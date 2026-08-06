import { prisma } from '../config/prisma.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import {
  applyStatusUpdates, normaliseWebhook, recordInboundEvents, verifySignature,
} from '../modules/conversation-engine/http/webhook-intake.js';
import { enqueueInboundEvents } from '../modules/conversation-engine/jobs/handlers/process-inbound.js';
import type { Request, Response } from 'express';

/*
 * The Meta payload shapes and the type/status mapping that used to live here are gone.
 *
 * They existed for the legacy inbound path, which interpreted the payload inline. Every
 * recognised channel now hands the raw change to `normaliseWebhook` in the conversation
 * engine, which owns that translation and is tested against it; the unrecognised case is
 * dropped. Two parallel mappings of the same Meta contract is one too many — the one that
 * was left behind would have drifted silently, because nothing called it.
 */

// GET verification handshake for Meta.
//   • With Meta's params present + token matches → echo `hub.challenge` (plain text, Meta requires this exact body).
//   • With Meta's params present + token mismatch → 403.
//   • With no params (e.g. a human opening the URL in a browser) → 200 JSON status message.
export const verifyWebhook = (req: Request, res: Response) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode || token || challenge) {
    const expected = env.meta.webhookVerifyToken;

    // An unconfigured token can never match. Without the `Boolean(expected)` guard, an empty
    // `expected` and a caller sending `hub.verify_token=` would compare equal and pass the
    // handshake — the fail-open that removing the `'verify-token'` default would otherwise
    // have introduced.
    const matches = Boolean(expected) && mode === 'subscribe' && token === expected;

    // Lengths and a boolean only.
    //
    // This used to log `receivedToken` in full and, on a mismatch, the char codes of *both*
    // tokens "to expose whitespace and encoding differences". `String.fromCharCode(...codes)`
    // reverses that, so the secret shared with Meta was written to the log in recoverable
    // form — and any unauthenticated GET with a wrong token triggered it on demand. A
    // diagnostic an anonymous caller can fire at will is not a diagnostic.
    logger.info('Webhook verify attempt', {
      mode,
      configured: Boolean(expected),
      receivedTokenLen: typeof token === 'string' ? token.length : 0,
      matches,
    });

    if (matches) return res.status(200).send(challenge);
    return res.status(403).json({ success: false, message: 'Webhook verification failed' });
  }

  return res.status(200).json({
    success: true,
    message: 'WhatsApp webhook endpoint is live. POST events here from Meta.',
    method: 'POST for events, GET (with hub.mode/hub.verify_token/hub.challenge) for verification.',
  });
};

// Main webhook receiver. Meta calls this per business account.
export const receiveWebhook = asyncHandler(async (req, res) => {
  // Reject a forged payload before it is persisted or queued. Meta is still
  // acked with a 200 on success paths below, because anything else makes it
  // retry a message we already have.
  if (!verifySignature(req)) {
    logger.warn('Rejected webhook with an invalid X-Hub-Signature-256');
    res.sendStatus(401);
    return;
  }

  // Respond fast; processing continues async.
  res.sendStatus(200);

  const body = req.body;

  // Log incoming payload overview
  logger.info('Received WhatsApp Webhook POST request', {
    object: body?.object,
    entryCount: body?.entry?.length || 0,
  });
  logger.debug('Webhook full request body', { body });

  try {
    if (body.object !== 'whatsapp_business_account') {
      logger.warn('Webhook ignored: object is not whatsapp_business_account', { object: body.object });
      return;
    }

    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        const value = change.value || {};
        const phoneNumberId = value.metadata?.phone_number_id;

        logger.info('Processing webhook entry change', {
          field: change.field,
          phoneNumberId,
          hasStatuses: !!value.statuses?.length,
          hasMessages: !!value.messages?.length,
        });

        if (!phoneNumberId) {
          logger.warn('Webhook change has no metadata.phone_number_id', { field: change.field });
          continue;
        }

        const account = await prisma.whatsappAccount.findFirst({
          where: { phoneNumberId },
          include: { tenant: true },
        });

        // ── Conversation engine ─────────────────────────────────────────────
        // Every known channel now goes through the engine: the event is
        // persisted and queued, and nothing is interpreted in this request.
        //
        // The engine's routing chain still gives an in-flight cart absolute
        // priority and delegates it to the ordering state machine, so checkout
        // behaves exactly as before. What changed is the front door for
        // *everything else* — the assistant answers rather than a keyword match.
        //
        // A phone_number_id with no matching channel is dropped below. There used to be a
        // second, legacy path here that tried to save those messages anyway; see the note
        // on why that was worse than losing them.
        if (account) {
          const normalised = normaliseWebhook({ entry: [{ changes: [change] }] });
          await applyStatusUpdates(normalised);
          const { eventIds, duplicates } = await recordInboundEvents(normalised);
          await enqueueInboundEvents(eventIds);
          logger.info('Inbound handed to the conversation engine', {
            tenantId: account.tenantId,
            queued: eventIds.length,
            duplicates,
          });
          continue;
        }

        // An unrecognised phone_number_id is DROPPED.
        //
        // What used to be here: `prisma.tenant.findFirst()`, then ~220 lines that wrote the
        // customer, the conversation and every message under whichever tenant came back
        // first. The comment called it "saving the message rather than dropping it", but the
        // message was saved into an unrelated business's inbox — a stranger's phone number
        // and message content, visible to a workspace that has no relationship with them.
        // No attacker was required: a stale Meta subscription, a number disconnected
        // mid-onboarding, or a typo'd phone_number_id was enough. It also silently undid the
        // number-masking guarantee, since the fallback tenant's own masking setting decided
        // whether a foreign customer's number was shown in full.
        //
        // That code was also already unreachable for legitimate traffic: every matched
        // account returns to the engine above, so `isUnmatchedAccount` was always true and
        // the `handleInboundMessage` branch at the end of it never ran.
        //
        // Dropping is the only correct answer. There is no tenant this event belongs to, and
        // guessing one is worse than losing it. Logged at `warn` with the id, because a
        // sustained stream of these means a channel is misconfigured and wants fixing at the
        // source.
        logger.warn(
          'Webhook for an unknown phone_number_id was dropped: no WhatsappAccount matches it, '
          + 'so there is no tenant this event belongs to.',
          { phoneNumberId, field: change.field },
        );
        continue;
      }
    }
  } catch (err: any) {
    logger.error('Webhook processing error', { error: err.message, stack: err.stack });
  }
});
