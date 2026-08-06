import { prisma } from '../../../config/prisma.js';
import { logger } from '../../../config/logger.js';
import type { WhatsAppSender } from '../engine/types.js';

/**
 * The tenant's own "I couldn't help with that" line.
 *
 * Its own module because two very different callers need it and neither should import the
 * other: the router reaches for it when the assistant has nothing, and the workflow walker
 * reaches for it when a run dies with no error branch wired. `routing/index.ts` already imports
 * the walker, so putting it there would close a cycle.
 *
 * **Why a shared helper rather than a message per situation.** The workspace has already
 * written what to say when the bot cannot answer. Inventing separate copy for "the model timed
 * out", "the AI is switched off" and "node 7 threw" would leak our internals into their voice,
 * and none of those distinctions mean anything to the person waiting for a reply.
 */
export const DEFAULT_FALLBACK = "Sorry, I didn't quite catch that. Let me get a colleague to help.";

export const fallbackTextFor = async (tenantId: string): Promise<string> => {
  const rule = await prisma.fallbackRule.findUnique({ where: { tenantId } });
  return rule?.response ?? DEFAULT_FALLBACK;
};

/**
 * Send it, and never let the attempt itself become the failure.
 *
 * Callers are already on a degraded path — an exhausted quota, a switched-off agent, a dead
 * node — so a throw here would replace a partial answer with an exception in a place none of
 * them are prepared to handle. Logged and swallowed.
 */
export const sendFallbackText = async (args: {
  tenantId: string;
  waId: string;
  whatsapp: WhatsAppSender;
}): Promise<void> => {
  try {
    await args.whatsapp.sendText({ to: args.waId, body: await fallbackTextFor(args.tenantId) });
  } catch (err) {
    logger.error('Could not send the fallback message', {
      tenantId: args.tenantId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};
