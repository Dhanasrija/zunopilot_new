import jwt, { type SignOptions } from 'jsonwebtoken';
import type { ImpersonationGrant } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { ApiError } from '../../utils/ApiError.js';

// Support access: the grant lifecycle, and the token it produces.
//
// The four properties this file exists to enforce, restated because every branch
// below is in service of one of them:
//
//   consent-gated · time-boxed · read-only · audited to the customer
//
// There is deliberately **no function here that grants access without an
// approval**. Not a flag, not an override, not a "system" caller. The moment such
// a path exists it becomes the one that gets used when someone is in a hurry, and
// then the consent model is decoration.

/** Marks a token as impersonation. Checked against the DB grant, never trusted alone. */
export const IMPERSONATION_AUDIENCE = 'zunopilot:impersonation';

/** How long an unanswered request stays open. Silence is not consent. */
export const REQUEST_TTL_HOURS = 24;

/** The longest window a workspace can approve in one go. */
export const MAX_WINDOW_HOURS = 8;
export const DEFAULT_WINDOW_HOURS = 1;

/**
 * How long a single minted token lives.
 *
 * Short and independent of the approved window, so a token that leaks — copied
 * out of a browser's storage, pasted into a bug report — is useful for minutes
 * rather than hours. The operator's console silently mints another while the
 * window is open.
 */
export const TOKEN_TTL_MINUTES = 15;

export interface ImpersonationClaims {
  userId: string;
  /** Present only on an impersonation token. */
  imp: true;
  grantId: string;
  superAdminId: string;
  tenantId: string;
  /** Always true. A writable support session is not something this offers. */
  readOnly: true;
}

/**
 * Whether a grant may be used right now.
 *
 * The narrowest of the three clocks wins — that is the point of checking them
 * together rather than trusting whichever one a caller happened to look at.
 */
export const grantUsable = (grant: ImpersonationGrant, now = new Date()): boolean => (
  grant.status === 'APPROVED'
  && grant.revokedAt === null
  && grant.approvedUntil !== null
  && grant.approvedUntil > now
);

/** A short-lived, read-only token for an approved grant. */
export const mintImpersonationToken = (grant: ImpersonationGrant): { token: string; expiresAt: Date } => {
  if (!grant.viewAsUserId) {
    throw ApiError.unprocessable('This grant has no user to view the workspace as');
  }
  if (!grantUsable(grant)) {
    throw ApiError.forbidden('This support access is not active');
  }

  // Never issue a token that outlives the window the workspace approved.
  const windowEnd = grant.approvedUntil!.getTime();
  const tokenEnd = Date.now() + TOKEN_TTL_MINUTES * 60_000;
  const expiresAt = new Date(Math.min(windowEnd, tokenEnd));
  const seconds = Math.max(30, Math.floor((expiresAt.getTime() - Date.now()) / 1000));

  const claims: ImpersonationClaims = {
    userId: grant.viewAsUserId,
    imp: true,
    grantId: grant.id,
    superAdminId: grant.requestedById,
    tenantId: grant.tenantId,
    readOnly: true,
  };

  // Signed with the *tenant* secret, because the customer API is what has to
  // accept it. That is not the security boundary — the boundary is that
  // `requireAuth` refuses any token carrying `imp` unless a live APPROVED grant
  // backs it, which no signature can fake.
  const token = jwt.sign(claims, env.jwt.secret, {
    audience: IMPERSONATION_AUDIENCE,
    expiresIn: seconds as SignOptions['expiresIn'],
  });

  return { token, expiresAt };
};

/**
 * Verify an impersonation token against the database.
 *
 * Signature first, then the grant. Both must hold: a perfectly signed token for a
 * revoked grant is refused, which is what makes "revoke" mean *now* rather than
 * "when the token expires".
 */
export const resolveImpersonation = async (
  claims: { grantId?: unknown; superAdminId?: unknown; tenantId?: unknown },
): Promise<ImpersonationGrant> => {
  if (typeof claims.grantId !== 'string') {
    throw ApiError.unauthorized('Malformed support access token');
  }

  const grant = await prisma.impersonationGrant.findUnique({ where: { id: claims.grantId } });
  if (!grant) throw ApiError.unauthorized('Support access not found');

  if (grant.revokedAt) {
    throw ApiError.forbidden('This support access was ended by the workspace');
  }
  if (!grantUsable(grant)) {
    throw ApiError.forbidden('This support access has expired');
  }

  // The token's tenant must match the grant's. Belt and braces: a token cannot be
  // replayed against a different workspace even if one were somehow re-signed.
  if (claims.tenantId !== grant.tenantId) {
    throw ApiError.unauthorized('Support access token does not match its grant');
  }

  return grant;
};

/**
 * Record that the grant was used, and what for.
 *
 * `requestCount` and `lastUsedAt` are the authoritative volume record and are
 * updated on the grant itself. The path log is **best effort**: losing a row must
 * not fail the request a support engineer is making, and the count already proves
 * the session was active.
 *
 * Method and path only. Never a response body — that would copy the customer data
 * being viewed into a second table, which is the opposite of the point.
 */
export const recordImpersonatedRequest = (
  grantId: string,
  method: string,
  path: string,
): void => {
  void prisma.impersonationGrant.update({
    where: { id: grantId },
    data: { requestCount: { increment: 1 }, lastUsedAt: new Date() },
  }).catch(() => {});

  void prisma.impersonationAccessLog.create({
    data: { grantId, method, path: path.slice(0, 300) },
  }).catch(() => {});
};

/**
 * Close out requests nobody answered, and windows that have run out.
 *
 * Run on a schedule. Without it a PENDING request stays on a customer's dashboard
 * forever, and an APPROVED grant past its window would keep reading as "active" on
 * the screens even though every token is refused.
 */
export const sweepImpersonationGrants = async (): Promise<{ expired: number; ended: number }> => {
  const now = new Date();

  const [expired, ended] = await Promise.all([
    prisma.impersonationGrant.updateMany({
      where: { status: 'PENDING', requestExpiresAt: { lte: now } },
      data: { status: 'EXPIRED', respondedAt: now },
    }),
    prisma.impersonationGrant.updateMany({
      where: { status: 'APPROVED', approvedUntil: { lte: now }, revokedAt: null },
      data: { status: 'EXPIRED' },
    }),
  ]);

  if (expired.count || ended.count) {
    logger.info('Support access swept', { unanswered: expired.count, windowsClosed: ended.count });
  }
  return { expired: expired.count, ended: ended.count };
};

/** Everything a screen needs, without leaking anything about other workspaces. */
export const grantView = (grant: ImpersonationGrant & {
  requestedBy?: { fullName: string; email: string } | null;
  respondedBy?: { fullName: string } | null;
  // A customer's email is optional now that the phone is the identifier, so this
  // falls back to the phone rather than showing a blank.
  viewAsUser?: { fullName: string; email: string | null; phone?: string | null } | null;
}) => ({
  id: grant.id,
  status: grant.status,
  reason: grant.reason,
  requestedAt: grant.createdAt,
  requestExpiresAt: grant.requestExpiresAt,
  respondedAt: grant.respondedAt,
  approvedUntil: grant.approvedUntil,
  revokedAt: grant.revokedAt,
  revokedBySelf: grant.revokedBySelf,
  startedAt: grant.startedAt,
  lastUsedAt: grant.lastUsedAt,
  requestCount: grant.requestCount,
  active: grantUsable(grant),
  requestedBy: grant.requestedBy
    ? { name: grant.requestedBy.fullName, email: grant.requestedBy.email }
    : null,
  respondedBy: grant.respondedBy?.fullName ?? null,
  viewAs: grant.viewAsUser
    ? {
      name: grant.viewAsUser.fullName,
      email: grant.viewAsUser.email ?? grant.viewAsUser.phone ?? null,
    }
    : null,
});
