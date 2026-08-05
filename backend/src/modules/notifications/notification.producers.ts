import { logger } from '../../config/logger.js';
import { QUEUES, enqueue } from '../conversation-engine/jobs/queue.js';
import { notifyQuietly } from './notification.service.js';
import { maskedNumber } from '../../utils/mask-number.js';

// Where notifications come from.
//
// **One place, so two paths cannot disagree.** Inbound WhatsApp messages are handled
// by both `webhook.controller.ts` and the `process-inbound` queue handler. If each
// wrote its own title, the bell would read differently depending on which path a
// message happened to take — and the dedupe key would drift, which is worse, because
// then it would notify twice.
//
// Every function here is fire-and-forget by construction: `notifyQuietly` swallows its
// own failures, and the push enqueue is wrapped too. Storing a customer's message is
// the job; telling someone about it is a courtesy that must never take the job down.

// **A notification never carries a full phone number, whatever the masking setting says.**
//
// Every other surface redacts per reader: the same customer row is masked for an agent and
// full for the owner. A notification cannot work that way, because its title is *persisted
// text* that many people read — masking at write time would show the owner bullets, and
// storing the real number would hand it to every masked agent the moment they open the bell.
//
// So the nameless-customer fallback is masked unconditionally. Nothing is lost: a
// notification's job is "someone messaged you", and its link opens the conversation, where
// an owner sees the real number through the normal per-reader path.

/** One line of preview, with newlines flattened so a pasted paragraph stays one line. */
const preview = (body: string | null | undefined, limit = 140): string => {
  const text = (body ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return 'Sent an attachment';
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
};

/**
 * Hand the notification to the push queue.
 *
 * Separate from creating it, and separately guarded: a queue that is down must not
 * cost us the in-app notification that is already safely written.
 */
const queuePush = async (notificationId: string): Promise<void> => {
  try {
    await enqueue(QUEUES.deliverPushNotification, { notificationId });
  } catch (err) {
    logger.warn('Could not queue a push for a notification', {
      notificationId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};

export interface InboundMessageNotice {
  tenantId: string;
  conversationId: string;
  /** What to call them. Falls back to a **masked** number — see the note above. */
  customerName: string | null;
  waId: string;
  body: string | null;
  /** The provider's message id — the dedupe key. Never a timestamp. */
  waMessageId: string;
}

/**
 * A customer sent a message.
 *
 * Addressed to the whole workspace (`userId` unset): a customer message belongs to
 * whoever picks it up, and sending it only to an assigned agent would mean it waits
 * for one person who may be off shift.
 */
export const notifyInboundMessage = async (input: InboundMessageNotice): Promise<void> => {
  const who = input.customerName?.trim() || maskedNumber(input.waId) || 'A customer';

  const notification = await notifyQuietly({
    tenantId: input.tenantId,
    kind: 'MESSAGE_RECEIVED',
    title: who,
    body: preview(input.body),
    // Deep link straight to the thread, so the notification is one click from useful.
    link: `/inbox?c=${input.conversationId}`,
    conversationId: input.conversationId,
    // The message id, so a webhook retry or the other inbound path collides here
    // rather than producing a second bell for one message.
    dedupeKey: `message:${input.waMessageId}`,
  });

  // Null means it already existed — a retry. Pushing again would be the duplicate
  // the dedupe key exists to prevent.
  if (notification) await queuePush(notification.id);
};

export interface HandoffNotice {
  tenantId: string;
  conversationId: string;
  customerName: string | null;
  waId: string;
  reason: string | null;
}

/**
 * A workflow gave up and asked for a person.
 *
 * The genuinely urgent kind: a customer is mid-conversation, has been told someone
 * will help, and is now waiting. Deduped on the conversation so a flow that requests a
 * handoff twice does not ring twice — but not on a timestamp, so a *later* handoff on
 * the same conversation, after the first was resolved, still gets through.
 */
export const notifyHandoffRequested = async (input: HandoffNotice): Promise<void> => {
  const who = input.customerName?.trim() || maskedNumber(input.waId) || 'A customer';

  const notification = await notifyQuietly({
    tenantId: input.tenantId,
    kind: 'HANDOFF_REQUESTED',
    title: `${who} needs a person`,
    body: preview(input.reason) === 'Sent an attachment'
      // `preview`'s empty fallback is written for messages and makes no sense here.
      ? 'A workflow asked for a human.'
      : preview(input.reason),
    link: `/inbox?c=${input.conversationId}`,
    conversationId: input.conversationId,
    dedupeKey: null,
  });

  if (notification) await queuePush(notification.id);
};

export interface OrderNotice {
  tenantId: string;
  conversationId: string | null;
  orderId: string;
  orderNumber: number;
  customerName: string | null;
  total: number;
}

/** An order was placed over WhatsApp. */
export const notifyOrderCreated = async (input: OrderNotice): Promise<void> => {
  const notification = await notifyQuietly({
    tenantId: input.tenantId,
    kind: 'ORDER_CREATED',
    title: `Order #${input.orderNumber}`,
    // Paise to rupees at the edge, never in the middle: money is stored as an integer
    // and only ever formatted for display.
    body: `${input.customerName?.trim() || 'A customer'} placed an order for ₹${(input.total / 100).toFixed(2)}`,
    link: `/orders/${input.orderId}`,
    conversationId: input.conversationId,
    dedupeKey: `order:${input.orderId}`,
  });

  if (notification) await queuePush(notification.id);
};
