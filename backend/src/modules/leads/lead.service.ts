import type {
  CallOutcome, Lead, LeadEventType, LeadStatus, Prisma,
} from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { logger } from '../../config/logger.js';
import { ApiError } from '../../utils/ApiError.js';
import { normalisePhone } from '../../services/otp.service.js';
import { requireActiveMember } from '../../services/membership.service.js';

// The lead pipeline.
//
// Two rules shape everything here:
//
//   • **Every change writes a `LeadEvent`.** A `status` column tells you where a
//     lead is; it cannot tell you that it sat in QUALIFIED for three weeks, or
//     who moved it to LOST. The timeline is the reason to have this module
//     rather than a spreadsheet, so it is written by the service and never by a
//     caller who might forget.
//   • **Writes go through one transaction.** The row and its event are written
//     together, or neither is. A timeline with holes is worse than no timeline,
//     because people trust it.

/** Statuses that mean the pipeline is finished with this lead. */
export const TERMINAL_STATUSES: LeadStatus[] = ['WON', 'LOST'];

export const leadInclude = {
  owner: { select: { id: true, fullName: true, phone: true, email: true } },
  customer: {
    select: {
      id: true,
      waId: true,
      name: true,
      // The newest thread only, so "Open conversation" can land on it instead of dropping
      // the agent on the Inbox list to find the person by hand. One row per lead, not the
      // whole history — the id is all the deep link needs.
      conversations: {
        orderBy: { lastMessageAt: 'desc' as const },
        take: 1,
        select: { id: true },
      },
    },
  },
} satisfies Prisma.LeadInclude;

/**
 * Normalise a lead's phone, refusing anything that is not a real number.
 *
 * Reuses `normalisePhone` from the auth path deliberately. A lead stored as
 * `+91 77020 00350` and a customer stored as `917702000350` are the same person
 * that nothing will ever match, so there is exactly one representation and it is
 * the one the rest of the product already uses.
 */
const leadPhone = (input: string): string => normalisePhone(input);

/** One timeline entry. Always written inside the caller's transaction. */
const recordEvent = (
  tx: Prisma.TransactionClient,
  event: {
    leadId: string;
    type: LeadEventType;
    actorId: string | null;
    body?: string | null;
    fromStatus?: LeadStatus | null;
    toStatus?: LeadStatus | null;
  },
) => tx.leadEvent.create({
  data: {
    leadId: event.leadId,
    type: event.type,
    actorId: event.actorId,
    body: event.body ?? null,
    fromStatus: event.fromStatus ?? null,
    toStatus: event.toStatus ?? null,
  },
});

/**
 * The earliest open reminder, cached onto the lead.
 *
 * `nextActionAt` exists so the list can sort and badge on "needs attention"
 * without a correlated subquery per row. It is derived, never authored, and
 * recomputed whenever a reminder is added, completed or removed — a cache that
 * only ever gets written on creation drifts within a day.
 */
const refreshNextAction = async (tx: Prisma.TransactionClient, leadId: string): Promise<void> => {
  const next = await tx.reminder.findFirst({
    where: { leadId, completedAt: null },
    orderBy: { dueAt: 'asc' },
    select: { dueAt: true },
  });
  await tx.lead.update({ where: { id: leadId }, data: { nextActionAt: next?.dueAt ?? null } });
};

/** Fetch a lead, scoped to the workspace. Throws rather than returning null. */
export const leadOf = async (tenantId: string, leadId: string) => {
  const lead = await prisma.lead.findFirst({
    where: { id: leadId, tenantId },
    include: leadInclude,
  });
  // Scoped by `tenantId` in the query rather than fetched and then checked, so
  // there is no path where a mistake reads another workspace's row at all.
  if (!lead) throw ApiError.notFound('Lead not found');
  return lead;
};

export interface CreateLeadInput {
  name: string;
  phone: string;
  email?: string | null;
  company?: string | null;
  source?: string | null;
  status?: LeadStatus;
  ownerId?: string | null;
  valuePaise?: number | null;
  notes?: string | null;
}

/**
 * Add a lead.
 *
 * A duplicate number is refused with a **409 that names the existing lead**,
 * rather than being created as a second row or silently merged. Both
 * alternatives are worse: a second row detaches the calls and reminders already
 * logged against the first, and a silent merge overwrites whatever the other
 * agent had recorded. Telling the caller where the lead already is lets them go
 * and look at it.
 */
export const createLead = async (
  tenantId: string,
  actorId: string,
  input: CreateLeadInput,
): Promise<Lead> => {
  const phone = leadPhone(input.phone);

  const existing = await prisma.lead.findUnique({
    where: { tenantId_phone: { tenantId, phone } },
    select: { id: true, name: true, status: true },
  });
  if (existing) {
    throw new ApiError(
      409,
      `${existing.name} is already a lead on this number (${existing.status.toLowerCase()}).`,
    );
  }

  // A brand-new lead is linked to an existing customer straight away when that
  // number has already messaged the business — otherwise the link would only
  // ever happen for leads added *before* first contact.
  const customer = await prisma.customer.findUnique({
    where: { tenantId_waId: { tenantId, waId: phone } },
    select: { id: true, lead: { select: { id: true } } },
  });
  const linkable = customer && !customer.lead ? customer.id : null;

  return prisma.$transaction(async (tx) => {
    const lead = await tx.lead.create({
      data: {
        tenantId,
        name: input.name.trim(),
        phone,
        email: input.email?.trim() || null,
        company: input.company?.trim() || null,
        source: input.source?.trim() || null,
        status: input.status ?? 'NEW',
        ownerId: input.ownerId ?? null,
        valuePaise: input.valuePaise ?? null,
        notes: input.notes?.trim() || null,
        customerId: linkable,
      },
    });

    await recordEvent(tx, {
      leadId: lead.id, type: 'CREATED', actorId, toStatus: lead.status,
      body: input.source ? `Added from ${input.source}` : 'Added',
    });
    if (lead.ownerId) {
      await recordEvent(tx, { leadId: lead.id, type: 'ASSIGNED', actorId, body: 'Assigned on creation' });
    }
    if (linkable) {
      await recordEvent(tx, {
        leadId: lead.id, type: 'LINKED_TO_CUSTOMER', actorId,
        body: 'This number has already messaged the business',
      });
    }

    return lead;
  });
};

export interface UpdateLeadInput {
  name?: string;
  phone?: string;
  email?: string | null;
  company?: string | null;
  source?: string | null;
  valuePaise?: number | null;
  notes?: string | null;
}

/** Edit the details. Status and owner have their own operations. */
export const updateLead = async (
  tenantId: string,
  leadId: string,
  actorId: string,
  input: UpdateLeadInput,
): Promise<Lead> => {
  const lead = await leadOf(tenantId, leadId);

  const data: Prisma.LeadUpdateInput = {};
  if (input.name !== undefined) data.name = input.name.trim();
  if (input.email !== undefined) data.email = input.email?.trim() || null;
  if (input.company !== undefined) data.company = input.company?.trim() || null;
  if (input.source !== undefined) data.source = input.source?.trim() || null;
  if (input.valuePaise !== undefined) data.valuePaise = input.valuePaise;
  if (input.notes !== undefined) data.notes = input.notes?.trim() || null;

  if (input.phone !== undefined) {
    const phone = leadPhone(input.phone);
    if (phone !== lead.phone) {
      const clash = await prisma.lead.findUnique({
        where: { tenantId_phone: { tenantId, phone } },
        select: { id: true, name: true },
      });
      if (clash) throw new ApiError(409, `${clash.name} is already a lead on that number.`);
      data.phone = phone;
    }
  }

  if (Object.keys(data).length === 0) return lead;

  return prisma.$transaction(async (tx) => {
    const updated = await tx.lead.update({ where: { id: leadId }, data });
    await recordEvent(tx, {
      leadId, type: 'UPDATED', actorId,
      body: `Updated ${Object.keys(data).join(', ')}`,
    });
    return updated;
  });
};

/**
 * Move a lead along the pipeline.
 *
 * Any status may follow any other, deliberately. Real pipelines go backwards —
 * a proposal is declined and the lead returns to CONTACTED — and a state machine
 * that refuses that teaches people to record something untrue instead. What is
 * enforced is that the move is *recorded*.
 */
export const setLeadStatus = async (
  tenantId: string,
  leadId: string,
  actorId: string,
  status: LeadStatus,
  note?: string | null,
): Promise<Lead> => {
  const lead = await leadOf(tenantId, leadId);
  if (lead.status === status) return lead;

  return prisma.$transaction(async (tx) => {
    const updated = await tx.lead.update({ where: { id: leadId }, data: { status } });
    await recordEvent(tx, {
      leadId, type: 'STATUS_CHANGED', actorId,
      fromStatus: lead.status, toStatus: status,
      body: note?.trim() || null,
    });
    return updated;
  });
};

/** Hand a lead to a colleague, or return it to the unassigned pool with null. */
export const assignLead = async (
  tenantId: string,
  leadId: string,
  actorId: string,
  ownerId: string | null,
): Promise<Lead> => {
  const lead = await leadOf(tenantId, leadId);
  if (lead.ownerId === ownerId) return lead;

  if (ownerId) {
    // Scoped to the workspace: assigning to a user id from another tenant would
    // otherwise put a lead somewhere nobody in this workspace can see it.
    const owner = await requireActiveMember(tenantId, ownerId);

    return prisma.$transaction(async (tx) => {
      const updated = await tx.lead.update({ where: { id: leadId }, data: { ownerId } });
      await recordEvent(tx, {
        leadId, type: 'ASSIGNED', actorId, body: `Assigned to ${owner.fullName}`,
      });
      return updated;
    });
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.lead.update({ where: { id: leadId }, data: { ownerId: null } });
    await recordEvent(tx, { leadId, type: 'UNASSIGNED', actorId, body: 'Returned to the pool' });
    return updated;
  });
};

/** A free-text note on the timeline. */
export const addLeadNote = async (
  tenantId: string,
  leadId: string,
  actorId: string,
  body: string,
): Promise<void> => {
  await leadOf(tenantId, leadId);
  await recordEvent(prisma, { leadId, type: 'NOTE', actorId, body: body.trim() });
};

/**
 * Record a call that an agent placed and then described.
 *
 * **This is the telephony seam.** Today the client opens a `tel:` link and the
 * agent says what happened, so nothing here observes the call — `durationSeconds`
 * stays null rather than being estimated, because a number that looks measured
 * and is not is worse than a blank. A provider like Exotel would call this same
 * function from its webhook with a duration and a recording url, and nothing
 * else in the module would change. Same shape as `deliver()` in `otp.service.ts`.
 */
export const logCall = async (
  tenantId: string,
  leadId: string,
  actorId: string,
  input: { outcome: CallOutcome; notes?: string | null; durationSeconds?: number | null },
) => {
  const lead = await leadOf(tenantId, leadId);

  return prisma.$transaction(async (tx) => {
    const call = await tx.callLog.create({
      data: {
        tenantId,
        leadId,
        actorId,
        // Frozen: correcting the lead's number later must not rewrite who was
        // actually dialled.
        phone: lead.phone,
        outcome: input.outcome,
        notes: input.notes?.trim() || null,
        durationSeconds: input.durationSeconds ?? null,
      },
    });

    // Only a connected call counts as contact. Marking a lead "last contacted"
    // because somebody rang and got no answer is how a stale lead looks fresh.
    if (input.outcome === 'CONNECTED') {
      await tx.lead.update({ where: { id: leadId }, data: { lastContactedAt: call.createdAt } });
    }

    await recordEvent(tx, {
      leadId, type: 'CALL_LOGGED', actorId,
      body: `Call — ${input.outcome.toLowerCase().replace(/_/g, ' ')}${input.notes ? `: ${input.notes.trim()}` : ''}`,
    });

    return call;
  });
};

/** Schedule a nudge. */
export const createReminder = async (
  tenantId: string,
  leadId: string,
  actorId: string,
  input: { dueAt: Date; note: string; assigneeId?: string | null },
) => {
  const lead = await leadOf(tenantId, leadId);

  // Defaults to the lead's owner, then to whoever set it. A reminder with no
  // owner is one nobody sees.
  const assigneeId = input.assigneeId ?? lead.ownerId ?? actorId;
  const assignee = await requireActiveMember(tenantId, assigneeId);

  return prisma.$transaction(async (tx) => {
    const reminder = await tx.reminder.create({
      data: { tenantId, leadId, assigneeId: assignee.id, dueAt: input.dueAt, note: input.note.trim() },
    });
    await recordEvent(tx, {
      leadId, type: 'REMINDER_SET', actorId,
      body: `Reminder for ${assignee.fullName}: ${input.note.trim()}`,
    });
    await refreshNextAction(tx, leadId);
    return reminder;
  });
};

/** Tick a reminder off. */
export const completeReminder = async (
  tenantId: string,
  reminderId: string,
  actorId: string,
) => {
  const reminder = await prisma.reminder.findFirst({
    where: { id: reminderId, tenantId },
  });
  if (!reminder) throw ApiError.notFound('Reminder not found');
  if (reminder.completedAt) return reminder;

  return prisma.$transaction(async (tx) => {
    const done = await tx.reminder.update({
      where: { id: reminderId },
      data: { completedAt: new Date() },
    });
    if (reminder.leadId) {
      await recordEvent(tx, {
        leadId: reminder.leadId, type: 'REMINDER_COMPLETED', actorId, body: reminder.note,
      });
      await refreshNextAction(tx, reminder.leadId);
    }
    return done;
  });
};

/**
 * Link a lead to the customer record for the same number.
 *
 * Called from the inbound path the first time a lead's number messages in.
 * Everything about it is defensive, because it runs on the hot path of every
 * inbound message: it does nothing when there is no lead, nothing when the lead
 * is already linked, and it never throws — a failure to link is a cosmetic
 * problem, and letting it reject would drop a customer's message.
 */
export const linkLeadToCustomer = async (
  tenantId: string,
  customerId: string,
  waId: string,
): Promise<void> => {
  try {
    const lead = await prisma.lead.findUnique({
      where: { tenantId_phone: { tenantId, phone: waId } },
      select: { id: true, customerId: true },
    });
    if (!lead || lead.customerId) return;

    await prisma.$transaction(async (tx) => {
      await tx.lead.update({ where: { id: lead.id }, data: { customerId } });
      await recordEvent(tx, {
        leadId: lead.id, type: 'LINKED_TO_CUSTOMER', actorId: null,
        body: 'This lead messaged the business on WhatsApp',
      });
    });

    logger.info('Lead linked to customer', { tenantId, leadId: lead.id, customerId });
  } catch (err) {
    // Swallowed on purpose, and logged loudly. The alternative is a failed link
    // rejecting an inbound customer message.
    logger.error('Could not link lead to customer', {
      tenantId, customerId, error: err instanceof Error ? err.message : String(err),
    });
  }
};

/**
 * Mark reminders that have come due.
 *
 * Runs every five minutes across every workspace. It does **not** send anything
 * — there is no email in the product and a WhatsApp nudge to an agent's own
 * number is a separate decision — so all it does is stamp `notifiedAt`, which is
 * what makes a due reminder countable exactly once instead of being re-counted
 * on every pass.
 *
 * Scoped to reminders that are open, past due, and not yet stamped, so the query
 * is bounded by the index and the work shrinks to nothing between sweeps.
 */
export const sweepDueReminders = async (): Promise<number> => {
  const { count } = await prisma.reminder.updateMany({
    where: { completedAt: null, notifiedAt: null, dueAt: { lte: new Date() } },
    data: { notifiedAt: new Date() },
  });
  if (count) logger.info('Lead reminders came due', { count });
  return count;
};
