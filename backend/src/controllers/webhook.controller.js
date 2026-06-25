import { prisma } from '../config/prisma.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { handleInboundMessage } from '../services/automation.service.js';

// GET verification handshake for Meta.
//   • With Meta's params present + token matches → echo `hub.challenge` (plain text, Meta requires this exact body).
//   • With Meta's params present + token mismatch → 403.
//   • With no params (e.g. a human opening the URL in a browser) → 200 JSON status message.
export const verifyWebhook = (req, res) => {
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
        receivedCharCodes: [...token].map((c) => c.charCodeAt(0)),
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

const mapMessageType = (msg) => {
  switch (msg.type) {
    case 'text': return { type: 'TEXT', body: msg.text?.body || '' };
    case 'image': return { type: 'IMAGE', mediaUrl: msg.image?.id, body: msg.image?.caption };
    case 'document': return { type: 'DOCUMENT', mediaUrl: msg.document?.id, body: msg.document?.filename };
    case 'audio': return { type: 'AUDIO', mediaUrl: msg.audio?.id };
    case 'video': return { type: 'VIDEO', mediaUrl: msg.video?.id };
    case 'location': return { type: 'LOCATION', body: `${msg.location?.latitude},${msg.location?.longitude}` };
    case 'interactive': {
      const i = msg.interactive;
      const text = i?.list_reply?.title || i?.button_reply?.title || '';
      return { type: 'INTERACTIVE', body: text, payloadExtra: { interactive: i } };
    }
    default: return { type: 'SYSTEM', body: JSON.stringify(msg) };
  }
};

// Main webhook receiver. Meta calls this per business account.
export const receiveWebhook = asyncHandler(async (req, res) => {
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

        let tenant = account?.tenant;
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
        } else {
          logger.info('Matched WhatsApp account to tenant', {
            tenantId: tenant.id,
            tenantName: tenant.businessName,
            phoneNumberId,
          });
        }

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
            data: { status: String(status.status).toUpperCase() },
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

          const contact = contacts.find((c) => c.wa_id === wm.from) || contacts[0];
          const profileName = contact?.profile?.name;

          const customer = await prisma.customer.upsert({
            where: { tenantId_waId: { tenantId: tenant.id, waId: wm.from } },
            update: { lastSeenAt: new Date(), name: profileName || undefined },
            create: { tenantId: tenant.id, waId: wm.from, name: profileName, phone: wm.from, lastSeenAt: new Date() },
          });

          logger.info('Upserted customer profile', {
            customerId: customer.id,
            tenantId: tenant.id,
            waId: wm.from,
            name: profileName || customer.name,
          });

          let conversation = await prisma.conversation.findFirst({
            where: { tenantId: tenant.id, customerId: customer.id, status: { in: ['OPEN', 'HUMAN_TAKEOVER'] } },
            orderBy: { lastMessageAt: 'desc' },
          });
          
          let conversationAction = '';
          if (!conversation) {
            conversation = await prisma.conversation.create({
              data: { tenantId: tenant.id, customerId: customer.id, status: 'OPEN', lastMessageAt: new Date(), unreadCount: 1 },
            });
            conversationAction = 'created_new';
          } else {
            conversation = await prisma.conversation.update({
              where: { id: conversation.id },
              data: { lastMessageAt: new Date(), unreadCount: { increment: 1 } },
            });
            conversationAction = 'updated_existing';
          }

          logger.info('Conversation state updated', {
            conversationId: conversation.id,
            action: conversationAction,
            status: conversation.status,
            unreadCount: conversation.unreadCount,
          });

          const mapped = mapMessageType(wm);
          const payload = { raw: wm, ...(mapped.payloadExtra || {}) };
          const message = await prisma.message.create({
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

          logger.info('Saved message to database', {
            messageId: message.id,
            waMessageId: wm.id,
            type: message.type,
            direction: message.direction,
          });

          if (isUnmatchedAccount) {
            logger.info('Skipping automation service handler for unmatched WhatsApp account', {
              messageId: message.id,
              waMessageId: wm.id,
            });
          } else {
            logger.info('Forwarding to automation service handler', {
              messageId: message.id,
              conversationId: conversation.id,
            });

            await handleInboundMessage({ tenant, conversation, customer, message });

            logger.info('Automation service handling complete', {
              messageId: message.id,
            });
          }
        }
      }
    }
  } catch (err) {
    logger.error('Webhook processing error', { error: err.message, stack: err.stack });
  }
});
