import jwt, { type SignOptions } from 'jsonwebtoken';
import type { NextFunction, Request, Response } from 'express';
import type { SuperAdmin } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { env } from '../../config/env.js';
import { ApiError } from '../../utils/ApiError.js';

// Super admin authentication.
//
// A separate token type, not a role on the existing one. The two must not be
// interchangeable in either direction:
//
//   • A **tenant** token presented here fails, because it is verified against a
//     different secret and additionally carries no `superAdminId`.
//   • A **super admin** token presented to the customer API fails for the same
//     reason, and would in any case find no `User` row.
//
// The audience claim is belt-and-braces on top of the separate secret: if the
// two secrets are ever accidentally set to the same value, the claim still keeps
// the token types apart.

const AUDIENCE = 'zunopilot:super-admin';

/**
 * Read from `process.env` only — never from the `env` snapshot.
 *
 * The snapshot is taken at import and reads the same `process.env`, so it can
 * never be fresher and can easily be staler. For a *secret* the difference runs
 * in the dangerous direction: a fallback means an unset `SUPERADMIN_JWT_SECRET`
 * still reads as configured, so `superAdminConfigured()` would report healthy and
 * the API would keep signing tokens with a value the operator believes they
 * removed. `env.superAdmin` stays in `config/env.ts` as the documented home of
 * these variables. Same reasoning as `billing/gst.ts`.
 */
const secret = (): string => process.env.SUPERADMIN_JWT_SECRET ?? '';

/**
 * Whether the surface can run at all.
 *
 * Checked at boot rather than at first login, so a misconfigured deployment
 * fails immediately and visibly instead of looking healthy until someone tries
 * to sign in.
 */
export const superAdminConfigured = (): boolean => {
  const value = secret();
  // A short secret is worse than none: it looks configured and is guessable.
  return value.length >= 32;
};

export interface SuperAdminTokenPayload {
  superAdminId: string;
}

/** Pinned, not taken from the token's own header. See the note in utils/jwt.ts. */
const ALGORITHM = 'HS256' as const;

export const signSuperAdminToken = (superAdminId: string): string => jwt.sign(
  { superAdminId } satisfies SuperAdminTokenPayload,
  secret(),
  {
    algorithm: ALGORITHM,
    audience: AUDIENCE,
    expiresIn: env.superAdmin.jwtExpiresIn as SignOptions['expiresIn'],
  },
);

export const verifySuperAdminToken = (token: string): SuperAdminTokenPayload => {
  const decoded = jwt.verify(token, secret(), { algorithms: [ALGORITHM], audience: AUDIENCE });
  if (typeof decoded === 'string' || typeof decoded.superAdminId !== 'string') {
    throw new jwt.JsonWebTokenError('Token payload is missing superAdminId');
  }
  return { superAdminId: decoded.superAdminId };
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      superAdmin?: SuperAdmin;
    }
  }
}

export const requireSuperAdmin = async (req: Request, _res: Response, next: NextFunction) => {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw ApiError.unauthorized('Missing access token');

    const { superAdminId } = verifySuperAdminToken(token);
    const admin = await prisma.superAdmin.findUnique({ where: { id: superAdminId } });

    // Deactivation takes effect on the next request rather than at token expiry.
    // For a surface that can read every workspace, an 8-hour window after
    // someone's access is revoked is not acceptable.
    if (!admin || !admin.isActive) throw ApiError.unauthorized('Not an active super admin');

    req.superAdmin = admin;
    next();
  } catch (err) {
    const error = err as Error;
    next(error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError'
      ? ApiError.unauthorized('Invalid or expired token')
      : error);
  }
};

/** The authenticated operator. Throws instead of returning undefined. */
export const adminOf = (req: Request): SuperAdmin => {
  if (!req.superAdmin) throw ApiError.unauthorized('Request is not authenticated');
  return req.superAdmin;
};

/**
 * Record an operator action.
 *
 * Deliberately awaited by callers rather than fired and forgotten: for an action
 * that changes a customer's plan or access, losing the record of who did it is
 * worse than failing the request.
 */
export const audit = async (
  req: Request,
  event: {
    action: string;
    summary: string;
    tenantId?: string | null;
    targetType?: string | null;
    targetId?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<void> => {
  await prisma.auditEvent.create({
    data: {
      superAdminId: req.superAdmin?.id ?? null,
      action: event.action,
      summary: event.summary,
      tenantId: event.tenantId ?? null,
      targetType: event.targetType ?? null,
      targetId: event.targetId ?? null,
      metadata: (event.metadata ?? {}) as object,
      // `trust proxy` is set on the app, so this is the client address rather
      // than nginx's.
      ip: req.ip ?? null,
    },
  });
};
