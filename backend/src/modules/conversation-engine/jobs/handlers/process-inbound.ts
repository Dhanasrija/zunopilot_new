import { Prisma, type Conversation, type Customer, type Tenant, type WhatsappAccount } from '@prisma/client';
import { prisma } from '../../../../config/prisma.js';
import { withContext } from '../../../../config/logger.js';
import { withAdvisoryLock } from '../../../../utils/withAdvisoryLock.js';
import type { NormalisedInboundMessage } from '../../http/webhook-intake.js';
import { routeInboundMessage } from '../../routing/index.js';
import { enqueue, QUEUES, type ProcessInboundMessageJob } from '../queue.js';
import { linkLeadToCustomer } from '../../../leads/lead.service.js';
import { handleConsentKeyword } from '../../../marketing/consent.service.js';
import { notifyInboundMessage } from '../../../notifications/notification.producers.js';

// The inbound pipeline, running off the queue rather than in the request.
//
//   load event → resolve channel/contact/conversation → persist message
//     → human-handoff check → route → act
//
// Ordering is the subtle part. Two messages from the same customer can produce
// two jobs that run concurrently, and a worker pool gives no ordering guarantee
// at all. So rather than trusting the queue, this handler takes a per-customer
// advisory lock and then drains *every* pending event for that customer in
// timestamp order. Whichever job wins the lock processes the backlog correctly;
// the other finds nothing left to do.

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
    update: { lastSeenAt: new Date(), ...(message.profileName ? { name: message.profileName } : {}) },
    create: {
      tenantId: channel.tenantId,
      waId: message.from,
      phone: message.from,
      name: message.profileName,
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

  const created = await prisma.message.create({
    data: {
      tenantId: context.tenant.id,
      conversationId: context.conversation.id,
      customerId: context.contact.id,
      direction: 'INBOUND',
      type: message.type === 'text' ? 'TEXT'
        : message.type === 'interactive' || message.type === 'button' ? 'INTERACTIVE'
          : message.type === 'location' ? 'LOCATION'
            : 'SYSTEM',
      status: 'RECEIVED',
      waMessageId: message.externalMessageId,
      body: message.text,
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
    customerName: context.contact.name,
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

  // Serialise per customer, then drain their backlog oldest-first. This is what
  // makes ordering correct regardless of the order the jobs happen to run in.
  const lockKey = `inbound:${payload.phoneNumberId}:${payload.message.from}`;

  const pending = await prisma.webhookEvent.findMany({
    where: {
      source: 'whatsapp',
      processingStatus: { in: ['PENDING', 'FAILED'] },
      payload: { path: ['message', 'from'], equals: payload.message.from },
    },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
    take: 50,
  });

  const queue = pending.length ? pending.map((p) => p.id) : [webhookEventId];

  await withAdvisoryLock(lockKey, async () => {
    for (const id of queue) {
      await processEvent(id);
    }
  }, { timeoutMs: 60_000 });
};

/** Enqueue processing for freshly recorded events. */
export const enqueueInboundEvents = async (eventIds: string[]): Promise<void> => {
  for (const webhookEventId of eventIds) {
    await enqueue(QUEUES.processInboundMessage, { webhookEventId });
  }
};
