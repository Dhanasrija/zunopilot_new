import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../config/prisma.js';

/*
 * The backfill, checked against whatever is actually in this database.
 *
 * ── Why this is not a fixture test ───────────────────────────────────────────
 *
 * Every other integration test here seeds its own rows and asserts on them. This one deliberately
 * does the opposite: it reads **every** `User` and `Membership` in the database and asserts they
 * correspond. A migration's correctness is a property of the data it ran against, not of data a
 * test invented afterwards — and the rows that would break it are the awkward historical ones a
 * fixture would never think to create.
 *
 * Locally that means 12 users across 10 tenants, **three of them with a null `roleId`** (accounts
 * that predate custom roles and fall back to the legacy enum). Those three are exactly why
 * `Membership.roleId` is nullable: a required column would have forced the migration to invent a
 * role for them.
 *
 * It is also the check that catches the migration being *re-run* — a second `INSERT … SELECT`
 * would violate `Membership_userId_tenantId_key`, but a hand-edited variant might not, and
 * duplicate memberships would double every seat count in the product.
 *
 * ── The direction it deliberately does NOT assert, yet ───────────────────────
 *
 * "Every user has a membership" is **not checked here**, and that is not an oversight. Nothing in
 * the application writes memberships yet — that is the next commit — so a user created *after* the
 * migration legitimately has none, and this suite runs alongside twenty others that create users.
 * Asserting it now would make the file fail depending on which tests ran first.
 *
 * So this file asserts the direction that *is* an invariant today: **every membership corresponds
 * correctly to its user.** The converse becomes true once every write path creates one, and the
 * assertion moves here then. Written down because a half-invariant that looks whole is worse than
 * a stated gap.
 */

describe('every membership matches the user the backfill copied it from', () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('**a membership cannot point at a user that does not exist**', async () => {
    /*
     * The foreign key, asserted rather than assumed — it is one of four in a hand-written
     * migration, and a dangling membership would be a workspace listing somebody who cannot be
     * shown.
     *
     * Asserted by *attempting* the bad write, because the obvious query cannot express it. The
     * first version of this test was `count({ where: { user: { is: undefined } } })`, which
     * returned **every** row: Prisma treats an `undefined` filter as no filter at all. That is
     * precisely the footgun this whole change is being careful about — the same reason
     * `tenantIdOf` throws instead of returning undefined — and it produced a green-looking
     * assertion that meant nothing.
     */
    const tenant = await prisma.tenant.findFirst({ select: { id: true } });
    if (!tenant) return; // Empty database; nothing to hang a membership off.

    await expect(prisma.membership.create({
      data: { userId: '00000000-0000-4000-8000-000000000000', tenantId: tenant.id },
    })).rejects.toMatchObject({ code: 'P2003' });
  });

  it('**each membership carries the same workspace, role and state as its user**', async () => {
    /*
     * The straight copy, and the one that matters most. Cardinality was 1:1 when the migration
     * ran — `User.tenantId` is `NOT NULL` — so anything other than an exact match means the
     * backfill's `SELECT` list was mis-ordered. That mistake produces plausible-looking rows
     * rather than an error, and a membership naming the wrong workspace hands somebody a
     * workspace that is not theirs the moment `requireAuth` starts reading this table.
     *
     * Iterating in TypeScript rather than as one clever query, because Prisma cannot compare a
     * column on one model against a column on a related one — the obvious
     * `where: { NOT: { user: { tenantId: { equals: membership.fields.tenantId } } } }` does not
     * typecheck, and there is no point contorting around it for a table this size.
     */
    const memberships = await prisma.membership.findMany({
      select: {
        id: true, tenantId: true, roleId: true, legacyRole: true, isActive: true, joinedAt: true,
        user: { select: { id: true, tenantId: true, roleId: true, role: true, isActive: true, createdAt: true } },
      },
    });

    for (const membership of memberships) {
      const user = membership.user;
      expect(membership.tenantId, `tenant for ${user.id}`).toBe(user.tenantId);
      expect(membership.roleId, `roleId for ${user.id}`).toBe(user.roleId);
      expect(membership.legacyRole, `legacyRole for ${user.id}`).toBe(user.role);
      expect(membership.isActive, `isActive for ${user.id}`).toBe(user.isActive);
      // `joinedAt` is the user's own `createdAt`, not the migration's clock — the team screen
      // orders by it, and "joined today" for everybody would be wrong on every row.
      expect(membership.joinedAt.getTime(), `joinedAt for ${user.id}`)
        .toBe(user.createdAt.getTime());
    }
  });

  it('**a deactivated person has a revocation time, and an active one does not**', async () => {
    /*
     * Derived from `isActive` rather than left null. The old deactivation path recorded no
     * timestamp of its own, so `updatedAt` was the closest thing to the truth available — but a
     * revoked membership with no `revokedAt` at all would leave the team screen unable to say
     * when somebody left.
     */
    const wrong = await prisma.membership.findMany({
      where: {
        OR: [
          { isActive: true, revokedAt: { not: null } },
          { isActive: false, revokedAt: null },
        ],
      },
      select: { id: true, isActive: true, revokedAt: true },
    });

    expect(wrong, `memberships whose revokedAt disagrees with isActive: ${JSON.stringify(wrong)}`)
      .toEqual([]);
  });

  it('**no duplicate memberships**', async () => {
    /*
     * The unique index enforces this, so it should be impossible — which is the point. A
     * duplicate would double every seat count in the product and bill a workspace twice for one
     * person, and it is the shape a re-run or a hand-edited variant of the migration produces.
     */
    const duplicated = await prisma.membership.groupBy({
      by: ['userId', 'tenantId'],
      having: { userId: { _count: { gt: 1 } } },
    });

    expect(duplicated).toEqual([]);
  });

  it('**is not vacuous: the backfill actually inserted rows**', async () => {
    /*
     * Every check above is a "nothing is wrong" assertion, and all of them pass trivially against
     * an empty table. So one positive claim: if there are users at all, the backfill produced
     * memberships. It cannot be an equality — other suites create users while this one runs, and
     * nothing writes memberships for them until the next commit.
     */
    const [users, memberships] = await Promise.all([
      prisma.user.count(),
      prisma.membership.count(),
    ]);

    if (users > 0) expect(memberships).toBeGreaterThan(0);
    expect(memberships).toBeLessThanOrEqual(users);
  });
});
