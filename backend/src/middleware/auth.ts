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

/** The bearer token on this request, or null. */
const bearerOf = (req: Request): string | null => {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7) : null;
};

/**
 * Which workspace this session is acting in, or null.
 *
 * ── Selected by the claim, never validated against it ────────────────────────
 *
 * The old code read the tenant off the *user row* and used the token's claim, where one existed,
 * only as a cross-check. Now the claim chooses, and a claim naming a workspace this person is not
 * an **active** member of resolves to nothing and the request is refused. Two consequences worth
 * being explicit about:
 *
 *   • Revoking a membership takes effect on the **next request**, not at token expiry. There is no
 *     window in which an already-issued token keeps working against a workspace somebody has been
 *     removed from.
 *   • A token cannot be edited into another workspace. The claim is signed, and even if it were
 *     not, an unmatched claim resolves to nothing rather than to a default.
 */
const membershipFor = async (userId: string, claimed: string | null) => {
  const active = await prisma.membership.findMany({
    where: { userId, isActive: true },
    include: { tenant: true, assignedRole: true },
    // Most recently used first, then oldest membership. Only matters for the legacy branch and for
    // deciding where a fresh login lands.
    orderBy: [{ lastSelectedAt: 'desc' }, { joinedAt: 'asc' }],
  });

  if (claimed) return active.find((membership) => membership.tenantId === claimed) ?? null;

  /*
   * ── Tokens minted before the claim existed ─────────────────────────────────
   *
   * Everyone who is signed in when this deploys. Refusing them all would sign out the entire
   * customer base for no reason; guessing would put somebody in a workspace they did not choose.
   *
   * So: exactly one membership resolves, and anything ambiguous **refuses** with a code the client
   * can act on. A silent pick here would be a cross-workspace read with a valid signature and no
   * audit trail, and it would be invisible for as long as this branch lives.
   *
   * `JWT_EXPIRES_IN` is a day, so the whole population turns over in one. Cardinality was 1:1 when
   * memberships shipped, so in practice every one of these tokens has exactly one membership.
   *
   * **DELETE THIS BRANCH — target 2026-08-16**, a week after C5 reaches production. While it lives,
   * a token with no claim is a token whose workspace we chose rather than the client did.
   */
  return active.length === 1 ? active[0]! : null;
};

/**
 * Identity only: who is this, with no workspace resolved.
 *
 * **Exists so somebody can always reach the workspace switcher.** `requireAuth` refuses a session
 * whose workspace is suspended, or whose legacy token is ambiguous — and if the endpoints that list
 * and change workspaces sat behind it, the only way out of either state would be a support ticket.
 * The two switcher routes mount on this instead.
 *
 * It deliberately does **not** set `req.tenantId`, so a tenant-scoped query in a handler behind
 * this middleware throws in `tenantIdOf` rather than silently returning every workspace's rows.
 */
export const requireSession = async (req: Request, _res: Response, next: NextFunction) => {
  try {
    const token = bearerOf(req);
    if (!token) throw ApiError.unauthorized('Missing access token');

    const decoded = verifyToken(token);
    const user = await prisma.user.findUnique({ where: { id: decoded.userId } });
    // `User.isActive` is the operator's kill switch on the *login*, distinct from a membership
    // being revoked. Both refuse; this one refuses everywhere at once.
    if (!user || !user.isActive) throw ApiError.unauthorized('User not active');

    req.user = user;
    req.tokenExp = typeof decoded.exp === 'number' ? decoded.exp : null;
    next();
  } catch (err) {
    next(asAuthError(err));
  }
};

export const requireAuth = async (req: Request, _res: Response, next: NextFunction) => {
  try {
    const token = bearerOf(req);
    if (!token) throw ApiError.unauthorized('Missing access token');

    const decoded = verifyToken(token);
    const user = await prisma.user.findUnique({ where: { id: decoded.userId } });
    if (!user || !user.isActive) throw ApiError.unauthorized('User not active');

    const claimed = typeof decoded.tenantId === 'string' ? decoded.tenantId : null;
    const membership = await membershipFor(user.id, claimed);

    if (!membership) {
      /*
       * Two different failures, told apart because the client's next move differs.
       *
       * A token that named a workspace has been revoked from it — sign in again, or switch. A token
       * with no claim at all belongs to somebody with several workspaces and no way to say which:
       * the answer is not "log in again", it is "ask which workspace", and `GET /auth/workspaces`
       * answers that. `ApiError.details` already reaches the client through the error handler.
       */
      throw claimed
        ? ApiError.unauthorized('This session is not a member of that workspace')
        : new ApiError(401, 'Choose a workspace to continue', { code: 'WORKSPACE_REQUIRED' });
    }

    // A suspended workspace, set by an operator in the super admin console.
    //
    // Checked here rather than per route, because a suspension that only some
    // endpoints honour is not a suspension. Deliberately 403 with an explicit
    // message rather than a generic 401: the user's credentials are fine, and
    // "invalid token" would send them resetting a password that works.
    if (!membership.tenant.isActive) {
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

      /*
       * The grant is bound to a workspace, and the person it names must still be in it.
       *
       * This check used to be nearly tautological: it compared the grant against `user.tenantId`,
       * and a user had exactly one. What survives is substantive — the membership above was
       * *selected by* the token's claim, and `resolveImpersonation` has already asserted that the
       * claim matches the grant, so reaching here means an **active membership exists in the
       * granted workspace**. That is now what makes support access stop working the moment the
       * viewed person is removed, rather than at token expiry.
       */
      if (membership.tenantId !== grant.tenantId) {
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
    req.membership = membership;
    req.tenantId = membership.tenantId;
    req.tokenExp = typeof decoded.exp === 'number' ? decoded.exp : null;
    /*
     * Resolved once per request rather than per check: `can()` is called several times on some
     * routes, and the answer cannot change mid-request.
     *
     * From the **membership's** role and legacy floor, not the user's. That is the whole point of
     * the split: the same person can be an owner here and hold two inbox permissions there.
     * `resolvePermissions` itself needed no change — its parameter was already structural.
     */
    req.permissions = resolvePermissions(membership.assignedRole, membership.legacyRole);
    next();
  } catch (err) {
    next(asAuthError(err));
  }
};

/** A malformed or expired token is a 401, not a 500. */
const asAuthError = (err: unknown): Error => {
  const error = err as Error;
  return error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError'
    ? ApiError.unauthorized('Invalid or expired token')
    : error;
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
