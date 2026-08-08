import { channelForTenant } from '../services/whatsapp-account.service.js';
import { ConversationStatus } from '@prisma/client';
import { queryBool, queryEnum } from '../utils/query.js';
import { holds, tenantIdOf, userOf } from '../middleware/auth.js';
import type { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma.js';
import { logger } from '../config/logger.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { metaFailure } from '../services/meta-error.js';
import { isSimulatedChannel, whatsappProviderFor } from '../modules/conversation-engine/providers/whatsapp.js';
import { recordOutboundMessage } from '../modules/conversation-engine/providers/mirror.js';
import { mediaFor, publicUrlFor, publicUrlIsReachable } from '../modules/media/media.service.js';
import { describeMedia } from '../modules/media/inbound-media.js';
import { windowStateFor } from '../modules/support/ticket.service.js';
import { markReadForConversation } from '../modules/notifications/notification.service.js';
import { CUSTOMER_VIEW_SELECT } from '../utils/customer-view.js';
import { maskContact } from '../utils/mask-number.js';
import { maySeeFullNumbers } from '../utils/may-see-numbers.js';
import { requireActiveMember } from '../services/membership.service.js';

/**
 * The filter every human-facing message read must carry.
 *
 * A named constant rather than `deletedAt: null` written out five times, because the failure mode
 * is one site missing it — a removed message reappearing in the conversation preview, or on the
 * customer's profile, while being absent from the thread. One expression means one thing to get
 * right.
 *
 * Deliberately **not** used by `windowStateFor`, the analytics counters, the super admin activity
 * view or webhook deduplication. Those reason about what actually happened, and hiding a row from
 * them would let an agent change what WhatsApp permits by tidying a thread. See the note on
 * `Message.deletedAt` in schema.prisma.
 */
export const VISIBLE_MESSAGE = { deletedAt: null } as const;

// Gets-or-creates an OPEN conversation for the given customer.
// Used by the CRM "Start conversation" button so agents can jump from a
// customer profile straight into the inbox.
export const startConversation = asyncHandler(async (req, res) => {
  const { customerId } = req.body;
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, tenantId: tenantIdOf(req) },
  });
  if (!customer) throw ApiError.notFound('Customer not found');

  let conversation = await prisma.conversation.findFirst({
    where: {
      tenantId: tenantIdOf(req),
      customerId: customer.id,
      status: { in: ['OPEN', 'HUMAN_TAKEOVER'] },
    },
    orderBy: { lastMessageAt: 'desc' },
  });
  if (!conversation) {
    conversation = await prisma.conversation.create({
      data: {
        tenantId: tenantIdOf(req),
        customerId: customer.id,
        status: 'HUMAN_TAKEOVER',
        automationPaused: true,
        assignedAgentId: userOf(req).id,
        lastMessageAt: new Date(),
      },
    });
  }

  res.status(201).json({ success: true, data: conversation });
});

export const listConversations = asyncHandler(async (req, res) => {
  const status = queryEnum(req.query.status, Object.values(ConversationStatus));
  const where: Prisma.ConversationWhereInput = { tenantId: tenantIdOf(req) };
  if (status) where.status = status;
  if (queryBool(req.query.assignedToMe)) where.assignedAgentId = userOf(req).id;
  // The shared pool: what nobody has picked up. This is the queue an agent
  // works from, so it needs to be one filter rather than a visual scan.
  if (queryBool(req.query.unassigned)) where.assignedAgentId = null;

  // Resolved once for the whole page rather than per row: it is one tenant read, and
  // computing it inside a map would run it a hundred times.
  const seeFull = await maySeeFullNumbers(req);

  const conversations = await prisma.conversation.findMany({
    where,
    include: {
      // An explicit select, not `customer: true`. The spread is what put the phone number
      // on this screen in the first place, and it would ship the next new column too.
      customer: { select: CUSTOMER_VIEW_SELECT },
      assignedAgent: { select: { id: true, fullName: true, email: true } },
      // Filtered too. Removing the newest message and still seeing it quoted in the list is
      // the most obvious way a half-applied soft delete announces itself.
      messages: { take: 1, orderBy: { createdAt: 'desc' }, where: VISIBLE_MESSAGE },
      // **The workflow occupying this conversation, if any.**
      //
      // Needed because a conversation holds one active instance at a time, and while it
      // does the router refuses every inbound message with `ACTIVE_WORKFLOW_BUSY`. That is
      // right for a flow mid-question and wrong for one parked at a handoff — but without
      // this the Inbox could not tell the two apart, so an agent had no way to see that the
      // bot was stuck, let alone hand control back.
      activeWorkflowInstance: {
        select: {
          id: true,
          status: true,
          currentNodeId: true,
          workflow: { select: { name: true } },
        },
      },
    },
    orderBy: { lastMessageAt: 'desc' },
    take: 100,
  });

  res.json({
    success: true,
    data: conversations.map((conversation) => ({
      ...conversation,
      customer: maskContact(conversation.customer, seeFull),
    })),
  });
});

export const getConversation = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const conversation = await prisma.conversation.findFirst({
    where: { id, tenantId: tenantIdOf(req) },
    include: {
      customer: { select: CUSTOMER_VIEW_SELECT },
      assignedAgent: { select: { id: true, fullName: true, email: true } },
      notes: { include: { author: { select: { id: true, fullName: true } } }, orderBy: { createdAt: 'desc' } },
    },
  });
  if (!conversation) throw ApiError.notFound('Conversation not found');

  res.json({
    success: true,
    data: {
      ...conversation,
      customer: maskContact(conversation.customer, await maySeeFullNumbers(req)),
    },
  });
});

export const listMessages = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const conversation = await prisma.conversation.findFirst({ where: { id, tenantId: tenantIdOf(req) } });
  if (!conversation) throw ApiError.notFound('Conversation not found');
  const messages = await prisma.message.findMany({
    where: { conversationId: id, ...VISIBLE_MESSAGE },
    orderBy: { createdAt: 'asc' },
    take: 500,
    include: {
      sentByUser: { select: { id: true, fullName: true, role: true } },
      /*
       * The quoted message, as a snippet rather than the whole row.
       *
       * An explicit `select`, not `replyTo: true` — the spread is what put a phone number on this
       * screen once already, and a quote needs four fields. `body` is truncated in the UI, not
       * here: the thread already ships full bodies for every message, so trimming only the quote
       * would save nothing and lose the ability to show a longer preview later.
       *
       * One level deep on purpose. A reply to a reply renders its own quote, not a chain — Prisma
       * would happily nest for ever and WhatsApp does not show chains either.
       */
      replyTo: {
        select: { id: true, direction: true, type: true, body: true, deletedAt: true },
      },
    },
  });

  /*
   * A quote whose target has since been removed is dropped from the response.
   *
   * `replyTo` is a relation, so `VISIBLE_MESSAGE` on the outer `where` does not reach it — a
   * removed message would still have come back through the quote of a reply to it, which is
   * exactly the leak the soft delete exists to prevent. The reply itself stays; it just loses
   * its quote block.
   */
  const visible = messages.map((message) => ({
    ...message,
    replyTo: message.replyTo?.deletedAt ? null : message.replyTo,
  }));

  res.json({ success: true, data: visible });
});

/**
 * The agent has read this thread.
 *
 * **Clears both counters, in one transaction.** `Conversation.unreadCount` draws the badge on
 * the row; unread `Notification` rows draw the bell. They describe the same fact, so an agent
 * who reads a thread must not be left with a bell insisting eight things are waiting — and
 * letting the two writes half-succeed is precisely how they would drift apart again.
 *
 * `updateMany` rather than `update`, so an unknown or other-tenant id is a no-op rather than a
 * throw. This fires from a poll-driven page on every thread open; a 404 race with a colleague
 * clearing a thread is not something worth surfacing to anyone.
 *
 * Idempotent by construction — `unreadCount: 0` on an already-zero row and `readAt: null` on
 * an already-read notification both change nothing.
 */
export const markRead = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const tenantId = tenantIdOf(req);

  const { cleared, notificationsRead } = await prisma.$transaction(async (tx) => {
    const conversation = await tx.conversation.updateMany({
      where: { id, tenantId },
      data: { unreadCount: 0 },
    });
    /*
     * An interactive transaction rather than the array form, so the recipient scoping lives in
     * `markReadForConversation` and nowhere else. Two updateManys against one database — the
     * transaction holds nothing slow, unlike the routing path this rule was written for.
     */
    const notificationsRead = await markReadForConversation(tenantId, userOf(req).id, id, tx);
    return { cleared: conversation.count > 0, notificationsRead };
  });

  res.json({ success: true, data: { cleared, notificationsRead } });
});

/**
 * Assign, claim, or release a conversation.
 *
 * The rule that makes a *shared* inbox work rather than a free-for-all: anyone
 * may claim something unassigned, and anyone may put their own back, but taking
 * a conversation off a colleague mid-thread needs `inbox:assign_others`. Two
 * agents silently swapping a live customer between them is how a customer gets
 * asked the same question twice.
 */
export const assignAgent = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { agentId } = req.body;
  const tenantId = tenantIdOf(req);
  const actor = userOf(req);

  const existing = await prisma.conversation.findFirst({ where: { id, tenantId } });
  if (!existing) throw ApiError.notFound('Conversation not found');

  // Was `'Invalid agent'`, which named a field rather than the problem. The shared helper's
  // sentence says what is actually wrong, and the check is the same one leads and tickets make.
  if (agentId) await requireActiveMember(tenantId, agentId);

  const takingFromSomeoneElse = existing.assignedAgentId
    && existing.assignedAgentId !== actor.id;
  const givingToSomeoneElse = agentId && agentId !== actor.id;

  /*
   * `holds`, not `can`.
   *
   * **`can(actor.role, …)` asked the wrong question.** It reads
   * `ROLE_PERMISSIONS[legacyEnum]` — the three built-in role templates — so a workspace that
   * built a custom role granting `inbox:assign_others` was refused anyway, and the only
   * explanation on screen was "Ask a manager to reassign it" to someone who *was* the manager.
   * Custom roles have existed since `Role` arrived; this was the last site where the legacy enum
   * still decided policy rather than acting as a label.
   *
   * `holds` reads `req.permissions`, which `requireAuth` resolved from the actual role — the
   * same source every `requirePermission` gate uses.
   */
  if ((takingFromSomeoneElse || givingToSomeoneElse) && !holds(req, 'inbox:assign_others')) {
    throw ApiError.forbidden(
      takingFromSomeoneElse
        ? 'This conversation is assigned to someone else. Ask a manager to reassign it.'
        : 'Your role can only assign conversations to yourself.',
    );
  }

  const conv = await prisma.conversation.update({
    where: { id },
    data: { assignedAgentId: agentId || null },
    include: { assignedAgent: { select: { id: true, fullName: true, email: true } } },
  });
  res.json({ success: true, data: conv });
});

// Module 5: human takeover toggle. When paused, automation engine skips this conversation.
export const setAutomation = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { paused } = req.body;
  const existing = await prisma.conversation.findFirst({ where: { id, tenantId: tenantIdOf(req) } });
  if (!existing) throw ApiError.notFound('Conversation not found');
  const conv = await prisma.conversation.update({
    where: { id },
    data: {
      automationPaused: !!paused,
      status: paused ? 'HUMAN_TAKEOVER' : 'OPEN',
    },
  });
  res.json({ success: true, data: conv });
});

export const sendAgentMessage = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { body, replyToId } = req.body as { body: string; replyToId?: string };
  const conversation = await prisma.conversation.findFirst({
    where: { id, tenantId: tenantIdOf(req) },
    // **Left as a spread on purpose, and not masked.** This is the one `customer: true` in
    // this file that never reaches a client: the response below is the created `Message`,
    // and the row is loaded solely for `customer.waId` — the address the WhatsApp send is
    // made to a few lines down. Masking here would send messages to a row of bullets.
    include: { customer: true },
  });
  if (!conversation) throw ApiError.notFound('Conversation not found');
  const wa = await channelForTenant(conversation.tenantId);
  if (!wa) throw ApiError.badRequest('WhatsApp not connected');

  // Through the same adapter the engine uses, not straight at Meta.
  //
  // `whatsappProviderFor` honours the per-channel rule that a `mock-token-`
  // channel is always served by the mock provider. Calling Meta directly here
  // meant an operator could not reply at all on a demo or test workspace — the
  // bot could talk to the customer and the human could not, which is exactly
  // backwards for a shared inbox.
  /*
   * The message being quoted, if any.
   *
   * Scoped to this conversation, not just this tenant: quoting a message from a *different*
   * customer's thread would send that customer's words to this one. `deletedAt: null` too — a
   * message somebody removed from the inbox should not be quotable back into it.
   *
   * A missing or unquotable target is a 400 rather than a silent downgrade to an unquoted send.
   * The agent chose Reply on a specific bubble; sending something else and saying nothing is how
   * a reply ends up attached to the wrong question.
   */
  const quoted = replyToId
    ? await prisma.message.findFirst({
      where: {
        id: replyToId,
        conversationId: conversation.id,
        tenantId: tenantIdOf(req),
        deletedAt: null,
      },
      select: { id: true, waMessageId: true },
    })
    : null;

  if (replyToId && !quoted) {
    throw ApiError.badRequest('That message is no longer in this conversation, so it cannot be quoted');
  }

  let sent: { messageId: string | null };
  try {
    sent = await whatsappProviderFor(wa).sendText({
      to: conversation.customer.waId,
      body,
      /*
       * Null when we never had a wamid for the quoted row — a mock-channel message, or one whose
       * id was dropped by the mirror's duplicate fallback. WhatsApp then shows no quote on the
       * customer's phone, while our own thread still renders it from `replyToId`. A partial quote
       * beats refusing the reply, and refusing it is what sending an unresolvable `context` to
       * Meta would do.
       */
      quotedWaMessageId: quoted?.waMessageId ?? null,
    });
  } catch (err) {
    // Meta explains its own refusals well; the job here is only to stop that explanation
    // being thrown away. Rethrowing the `AxiosError` made every one of them a 500
    // "Internal server error" — including "recipient not in allowed list" and the expired
    // 24-hour window, both of which the agent can act on and neither of which is a fault
    // of ours. `metaFailure` returns null for anything that is not a Graph rejection, so a
    // real bug in here still surfaces as one.
    throw metaFailure(err) ?? err;
  }

  const msg = await recordOutboundMessage(
    {
      tenantId: tenantIdOf(req),
      conversationId: conversation.id,
      customerId: conversation.customerId,
    },
    {
      type: 'TEXT',
      body,
      messageId: sent.messageId,
      // Who typed it. A null here on an OUTBOUND row means the bot, which is
      // the distinction the shared inbox is built on.
      sentByUserId: userOf(req).id,
      replyToId: quoted?.id ?? null,
    },
  );
  await prisma.conversation.update({
    where: { id: conversation.id },
    data: { lastMessageAt: new Date() },
  });
  res.status(201).json({ success: true, data: msg });
});

/**
 * Send a customer a file.
 *
 * The agent uploads it first through `POST /api/media`, then names the id here — so the bytes
 * are validated, stored and given a URL by the one path that already does that, rather than a
 * second uploader that would eventually disagree with the first.
 *
 * **Meta fetches the file from us**, which is why it has to be an `UPLOAD` asset: those are
 * servable on the open route precisely because Meta cannot present a token. An `INBOUND` file —
 * something a customer sent — is deliberately not reachable there, so forwarding one back is
 * refused rather than silently failing at Meta with a download error.
 */
export const sendAgentMedia = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { mediaId, caption } = req.body as { mediaId?: string; caption?: string };
  if (!mediaId) throw ApiError.badRequest('Choose a file to send');

  const conversation = await prisma.conversation.findFirst({
    where: { id, tenantId: tenantIdOf(req) },
    include: { customer: true },
  });
  if (!conversation) throw ApiError.notFound('Conversation not found');

  /*
   * The 24-hour window, checked before the send rather than after Meta refuses it.
   *
   * Outside it WhatsApp allows templates only, and a template's media is fixed when the
   * template is approved — so "send this customer a photo" is genuinely impossible, not merely
   * blocked. Saying so here means the agent finds out before they pick a file, and reuses the
   * same rule the ticket sender applies rather than a second copy that could drift.
   */
  const window = await windowStateFor(tenantIdOf(req), conversation.id);
  if (!window.open) {
    throw ApiError.badRequest(
      window.reason === 'never_messaged'
        ? 'This customer has never messaged you, so WhatsApp will not accept a file. They have to write first.'
        : 'WhatsApp only allows a file within 24 hours of the customer’s last message. '
          + 'That window has closed — send a template, or wait for them to write again.',
    );
  }

  const asset = await mediaFor(tenantIdOf(req), mediaId);
  if (asset.source !== 'UPLOAD') {
    throw ApiError.badRequest(
      'That file came from a customer and cannot be sent back. Upload your own copy instead.',
    );
  }

  const wa = await channelForTenant(conversation.tenantId);
  if (!wa) throw ApiError.badRequest('WhatsApp not connected');

  // Said here rather than left to Meta, which reports it as a generic media download failure
  // that reads like our bug. On a laptop `APP_URL` is localhost and Meta cannot reach it.
  //
  // Only for a real channel: a simulated one never fetches the link, so refusing a demo or a
  // test workspace over an address nobody will dial would be a rule with no purpose.
  if (!isSimulatedChannel(wa) && !publicUrlIsReachable()) {
    throw ApiError.badRequest(
      'WhatsApp fetches the file from this server, and APP_URL is not a public https address. '
      + 'Sending files needs a reachable APP_URL.',
    );
  }

  let sent: { messageId: string | null };
  try {
    sent = await whatsappProviderFor(wa).sendMedia({
      to: conversation.customer.waId,
      kind: asset.kind,
      link: publicUrlFor(asset),
      caption: caption ?? null,
      filename: asset.originalName,
    });
  } catch (err) {
    throw metaFailure(err) ?? err;
  }

  const msg = await recordOutboundMessage(
    {
      tenantId: tenantIdOf(req),
      conversationId: conversation.id,
      customerId: conversation.customerId,
    },
    {
      type: asset.kind,
      body: caption?.trim() || describeMedia(asset.kind, asset.originalName),
      messageId: sent.messageId,
      sentByUserId: userOf(req).id,
      // Our own id, not the public link: the thread is read by an agent, and the
      // authenticated route is the one that keeps working when the asset is later made
      // private.
      mediaUrl: `/api/media/${asset.id}/file`,
    },
  );

  await prisma.conversation.update({
    where: { id: conversation.id },
    data: { lastMessageAt: new Date() },
  });

  res.status(201).json({ success: true, data: msg });
});

/*
 * ── Removing messages from a thread ──────────────────────────────────────────
 *
 * **This is not an unsend, and the wording everywhere says so.** The WhatsApp Cloud API has no
 * endpoint to delete a message the business already sent, so the customer keeps their copy no
 * matter what happens here. Calling the button "Delete" would promise something WhatsApp does not
 * offer; it says "Remove from inbox".
 *
 * A soft delete for a reason beyond reversibility: a message is the evidence in a payment dispute
 * and the context of a support ticket. An agent tidying a thread must not be able to destroy the
 * record of what a customer was promised. So the row stays, `deletedAt` hides it from the five
 * human-facing reads, and `deletedByUserId` answers the question a shared inbox always asks next.
 */

/** Remove one message. */
export const deleteMessage = asyncHandler(async (req, res) => {
  const { id } = req.params;

  /*
   * `updateMany` with the tenant in the `where`, not `findUnique` then `update`.
   *
   * One statement means there is no window between the check and the write, and no version of
   * this that can touch another workspace's message. `count === 0` covers both "no such message"
   * and "not yours" with the same 404, which is also the answer that does not confirm an id
   * exists in a workspace the caller cannot see.
   *
   * `deletedAt: null` in the where makes it idempotent: removing the same message twice keeps
   * the first person's name and timestamp rather than overwriting them with the second's.
   */
  const { count } = await prisma.message.updateMany({
    where: { id, tenantId: tenantIdOf(req), deletedAt: null },
    data: { deletedAt: new Date(), deletedByUserId: userOf(req).id },
  });

  if (count === 0) {
    // Already removed, never existed, or belongs to someone else. A 404 for all three.
    throw ApiError.notFound('Message not found');
  }

  logger.info('Message removed from the inbox', {
    tenantId: tenantIdOf(req), messageId: id, byUserId: userOf(req).id,
  });

  res.json({ success: true, data: { removed: 1 } });
});

/**
 * Remove every message in a thread.
 *
 * **Messages only.** The conversation, the customer, their orders, the internal notes and any
 * linked support ticket all survive — the thread stays in the list and reads as empty. Deleting
 * the conversation row instead would cascade into its notes and workflow instances and unlink a
 * ticket, which is a great deal of collateral for "clear this chat".
 */
export const deleteThread = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const conversation = await prisma.conversation.findFirst({
    where: { id, tenantId: tenantIdOf(req) },
    select: { id: true },
  });
  if (!conversation) throw ApiError.notFound('Conversation not found');

  const count = await prisma.$transaction(async (tx) => {
    const removed = await tx.message.updateMany({
      where: { conversationId: conversation.id, deletedAt: null },
      data: { deletedAt: new Date(), deletedByUserId: userOf(req).id },
    });

    /*
     * The counters go with the messages.
     *
     * An unread badge of 10 on a thread with nothing in it is the most obvious way this could
     * lie, and a bell entry quoting a message that no longer exists is the same lie one screen
     * over. Clearing a thread is unambiguously "I have dealt with this", so both are stale the
     * moment the messages are hidden.
     */
    await tx.conversation.updateMany({
      where: { id: conversation.id, tenantId: tenantIdOf(req) },
      data: { unreadCount: 0 },
    });
    await markReadForConversation(tenantIdOf(req), userOf(req).id, conversation.id, tx);

    return removed.count;
  });

  /*
   * `lastMessageAt` is deliberately left alone.
   *
   * It orders the conversation list, and rewriting it would jump a thread somebody had just
   * tidied to the bottom of the queue — or to the top, depending on the null handling. It is a
   * record of when the customer last made contact, which is still true.
   */
  logger.info('Thread cleared', {
    tenantId: tenantIdOf(req), conversationId: id, removed: count, byUserId: userOf(req).id,
  });

  res.json({ success: true, data: { removed: count } });
});

export const addNote = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { body } = req.body;
  const conversation = await prisma.conversation.findFirst({ where: { id, tenantId: tenantIdOf(req) } });
  if (!conversation) throw ApiError.notFound();
  const note = await prisma.internalNote.create({
    data: { conversationId: id, authorId: userOf(req).id, body },
    include: { author: { select: { id: true, fullName: true } } },
  });
  res.status(201).json({ success: true, data: note });
});
