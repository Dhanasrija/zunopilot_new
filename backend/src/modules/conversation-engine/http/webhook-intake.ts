import crypto from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { Request } from 'express';
import { prisma } from '../../../config/prisma.js';
import { logger } from '../../../config/logger.js';
import { env } from '../../../config/env.js';

// Webhook intake: the boundary between Meta and everything else.
//
// The contract Meta imposes is a fast ack — it retries anything it thinks
// failed, and a slow handler turns one message into several. So this layer does
// the minimum that must happen synchronously (verify, persist, deduplicate) and
// hands the rest to a job.
//
// Nothing here interprets the message. No routing, no LLM call, no workflow.
// Those happen in the worker, where taking two seconds is fine.

export interface NormalisedInboundMessage {
  externalMessageId: string;
  from: string;
  profileName: string | null;
  type: string;
  text: string;
  interactive: {
    replyId: string | null;
    replyTitle: string | null;
    kind: 'button' | 'list' | null;
  } | null;
  location: { latitude: number | null; longitude: number | null; label: string | null } | null;
  raw: unknown;
}

export interface NormalisedWebhook {
  phoneNumberId: string | null;
  messages: NormalisedInboundMessage[];
  statuses: Array<{ externalMessageId: string; status: string; recipientId: string }>;
}

/**
 * Verify Meta's X-Hub-Signature-256 over the exact bytes received.
 *
 * The raw body is captured in app.ts because re-serialising the parsed JSON produces
 * different bytes and therefore a different digest.
 *
 * **Fails closed when there is no app secret.** `POST /api/webhook` is unauthenticated by
 * design — Meta cannot present a token — so this HMAC is the only thing separating a real
 * inbound message from an invented one. This used to `return true` on a missing secret,
 * which turned the endpoint into an open write API: anyone could forge inbound messages for
 * any `phone_number_id` and manufacture customers, orders and automation triggers in any
 * tenant. Razorpay's webhook, two directories over, has always failed closed on exactly
 * this condition.
 *
 * Local development opts out with `ALLOW_UNSIGNED_WEBHOOKS=true` rather than by leaving the
 * secret unset. That inversion is the point: the permissive path now needs a deliberate act,
 * so an environment that simply forgot to configure the secret is safe rather than open.
 * Gating on `NODE_ENV !== 'production'` was considered and rejected — `NODE_ENV` is set
 * nowhere in this repository, so "unset" must be the safe state, not the relaxed one.
 */
export const verifySignature = (req: Request): boolean => {
  const secret = env.meta.appSecret;
  if (!secret) {
    if (process.env.ALLOW_UNSIGNED_WEBHOOKS === 'true') {
      logger.warn(
        'META_APP_SECRET is not set and ALLOW_UNSIGNED_WEBHOOKS=true — accepting an '
        + 'unverified webhook. This must never be the case outside local development.',
      );
      return true;
    }
    logger.error(
      'META_APP_SECRET is not set, so this webhook cannot be verified and is being '
      + 'REJECTED. Set the secret, or set ALLOW_UNSIGNED_WEBHOOKS=true for local work.',
    );
    return false;
  }

  const header = req.get('x-hub-signature-256');
  if (!header?.startsWith('sha256=')) return false;

  const raw = (req as Request & { rawBody?: Buffer }).rawBody;
  if (!raw) {
    logger.error('Webhook raw body missing — cannot verify signature');
    return false;
  }

  const expected = crypto.createHmac('sha256', secret).update(raw).digest('hex');
  const received = header.slice('sha256='.length);

  // Constant-time compare: a plain === leaks the digest one byte at a time.
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(received, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

const textOf = (message: Record<string, any>): string => {
  switch (message.type) {
    case 'text': return message.text?.body ?? '';
    case 'interactive':
      return message.interactive?.list_reply?.title
        ?? message.interactive?.button_reply?.title
        ?? '';
    case 'button': return message.button?.text ?? '';
    case 'location': {
      const l = message.location ?? {};
      return [l.name, l.address].filter(Boolean).join(', ');
    }
    /*
     * A caption if there is one, and otherwise nothing.
     *
     * **The empty string is meaningful and the worker depends on it.** A photo with no caption
     * is not a question, so `process-inbound` acknowledges it rather than routing an empty
     * message into a model that cannot see the image. The stored `Message.body` gets a short
     * description instead — this returns the customer's own words or none.
     *
     * This comment used to claim the worker "sends an 'I can't read that' fallback rather than
     * guessing". No such code existed. A bare photo went to the router as an empty string and
     * got the generic fallback, which reads to a customer as though nothing arrived.
     */
    default: return message[message.type]?.caption ?? '';
  }
};

const interactiveOf = (message: Record<string, any>): NormalisedInboundMessage['interactive'] => {
  const i = message.interactive;
  if (i?.list_reply) {
    return { replyId: i.list_reply.id ?? null, replyTitle: i.list_reply.title ?? null, kind: 'list' };
  }
  if (i?.button_reply) {
    return { replyId: i.button_reply.id ?? null, replyTitle: i.button_reply.title ?? null, kind: 'button' };
  }
  // A template quick-reply arrives as `type: 'button'` with a payload, not as
  // an `interactive` object — easy to miss, and it is how template callbacks
  // reach a deterministic routing rule.
  if (message.type === 'button' && message.button) {
    return { replyId: message.button.payload ?? null, replyTitle: message.button.text ?? null, kind: 'button' };
  }
  return null;
};

/** Flatten Meta's nested envelope into the shape the worker consumes. */
export const normaliseWebhook = (body: Record<string, any>): NormalisedWebhook[] => {
  const results: NormalisedWebhook[] = [];

  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value ?? {};
      const contacts: Array<Record<string, any>> = value.contacts ?? [];

      results.push({
        phoneNumberId: value.metadata?.phone_number_id ?? null,
        messages: (value.messages ?? []).map((message: Record<string, any>): NormalisedInboundMessage => {
          const contact = contacts.find((c) => c.wa_id === message.from) ?? contacts[0];
          const location = message.location
            ? {
              latitude: message.location.latitude ?? null,
              longitude: message.location.longitude ?? null,
              label: [message.location.name, message.location.address].filter(Boolean).join(', ') || null,
            }
            : null;

          return {
            externalMessageId: message.id,
            from: message.from,
            profileName: contact?.profile?.name ?? null,
            type: message.type ?? 'unknown',
            text: textOf(message),
            interactive: interactiveOf(message),
            location,
            raw: message,
          };
        }),
        statuses: (value.statuses ?? []).map((status: Record<string, any>) => ({
          externalMessageId: status.id,
          status: String(status.status ?? '').toUpperCase(),
          recipientId: status.recipient_id,
        })),
      });
    }
  }

  return results;
};

export interface IntakeResult {
  accepted: number;
  duplicates: number;
  eventIds: string[];
}

/**
 * Persist each inbound message as a WebhookEvent and return the new ones.
 *
 * The unique index on (source, externalEventId) is the deduplication gate, and
 * it is relied on rather than a read-then-write check: Meta's retries arrive
 * concurrently, so only the database can decide which one is first.
 */
export const recordInboundEvents = async (
  webhooks: NormalisedWebhook[],
): Promise<IntakeResult> => {
  const eventIds: string[] = [];
  let duplicates = 0;

  for (const webhook of webhooks) {
    for (const message of webhook.messages) {
      try {
        const event = await prisma.webhookEvent.create({
          data: {
            source: 'whatsapp',
            eventType: 'message',
            externalEventId: message.externalMessageId,
            payload: {
              phoneNumberId: webhook.phoneNumberId,
              message,
            } as unknown as Prisma.InputJsonValue,
            processingStatus: 'PENDING',
          },
        });
        eventIds.push(event.id);
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          duplicates += 1;
          logger.debug('Duplicate webhook delivery ignored', {
            externalMessageId: message.externalMessageId,
          });
          continue;
        }
        throw err;
      }
    }
  }

  return { accepted: eventIds.length, duplicates, eventIds };
};

/** Apply delivery-status updates. Cheap enough to do inline. */
export const applyStatusUpdates = async (webhooks: NormalisedWebhook[]): Promise<number> => {
  let updated = 0;
  for (const webhook of webhooks) {
    for (const status of webhook.statuses) {
      const result = await prisma.message.updateMany({
        where: { waMessageId: status.externalMessageId },
        data: { status: status.status as never },
      });
      updated += result.count;
    }
  }
  return updated;
};
