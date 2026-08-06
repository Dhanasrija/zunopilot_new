import type {
  Prisma, Ticket, TicketEventType, TicketPriority, TicketStatus,
} from '@prisma/client';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { prisma } from '../../config/prisma.js';
import { logger } from '../../config/logger.js';
import { ApiError } from '../../utils/ApiError.js';
import { whatsappProviderFor } from '../conversation-engine/providers/whatsapp.js';
import { recordOutboundMessage } from '../conversation-engine/providers/mirror.js';

// Support tickets.
//
// A ticket is a promise: someone said they would deal with a customer's problem.
// Everything here exists to keep that promise legible — a gapless reference the
// customer can quote, a history nobody can quietly rewrite, and an update path
// that either reaches the customer or says plainly that it did not.

const PREFIX = 'ZT';

/** How many times to re-attempt a ticket number lost to a concurrent raise. */
const MAX_SEQUENCE_ATTEMPTS = 10;

/**
 * A unique-constraint violation caused by two raises picking the same number.
 *
 * Matches on **either** unique index, because `number` and `sequence` are two
 * expressions of one value and Postgres reports whichever it happens to check
 * first — in practice `(tenantId, number)`. An earlier version of this predicate
 * looked only for `sequence`, so it never matched, the retry never ran, and the
 * concurrency bug it was written to fix stayed exactly as broken as before.
 */
const isNumberCollision = (err: unknown): boolean => {
  if (!(err instanceof PrismaClientKnownRequestError) || err.code !== 'P2002') return false;
  const target = String((err.meta as { target?: string | string[] } | undefined)?.target ?? '');
  return target.includes('sequence') || target.includes('number');
};

/** Statuses where the business considers the promise discharged. */
export const CLOSED_STATUSES: TicketStatus[] = ['RESOLVED', 'CLOSED'];

export const ticketInclude = {
  assignee: { select: { id: true, fullName: true } },
  openedBy: { select: { id: true, fullName: true } },
  customer: { select: { id: true, waId: true, name: true, phone: true } },
  conversation: { select: { id: true, status: true } },
} satisfies Prisma.TicketInclude;

/**
 * How long Meta lets a business reply with a free-form message.
 *
 * Measured from the customer's **last inbound message**, not from anything we
 * sent. Outside it only an approved template may be delivered, so this number
 * decides whether an agent can answer at all.
 */
export const CUSTOMER_SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

const recordEvent = (
  tx: Prisma.TransactionClient,
  event: {
    ticketId: string;
    type: TicketEventType;
    actorId: string | null;
    body?: string | null;
    fromStatus?: TicketStatus | null;
    toStatus?: TicketStatus | null;
    visibleToCustomer?: boolean;
    messageId?: string | null;
  },
) => tx.ticketEvent.create({
  data: {
    ticketId: event.ticketId,
    type: event.type,
    actorId: event.actorId,
    body: event.body ?? null,
    fromStatus: event.fromStatus ?? null,
    toStatus: event.toStatus ?? null,
    // Defaults to false. An internal note that leaked as "sent to the customer"
    // would let an agent believe someone had been told something they had not.
    visibleToCustomer: event.visibleToCustomer ?? false,
    messageId: event.messageId ?? null,
  },
});

/** Fetch a ticket, scoped to the workspace. */
export const ticketOf = async (tenantId: string, ticketId: string) => {
  const ticket = await prisma.ticket.findFirst({
    where: { id: ticketId, tenantId },
    include: ticketInclude,
  });
  if (!ticket) throw ApiError.notFound('Ticket not found');
  return ticket;
};

export interface RaiseTicketInput {
  subject: string;
  body: string;
  priority?: TicketPriority;
  customerId?: string | null;
  conversationId?: string | null;
  assigneeId?: string | null;
}

/**
 * Raise a ticket.
 *
 * The number is allocated **inside the transaction** that writes the row, from
 * the highest sequence this workspace has used, and a raise that fails consumes
 * nothing. That is the whole point: customers quote these back, and a jump from
 * ZT-000041 to ZT-000043 reads as a ticket that was lost.
 *
 * Concurrent raises are handled by the retry loop below rather than by isolation
 * — see the comment there for why, and for what actually happens without it.
 */
export const raiseTicket = async (
  tenantId: string,
  actorId: string,
  input: RaiseTicketInput,
): Promise<Ticket> => {
  // Both are resolved before the transaction and scoped to the workspace, so a
  // guessed id from another tenant cannot attach a ticket to their conversation.
  let customerId = input.customerId ?? null;

  if (input.conversationId) {
    const conversation = await prisma.conversation.findFirst({
      where: { id: input.conversationId, tenantId },
      select: { id: true, customerId: true },
    });
    if (!conversation) throw ApiError.badRequest('That conversation is not in this workspace');
    // The conversation knows who it belongs to; trusting it over the request
    // means a ticket can never be filed against the wrong customer.
    customerId = conversation.customerId;
  } else if (customerId) {
    const customer = await prisma.customer.findFirst({
      where: { id: customerId, tenantId },
      select: { id: true },
    });
    if (!customer) throw ApiError.badRequest('That customer is not in this workspace');
  }

  if (input.assigneeId) {
    const assignee = await prisma.user.findFirst({
      where: { id: input.assigneeId, tenantId, isActive: true },
      select: { id: true },
    });
    if (!assignee) throw ApiError.badRequest('That person is not an active member of this workspace');
  }

  // Retried, because "read the highest sequence then insert" is a read-modify-write
  // and Postgres' default isolation lets concurrent raises read the same value.
  // Measured before this loop existed: **five of eight simultaneous raises failed**
  // on the unique index. For a busy support desk that is two agents clicking at
  // once and one of them seeing an error.
  //
  // A retry rather than a Postgres sequence, because a sequence hands back numbers
  // on rollback and leaves gaps — and gapless is the whole requirement. The unique
  // index stays as the correctness backstop; this loop just means losing the race
  // costs a retry instead of the ticket.
  for (let attempt = 0; attempt < MAX_SEQUENCE_ATTEMPTS; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        const last = await tx.ticket.findFirst({
          where: { tenantId },
          orderBy: { sequence: 'desc' },
          select: { sequence: true },
        });
        const sequence = (last?.sequence ?? 0) + 1;

        const ticket = await tx.ticket.create({
          data: {
            tenantId,
            sequence,
            number: `${PREFIX}-${String(sequence).padStart(6, '0')}`,
            subject: input.subject.trim(),
            body: input.body.trim(),
            priority: input.priority ?? 'NORMAL',
            customerId,
            conversationId: input.conversationId ?? null,
            assigneeId: input.assigneeId ?? null,
            openedById: actorId,
          },
        });

        await recordEvent(tx, {
          ticketId: ticket.id, type: 'OPENED', actorId, toStatus: 'OPEN', body: ticket.subject,
        });
        if (ticket.assigneeId) {
          await recordEvent(tx, { ticketId: ticket.id, type: 'ASSIGNED', actorId, body: 'Assigned on creation' });
        }

        return ticket;
      });
    } catch (err) {
      if (!isNumberCollision(err) || attempt === MAX_SEQUENCE_ATTEMPTS - 1) throw err;
      // A short jittered pause, so a burst of contenders does not re-collide in
      // lockstep on the next attempt.
      await new Promise((resolve) => { setTimeout(resolve, 10 + Math.random() * 40); });
    }
  }

  // Unreachable: the loop either returns or rethrows on its last attempt.
  throw ApiError.internal('Could not allocate a ticket number');
};

/**
 * Move a ticket's status.
 *
 * `resolvedAt` and `closedAt` are stamped when they are reached and **cleared on
 * reopen**, so "resolved on" always means the resolution that stuck rather than
 * the first attempt. `firstRespondedAt` is deliberately not touched here — it
 * belongs to the moment a customer was actually told something, not to an
 * internal status change.
 */
export const setTicketStatus = async (
  tenantId: string,
  ticketId: string,
  actorId: string,
  status: TicketStatus,
  note?: string | null,
): Promise<Ticket> => {
  const ticket = await ticketOf(tenantId, ticketId);
  if (ticket.status === status) return ticket;

  const wasClosed = CLOSED_STATUSES.includes(ticket.status);
  const isClosed = CLOSED_STATUSES.includes(status);
  const now = new Date();

  return prisma.$transaction(async (tx) => {
    const updated = await tx.ticket.update({
      where: { id: ticketId },
      data: {
        status,
        resolvedAt: status === 'RESOLVED' ? (ticket.resolvedAt ?? now) : isClosed ? ticket.resolvedAt : null,
        closedAt: status === 'CLOSED' ? now : null,
      },
    });

    await recordEvent(tx, {
      ticketId,
      type: !wasClosed && status === 'RESOLVED' ? 'RESOLVED'
        : wasClosed && !isClosed ? 'REOPENED'
          : 'STATUS_CHANGED',
      actorId,
      fromStatus: ticket.status,
      toStatus: status,
      body: note?.trim() || null,
    });

    return updated;
  });
};

/** Hand a ticket to a colleague, or return it to the queue with null. */
export const assignTicket = async (
  tenantId: string,
  ticketId: string,
  actorId: string,
  assigneeId: string | null,
): Promise<Ticket> => {
  const ticket = await ticketOf(tenantId, ticketId);
  if (ticket.assigneeId === assigneeId) return ticket;

  let name = 'nobody';
  if (assigneeId) {
    const assignee = await prisma.user.findFirst({
      where: { id: assigneeId, tenantId, isActive: true },
      select: { fullName: true },
    });
    if (!assignee) throw ApiError.badRequest('That person is not an active member of this workspace');
    name = assignee.fullName;
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.ticket.update({ where: { id: ticketId }, data: { assigneeId } });
    await recordEvent(tx, {
      ticketId,
      type: assigneeId ? 'ASSIGNED' : 'UNASSIGNED',
      actorId,
      body: assigneeId ? `Assigned to ${name}` : 'Returned to the queue',
    });
    return updated;
  });
};

/** An internal note. Never sent, and marked so it can never be mistaken for one. */
export const addTicketNote = async (
  tenantId: string,
  ticketId: string,
  actorId: string,
  body: string,
): Promise<void> => {
  await ticketOf(tenantId, ticketId);
  await recordEvent(prisma, {
    ticketId, type: 'NOTE', actorId, body: body.trim(), visibleToCustomer: false,
  });
};

export interface WindowState {
  /** Whether a free-form reply may be sent right now. */
  open: boolean;
  /** When the last inbound message arrived, or null if the customer never wrote. */
  lastInboundAt: Date | null;
  /** When the window shuts, if it is open. */
  expiresAt: Date | null;
  reason: 'open' | 'expired' | 'never_messaged' | 'no_conversation';
}

/**
 * Whether Meta's 24-hour customer service window is open on this ticket.
 *
 * Computed from the last **inbound** message, because that is what Meta's rule
 * is actually about — nothing the business sends reopens it. Exposed as its own
 * function so the UI can tell an agent *before* they type a reply, rather than
 * after they press send.
 */
export const windowStateFor = async (
  tenantId: string,
  conversationId: string | null,
): Promise<WindowState> => {
  if (!conversationId) {
    return { open: false, lastInboundAt: null, expiresAt: null, reason: 'no_conversation' };
  }

  const lastInbound = await prisma.message.findFirst({
    where: { tenantId, conversationId, direction: 'INBOUND' },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  });

  if (!lastInbound) {
    return { open: false, lastInboundAt: null, expiresAt: null, reason: 'never_messaged' };
  }

  const expiresAt = new Date(lastInbound.createdAt.getTime() + CUSTOMER_SERVICE_WINDOW_MS);
  return {
    open: expiresAt > new Date(),
    lastInboundAt: lastInbound.createdAt,
    expiresAt,
    reason: expiresAt > new Date() ? 'open' : 'expired',
  };
};

const WINDOW_REFUSAL: Record<WindowState['reason'], string> = {
  open: '',
  expired:
    'WhatsApp only allows a free reply within 24 hours of the customer’s last message, '
    + 'and that window has closed. The update has been saved on the ticket — reach them another '
    + 'way, or wait until they message again.',
  never_messaged:
    'This customer has never messaged on WhatsApp, so there is no conversation to reply in. '
    + 'The update has been saved on the ticket.',
  no_conversation:
    'This ticket is not linked to a WhatsApp conversation, so there is nobody to send it to. '
    + 'The update has been saved on the ticket.',
};

export interface UpdateResult {
  sent: boolean;
  /** Why it was not sent. Shown to the agent verbatim. */
  reason?: string;
  window: WindowState;
}

/**
 * Tell the customer where their ticket has got to.
 *
 * The important behaviour is what happens when it **cannot** be sent. The update
 * is still written to the ticket, as an `UPDATE_NOT_SENT` event that is not
 * marked visible, and the caller is told plainly why. Silently dropping a
 * resolution notice is the worst outcome available here: the agent believes the
 * customer was told, the customer heard nothing, and nothing anywhere records
 * the difference.
 *
 * Delivery goes through `whatsappProviderFor`, not straight at Meta, so a demo
 * or test workspace on a `mock-token-` channel behaves correctly instead of
 * failing — and through `recordOutboundMessage`, so the update appears in the
 * Inbox thread rather than living only on the ticket.
 */
export const sendTicketUpdate = async (
  tenantId: string,
  ticketId: string,
  actorId: string,
  body: string,
): Promise<UpdateResult> => {
  const ticket = await ticketOf(tenantId, ticketId);
  const message = body.trim();

  const window = await windowStateFor(tenantId, ticket.conversationId);

  const refuse = async (reason: string): Promise<UpdateResult> => {
    await recordEvent(prisma, {
      ticketId, type: 'UPDATE_NOT_SENT', actorId, body: message, visibleToCustomer: false,
    });
    logger.warn('Ticket update could not be delivered', {
      tenantId, ticketId, reason: window.reason,
    });
    return { sent: false, reason, window };
  };

  if (!window.open) return refuse(WINDOW_REFUSAL[window.reason]);
  if (!ticket.customer || !ticket.conversationId) return refuse(WINDOW_REFUSAL.no_conversation);

  const channel = await prisma.whatsappAccount.findFirst({ where: { tenantId } });
  if (!channel) {
    return refuse('No WhatsApp number is connected, so nothing can be sent. The update has been saved on the ticket.');
  }

  let sent: { messageId: string | null };
  try {
    sent = await whatsappProviderFor(channel).sendText({
      to: ticket.customer.waId,
      body: `${message}\n\nRef ${ticket.number}`,
    });
  } catch (err) {
    // A provider failure is not the agent's fault and must not lose the text
    // they wrote.
    return refuse(
      `WhatsApp refused the message (${err instanceof Error ? err.message : 'unknown error'}). `
      + 'The update has been saved on the ticket.',
    );
  }

  const mirrored = await recordOutboundMessage(
    { tenantId, conversationId: ticket.conversationId, customerId: ticket.customer.id },
    { type: 'TEXT', body: message, messageId: sent.messageId, sentByUserId: actorId },
  );

  await prisma.$transaction(async (tx) => {
    await recordEvent(tx, {
      ticketId, type: 'CUSTOMER_UPDATE', actorId, body: message,
      visibleToCustomer: true, messageId: mirrored.id,
    });
    await tx.ticket.update({
      where: { id: ticketId },
      data: {
        // Stamped once. A first-response time that moves is not one.
        firstRespondedAt: ticket.firstRespondedAt ?? new Date(),
      },
    });
    await tx.conversation.update({
      where: { id: ticket.conversationId! },
      data: { lastMessageAt: new Date() },
    });
  });

  logger.info('Ticket update sent', { tenantId, ticketId, number: ticket.number });
  return { sent: true, window };
};
