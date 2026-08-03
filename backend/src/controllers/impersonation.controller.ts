import type { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../config/prisma.js';
import { logger } from '../config/logger.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { tenantIdOf, userOf } from '../middleware/auth.js';
import {
  DEFAULT_WINDOW_HOURS, MAX_WINDOW_HOURS, grantView,
} from '../modules/super-admin/impersonation.js';

// The **customer's** side of support access.
//
// This is the half that makes the feature defensible, so it is a first-class part
// of the product rather than an admin afterthought: the workspace sees who asked,
// why, what they were allowed to do, what they actually looked at, and can end it
// mid-session.
//
// An audit trail only the watcher can read is not accountability, which is why
// every one of these endpoints is on the customer API.

const idShape = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const requireGrant = async (req: Request) => {
  const id = req.params.grantId;
  if (!id || !idShape.test(id)) throw ApiError.badRequest('Not a support request id');

  // Scoped to the caller's own tenant. A grant id from another workspace is a
  // 404 here, not a 403 — there is nothing to confirm the existence of.
  const grant = await prisma.impersonationGrant.findFirst({
    where: { id, tenantId: tenantIdOf(req) },
  });
  if (!grant) throw ApiError.notFound('Support request not found');
  return grant;
};

/**
 * Everything this workspace should know about support access.
 *
 * Returned to any member who can read settings, not only to owners: the fact that
 * someone outside the business looked at your customers is not information to
 * ration inside it. Only *approving* is owner-only.
 */
export const listSupportAccess = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = tenantIdOf(req);

  const grants = await prisma.impersonationGrant.findMany({
    where: { tenantId },
    orderBy: { createdAt: 'desc' },
    take: 50,
    include: {
      requestedBy: { select: { fullName: true, email: true } },
      respondedBy: { select: { fullName: true } },
      viewAsUser: { select: { fullName: true, email: true, phone: true } },
    },
  });

  res.json({
    success: true,
    data: {
      grants: grants.map(grantView),
      maxWindowHours: MAX_WINDOW_HOURS,
      defaultWindowHours: DEFAULT_WINDOW_HOURS,
    },
  });
});

/** What a support engineer actually looked at during one session. */
export const supportAccessLog = asyncHandler(async (req: Request, res: Response) => {
  const grant = await requireGrant(req);

  const entries = await prisma.impersonationAccessLog.findMany({
    where: { grantId: grant.id },
    orderBy: { at: 'desc' },
    take: 500,
    select: { method: true, path: true, at: true },
  });

  res.json({
    success: true,
    data: {
      // The grant's own counter is authoritative; the path list is best effort, so
      // the two are reported separately rather than one implying the other.
      requestCount: grant.requestCount,
      entries,
      complete: entries.length >= grant.requestCount,
    },
  });
});

const approveSchema = z.object({
  hours: z.number().int().min(1).max(MAX_WINDOW_HOURS).default(DEFAULT_WINDOW_HOURS),
});

/**
 * Approve a request.
 *
 * The approver picks the window, capped at `MAX_WINDOW_HOURS`. The engineer views
 * the workspace as the **approver themselves**, resolved now and frozen onto the
 * grant — so a later role change cannot widen what a live session can see, and the
 * person who consented is the person whose view was shared.
 */
export const approveSupportAccess = asyncHandler(async (req: Request, res: Response) => {
  const grant = await requireGrant(req);
  const body = approveSchema.parse(req.body);
  const actor = userOf(req);

  if (grant.status !== 'PENDING') {
    throw ApiError.badRequest(`This request is already ${grant.status.toLowerCase()}`);
  }
  if (grant.requestExpiresAt <= new Date()) {
    // Answering a lapsed request would resurrect consent that had already timed
    // out. Mark it and refuse.
    await prisma.impersonationGrant.update({
      where: { id: grant.id },
      data: { status: 'EXPIRED', respondedAt: new Date() },
    });
    throw ApiError.badRequest('This request has expired. Ask the engineer to request access again.');
  }

  const now = new Date();
  const approvedUntil = new Date(now.getTime() + body.hours * 3_600_000);

  const updated = await prisma.impersonationGrant.update({
    where: { id: grant.id },
    data: {
      status: 'APPROVED',
      respondedAt: now,
      respondedByUserId: actor.id,
      viewAsUserId: actor.id,
      approvedUntil,
    },
    include: {
      requestedBy: { select: { fullName: true, email: true } },
      respondedBy: { select: { fullName: true } },
      viewAsUser: { select: { fullName: true, email: true, phone: true } },
    },
  });

  await prisma.auditEvent.create({
    data: {
      superAdminId: grant.requestedById,
      action: 'impersonation.approved',
      tenantId: grant.tenantId,
      targetType: 'ImpersonationGrant',
      targetId: grant.id,
      summary: `${actor.email} approved support access for ${body.hours}h`,
      metadata: { hours: body.hours, approvedUntil: approvedUntil.toISOString() },
      ip: req.ip ?? null,
    },
  });

  logger.warn('Support access approved', {
    tenantId: grant.tenantId, grantId: grant.id, hours: body.hours, by: actor.email,
  });

  res.json({ success: true, data: grantView(updated) });
});

export const denySupportAccess = asyncHandler(async (req: Request, res: Response) => {
  const grant = await requireGrant(req);
  const actor = userOf(req);

  if (grant.status !== 'PENDING') {
    throw ApiError.badRequest(`This request is already ${grant.status.toLowerCase()}`);
  }

  await prisma.impersonationGrant.update({
    where: { id: grant.id },
    data: { status: 'DENIED', respondedAt: new Date(), respondedByUserId: actor.id },
  });

  await prisma.auditEvent.create({
    data: {
      superAdminId: grant.requestedById,
      action: 'impersonation.denied',
      tenantId: grant.tenantId,
      targetType: 'ImpersonationGrant',
      targetId: grant.id,
      summary: `${actor.email} denied support access`,
      ip: req.ip ?? null,
    },
  });

  res.json({ success: true });
});

/**
 * End a session immediately.
 *
 * Takes effect on the engineer's **next request**, because `requireAuth` resolves
 * the grant from the database every time rather than trusting the token. That is
 * the whole reason revocation is meaningful here instead of a promise that the
 * token will lapse eventually.
 */
export const revokeSupportAccess = asyncHandler(async (req: Request, res: Response) => {
  const grant = await requireGrant(req);
  const actor = userOf(req);

  if (grant.status !== 'APPROVED' || grant.revokedAt) {
    throw ApiError.badRequest('There is no active support session to end');
  }

  await prisma.impersonationGrant.update({
    where: { id: grant.id },
    data: {
      status: 'REVOKED',
      revokedAt: new Date(),
      revokedByUserId: actor.id,
      revokedBySelf: false,
    },
  });

  await prisma.auditEvent.create({
    data: {
      superAdminId: grant.requestedById,
      action: 'impersonation.revoked',
      tenantId: grant.tenantId,
      targetType: 'ImpersonationGrant',
      targetId: grant.id,
      summary: `${actor.email} ended support access after ${grant.requestCount} requests`,
      metadata: { requestCount: grant.requestCount, endedBy: 'workspace' },
      ip: req.ip ?? null,
    },
  });

  logger.warn('Support access revoked by the workspace', {
    tenantId: grant.tenantId, grantId: grant.id, by: actor.email,
  });

  res.json({ success: true });
});
