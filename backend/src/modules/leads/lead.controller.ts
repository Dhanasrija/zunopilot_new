import type { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../config/prisma.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ApiError } from '../../utils/ApiError.js';
import { tenantIdOf, userOf } from '../../middleware/auth.js';
import { queryString } from '../../utils/query.js';
import {
  addLeadNote, assignLead, completeReminder, createLead, createReminder,
  leadInclude, leadOf, logCall, setLeadStatus, updateLead,
} from './lead.service.js';

// The Leads API.
//
// Every route is scoped with `tenantIdOf(req)` — never a bare `where: { tenantId }`
// that could be undefined, which Prisma reads as *no filter* and would return
// every workspace's pipeline.

const LEAD_STATUSES = ['NEW', 'CONTACTED', 'QUALIFIED', 'PROPOSAL', 'WON', 'LOST'] as const;
const CALL_OUTCOMES = ['CONNECTED', 'NO_ANSWER', 'BUSY', 'WRONG_NUMBER', 'CALLBACK_REQUESTED'] as const;

const idParam = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const requireId = (value: string | undefined, what: string): string => {
  if (!value || !idParam.test(value)) throw ApiError.badRequest(`Not a ${what} id`);
  return value;
};

/**
 * Money in **paise**, as an integer.
 *
 * Same rule as every other amount in the product. A lead worth "₹1,20,000.50"
 * is 12000050, and a float here eventually produces a pipeline total that does
 * not add up.
 */
const paise = z.number().int().min(0).max(1_000_000_000_00);

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  phone: z.string().trim().min(6).max(24),
  email: z.string().trim().email().max(200).nullish(),
  company: z.string().trim().max(160).nullish(),
  source: z.string().trim().max(80).nullish(),
  status: z.enum(LEAD_STATUSES).optional(),
  ownerId: z.string().regex(idParam).nullish(),
  valuePaise: paise.nullish(),
  notes: z.string().trim().max(4_000).nullish(),
});

const updateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  phone: z.string().trim().min(6).max(24).optional(),
  email: z.string().trim().email().max(200).nullish(),
  company: z.string().trim().max(160).nullish(),
  source: z.string().trim().max(80).nullish(),
  valuePaise: paise.nullish(),
  notes: z.string().trim().max(4_000).nullish(),
});

const listSchema = z.object({
  status: z.enum(LEAD_STATUSES).optional(),
  ownerId: z.string().regex(idParam).optional(),
  /** `me` is resolved server-side, so the client never has to know its own id. */
  owner: z.literal('me').optional(),
  unassigned: z.coerce.boolean().optional(),
  /** Open reminder already due. The one filter an agent actually starts the day on. */
  due: z.coerce.boolean().optional(),
  search: z.string().trim().max(120).optional(),
  take: z.coerce.number().int().min(1).max(200).default(50),
  skip: z.coerce.number().int().min(0).default(0),
});

export const listLeads = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = tenantIdOf(req);
  const user = userOf(req);
  // A repeated query param (`?status=A&status=B`) arrives as an array.
  // `queryString` collapses that to absent rather than letting an array reach a
  // Prisma filter, where it throws in the driver.
  const query = listSchema.parse({
    status: queryString(req.query.status),
    ownerId: queryString(req.query.ownerId),
    owner: queryString(req.query.owner),
    unassigned: queryString(req.query.unassigned),
    due: queryString(req.query.due),
    search: queryString(req.query.search),
    take: queryString(req.query.take),
    skip: queryString(req.query.skip),
  });

  const search = query.search?.trim();
  const where: Prisma.LeadWhereInput = {
    tenantId,
    ...(query.status ? { status: query.status } : {}),
    ...(query.unassigned ? { ownerId: null } : {}),
    ...(query.owner === 'me' ? { ownerId: user.id } : {}),
    ...(query.ownerId ? { ownerId: query.ownerId } : {}),
    ...(query.due ? { nextActionAt: { lte: new Date() } } : {}),
    ...(search
      ? {
        OR: [
          { name: { contains: search, mode: 'insensitive' as const } },
          { phone: { contains: search.replace(/[^\d]/g, '') } },
          { company: { contains: search, mode: 'insensitive' as const } },
          { email: { contains: search, mode: 'insensitive' as const } },
        ],
      }
      : {}),
  };

  const [leads, total, counts] = await Promise.all([
    prisma.lead.findMany({
      where,
      include: leadInclude,
      // Anything with an action due comes first; then most recently touched.
      orderBy: [{ nextActionAt: { sort: 'asc', nulls: 'last' } }, { updatedAt: 'desc' }],
      take: query.take,
      skip: query.skip,
    }),
    prisma.lead.count({ where }),
    // Pipeline totals across the whole workspace, not the current filter — the
    // tabs must not renumber themselves as you click through them.
    prisma.lead.groupBy({ by: ['status'], where: { tenantId }, _count: { _all: true } }),
  ]);

  res.json({
    success: true,
    data: {
      leads,
      total,
      counts: Object.fromEntries(counts.map((row) => [row.status, row._count._all])),
    },
  });
});

export const getLead = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = tenantIdOf(req);
  const leadId = requireId(req.params.leadId, 'lead');

  const lead = await leadOf(tenantId, leadId);
  const [events, calls, reminders] = await Promise.all([
    prisma.leadEvent.findMany({
      where: { leadId },
      include: { actor: { select: { id: true, fullName: true } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    }),
    prisma.callLog.findMany({
      where: { leadId },
      include: { actor: { select: { id: true, fullName: true } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
    prisma.reminder.findMany({
      where: { leadId },
      include: { assignee: { select: { id: true, fullName: true } } },
      orderBy: [{ completedAt: { sort: 'asc', nulls: 'first' } }, { dueAt: 'asc' }],
    }),
  ]);

  res.json({ success: true, data: { lead, events, calls, reminders } });
});

export const postLead = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = tenantIdOf(req);
  const user = userOf(req);
  const body = createSchema.parse(req.body);

  const lead = await createLead(tenantId, user.id, body);
  res.status(201).json({ success: true, data: lead });
});

export const patchLead = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = tenantIdOf(req);
  const user = userOf(req);
  const leadId = requireId(req.params.leadId, 'lead');
  const body = updateSchema.parse(req.body);

  res.json({ success: true, data: await updateLead(tenantId, leadId, user.id, body) });
});

const statusSchema = z.object({
  status: z.enum(LEAD_STATUSES),
  note: z.string().trim().max(1_000).nullish(),
});

export const patchLeadStatus = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = tenantIdOf(req);
  const user = userOf(req);
  const leadId = requireId(req.params.leadId, 'lead');
  const body = statusSchema.parse(req.body);

  res.json({
    success: true,
    data: await setLeadStatus(tenantId, leadId, user.id, body.status, body.note),
  });
});

const assignSchema = z.object({ ownerId: z.string().regex(idParam).nullable() });

export const patchLeadOwner = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = tenantIdOf(req);
  const user = userOf(req);
  const leadId = requireId(req.params.leadId, 'lead');
  const body = assignSchema.parse(req.body);

  res.json({ success: true, data: await assignLead(tenantId, leadId, user.id, body.ownerId) });
});

const bulkAssignSchema = z.object({
  leadIds: z.array(z.string().regex(idParam)).min(1).max(100),
  ownerId: z.string().regex(idParam).nullable(),
});

/**
 * Hand several leads over at once.
 *
 * Sequential rather than one `updateMany`, because each assignment has to write
 * its own timeline entry — and because a partial failure should leave the ones
 * that worked assigned rather than rolling back a hundred rows over one bad id.
 */
export const bulkAssignLeads = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = tenantIdOf(req);
  const user = userOf(req);
  const body = bulkAssignSchema.parse(req.body);

  const assigned: string[] = [];
  const failed: Array<{ leadId: string; reason: string }> = [];

  for (const leadId of body.leadIds) {
    try {
      await assignLead(tenantId, leadId, user.id, body.ownerId);
      assigned.push(leadId);
    } catch (err) {
      failed.push({ leadId, reason: err instanceof Error ? err.message : 'Could not assign' });
    }
  }

  res.json({ success: true, data: { assigned: assigned.length, failed } });
});

const noteSchema = z.object({ body: z.string().trim().min(1).max(4_000) });

export const postLeadNote = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = tenantIdOf(req);
  const user = userOf(req);
  const leadId = requireId(req.params.leadId, 'lead');
  const body = noteSchema.parse(req.body);

  await addLeadNote(tenantId, leadId, user.id, body.body);
  res.status(201).json({ success: true, data: { recorded: true } });
});

const callSchema = z.object({
  outcome: z.enum(CALL_OUTCOMES),
  notes: z.string().trim().max(2_000).nullish(),
});

/**
 * Record a call the agent has just made.
 *
 * The dial itself happens in the browser via a `tel:` link — nothing here places
 * it. `durationSeconds` is not accepted from the client on purpose: an agent's
 * estimate stored in the same field a provider would fill would make a guessed
 * number indistinguishable from a measured one.
 */
export const postLeadCall = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = tenantIdOf(req);
  const user = userOf(req);
  const leadId = requireId(req.params.leadId, 'lead');
  const body = callSchema.parse(req.body);

  const call = await logCall(tenantId, leadId, user.id, body);
  res.status(201).json({ success: true, data: call });
});

const reminderSchema = z.object({
  dueAt: z.coerce.date(),
  note: z.string().trim().min(1).max(500),
  assigneeId: z.string().regex(idParam).nullish(),
});

export const postLeadReminder = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = tenantIdOf(req);
  const user = userOf(req);
  const leadId = requireId(req.params.leadId, 'lead');
  const body = reminderSchema.parse(req.body);

  const reminder = await createReminder(tenantId, leadId, user.id, {
    dueAt: body.dueAt,
    note: body.note,
    assigneeId: body.assigneeId ?? null,
  });
  res.status(201).json({ success: true, data: reminder });
});

export const patchReminderComplete = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = tenantIdOf(req);
  const user = userOf(req);
  const reminderId = requireId(req.params.reminderId, 'reminder');

  res.json({ success: true, data: await completeReminder(tenantId, reminderId, user.id) });
});

/** This person's open reminders, for the header badge and the start of the day. */
export const listMyReminders = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = tenantIdOf(req);
  const user = userOf(req);

  const reminders = await prisma.reminder.findMany({
    where: { tenantId, assigneeId: user.id, completedAt: null },
    include: { lead: { select: { id: true, name: true, phone: true, status: true } } },
    orderBy: { dueAt: 'asc' },
    take: 100,
  });

  const now = new Date();
  res.json({
    success: true,
    data: { reminders, dueCount: reminders.filter((r) => r.dueAt <= now).length },
  });
});

export const deleteLead = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = tenantIdOf(req);
  const leadId = requireId(req.params.leadId, 'lead');

  // Scoped delete: `deleteMany` with a tenant filter cannot remove another
  // workspace's row even if the id were guessed.
  await leadOf(tenantId, leadId);
  await prisma.lead.deleteMany({ where: { id: leadId, tenantId } });

  res.json({ success: true, data: { deleted: true } });
});
