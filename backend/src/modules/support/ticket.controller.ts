import type { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../config/prisma.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ApiError } from '../../utils/ApiError.js';
import { holds, tenantIdOf, userOf } from '../../middleware/auth.js';
import { maskContact } from '../../utils/mask-number.js';
import { maySeeFullNumbers } from '../../utils/may-see-numbers.js';
import { queryString } from '../../utils/query.js';
import {
  CLOSED_STATUSES, addTicketNote, assignTicket, raiseTicket, sendTicketUpdate,
  setTicketStatus, ticketInclude, ticketOf, windowStateFor,
} from './ticket.service.js';

const TICKET_STATUSES = ['OPEN', 'IN_PROGRESS', 'WAITING_ON_CUSTOMER', 'RESOLVED', 'CLOSED'] as const;
const PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;

const idParam = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const requireId = (value: string | undefined, what: string): string => {
  if (!value || !idParam.test(value)) throw ApiError.badRequest(`Not a ${what} id`);
  return value;
};

const listSchema = z.object({
  status: z.enum(TICKET_STATUSES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  assigneeId: z.string().regex(idParam).optional(),
  assignee: z.literal('me').optional(),
  unassigned: z.coerce.boolean().optional(),
  /** Everything not yet resolved or closed — the default working view. */
  open: z.coerce.boolean().optional(),
  search: z.string().trim().max(120).optional(),
  take: z.coerce.number().int().min(1).max(200).default(50),
  skip: z.coerce.number().int().min(0).default(0),
});

export const listTickets = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = tenantIdOf(req);
  const user = userOf(req);
  const query = listSchema.parse({
    status: queryString(req.query.status),
    priority: queryString(req.query.priority),
    assigneeId: queryString(req.query.assigneeId),
    assignee: queryString(req.query.assignee),
    unassigned: queryString(req.query.unassigned),
    open: queryString(req.query.open),
    search: queryString(req.query.search),
    take: queryString(req.query.take),
    skip: queryString(req.query.skip),
  });

  const search = query.search?.trim();
  const where: Prisma.TicketWhereInput = {
    tenantId,
    ...(query.status ? { status: query.status } : {}),
    ...(query.priority ? { priority: query.priority } : {}),
    ...(query.open ? { status: { notIn: ['RESOLVED', 'CLOSED'] } } : {}),
    ...(query.unassigned ? { assigneeId: null } : {}),
    ...(query.assignee === 'me' ? { assigneeId: user.id } : {}),
    ...(query.assigneeId ? { assigneeId: query.assigneeId } : {}),
    ...(search
      ? {
        OR: [
          { number: { contains: search, mode: 'insensitive' as const } },
          { subject: { contains: search, mode: 'insensitive' as const } },
          { customer: { name: { contains: search, mode: 'insensitive' as const } } },
          { customer: { waId: { contains: search.replace(/[^\d]/g, '') } } },
        ],
      }
      : {}),
  };

  const [tickets, total, counts] = await Promise.all([
    prisma.ticket.findMany({
      where,
      include: ticketInclude,
      // Urgent first, then oldest-untouched — the opposite of newest-first, which
      // buries the ticket that has been waiting longest.
      orderBy: [{ priority: 'desc' }, { updatedAt: 'asc' }],
      take: query.take,
      skip: query.skip,
    }),
    prisma.ticket.count({ where }),
    // Counts across the workspace, not the current filter, so the tabs do not
    // renumber themselves as you click through them.
    prisma.ticket.groupBy({ by: ['status'], where: { tenantId }, _count: { _all: true } }),
  ]);

  const seeFull = await maySeeFullNumbers(req);
  res.json({
    success: true,
    data: {
      tickets: tickets.map((ticket) => ({
        ...ticket,
        customer: ticket.customer ? maskContact(ticket.customer, seeFull) : ticket.customer,
      })),
      total,
      counts: Object.fromEntries(counts.map((row) => [row.status, row._count._all])),
    },
  });
});

export const getTicket = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = tenantIdOf(req);
  const ticketId = requireId(req.params.ticketId, 'ticket');

  const ticket = await ticketOf(tenantId, ticketId);
  const [events, window] = await Promise.all([
    prisma.ticketEvent.findMany({
      where: { ticketId },
      include: { actor: { select: { id: true, fullName: true } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    }),
    // Sent with the ticket so the reply box can say the window has closed
    // *before* the agent types, rather than after they press send.
    windowStateFor(tenantId, ticket.conversationId),
  ]);

  const seeFullDetail = await maySeeFullNumbers(req);
  res.json({
    success: true,
    data: {
      ticket: { ...ticket, customer: ticket.customer ? maskContact(ticket.customer, seeFullDetail) : ticket.customer },
      events,
      window,
    },
  });
});

const raiseSchema = z.object({
  subject: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(8_000),
  priority: z.enum(PRIORITIES).optional(),
  customerId: z.string().regex(idParam).nullish(),
  conversationId: z.string().regex(idParam).nullish(),
  assigneeId: z.string().regex(idParam).nullish(),
});

export const postTicket = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = tenantIdOf(req);
  const user = userOf(req);
  const body = raiseSchema.parse(req.body);

  const ticket = await raiseTicket(tenantId, user.id, body);
  // No masking here: this response is a bare `Ticket` with no customer relation loaded,
  // so there is no number in it to redact.
  res.status(201).json({ success: true, data: ticket });
});

const statusSchema = z.object({
  status: z.enum(TICKET_STATUSES),
  note: z.string().trim().max(1_000).nullish(),
});

export const patchTicketStatus = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = tenantIdOf(req);
  const user = userOf(req);
  const ticketId = requireId(req.params.ticketId, 'ticket');
  const body = statusSchema.parse(req.body);

  // Which permission this needs depends on the value being set, so it cannot be
  // a `requirePermission` on the route. Declaring a customer's problem dealt with
  // is a different act from moving a ticket between working states — it is the
  // one that ends the promise — so it is gated separately.
  if (CLOSED_STATUSES.includes(body.status) && !holds(req, 'tickets:close')) {
    throw ApiError.forbidden('Your role does not allow resolving or closing tickets (tickets:close)');
  }

  res.json({
    success: true,
    data: await setTicketStatus(tenantId, ticketId, user.id, body.status, body.note),
  });
});

const assignSchema = z.object({ assigneeId: z.string().regex(idParam).nullable() });

export const patchTicketAssignee = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = tenantIdOf(req);
  const user = userOf(req);
  const ticketId = requireId(req.params.ticketId, 'ticket');
  const body = assignSchema.parse(req.body);

  res.json({ success: true, data: await assignTicket(tenantId, ticketId, user.id, body.assigneeId) });
});

const noteSchema = z.object({ body: z.string().trim().min(1).max(8_000) });

export const postTicketNote = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = tenantIdOf(req);
  const user = userOf(req);
  const ticketId = requireId(req.params.ticketId, 'ticket');
  const body = noteSchema.parse(req.body);

  await addTicketNote(tenantId, ticketId, user.id, body.body);
  res.status(201).json({ success: true, data: { recorded: true } });
});

/**
 * Send the customer an update.
 *
 * Answers **200 with `sent: false`** when the 24-hour window has closed, rather
 * than an error status. It is not a failure the agent can fix by retrying, the
 * text they wrote *was* saved on the ticket, and a 4xx would make the client
 * show a generic "something went wrong" over an explanation that actually tells
 * them what to do next.
 */
export const postTicketUpdate = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = tenantIdOf(req);
  const user = userOf(req);
  const ticketId = requireId(req.params.ticketId, 'ticket');
  const body = noteSchema.parse(req.body);

  const result = await sendTicketUpdate(tenantId, ticketId, user.id, body.body);
  res.status(result.sent ? 201 : 200).json({ success: true, data: result });
});
