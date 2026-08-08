import crypto from 'node:crypto';
import { Prisma, type MessageStatus, type RecipientStatus } from '@prisma/client';
import type { Request } from 'express';
import { prisma } from '../../../config/prisma.js';
import { logger } from '../../../config/logger.js';
import { env } from '../../../config/env.js';
import { withoutNumbers } from '../../../services/meta-error.js';

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

/**
 * One delivery-status event, as Meta sent it.
 *
 * `status` stays **Meta's own lowercase word**, unmapped. It used to be `.toUpperCase()`d here,
 * which made the parse output *look* like a `MessageStatus` while still being an arbitrary
 * string — and that resemblance is what made `status as never` at the write site feel
 * reasonable. Keeping Meta's word verbatim puts the enum decision in exactly one place.
 */
export interface NormalisedStatus {
  externalMessageId: string;
  status: string;
  recipientId: string;
  /** When Meta says it happened, not when we read it. Null when the field is unusable. */
  occurredAt: Date | null;
  /** Meta's own reason for a failure, phone numbers scrubbed. Null otherwise. */
  error: string | null;
}

export interface NormalisedWebhook {
  phoneNumberId: string | null;
  messages: NormalisedInboundMessage[];
  statuses: NormalisedStatus[];
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

/**
 * Meta's unix-seconds string as a Date, or null when it is unusable.
 *
 * Meta's clock rather than ours, because a webhook retried an hour later must not claim the
 * customer read the message an hour late. Sanity-bounded rather than trusted: this is someone
 * else's field, and a garbage value landing in `readAt` shows an agent "Read 1970".
 */
const occurredAtOf = (raw: unknown): Date | null => {
  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;

  const at = new Date(seconds * 1000).getTime();

  /*
   * The NaN check is first, and it is not redundant.
   *
   * A value past the maximum representable date — `'99999999999999'` — is a finite number that
   * makes an *Invalid* Date, whose `getTime()` is NaN. Every comparison against NaN is false, so
   * the two bounds below both pass and an invalid Date is returned as though it were fine. The
   * range checks read like they cover this and do not.
   */
  if (Number.isNaN(at)) return null;

  const floor = Date.UTC(2020, 0, 1);
  // A day of slack for clock skew between Meta and us; beyond that it is not a timestamp.
  const ceiling = Date.now() + 24 * 60 * 60 * 1000;
  if (at < floor || at > ceiling) return null;

  return new Date(at);
};

/**
 * Meta's failure reason as one line an operator can act on.
 *
 * `error_data.details` first, because it is the sentence that says what to *do* ("Add recipient
 * phone number to recipient list"); `message` and `title` are the fallbacks. The code is
 * prefixed because it is the only part worth searching Meta's documentation for.
 *
 * **Scrubbed through `withoutNumbers`**, the same helper `meta-error.ts` uses on the messages it
 * returns to a caller. This text reaches every agent through
 * `GET /api/inbox/conversations/:id/messages`, and a number smuggled in on someone else's error
 * string must not undo the masking the rest of the codebase maintains. Truncated to 500 to
 * match `CampaignRecipient.error`.
 */
const statusErrorOf = (status: Record<string, any>): string | null => {
  const first = (status.errors ?? [])[0];
  if (!first) return null;

  const text = first.error_data?.details || first.message || first.title || '';
  const line = [first.code, text].filter(Boolean).join(': ').trim();
  return line ? withoutNumbers(line).slice(0, 500) : null;
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
        statuses: (value.statuses ?? []).map((status: Record<string, any>): NormalisedStatus => ({
          externalMessageId: status.id,
          status: String(status.status ?? '').toLowerCase(),
          recipientId: status.recipient_id,
          occurredAt: occurredAtOf(status.timestamp),
          error: statusErrorOf(status),
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

/*
 * ── Delivery status ──────────────────────────────────────────────────────────
 *
 * Meta reports sent / delivered / read / failed per message, and it does so **out of order and
 * with retries**. `delivered` arriving for a message we already know was `read` is ordinary
 * traffic, not an anomaly. So the rule is monotonic: a status may only move a message *up* the
 * ladder, never back down it.
 */

/**
 * The outbound delivery ladder, in the only order it may be climbed.
 *
 * Two things this array encodes that a plain `data: { status }` cannot:
 *
 *   • `FAILED` is last, so nothing outranks it. A late `delivered` for a message Meta already
 *     refused leaves it FAILED — which the failure counters in `analytics.controller.ts` and
 *     the red tick in the Inbox both depend on.
 *   • **`RECEIVED` is deliberately absent.** It is the inbound default, and since every row we
 *     advance *from* must appear in this array, an inbound message can never be relabelled by a
 *     status webhook. That guarantee is a property of the data structure rather than an `if`
 *     someone can drop later.
 */
const LADDER = ['SENT', 'DELIVERED', 'READ', 'FAILED'] as const satisfies readonly MessageStatus[];
type Rung = (typeof LADDER)[number];

/**
 * The statuses a row must currently be in for `next` to be a genuine advance.
 *
 * `[]` for `SENT`, and that is correct rather than a gap: every outbound row is born `SENT`
 * (see `mirror.ts`, `workers.ts`, `nodes.ts`), so Meta's `sent` only confirms what we already
 * recorded and there is nothing to move.
 */
const advanceFrom = <T extends string>(ladder: readonly T[], next: T): T[] =>
  ladder.slice(0, ladder.indexOf(next));

/**
 * The same ladder for a campaign recipient — and two statuses pointedly not on it.
 *
 * `PENDING` is excluded: a recipient stays PENDING until the sender writes SENT/sentAt/messageId,
 * so a status webhook against a still-PENDING row means that write has not landed yet. Advancing
 * it would leave a row that is "delivered" with no `sentAt` and no linked `Message`.
 *
 * `SKIPPED_OPTED_OUT` is excluded because it is a refusal honoured. Nothing Meta says may turn
 * "we chose not to message this person" into "we messaged this person".
 */
const RECIPIENT_LADDER = [
  'SENT', 'DELIVERED', 'READ', 'FAILED',
] as const satisfies readonly RecipientStatus[];

/**
 * Meta's status words, mapped to ours. **Anything absent is ignored, not thrown.**
 *
 * This replaces `data: { status: status.status as never }`. That cast did not merely lose a
 * status: Prisma validates an enum argument before it queries, so one word we do not model —
 * `deleted`, or whatever Meta ships next — threw a validation error which propagated to the
 * entry-loop catch in `webhook.controller.ts` and abandoned `recordInboundEvents` and
 * `enqueueInboundEvents` for every remaining change in the batch. Meta had already been sent a
 * 200, so it never retried and those customer messages were simply gone. An unmodelled *status*
 * costing us an inbound *message* is the wrong trade by a very long way.
 */
const STATUS_BY_META: Record<string, Rung> = {
  sent: 'SENT',
  delivered: 'DELIVERED',
  read: 'READ',
  failed: 'FAILED',
};

/** Which timestamp column a rung writes. Explicit, so Prisma keeps its typing. */
const stampsFor = (next: Rung, at: Date) => {
  switch (next) {
    case 'DELIVERED': return { deliveredAt: at };
    case 'READ': return { readAt: at };
    case 'FAILED': return { failedAt: at };
    default: return {};
  }
};

export interface StatusOutcome {
  /** Message rows moved forward. */
  applied: number;
  /** Campaign recipient rows moved forward. */
  recipients: number;
  /** A status that could not advance anything: `sent`, or a row already further along. */
  noop: number;
  /** A word Meta sent that we do not model. */
  unknown: number;
  /** A database error on one status. Logged, never propagated. */
  failed: number;
}

/**
 * Apply delivery-status updates for one workspace. Cheap enough to do inline.
 *
 * **`tenantId` is required, not optional.** Without it this was an `updateMany` keyed on
 * `waMessageId` alone — half of `@@unique([tenantId, waMessageId])`. That constraint is
 * composite precisely because two workspaces can hold the same id, so one workspace's webhook
 * could rewrite another's message row. It was also an unindexed scan of the whole `Message`
 * table per status event; with the tenant present, `Message_tenantId_waMessageId_key` serves the
 * lookup as a single-row index scan. Adding the tenant filter *is* the index fix.
 *
 * **This function does not throw.** Every failure is a counter and a log line, because it runs
 * after Meta has been acked and beside work that matters a great deal more than a tick.
 */
export const applyStatusUpdates = async (
  tenantId: string,
  webhooks: NormalisedWebhook[],
): Promise<StatusOutcome> => {
  const outcome: StatusOutcome = {
    applied: 0, recipients: 0, noop: 0, unknown: 0, failed: 0,
  };

  for (const webhook of webhooks) {
    for (const status of webhook.statuses) {
      const next = STATUS_BY_META[status.status];
      if (!next) {
        outcome.unknown += 1;
        logger.warn('Ignoring a WhatsApp delivery status we do not model', {
          tenantId, metaStatus: status.status, waMessageId: status.externalMessageId,
        });
        continue;
      }

      const from = advanceFrom(LADDER, next);
      if (from.length === 0) {
        // `sent` confirms what the row already says. Skip the round trip entirely.
        outcome.noop += 1;
        continue;
      }

      const at = status.occurredAt ?? new Date();

      try {
        /*
         * One statement, and that is the correctness argument rather than tidiness.
         *
         * Under Postgres' READ COMMITTED, when two status webhooks for the same wamid race, the
         * second UPDATE blocks on the row lock and then **re-evaluates its WHERE clause against
         * the newly committed row version**. So the loser sees the winner's `READ`, its
         * `IN ('SENT','DELIVERED')` no longer matches, and it writes nothing. A read-then-write
         * in application code — or this same logic inside a default-isolation `$transaction` —
         * would not give you that.
         */
        const message = await prisma.message.updateMany({
          where: {
            tenantId,
            waMessageId: status.externalMessageId,
            status: { in: from },
          },
          data: {
            status: next,
            ...stampsFor(next, at),
            ...(next === 'FAILED' && status.error ? { statusError: status.error } : {}),
          },
        });

        /*
         * The campaign recipient for the same wamid, if there is one.
         *
         * `CampaignRecipient` has no `tenantId` of its own, so it is scoped through the relation
         * — which Prisma compiles to a subselect on `Campaign`. Without it this would be the
         * same cross-tenant write the message update just stopped being.
         *
         * Its DELIVERED, READ, deliveredAt and readAt columns had never been written by anything
         * before this: the report in `CampaignDetail.tsx` has rendered labels for them all along.
         */
        const recipient = await prisma.campaignRecipient.updateMany({
          where: {
            waMessageId: status.externalMessageId,
            campaign: { tenantId },
            status: { in: advanceFrom(RECIPIENT_LADDER, next) },
          },
          data: {
            status: next,
            ...stampsFor(next, at),
            ...(next === 'FAILED' && status.error ? { error: status.error } : {}),
          },
        });

        outcome.applied += message.count;
        outcome.recipients += recipient.count;
        // Nothing moved: either no such message, or it is already further along. Both are
        // ordinary given Meta's retries, and neither is worth a log line of its own.
        if (message.count === 0) outcome.noop += 1;
      } catch (err) {
        outcome.failed += 1;
        logger.error('Could not apply a WhatsApp delivery status', {
          tenantId,
          waMessageId: status.externalMessageId,
          metaStatus: status.status,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  return outcome;
};

/** Exported for the tests that pin the ladder's shape directly. */
export const __statusLadder = { LADDER, RECIPIENT_LADDER, advanceFrom, STATUS_BY_META };
