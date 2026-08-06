import type { EnquiryStatus, Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { logger } from '../../config/logger.js';
import { ApiError } from '../../utils/ApiError.js';
import { normalisePhone } from '../../services/otp.service.js';

// Contact enquiries from the marketing site.
//
// Platform-level, not tenant-level: the person filling in the form wants to buy
// ZunoPilot and has no workspace. See the `Enquiry` model comment for why this is
// the one table with no `tenantId`, and why these are not `Lead`s.
//
// The operating rule for everything here: **an enquiry must never be lost.** Before
// this existed the form ran a `setTimeout`, claimed "we will be in touch", and
// discarded the submission. Every judgement below leans towards storing something
// imperfect over rejecting it.

/**
 * Join the dial code to the number and normalise where possible.
 *
 * `normalisePhone` is reused so a stored enquiry matches the format the rest of the
 * product uses — but its failure is **not** fatal here. It refuses anything outside
 * 8–15 digits, and a prospect who types their number unusually should still reach
 * us; the sales conversation can sort the format out. The raw value is kept instead.
 */
const joinPhone = (dialCode: string, number: string): string => {
  const combined = `${dialCode}${number}`;
  try {
    return normalisePhone(combined);
  } catch {
    // Digits only, so what is stored is at least consistent, and capped so a
    // pathological input cannot bloat the row.
    return combined.replace(/[^\d+]/g, '').slice(0, 24);
  }
};

export interface CreateEnquiryInput {
  fullName: string;
  email: string;
  dialCode: string;
  phone: string;
  interest: string;
  message: string;
  ip: string | null;
  userAgent: string | null;
}

/**
 * Record an enquiry.
 *
 * Returns nothing the caller can echo back. The endpoint is public, so it answers
 * with `{ received: true }` and no id — there is no reason to hand an anonymous
 * caller a handle on a row.
 */
export const createEnquiry = async (input: CreateEnquiryInput): Promise<void> => {
  const enquiry = await prisma.enquiry.create({
    data: {
      fullName: input.fullName.trim(),
      email: input.email.trim().toLowerCase(),
      phone: joinPhone(input.dialCode, input.phone),
      interest: input.interest.trim(),
      message: input.message.trim(),
      ip: input.ip,
      // Capped: a header is attacker-controlled and unbounded.
      userAgent: input.userAgent?.slice(0, 400) ?? null,
    },
  });

  // Logged at info with the interest but **not** the message body: this is the only
  // signal that a prospect has arrived until someone opens the console, and a log
  // tail should not become a second copy of everyone's enquiry text.
  logger.info('Contact enquiry received', {
    enquiryId: enquiry.id,
    interest: enquiry.interest,
  });
};

export interface EnquiryListQuery {
  status?: EnquiryStatus;
  take: number;
  skip: number;
}

/**
 * The operator's list.
 *
 * **This returns the message body, and that is correct.** `docs/super-admin.md`
 * states that no endpoint returns message bodies — that rule protects *tenants'
 * customers' conversations*, which an operator has no business reading. An enquiry
 * is a message addressed to ZunoPilot by its own author, and the whole point of the
 * screen is to read and answer it. Please do not "fix" this.
 */
export const listEnquiries = async (query: EnquiryListQuery) => {
  const where: Prisma.EnquiryWhereInput = query.status ? { status: query.status } : {};

  const [enquiries, total, counts] = await Promise.all([
    prisma.enquiry.findMany({
      where,
      // Newest first: an enquiry decays fast, so the top of the list is the most
      // urgent thing on the screen.
      orderBy: { createdAt: 'desc' },
      take: query.take,
      skip: query.skip,
    }),
    prisma.enquiry.count({ where }),
    // Counts across every enquiry, not the current filter, so the tabs do not
    // renumber as you click through them.
    prisma.enquiry.groupBy({ by: ['status'], _count: { _all: true } }),
  ]);

  return {
    enquiries,
    total,
    counts: Object.fromEntries(counts.map((row) => [row.status, row._count._all])),
  };
};

/** How many are still untouched. Drives the console's nav badge. */
export const newEnquiryCount = (): Promise<number> =>
  prisma.enquiry.count({ where: { status: 'NEW' } });

export const enquiryById = async (id: string) => {
  const enquiry = await prisma.enquiry.findUnique({ where: { id } });
  if (!enquiry) throw ApiError.notFound('Enquiry not found');
  return enquiry;
};

/**
 * Update status and/or the internal note.
 *
 * `handledAt` is stamped the first time an enquiry leaves `NEW` and never rewritten,
 * so "how long did we take to pick this up" stays answerable.
 */
export const updateEnquiry = async (
  id: string,
  superAdminId: string,
  changes: { status?: EnquiryStatus; internalNote?: string | null },
) => {
  const existing = await enquiryById(id);
  const leavingNew = changes.status && changes.status !== 'NEW' && existing.status === 'NEW';

  return prisma.enquiry.update({
    where: { id },
    data: {
      ...(changes.status ? { status: changes.status } : {}),
      ...(changes.internalNote !== undefined ? { internalNote: changes.internalNote } : {}),
      handledByAdminId: superAdminId,
      ...(leavingNew && !existing.handledAt ? { handledAt: new Date() } : {}),
    },
  });
};
