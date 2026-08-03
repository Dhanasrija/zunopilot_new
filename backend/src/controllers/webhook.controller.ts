import { prisma } from '../config/prisma.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { handleInboundMessage } from '../services/automation.service.js';
import { withAdvisoryLock } from '../utils/withAdvisoryLock.js';
import {
  applyStatusUpdates, normaliseWebhook, recordInboundEvents, verifySignature,
} from '../modules/conversation-engine/http/webhook-intake.js';
import { enqueueInboundEvents } from '../modules/conversation-engine/jobs/handlers/process-inbound.js';
import { MessageStatus, MessageType, type Tenant } from '@prisma/client';
import type { Request, Response } from 'express';
import type { InboundMessage } from '../types/domain.js';
import { linkLeadToCustomer } from '../modules/leads/lead.service.js';
import { handleConsentKeyword } from '../modules/marketing/consent.service.js';

/** The parts of a Meta inbound message object this handler reads. */
interface MetaInteractiveReply {
  type?: string;
  list_reply?: { id: string; title?: string; description?: string };
  button_reply?: { id: string; title?: string };
}

interface MetaInboundMessage {
  id: string;
  from: string;
  type: string;
  text?: { body?: string };
  image?: { id?: string; caption?: string };
  document?: { id?: string; filename?: string };
  audio?: { id?: string };
  video?: { id?: string };
  location?: { latitude?: number; longitude?: number; name?: string; address?: string };
  interactive?: MetaInteractiveReply;
}

interface MetaContact {
  wa_id: string;
  profile?: { name?: string };
}

interface MappedMessage {
  type: MessageType;
  body?: string;
  mediaUrl?: string;
  payloadExtra?: Record<string, unknown>;
}

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
    const matches = mode === 'subscribe' && token === expected;

    // Diagnostic logs (visible in server console). Lengths and char-codes
    // expose whitespace/encoding mismatches that look identical in a UI.
    logger.info('Webhook verify attempt', {
      mode,
      receivedToken: token,
      receivedTokenLen: token?.length,
      expectedTokenLen: expected?.length,
      tokensEqual: token === expected,
      matches,
    });
    if (token && expected && token !== expected) {
      logger.warn('Token mismatch detail', {
        receivedCharCodes: [...String(token)].map((c) => c.charCodeAt(0)),
        expectedCharCodes: [...expected].map((c) => c.charCodeAt(0)),
      });
    }

    if (matches) return res.status(200).send(challenge);
    return res.status(403).json({ success: false, message: 'Webhook verification failed' });
  }

  return res.status(200).json({
    success: true,
    message: 'WhatsApp webhook endpoint is live. POST events here from Meta.',
    method: 'POST for events, GET (with hub.mode/hub.verify_token/hub.challenge) for verification.',
  });
};

const toMessageStatus = (raw: unknown): MessageStatus | undefined => {
  const upper = String(raw ?? '').toUpperCase();
  return (Object.values(MessageStatus) as string[]).includes(upper)
    ? (upper as MessageStatus)
    : undefined;
};

const mapMessageType = (msg: MetaInboundMessage): MappedMessage => {
  switch (msg.type) {
    case 'text': return { type: MessageType.TEXT, body: msg.text?.body || '' };
    case 'image': return { type: MessageType.IMAGE, mediaUrl: msg.image?.id, body: msg.image?.caption };
    case 'document': return { type: MessageType.DOCUMENT, mediaUrl: msg.document?.id, body: msg.document?.filename };
    case 'audio': return { type: MessageType.AUDIO, mediaUrl: msg.audio?.id };
    case 'video': return { type: MessageType.VIDEO, mediaUrl: msg.video?.id };
    case 'location': {
      // WhatsApp usually supplies a human-readable `name` and `address` alongside
      // the pin. Keep those as the body and the coordinates as structured payload,
      // rather than smuggling raw lat/long through the body — a delivery address
      // of "17.385044,78.486671" is unreadable in the inbox and on the order.
      const l = msg.location || {};
      const label = [l.name, l.address].filter(Boolean).join(', ');
      return {
        type: MessageType.LOCATION,
        body: label || (l.latitude != null ? `${l.latitude}, ${l.longitude}` : ''),
        payloadExtra: {
          location: {
            latitude: l.latitude ?? null,
            longitude: l.longitude ?? null,
            name: l.name ?? null,
            address: l.address ?? null,
          },
        },
      };
    }
    case 'interactive': {
      const i = msg.interactive;
      const text = i?.list_reply?.title || i?.button_reply?.title || '';
      return { type: MessageType.INTERACTIVE, body: text, payloadExtra: { interactive: i } };
    }
    default: return { type: MessageType.SYSTEM, body: JSON.stringify(msg) };
  }
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
        // The legacy path below now only runs for a phone_number_id we cannot
        // match to a channel, where it exists to save the message rather than
        // drop it.
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

        // Reaching here means `account` was null — a phone_number_id we do not
        // recognise. TypeScript has narrowed it to `never` above, which is the
        // compiler confirming the engine now handles every known channel.
        let tenant: Tenant | null = null;
        let isUnmatchedAccount = false;

        if (!tenant) {
          logger.warn('Unknown phone_number_id in webhook, falling back to first available tenant to save message', { phoneNumberId });
          tenant = await prisma.tenant.findFirst();
          isUnmatchedAccount = true;

          if (!tenant) {
            logger.error('No tenant exists in database. Cannot process or save webhook data.', { phoneNumberId });
            continue;
          }
          logger.info('Fallback tenant matched for unmatched WhatsApp account', {
            tenantId: tenant.id,
            tenantName: tenant.businessName,
          });
        }
        // The matched-account branch that used to live here is gone: a matched
        // account never reaches this code any more, it goes to the engine above.

        // Process status updates
        for (const status of value.statuses || []) {
          logger.info('Processing message status update', {
            tenantId: tenant.id,
            waMessageId: status.id,
            status: status.status,
            recipientId: status.recipient_id,
          });

          const updateResult = await prisma.message.updateMany({
            where: { tenantId: tenant.id, waMessageId: status.id },
            // Meta sends lowercase ('sent'/'delivered'/'read'/'failed'); an
            // unrecognised value is dropped rather than written to the enum.
            data: { status: toMessageStatus(status.status) },
          });

          logger.info('Updated message status in database', {
            tenantId: tenant.id,
            waMessageId: status.id,
            status: String(status.status).toUpperCase(),
            matchedCount: updateResult.count,
          });
        }

        // Process incoming messages
        const contacts = value.contacts || [];
        for (const wm of value.messages || []) {
          logger.info('Processing incoming WhatsApp message', {
            tenantId: tenant.id,
            from: wm.from,
            waMessageId: wm.id,
            type: wm.type,
          });

          const contact = (contacts as MetaContact[]).find((c) => c.wa_id === wm.from) || (contacts[0] as MetaContact | undefined);
          const profileName = contact?.profile?.name;

          // Resolve the customer and their open conversation under a per-customer
          // advisory lock. Meta is acked before processing, so deliveries for the
          // same customer run concurrently — unserialized, two handlers would
          // both find no conversation and both create one, leaving a duplicate
          // empty thread in the inbox. Only these cheap reads/writes are inside
          // the lock; the message insert and automation run outside it.
          let { customer, conversation, conversationAction } = await withAdvisoryLock(
            `wa:${tenant.id}:${wm.from}`,
            async (tx) => {
              const customer = await tx.customer.upsert({
                where: { tenantId_waId: { tenantId: tenant.id, waId: wm.from } },
                // `marketingOptIn` is deliberately absent from `update` — see the
                // note on the engine path's upsert. Setting it here would restore
                // consent on the very message that withdrew it.
                update: { lastSeenAt: new Date(), name: profileName || undefined },
                create: {
                  tenantId: tenant.id,
                  waId: wm.from,
                  name: profileName,
                  phone: wm.from,
                  lastSeenAt: new Date(),
                  marketingOptIn: true,
                  optInSource: 'inbound_message',
                },
              });

              const existing = await tx.conversation.findFirst({
                where: { tenantId: tenant.id, customerId: customer.id, status: { in: ['OPEN', 'HUMAN_TAKEOVER'] } },
                orderBy: { lastMessageAt: 'desc' },
              });
              if (existing) {
                return { customer, conversation: existing, conversationAction: 'matched_existing' };
              }

              // Created with unreadCount 0 on purpose — it is incremented below,
              // only once the message insert has proven this is not a retry.
              const created = await tx.conversation.create({
                data: { tenantId: tenant.id, customerId: customer.id, status: 'OPEN', lastMessageAt: new Date(), unreadCount: 0 },
              });
              return { customer, conversation: created, conversationAction: 'created_new' };
            }
          );

          logger.info('Upserted customer profile', {
            customerId: customer.id,
            tenantId: tenant.id,
            waId: wm.from,
            name: profileName || customer.name,
          });

          // A lead who finally messages stops being two records.
          //
          // Outside the advisory lock, because this opens its own transaction.
          // It never throws — a workspace without the Leads module has no rows to
          // match, and a failure to link must not reject a customer's message.
          await linkLeadToCustomer(tenant.id, customer.id, wm.from);

          const mapped = mapMessageType(wm);
          const payload = { raw: wm, ...(mapped.payloadExtra || {}) };

          // The insert is the idempotency gate. Meta retries deliveries, so a
          // duplicate wamid must not bump the unread count or re-run automation.
          // Relying on the unique constraint (rather than a read-then-write
          // check) keeps this correct under concurrent retries.
          let message;
          try {
            message = await prisma.message.create({
              data: {
                tenantId: tenant.id,
                conversationId: conversation.id,
                customerId: customer.id,
                direction: 'INBOUND',
                type: mapped.type,
                status: 'RECEIVED',
                waMessageId: wm.id,
                body: mapped.body,
                mediaUrl: mapped.mediaUrl,
                payload,
              },
            });
          } catch (err: any) {
            if (err.code === 'P2002') {
              logger.info('Duplicate webhook delivery ignored', {
                waMessageId: wm.id,
                tenantId: tenant.id,
                conversationId: conversation.id,
              });
              continue;
            }
            throw err;
          }

          logger.info('Saved message to database', {
            messageId: message.id,
            waMessageId: wm.id,
            type: message.type,
            direction: message.direction,
          });

          // Side effects run only for genuinely new messages.
          conversation = await prisma.conversation.update({
            where: { id: conversation.id },
            data: { lastMessageAt: new Date(), unreadCount: { increment: 1 } },
          });

          logger.info('Conversation state updated', {
            conversationId: conversation.id,
            action: conversationAction,
            status: conversation.status,
            unreadCount: conversation.unreadCount,
          });

          // "STOP" is answered before automation gets a look at the message.
          //
          // Same rule as the engine path: withdrawing consent must not be
          // interpreted as an order, a keyword or anything else. Returns true
          // when it consumed the message, and nothing else runs on it.
          const consentHandled = await handleConsentKeyword(
            {
              tenantId: tenant.id,
              customerId: customer.id,
              conversationId: conversation.id,
              waId: wm.from,
            },
            message.body,
          );

          if (consentHandled) {
            logger.info('Consent keyword handled, skipping automation', { messageId: message.id });
          } else if (isUnmatchedAccount) {
            logger.info('Skipping automation service handler for unmatched WhatsApp account', {
              messageId: message.id,
              waMessageId: wm.id,
            });
          } else {
            logger.info('Forwarding to automation service handler', {
              messageId: message.id,
              conversationId: conversation.id,
            });

            await handleInboundMessage({ tenant, conversation, customer, message: message as InboundMessage });

            logger.info('Automation service handling complete', {
              messageId: message.id,
            });
          }
        }
      }
    }
  } catch (err: any) {
    logger.error('Webhook processing error', { error: err.message, stack: err.stack });
  }
});
