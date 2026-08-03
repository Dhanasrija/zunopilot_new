import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { ModuleKey, UserRole } from '@prisma/client';
import {
  PERMISSIONS, isPermission, permissionsFor, type Permission,
} from '../config/permissions.js';
import { verifyToken } from '../utils/jwt.js';
import { ApiError } from '../utils/ApiError.js';
import { prisma } from '../config/prisma.js';
import { recordImpersonatedRequest, resolveImpersonation } from '../modules/super-admin/impersonation.js';
import { moduleEnabled } from '../modules/modules/module.service.js';

/** Methods a read-only support session may use. Everything else is refused. */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /**
       * Set when this request is a support engineer viewing the workspace under an
       * approved, read-only grant. Absent for every ordinary request, so code that
       * needs to behave differently can ask — but nothing has to, because the
       * read-only rule is enforced before any handler runs.
       */
      impersonation?: { grantId: string; superAdminId: string; readOnly: true };
      /** Resolved from the user's role once per request. */
      permissions?: Permission[];
    }
  }
}

export const requireAuth = async (req: Request, _res: Response, next: NextFunction) => {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw ApiError.unauthorized('Missing access token');

    const decoded = verifyToken(token);
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      include: { tenant: true, assignedRole: true },
    });
    if (!user || !user.isActive) throw ApiError.unauthorized('User not active');

    // A suspended workspace, set by an operator in the super admin console.
    //
    // Checked here rather than per route, because a suspension that only some
    // endpoints honour is not a suspension. Deliberately 403 with an explicit
    // message rather than a generic 401: the user's credentials are fine, and
    // "invalid token" would send them resetting a password that works.
    if (!user.tenant.isActive) {
      throw ApiError.forbidden(
        'This workspace has been suspended. Please contact support.',
      );
    }

    // ── Support access ───────────────────────────────────────────────────────
    //
    // A token carrying `imp` was minted for an approved support session. Its
    // signature proves only that *we* issued it; the database decides whether it
    // is still allowed. That ordering is what makes "revoke" take effect on the
    // next request rather than whenever the token happens to expire.
    //
    // Enforced here, not per route, for the same reason the suspension check is:
    // a read-only session that only some routers honour is not read-only.
    if ((decoded as { imp?: unknown }).imp === true) {
      const grant = await resolveImpersonation(decoded as Record<string, unknown>);

      // The grant is bound to a workspace. If the user the token names has since
      // moved or the grant points elsewhere, refuse rather than reconcile.
      if (grant.tenantId !== user.tenantId) {
        throw ApiError.unauthorized('Support access token does not match this workspace');
      }

      // Read-only, always. An operator may reproduce what a customer sees and can
      // never take an action attributed to them — no message sent as the
      // business, no order changed, no plan bought. There is no writable variant
      // of this session to opt into.
      if (!SAFE_METHODS.has(req.method)) {
        throw ApiError.forbidden(
          'Support access is read-only. This action has to be taken by someone in the workspace.',
        );
      }

      recordImpersonatedRequest(grant.id, req.method, req.originalUrl);

      req.impersonation = {
        grantId: grant.id,
        superAdminId: grant.requestedById,
        readOnly: true,
      };
    }

    req.user = user;
    req.tenantId = user.tenantId;
    // Resolved once per request rather than per check: `can()` is called several
    // times on some routes, and the answer cannot change mid-request.
    req.permissions = resolvePermissions(user.assignedRole, user.role);
    next();
  } catch (err) {
    const error = err as Error;
    next(error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError'
      ? ApiError.unauthorized('Invalid or expired token')
      : error);
  }
};

/**
 * What this user may do.
 *
 * The workspace's own `Role` row decides, and an owner role holds everything
 * implicitly rather than by enumeration — so a permission added to the vocabulary
 * later is available to owners without a data migration.
 *
 * The fallback to the legacy enum matters: a user whose `roleId` is somehow unset
 * would otherwise have **no** permissions, and someone with no permissions cannot
 * even open the screen that would fix them. Falling back to what they were is the
 * safe direction to fail.
 */
export const resolvePermissions = (
  role: { isOwner: boolean; permissions: string[] } | null,
  legacyRole: UserRole,
): Permission[] => {
  if (!role) return permissionsFor(legacyRole);
  if (role.isOwner) return [...PERMISSIONS];
  return role.permissions.filter(isPermission);
};

/**
 * Gate a route on a named capability rather than on a list of roles.
 *
 * A role list spreads the policy across every router and makes adding a role an
 * audit — which matters much more now that a workspace can invent its own roles.
 * `requirePermission('workflows:publish')` says what the route needs, and the
 * workspace's role says who has it.
 */
export const requirePermission = (permission: Permission): RequestHandler => (req, _res, next) => {
  if (!req.user) return next(ApiError.unauthorized());
  if (!(req.permissions ?? []).includes(permission)) {
    return next(ApiError.forbidden(`Your role does not allow this (${permission})`));
  }
  next();
};

/** Whether the current request holds a permission, for checks inside a handler. */
export const holds = (req: Request, permission: Permission): boolean =>
  (req.permissions ?? []).includes(permission);

/**
 * Gate a route on an optional module the workspace has been given.
 *
 * A different question from `requirePermission`, and both usually apply:
 * *has this workspace been sold Leads* is the operator's decision, and *may this
 * person open it* is the workspace's. Mounted module-wide rather than per route,
 * because a module where three endpoints forgot the gate is not gated.
 *
 * **Refused as 404, not 403.** A workspace that was never given Leads should not
 * be able to enumerate its endpoints and learn the feature exists — 403 says
 * "this is here and you cannot have it", which is an invitation to ask why, and
 * on an unreleased module it is a roadmap leak. It also means the client sees the
 * same thing for "module off" as for "route does not exist", which is exactly
 * what it should render.
 *
 * Read from the database per request rather than from the token, so an operator
 * disabling a module takes effect immediately instead of at token expiry — same
 * reasoning as revoking a support grant.
 */
export const requireModule = (module: ModuleKey): RequestHandler => async (req, _res, next) => {
  try {
    if (!req.tenantId) return next(ApiError.unauthorized());
    if (!await moduleEnabled(req.tenantId, module)) return next(ApiError.notFound());
    next();
  } catch (err) {
    next(err as Error);
  }
};

/**
 * The tenant every query in a request must be scoped to.
 *
 * This exists instead of declaring `tenantId` non-optional on the Request, and
 * instead of `req.tenantId!` at each call site, because of how Prisma treats
 * undefined: `where: { tenantId: undefined }` does not match nothing, it drops
 * the filter entirely and returns every tenant's rows. So an unauthenticated
 * request reaching tenant-scoped code has to fail loudly rather than silently
 * widen the query.
 */
export const tenantIdOf = (req: Request): string => {
  if (!req.tenantId) throw ApiError.unauthorized('Request is not authenticated');
  return req.tenantId;
};

/** The authenticated user, for routes behind `requireAuth`. Throws otherwise. */
export const userOf = (req: Request): NonNullable<Request['user']> => {
  if (!req.user) throw ApiError.unauthorized('Request is not authenticated');
  return req.user;
};
