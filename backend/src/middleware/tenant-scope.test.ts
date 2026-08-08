import { describe, expect, it } from 'vitest';
import type { Request } from 'express';
import { tenantIdOf, userOf } from './auth.js';

/*
 * The last-resort guard, tested at its own level.
 *
 * ── Why this file exists, and what it is *not* duplicating ───────────────────
 *
 * `tenant-isolation.integration.test.ts` asserts that every tenant-scoped list endpoint refuses
 * an anonymous request. That is a real property, and I wrote it believing it also covered this
 * one. **It does not**, and a mutation proved it: deleting the throw from `tenantIdOf` left all
 * 38 of those tests green, because `requireAuth` refuses an unauthenticated request long before
 * any handler calls `tenantIdOf`. The integration matrix tests `requireAuth`; nothing tested the
 * backstop behind it.
 *
 * ── Why the backstop matters more than it looks ──────────────────────────────
 *
 * From the note at `middleware/auth.ts:178`: Prisma treats `where: { tenantId: undefined }` as
 * **no filter at all** and returns every tenant's rows. So a handler that reached a query with
 * no tenant would not fail — it would answer 200 with the whole database. `tenantIdOf` throwing
 * is what converts that into a 401.
 *
 * Today it is unreachable, which is why a unit test is the only way to hold it. It stops being
 * unreachable the moment the tenant comes from a token claim rather than from the user row,
 * because then "authenticated but no workspace resolved" becomes a real state.
 */

/** A bare request object. Not a mock of Express — these two functions read two properties. */
const req = (over: Partial<Request> = {}) => over as Request;

describe('tenantIdOf', () => {
  it('**throws rather than returning undefined**', () => {
    /*
     * The whole point. Returning `undefined` here would be silently widened by Prisma into
     * "every workspace", so this must be an exception and not a falsy value a caller might
     * plausibly pass through.
     */
    expect(() => tenantIdOf(req())).toThrow();
  });

  it('throws with a 401, not a 500', () => {
    // It is an authentication failure, not a bug: the client's move is to sign in.
    try {
      tenantIdOf(req());
      expect.unreachable('tenantIdOf should have thrown');
    } catch (err) {
      expect((err as { statusCode?: number }).statusCode).toBe(401);
    }
  });

  it('throws on an empty string too', () => {
    // An empty tenant id is the same hazard as a missing one — `where: { tenantId: '' }` matches
    // nothing rather than everything, but it means something upstream is broken and silently
    // returning no rows would hide it.
    expect(() => tenantIdOf(req({ tenantId: '' } as Partial<Request>))).toThrow();
  });

  it('returns the tenant when one is resolved', () => {
    expect(tenantIdOf(req({ tenantId: 'ten-1' } as Partial<Request>))).toBe('ten-1');
  });
});

describe('userOf', () => {
  it('**throws rather than returning undefined**', () => {
    // Same shape, same reason: `where: { id: undefined }` is not "no user", it is "any user".
    expect(() => userOf(req())).toThrow();
  });

  it('returns the user when one is resolved', () => {
    const user = { id: 'user-1' } as never;
    expect(userOf(req({ user } as Partial<Request>))).toBe(user);
  });
});
