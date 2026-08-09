import {
  Prisma, type Conversation, type Customer, type MessageType, type Tenant, type WhatsappAccount,
} from '@prisma/client';
import { prisma } from '../../../../config/prisma.js';
import { withContext } from '../../../../config/logger.js';
import { withAdvisoryLock } from '../../../../utils/withAdvisoryLock.js';
import type { NormalisedInboundMessage } from '../../http/webhook-intake.js';
import { routeInboundMessage } from '../../routing/index.js';
import { handleAgentQuickReply } from '../../routing/agent-quick-reply.js';
import { whatsappProviderFor } from '../../providers/whatsapp.js';
import { recordOutboundMessage } from '../../providers/mirror.js';
import { enqueue, QUEUES, type ProcessInboundMessageJob } from '../queue.js';
import { linkLeadToCustomer } from '../../../leads/lead.service.js';
import { handleConsentKeyword } from '../../../marketing/consent.service.js';
import { notifyInboundMessage } from '../../../notifications/notification.producers.js';
import { operatorDisplayName } from '../../../../utils/customer-name.js';
import {
  captureInboundMedia, describeMedia, isMediaType, messageTypeOf,
} from '../../../media/inbound-media.js';

// The inbound pipeline, running off the queue rather than in the request.
//
//   load event → resolve channel/contact/conversation → persist message
//     → human-handoff check → route → act
//
// Ordering is the subtle part. Two messages from the same customer can produce
// two jobs that run concurrently, and a worker pool gives no ordering guarantee
// at all. So rather than trusting the queue, this handler takes a per-customer
// advisory lock, uses it to *claim* that customer's pending events in timestamp
// order, and then processes them outside the lock. Whichever job wins the claim
// does the work; the other finds nothing to take and exits.
//
// The claim/process split matters as much as the ordering: the lock is a database
// transaction, and this pipeline makes two LLM calls and an HTTP request per
// message. Holding one across all of that burned a pooled connection per job for
// no reason. See the long note in `handleProcessInboundMessage`.

interface ResolvedContext {
  tenant: Tenant;
  channel: WhatsappAccount;
  contact: Customer;
  conversation: Conversation;
}

interface EventPayload {
  phoneNumberId: string | null;
  message: NormalisedInboundMessage;
}

const payloadOf = (raw: Prisma.JsonValue): EventPayload | null => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const payload = raw as unknown as EventPayload;
  return payload.message?.from ? payload : null;
};

/**
 * Resolve the channel, contact and conversation for a message.
 *
 * Runs inside the advisory lock: an unserialized find-then-create lets two
 * concurrent deliveries both miss and both insert, which is how duplicate empty
 * conversations appeared in the inbox before.
 */
const resolveContext = async (
  tx: Prisma.TransactionClient,
  payload: EventPayload,
): Promise<ResolvedContext | null> => {
  const { phoneNumberId, message } = payload;
  if (!phoneNumberId) return null;

  const channel = await tx.whatsappAccount.findFirst({
    where: { phoneNumberId },
    include: { tenant: true },
  });
  if (!channel) return null;

  const contact = await tx.customer.upsert({
    where: { tenantId_waId: { tenantId: channel.tenantId, waId: message.from } },
    // **`marketingOptIn` is deliberately absent from `update`.**
    //
    // Setting it here would resurrect consent every time an opted-out customer
    // sent any message at all — including the "STOP" that removed them. It
    // belongs only in `create`, where it records the one thing that actually
    // happened: this person wrote to the business first.
    //
    // **`name` is now absent for the same class of reason.** It used to be set from
    // `contacts[].profile.name` on every message, which meant an agent who labelled
    // someone "Ravi — accounts, chases invoices" lost it the next time Ravi wrote.
    // `name` is the agent's; `waProfileName` is Meta's and is refreshed here.
    update: {
      lastSeenAt: new Date(),
      ...(message.profileName ? { waProfileName: message.profileName } : {}),
    },
    create: {
      tenantId: channel.tenantId,
      waId: message.from,
      phone: message.from,
      // Only the profile name on create. An agent's label starts empty and stays empty until
      // somebody types one — that emptiness is what makes it possible to tell the two apart.
      waProfileName: message.profileName,
      lastSeenAt: new Date(),
      // Same rule the migration backfilled existing customers with. Without it
      // the backfill would be a one-off and every customer acquired afterwards
      // would be unreachable — the audience would quietly shrink to nothing.
      marketingOptIn: true,
      optInSource: 'inbound_message',
    },
  });

  const assistant = await tx.assistant.findFirst({
    where: { whatsappChannelId: channel.id, status: 'ACTIVE' },
  });

  const existing = await tx.conversation.findFirst({
    where: {
      tenantId: channel.tenantId,
      customerId: contact.id,
      status: { in: ['OPEN', 'HUMAN_TAKEOVER'] },
    },
    orderBy: { lastMessageAt: 'desc' },
  });

  const conversation = existing ?? await tx.conversation.create({
    data: {
      tenantId: channel.tenantId,
      customerId: contact.id,
      status: 'OPEN',
      assistantId: assistant?.id ?? null,
      externalConversationKey: `${channel.id}:${message.from}`,
      lastMessageAt: new Date(),
      unreadCount: 0,
    },
  });

  // Adopt the assistant if one was connected after the conversation started.
  if (assistant && !conversation.assistantId) {
    await tx.conversation.update({
      where: { id: conversation.id },
      data: { assistantId: assistant.id },
    });
    conversation.assistantId = assistant.id;
  }

  const { tenant, ...channelRow } = channel;
  return { tenant, channel: channelRow, contact, conversation };
};

/**
 * Meta's own interactive object, as the ordering state machine expects it.
 *
 * A template quick-reply arrives as `type: 'button'` with `button.payload` and
 * no `interactive` object at all, so that shape is translated into the
 * `button_reply` form rather than being dropped — the legacy path never handled
 * it, which is why template buttons did nothing.
 */
const metaInteractiveOf = (message: NormalisedInboundMessage): Record<string, unknown> | undefined => {
  const raw = message.raw as Record<string, any> | null;
  if (raw?.interactive) return raw.interactive as Record<string, unknown>;

  if (raw?.button?.payload) {
    return { type: 'button_reply', button_reply: { id: raw.button.payload, title: raw.button.text ?? '' } };
  }

  // Nothing from Meta, but our normaliser found a reply id — reconstruct the
  // shape so a tap is never lost just because it arrived unusually.
  if (message.interactive?.replyId) {
    const reply = { id: message.interactive.replyId, title: message.interactive.replyTitle ?? '' };
    return message.interactive.kind === 'list'
      ? { type: 'list_reply', list_reply: reply }
      : { type: 'button_reply', button_reply: reply };
  }

  return undefined;
};

/** The message types that carry a file rather than words. */
const MEDIA_MESSAGE_TYPES = new Set<MessageType>(['IMAGE', 'VIDEO', 'AUDIO', 'DOCUMENT']);

const ATTACHMENT_REPLY: Record<string, string> = {
  IMAGE: 'Thanks — we\'ve got your photo. Someone from the team will take a look.',
  VIDEO: 'Thanks — we\'ve got your video. Someone from the team will take a look.',
  AUDIO: 'Thanks — we\'ve got your voice message. Someone from the team will listen and reply.',
  DOCUMENT: 'Thanks — we\'ve got your document. Someone from the team will take a look.',
};

/**
 * Tell the customer the file arrived.
 *
 * Sent through the provider the rest of the engine uses, so a demo or simulated channel is
 * answered by the mock rather than attempting a live send with a fake token. Mirrored into the
 * Inbox for the same reason every other automated reply is: an agent who cannot see what the
 * bot already said will say it again.
 */
const acknowledgeAttachment = async (context: ResolvedContext, type: MessageType) => {
  const body = ATTACHMENT_REPLY[type] ?? 'Thanks — we\'ve got your attachment.';

  const sent = await whatsappProviderFor(context.channel)
    .sendText({ to: context.contact.waId, body });

  await recordOutboundMessage(
    {
      tenantId: context.tenant.id,
      conversationId: context.conversation.id,
      customerId: context.contact.id,
    },
    { type: 'TEXT', body, messageId: sent.messageId },
  );
};

const persistMessage = async (context: ResolvedContext, message: NormalisedInboundMessage) => {
  // Idempotent by wamid, because this runs on every retry.
  //
  // The WebhookEvent unique index stops *Meta* re-delivering the same message
  // twice. It does nothing about *pg-boss* retrying a job that already got past
  // this insert and then failed further down — at the router, at a send, at the
  // model. Without this check the retry died on the unique constraint before it
  // reached the thing that actually failed, so one transient error poisoned that
  // message permanently and the customer was never answered.
  const existing = await prisma.message.findFirst({
    where: { tenantId: context.tenant.id, waMessageId: message.externalMessageId },
  });
  if (existing) return existing;

  /*
   * A photo, video, document or voice note is fetched **now**, before the row is written.
   *
   * Meta hands over a media id, not a file, and that id expires. Doing this lazily when an
   * agent opens the conversation works for a few minutes and then silently stops, which
   * surfaces weeks later as "all the old photos are broken". Every image sent to this platform
   * before this shipped is already gone for that reason.
   *
   * A failure returns null and the message is still recorded: losing an attachment is bad,
   * losing the fact that a customer wrote to you because a download timed out is worse.
   */
  const captured = isMediaType(message.type)
    ? await captureInboundMedia({
      tenantId: context.tenant.id,
      accessToken: context.channel.accessToken,
      whatsappType: message.type,
      raw: message.raw,
    })
    : null;

  /*
   * The body for a file with no caption.
   *
   * `message.text` is the caption, and for a bare photo it is an empty string — which used to
   * reach the router as nothing at all, so the customer got the generic "sorry, I didn't catch
   * that" as though their photo had never arrived. A short description means the Inbox, the
   * notification and the assistant all say the same true thing.
   */
  const body = message.text
    || (captured ? describeMedia(captured.kind, captured.originalName) : message.text);

  /*
   * The message this one quotes, if the customer used WhatsApp's Reply.
   *
   * Looked up before the write rather than after, so the row is complete in one insert and there
   * is no window where a reply exists without its quote.
   */
  const quotedMessage = message.quotedWaMessageId
    ? await prisma.message.findFirst({
      where: { tenantId: context.tenant.id, waMessageId: message.quotedWaMessageId },
      select: { id: true },
    })
    : null;

  const created = await prisma.message.create({
    data: {
      tenantId: context.tenant.id,
      conversationId: context.conversation.id,
      customerId: context.contact.id,
      direction: 'INBOUND',
      // Was `SYSTEM` for everything that was not text, interactive or a location — so an
      // image and an unhandled system notice were indistinguishable, and the Inbox rendered
      // both as the literal string "[SYSTEM]".
      type: messageTypeOf(message.type),
      status: 'RECEIVED',
      waMessageId: message.externalMessageId,
      body,
      // Our own id, not Meta's URL. Meta's expires; this one is served by
      // `GET /api/media/:id/file`, authenticated and scoped to this workspace.
      mediaUrl: captured ? `/api/media/${captured.mediaAssetId}/file` : null,
      /*
       * What the customer replied to, resolved from Meta's wamid to our own row.
       *
       * Scoped by tenant, because `waMessageId` alone is half of
       * `@@unique([tenantId, waMessageId])` — the same lookup that let one workspace's delivery
       * status rewrite another's message before it was fixed.
       *
       * Null when we cannot find it, which is ordinary: the quote may be older than this
       * workspace's history, or a message we sent before the mirror existed. A missing quote
       * costs a small block of context; refusing the message over it would cost the message.
       */
      replyToId: quotedMessage?.id ?? null,
      // `payload.interactive` must keep META's shape, not our normalised one.
      //
      // The ordering state machine reads `interactive.list_reply.id` directly,
      // and `automation.service` decides whether a message is an interactive
      // reply the same way. Storing `{ replyId, replyTitle, kind }` here instead
      // silently broke both: the tap looked like plain text, fell through to the
      // LLM router, which answered "start ordering" and re-sent the category
      // list — an infinite menu loop on a live number.
      //
      // Our normalised form is kept alongside under a separate key for engine
      // code that prefers it.
      payload: {
        raw: message.raw,
        interactive: metaInteractiveOf(message),
        normalisedInteractive: message.interactive,
        location: message.location,
      } as unknown as Prisma.InputJsonValue,
    },
  });

  await prisma.conversation.update({
    where: { id: context.conversation.id },
    data: { lastMessageAt: new Date(), unreadCount: { increment: 1 } },
  });

  // Only reached for a genuinely new message: the `existing` check above returns
  // early on a pg-boss retry, so this does not re-ring. The dedupe key is belt and
  // braces for the case where this path and the webhook controller both see one
  // message — they key on the same wamid, so the second write collides.
  await notifyInboundMessage({
    tenantId: context.tenant.id,
    conversationId: context.conversation.id,
    // The label an agent typed, after WhatsApp's own name — "The Jora Group (Ravi)". Null
    // when neither exists, which is what lets the producer fall back to a *masked* number.
    customerName: operatorDisplayName(context.contact),
    waId: context.contact.waId,
    body: message.text,
    waMessageId: message.externalMessageId,
  });

  return created;
};

/** Process one already-resolved event. */
const processEvent = async (eventId: string): Promise<void> => {
  const event = await prisma.webhookEvent.findUnique({ where: { id: eventId } });
  if (!event || event.processingStatus === 'PROCESSED') return;

  const payload = payloadOf(event.payload);
  if (!payload) {
    await prisma.webhookEvent.update({
      where: { id: eventId },
      data: { processingStatus: 'IGNORED', error: 'Unrecognised payload shape', processedAt: new Date() },
    });
    return;
  }

  const context = await withAdvisoryLock(
    `wa:${payload.phoneNumberId}:${payload.message.from}`,
    (tx) => resolveContext(tx as unknown as Prisma.TransactionClient, payload),
  );

  if (!context) {
    await prisma.webhookEvent.update({
      where: { id: eventId },
      data: {
        processingStatus: 'IGNORED',
        error: `No channel connected for phone_number_id ${payload.phoneNumberId}`,
        processedAt: new Date(),
      },
    });
    return;
  }

  // A lead who finally messages stops being two records.
  //
  // Outside the advisory lock on purpose: this opens its own transaction, and it
  // never throws — a workspace without the Leads module has no rows to match, and
  // a failure here must not reject a customer's message.
  await linkLeadToCustomer(context.tenant.id, context.contact.id, payload.message.from);

  const logger = withContext({
    tenantId: context.tenant.id,
    conversationId: context.conversation.id,
    contactId: context.contact.id,
    messageId: event.id,
  });

  await prisma.webhookEvent.update({
    where: { id: eventId },
    data: { processingStatus: 'PROCESSING', tenantId: context.tenant.id },
  });

  try {
    const message = await persistMessage(context, payload.message);

    // "STOP" is answered before anything else can answer.
    //
    // Ahead of the human-takeover check, the keyword rules and the router, on
    // purpose. Someone who types STOP must not have an order workflow started on
    // them, and routing first would also spend a model call classifying a message
    // whose meaning is already known. It is recorded even on a paused
    // conversation, because withdrawing consent is not an automated reply — it is
    // the customer telling the business something.
    if (await handleConsentKeyword(
      {
        tenantId: context.tenant.id,
        customerId: context.contact.id,
        conversationId: context.conversation.id,
        waId: payload.message.from,
      },
      message.body,
    )) {
      logger.info('Consent keyword handled, not routing');
      await prisma.webhookEvent.update({
        where: { id: eventId },
        data: { processingStatus: 'PROCESSED', processedAt: new Date() },
      });
      return;
    }

    /*
     * A tap on a button a human agent sent.
     *
     * **Above the human-takeover check on purpose**, and it is the only thing that is. An agent who
     * sends buttons is, almost by definition, in a thread they have taken over — so below that
     * check a workflow-bound button could never fire in the one situation it exists for. Honouring
     * it is carrying out the agent's own instruction, not overriding it: they offered the button
     * and the customer accepted.
     *
     * Below the consent check, because STOP outranks an outstanding question.
     *
     * Returns `not-ours` for every id belonging to the ordering flow, a workflow node or an
     * operator's payload rule, so nothing else changes shape. See `agent-quick-reply.ts` for what
     * each of the chain's steps would otherwise do with one of these — two of them corrupt data
     * rather than merely misfire.
     */
    const quickReply = await handleAgentQuickReply({
      tenant: context.tenant,
      channel: context.channel,
      contact: context.contact,
      conversation: context.conversation,
      message: {
        id: message.id,
        body: message.body ?? '',
        type: message.type,
        payload: message.payload,
        interactive: payload.message.interactive,
      },
    });
    if (quickReply !== 'not-ours') {
      logger.info('Handled a tap on an agent-sent button', { outcome: quickReply });
      await prisma.webhookEvent.update({
        where: { id: eventId },
        data: { processingStatus: 'PROCESSED', processedAt: new Date() },
      });
      return;
    }

    // A conversation a human has taken over gets no automated reply at all —
    // checked before routing, not after, so no model is called and no workflow
    // starts for a thread an agent is handling.
    if (context.conversation.automationPaused || context.conversation.status === 'HUMAN_TAKEOVER') {
      logger.info('Automation paused for this conversation, not routing');
      await prisma.webhookEvent.update({
        where: { id: eventId },
        data: { processingStatus: 'PROCESSED', processedAt: new Date() },
      });
      return;
    }

    /*
     * A file with no caption is acknowledged, not routed.
     *
     * The model cannot see the image. Handing it "[photo]" produces a confident answer about
     * nothing, and with the agent off it reaches the generic fallback — which reads to the
     * customer as though the photo never arrived. Neither is honest; both were what happened
     * before this.
     *
     * A caption is different: that is a real message and goes through the router as normal,
     * with the file sitting beside it in the Inbox for whoever picks it up.
     *
     * Deliberately after the cart and the human-takeover checks above, so a flow that is
     * *expecting* a document — upload your prescription, send a photo of the damage — still
     * gets it, and a thread an agent has taken over stays silent.
     */
    if (MEDIA_MESSAGE_TYPES.has(message.type) && !payload.message.text.trim()) {
      await acknowledgeAttachment(context, message.type);
      logger.info('Acknowledged an attachment with no caption', { type: message.type });
      await prisma.webhookEvent.update({
        where: { id: eventId },
        data: { processingStatus: 'PROCESSED', processedAt: new Date() },
      });
      return;
    }

    /*
     * A message with nothing in it we can act on is recorded and left alone.
     *
     * ── The bug this closes ──────────────────────────────────────────────────
     *
     * A WhatsApp Flow submission, a reaction, a native catalogue order: each arrives with no text
     * our normaliser could read, and each was handed to the router as an empty string. The router
     * has nothing to classify, so the model answered from the previous turn — and a live customer
     * was told the same thing twice for something they never said. The Inbox drew `[INTERACTIVE]`
     * beside it.
     *
     * ── Why the test is this narrow and not "any empty body" ─────────────────
     *
     * **A bare location pin has an empty body and must still route.** `textOf` builds its text from
     * the pin's name and address, and a dropped pin has neither — but the ordering flow reads
     * `payload.location` and treats it as the answer to "where do we deliver?". Swallowing that
     * would break checkout.
     *
     * Media is excluded for the opposite reason: it has its own acknowledgement above, which sends
     * something, because a photo with no caption is usually a question.
     *
     * So: no readable text, no reply id we could route on, and not a pin. Silence rather than an
     * apology — the customer performed an action, not asked a question, and "I could not read that"
     * would be wrong in every case where we simply have not taught the normaliser a shape yet.
     */
    const unreadable = !payload.message.text.trim()
      && !payload.message.interactive?.replyId
      && !payload.message.location;

    if (unreadable) {
      /*
       * Logged at warn with the shape and no content.
       *
       * This is the line that turns "a customer noticed" into "the logs noticed". The keys are the
       * useful part — `nfm_reply` versus something Meta has not documented yet — and none of them is
       * the customer's data.
       */
      // `raw` is `unknown` on the normalised shape, deliberately — nothing downstream should be
      // reading Meta's envelope by field. Narrowed here, for a log line, and nowhere else.
      const raw = (payload.message.raw ?? {}) as { type?: string; interactive?: Record<string, unknown> };
      logger.warn('An inbound message had nothing to route, so it was recorded only', {
        type: message.type,
        whatsappType: raw.type ?? null,
        interactiveKeys: Object.keys(raw.interactive ?? {}),
      });
      await prisma.webhookEvent.update({
        where: { id: eventId },
        data: { processingStatus: 'PROCESSED', processedAt: new Date() },
      });
      return;
    }

    await routeInboundMessage({
      tenant: context.tenant,
      channel: context.channel,
      contact: context.contact,
      conversation: context.conversation,
      message: {
        id: message.id,
        body: message.body ?? '',
        type: message.type,
        payload: message.payload,
        interactive: payload.message.interactive,
      },
    });

    await prisma.webhookEvent.update({
      where: { id: eventId },
      data: { processingStatus: 'PROCESSED', processedAt: new Date() },
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger.error('Inbound processing failed', { error });
    await prisma.webhookEvent.update({
      where: { id: eventId },
      data: { processingStatus: 'FAILED', error, processedAt: new Date() },
    });
    // Rethrow so pg-boss retries — a dropped inbound message is a lost customer.
    throw err;
  }
};

/**
 * How many of a customer's backlogged events one job will drain.
 *
 * Was 50. Each event costs two LLM calls and a send — call it two and a half seconds — so 50
 * meant a single conversation could hold a worker slot for two minutes while every other tenant
 * waited behind it. Eight is enough to keep a genuine burst in order, and whatever is left over
 * is still queued and gets picked up by the next job for that customer.
 */
const MAX_DRAIN = 8;

/**
 * After this long, a `PROCESSING` row is assumed abandoned rather than in flight.
 *
 * Events are normally claimed and finished within seconds. Anything still `PROCESSING` after ten
 * minutes belongs to a process that died between claiming and finishing, and must be reclaimable
 * or that customer's messages are stranded forever. Generous on purpose: reclaiming something
 * that *is* still running would process it twice.
 */
const STALE_CLAIM_MS = 10 * 60_000;

export const handleProcessInboundMessage = async (
  { webhookEventId }: ProcessInboundMessageJob,
): Promise<void> => {
  const event = await prisma.webhookEvent.findUnique({ where: { id: webhookEventId } });
  if (!event) return;

  const payload = payloadOf(event.payload);
  if (!payload) {
    await processEvent(webhookEventId);
    return;
  }

  /*
   * Claim, then process — and the split is the whole point of this shape.
   *
   * Ordering still needs serialising per customer: two messages produce two jobs, the pool gives
   * no ordering guarantee, and processing "2" before "1" corrupts a workflow's state. So a
   * per-customer advisory lock is still taken. What changed is *how long* it is held.
   *
   * It used to wrap the entire drain: `withAdvisoryLock(key, () => { for (...) await
   * processEvent(id) })`. That kept a Prisma transaction — and therefore a pooled connection —
   * open across two LLM calls and an HTTP POST to Meta, per in-flight job. The callback did not
   * even use the transaction it was handed; `processEvent` works on the global client, so the
   * connection sat `idle in transaction` doing nothing while the real work competed for others
   * from the same pool. On a small instance, where Prisma's default pool is a handful of
   * connections, five concurrent jobs could exhaust it and then time out waiting for
   * themselves. `withAdvisoryLock`'s own comment forbids exactly this: "Outbound HTTP (Meta) and
   * the automation engine must stay outside."
   *
   * Now the lock covers only the claim — a select and an update, no network — and the work
   * happens outside it. Mutual exclusion is preserved by the claim itself: whoever wins marks the
   * batch `PROCESSING`, so a concurrent job for the same customer finds nothing to take and
   * exits, exactly as it used to find nothing left to drain.
   */
  const lockKey = `inbound:${payload.phoneNumberId}:${payload.message.from}`;
  const staleBefore = new Date(Date.now() - STALE_CLAIM_MS);

  const claimed = await withAdvisoryLock(lockKey, async (tx) => {
    const pending = await tx.webhookEvent.findMany({
      where: {
        source: 'whatsapp',
        // Scoped to this channel as well as this customer. Filtering on `message.from` alone
        // meant that when one person messaged two businesses on the platform, either tenant's
        // job could pull the other's events into its own drain.
        payload: {
          path: ['message', 'from'],
          equals: payload.message.from,
        },
        OR: [
          { processingStatus: { in: ['PENDING', 'FAILED'] } },
          // Reclaim what a crashed process left behind; see STALE_CLAIM_MS.
          { processingStatus: 'PROCESSING', createdAt: { lt: staleBefore } },
        ],
      },
      orderBy: { createdAt: 'asc' },
      select: { id: true, payload: true },
      take: MAX_DRAIN,
    });

    // Keep only this channel's events. Done here rather than in the `where` because the
    // phoneNumberId sits in the same JSON blob and Prisma cannot express two paths on one field.
    const mine = pending
      .filter((row) => payloadOf(row.payload)?.phoneNumberId === payload.phoneNumberId)
      .map((row) => row.id);

    /*
     * The fallback: if the scan found nothing, fall back to the event this job names — but
     * **only if that event is still claimable**.
     *
     * The filter is the whole point, and without it there was a duplicate-reply bug. pg-boss is
     * at-least-once: a worker that finishes the work and then dies before acking gets the same
     * job redelivered. On that redelivery the scan finds nothing (everything is `PROCESSED`), so
     * the old unconditional fallback took the triggering id anyway and the `updateMany` below
     * flipped it from `PROCESSED` back to `PROCESSING`. That defeated the terminal-state guard
     * at the top of `processEvent`, which then routed the message a second time — and the
     * customer received the same reply twice.
     *
     * `processEvent` cannot defend itself here: by the time it reads the row, this transaction
     * has already overwritten the status it would have checked. So the claim has to be the thing
     * that refuses, using the same claimability predicate as the scan above.
     */
    const ids = mine.length
      ? mine
      : (await tx.webhookEvent.findMany({
        where: {
          id: webhookEventId,
          OR: [
            { processingStatus: { in: ['PENDING', 'FAILED'] } },
            { processingStatus: 'PROCESSING', createdAt: { lt: staleBefore } },
          ],
        },
        select: { id: true },
      })).map((row) => row.id);

    if (!ids.length) return [];

    await tx.webhookEvent.updateMany({
      where: { id: { in: ids } },
      data: { processingStatus: 'PROCESSING' },
    });

    return ids;
  });

  for (const id of claimed) {
    // Sequential on purpose: this is the ordering guarantee. Concurrency across *different*
    // customers comes from the worker's own concurrency, not from here.
    // eslint-disable-next-line no-await-in-loop
    await processEvent(id);
  }
};

/** Enqueue processing for freshly recorded events. */
export const enqueueInboundEvents = async (eventIds: string[]): Promise<void> => {
  for (const webhookEventId of eventIds) {
    await enqueue(QUEUES.processInboundMessage, { webhookEventId });
  }
};
