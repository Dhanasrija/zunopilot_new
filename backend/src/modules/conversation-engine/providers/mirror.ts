import { Prisma, type MessageType } from '@prisma/client';
import { prisma } from '../../../config/prisma.js';
import { logger } from '../../../config/logger.js';
import type { WhatsAppSender } from '../engine/types.js';
import { describeMedia } from '../../media/inbound-media.js';

// Mirror everything the engine says into the Inbox.
//
// Without this an operator opening a conversation sees the customer's messages
// and nothing else — no menu, no question, no confirmation — which reads as a
// bot that never replied. Only `general-response` used to record its reply, so
// precisely the messages that matter when something goes wrong (the workflow's
// own prompts, the retry prompts, the clarification questions) were the ones
// missing.
//
// It is a decorator rather than a `prisma.message.create` at each call site
// because there are a dozen call sites and the next one added would forget.
// Wrapping the sender means anything that can talk to a customer is recorded by
// construction.

export interface MirrorContext {
  tenantId: string;
  conversationId: string;
  customerId: string;
}

/** Compact, operator-readable note of the choices offered alongside a message. */
type Options =
  | { kind: 'buttons'; options: Array<{ id: string; title: string }> }
  | { kind: 'list'; button: string; options: Array<{ id: string; title: string; description?: string }> }
  | null;

/**
 * Write one outbound message into the conversation.
 *
 * Shared with the operator reply path in `inbox.controller.ts`, because both
 * hit the same constraint and both need the same answer to it. A second copy
 * of this would be a second place to forget the duplicate-id case.
 *
 * `sentByUserId` is the attribution: a user id when a person typed it, null
 * when the engine did.
 */
export const recordOutboundMessage = async (
  ctx: MirrorContext,
  {
    type, body, messageId, options, sentByUserId, mediaUrl,
  }: {
    type: MessageType;
    body: string;
    messageId: string | null;
    options?: Options;
    sentByUserId?: string | null;
    /** Our own `/api/media/:id/file` path when the message carried a file. */
    mediaUrl?: string | null;
  },
) => {
  const data = {
    tenantId: ctx.tenantId,
    conversationId: ctx.conversationId,
    customerId: ctx.customerId,
    direction: 'OUTBOUND' as const,
    type,
    status: 'SENT' as const,
    body,
    sentByUserId: sentByUserId ?? null,
    // In the same insert as the row, not a follow-up update: two writes can disagree, and the
    // one that loses leaves a file in the thread that the thread cannot open.
    mediaUrl: mediaUrl ?? null,
    ...(options ? { payload: { outbound: options } as Prisma.InputJsonValue } : {}),
  };
  const include = { sentByUser: { select: { id: true, fullName: true, role: true } } };

  try {
    return await prisma.message.create({ data: { ...data, waMessageId: messageId }, include });
  } catch (err) {
    // `(tenantId, waMessageId)` is unique, because that constraint is what makes
    // *inbound* webhook retries idempotent. Outbound ids are not guaranteed
    // unique by every provider — the mock and console adapters restart their
    // counters per instance — and a duplicate id must not cost us the message.
    // Postgres allows many NULLs, so dropping the id keeps the row.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return prisma.message.create({ data: { ...data, waMessageId: null }, include });
    }
    throw err;
  }
};

const record = async (
  ctx: MirrorContext,
  args: {
    type: MessageType;
    body: string;
    messageId: string | null;
    options?: Options;
  },
): Promise<void> => {
  // No `sentByUserId`: everything the engine says is the bot talking.
  await recordOutboundMessage(ctx, args);
};

/**
 * Wrap a sender so every message it sends also lands in the Inbox.
 *
 * Recording happens *after* the send returns, so a message that failed to send
 * never appears as though it did. A failure to record is logged and swallowed:
 * the customer has already received the message, and throwing here would fail
 * the node — turning a cosmetic problem into a broken conversation.
 */
export const mirrorOutbound = (inner: WhatsAppSender, ctx: MirrorContext): WhatsAppSender => {
  const safely = async (write: () => Promise<void>) => {
    try {
      await write();
    } catch (err) {
      logger.error('Could not mirror an outbound message into the inbox', {
        conversationId: ctx.conversationId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  return {
    async sendText(args) {
      const sent = await inner.sendText(args);
      await safely(() => record(ctx, { type: 'TEXT', body: args.body, messageId: sent.messageId }));
      return sent;
    },

    async sendMedia(args) {
      const sent = await inner.sendMedia(args);
      // The caption is the body, or a short description when there is none — the same shape
      // an inbound file gets, so a thread reads consistently whichever direction it came from.
      await safely(() => record(ctx, {
        type: args.kind,
        body: args.caption?.trim() || describeMedia(args.kind, args.filename),
        messageId: sent.messageId,
      }));
      return sent;
    },

    async sendButtons(args) {
      const sent = await inner.sendButtons(args);
      await safely(() => record(ctx, {
        type: 'INTERACTIVE',
        body: args.body,
        messageId: sent.messageId,
        options: { kind: 'buttons', options: args.buttons },
      }));
      return sent;
    },

    async sendList(args) {
      const sent = await inner.sendList(args);
      await safely(() => record(ctx, {
        type: 'INTERACTIVE',
        body: args.body,
        messageId: sent.messageId,
        options: {
          kind: 'list',
          button: args.button,
          options: args.sections.flatMap((section) => section.rows),
        },
      }));
      return sent;
    },

    async sendTemplate(args) {
      const sent = await inner.sendTemplate(args);
      await safely(() => record(ctx, {
        // The rendered text lives in Meta's approved template, not here, so the
        // name and its parameters are the most an operator can be shown.
        type: 'TEMPLATE',
        body: args.params.length
          ? `${args.templateName} (${args.params.join(' · ')})`
          : args.templateName,
        messageId: sent.messageId,
      }));
      return sent;
    },
  };
};
