import { prisma } from '../../config/prisma.js';
import { logger } from '../../config/logger.js';
import { whatsappProviderFor } from '../conversation-engine/providers/whatsapp.js';
import { recordOutboundMessage } from '../conversation-engine/providers/mirror.js';

// Consent, and the word that withdraws it.
//
// This is the most important file in the Marketing module and it deliberately
// contains no marketing. A WhatsApp number is not suspended for sending too
// much — it is suspended when enough people **block or report** it, and the
// single largest cause of that is a business that kept messaging after someone
// asked it to stop.
//
// So opting out is handled first, everywhere, before anything else can answer.

/**
 * Words that withdraw consent.
 *
 * Matched on the whole trimmed message, case-insensitively, and nothing else.
 * Substring matching would opt someone out for writing "please stop by at 6",
 * which is worse than the reverse: an opt-out that fails to register is a
 * complaint, but one that fires on a normal sentence silently removes a customer
 * who never asked to leave.
 */
const OPT_OUT_WORDS = new Set([
  'stop', 'unsubscribe', 'optout', 'opt out', 'opt-out', 'cancel subscription',
]);

/** Words that ask to start receiving again. */
const OPT_IN_WORDS = new Set(['start', 'subscribe', 'optin', 'opt in', 'opt-in', 'resume']);

export type ConsentIntent = 'opt_out' | 'opt_in' | null;

/** Whether a message is asking to leave or rejoin. Exact match only. */
export const consentIntentOf = (body: string | null | undefined): ConsentIntent => {
  const text = (body ?? '').trim().toLowerCase().replace(/[.!]+$/, '');
  if (!text) return null;
  if (OPT_OUT_WORDS.has(text)) return 'opt_out';
  if (OPT_IN_WORDS.has(text)) return 'opt_in';
  return null;
};

/** Whether this person may be sent marketing right now. */
export const mayReceiveMarketing = (customer: {
  marketingOptIn: boolean;
  optedOutAt: Date | null;
}): boolean => customer.marketingOptIn && customer.optedOutAt === null;

interface ConsentContext {
  tenantId: string;
  customerId: string;
  conversationId: string;
  waId: string;
}

/**
 * Handle an opt-out or opt-in, if that is what the message was.
 *
 * Returns **true when it consumed the message**, and the caller must then stop:
 * no keyword rules, no workflow, no model. Somebody who types STOP should not
 * have an order flow started on them, and running the router first would also
 * spend money classifying a message whose meaning is already known.
 *
 * The confirmation is a session message, which is always allowed here — they
 * just wrote to us, so the 24-hour window is open by definition. It is sent
 * *after* the database is updated, so a send failure can never leave someone
 * opted in while believing they are out.
 */
export const handleConsentKeyword = async (
  context: ConsentContext,
  body: string | null | undefined,
): Promise<boolean> => {
  const intent = consentIntentOf(body);
  if (!intent) return false;

  const now = new Date();

  if (intent === 'opt_out') {
    await prisma.customer.update({
      where: { id: context.customerId },
      // Both are set. `marketingOptIn: false` is the state a later import might
      // flip back; `optedOutAt` is the explicit refusal that outlives it, and
      // every send path checks both.
      data: { marketingOptIn: false, optedOutAt: now },
    });
    logger.info('Customer opted out of marketing', {
      tenantId: context.tenantId, customerId: context.customerId,
    });
  } else {
    await prisma.customer.update({
      where: { id: context.customerId },
      data: { marketingOptIn: true, optedOutAt: null, optInSource: 'keyword:start' },
    });
    logger.info('Customer opted back in to marketing', {
      tenantId: context.tenantId, customerId: context.customerId,
    });
  }

  await confirm(context, intent);
  return true;
};

const CONFIRMATION: Record<'opt_out' | 'opt_in', string> = {
  opt_out:
    "You're unsubscribed and won't get any more offers from us. "
    + 'You can still message here any time if you need help — reply START to get offers again.',
  opt_in: "You're subscribed again. Reply STOP at any time to unsubscribe.",
};

/**
 * Tell them it worked.
 *
 * Failure is logged and swallowed. The opt-out is already recorded, and throwing
 * here would fail the inbound job, which pg-boss would retry — re-running an
 * opt-out that already succeeded and sending the confirmation twice.
 */
const confirm = async (context: ConsentContext, intent: 'opt_out' | 'opt_in'): Promise<void> => {
  try {
    const channel = await prisma.whatsappAccount.findFirst({ where: { tenantId: context.tenantId } });
    if (!channel) return;

    const body = CONFIRMATION[intent];
    const sent = await whatsappProviderFor(channel).sendText({ to: context.waId, body });

    await recordOutboundMessage(
      {
        tenantId: context.tenantId,
        conversationId: context.conversationId,
        customerId: context.customerId,
      },
      { type: 'TEXT', body, messageId: sent.messageId },
    );
  } catch (err) {
    logger.error('Could not confirm a consent change to the customer', {
      tenantId: context.tenantId,
      customerId: context.customerId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};
