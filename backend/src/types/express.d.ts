import type { Prisma } from '@prisma/client';

// `requireAuth` hangs the authenticated user and their tenant off the request,
// and every controller downstream reads them. Declaration merging is how those
// become typed rather than `any` at each use site.

type AuthedUser = Prisma.UserGetPayload<{ include: { tenant: true } }>;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthedUser;
      /** Always set together with `user`; the tenant every query must scope to. */
      tenantId?: string;
    }
  }
}

export {};
