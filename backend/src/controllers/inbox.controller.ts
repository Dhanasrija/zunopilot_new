import { channelForTenant } from '../services/whatsapp-account.service.js';
import { ConversationStatus } from '@prisma/client';
import { queryBool, queryEnum } from '../utils/query.js';
import { tenantIdOf, userOf } from '../middleware/auth.js';
import { can } from '../config/permissions.js';
import type { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { metaFailure } from '../services/meta-error.js';
import { isSimulatedChannel, whatsappProviderFor } from '../modules/conversation-engine/providers/whatsapp.js';
import { recordOutboundMessage } from '../modules/conversation-engine/providers/mirror.js';
import { mediaFor, publicUrlFor, publicUrlIsReachable } from '../modules/media/media.service.js';
import { describeMedia } from '../modules/media/inbound-media.js';
import { windowStateFor } from '../modules/support/ticket.service.js';
import { CUSTOMER_VIEW_SELECT } from '../utils/customer-view.js';
import { maskContact } from '../utils/mask-number.js';
import { maySeeFullNumbers } from '../utils/may-see-numbers.js';

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
      messages: { take: 1, orderBy: { createdAt: 'desc' } },
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
    where: { conversationId: id },
    orderBy: { createdAt: 'asc' },
    take: 500,
    include: { sentByUser: { select: { id: true, fullName: true, role: true } } },
  });
  res.json({ success: true, data: messages });
});

export const markRead = asyncHandler(async (req, res) => {
  const { id } = req.params;
  await prisma.conversation.updateMany({
    where: { id, tenantId: tenantIdOf(req) },
    data: { unreadCount: 0 },
  });
  res.json({ success: true });
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

  if (agentId) {
    const agent = await prisma.user.findFirst({
      where: { id: agentId, tenantId, isActive: true },
    });
    if (!agent) throw ApiError.badRequest('Invalid agent');
  }

  const takingFromSomeoneElse = existing.assignedAgentId
    && existing.assignedAgentId !== actor.id;
  const givingToSomeoneElse = agentId && agentId !== actor.id;

  if ((takingFromSomeoneElse || givingToSomeoneElse) && !can(actor.role, 'inbox:assign_others')) {
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
  const { body } = req.body;
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
  let sent: { messageId: string | null };
  try {
    sent = await whatsappProviderFor(wa).sendText({ to: conversation.customer.waId, body });
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
