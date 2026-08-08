import type { Prisma } from '@prisma/client';

// `requireAuth` hangs the authenticated identity, the membership it resolved, and that
// membership's tenant off the request, and every controller downstream reads them. Declaration
// merging is how those become typed rather than `any` at each use site.

/**
 * Who is signed in. **Identity only** — a phone number, a name, notification preferences.
 *
 * This used to be `UserGetPayload<{ include: { tenant: true } }>`, which gave every controller
 * `actor.tenant` for free and quietly encoded "a user has one workspace" into the type system.
 * Dropping the include is deliberate: it turns every place that still assumed that into a compile
 * error, which is a better inventory than any grep.
 *
 * Read the workspace from `tenantIdOf(req)` instead. It was already the dominant pattern.
 */
type AuthedUser = Prisma.UserGetPayload<Record<string, never>>;

/** The workspace this request is acting in, with the role that decides what is allowed here. */
type ActiveMembership = Prisma.MembershipGetPayload<{
  include: { tenant: true; assignedRole: true };
}>;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthedUser;
      /**
       * Set by `requireAuth`, absent under `requireSession`.
       *
       * `requireSession` deliberately resolves no workspace — it is what the switcher routes mount
       * on, so somebody whose workspace is suspended can still get out of it. Anything reading this
       * must cope with its absence, which in practice means going through `tenantIdOf`.
       */
      membership?: ActiveMembership;
      /** Always set together with `membership`; the tenant every query must scope to. */
      tenantId?: string;
      /**
       * The token's own expiry, in seconds.
       *
       * Carried so switching workspaces can mint a token that **inherits** it rather than starting
       * a fresh lifetime — otherwise somebody with two workspaces holds an indefinite session by
       * moving between them.
       */
      tokenExp?: number | null;
    }
  }
}

export {};
