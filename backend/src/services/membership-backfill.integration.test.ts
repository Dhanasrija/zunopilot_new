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
 * Locally that means a dozen users across ten tenants, **several with a null `roleId`** (accounts
 * that predate custom roles and fall back to the legacy enum). Those are exactly why
 * `Membership.roleId` is nullable: a required column would have forced the migration to invent a
 * role for them.
 *
 * It is also the check that catches the migration being *re-run* — a second `INSERT … SELECT`
 * would violate `Membership_userId_tenantId_key`, but a hand-edited variant might not, and
 * duplicate memberships would double every seat count in the product.
 *
 * ── The direction that only just became assertable ───────────────────────────
 *
 * "Every user has a membership" was deliberately absent from the first version of this file: at
 * that point nothing in the application wrote memberships, so a user created by any other suite
 * legitimately had none, and asserting it would have made the file pass or fail on test ordering.
 *
 * It is here now, because every write path that creates or changes a user also syncs the
 * membership — signup, invite, role change, deactivation, the operator console, and the seeds. So
 * the converse holds too, and **that is the property C5 depends on**: the moment `requireAuth`
 * reads memberships instead of `User.tenantId`, a user without one cannot sign in anywhere.
 *
 * It is also the test that will catch the *next* write path somebody adds and forgets to sync.
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

  it('**every login still has the membership the backfill gave it**', async () => {
    /*
     * ── What this used to assert, and why it had to change ─────────────────────
     *
     * It compared every membership field against the user row: same tenant, same `roleId`, same
     * `legacyRole`, same `isActive`. That was right when the backfill ran, because cardinality was
     * **1:1** — `User.tenantId` was `NOT NULL` and nothing else wrote memberships.
     *
     * It is wrong now, and the first thing to falsify it was the feature working. A second
     * membership has a different tenant by definition. And since roles moved onto the membership,
     * `User.role` and `User.roleId` are **provenance** — what this login was created as — which a
     * role change in the team screen deliberately no longer touches.
     *
     * So the surviving claim is narrower and still worth having: the row the backfill created is
     * still there. Its tenant is the user's home tenant, and it is the one a person keeps even
     * after being revoked from it, because leaving is a flag rather than a delete.
     */
    const users = await prisma.user.findMany({
      select: {
        id: true, tenantId: true, createdAt: true,
        memberships: { select: { tenantId: true, joinedAt: true } },
      },
    });

    for (const user of users) {
      const home = user.memberships.find((membership) => membership.tenantId === user.tenantId);
      expect(home, `home membership for ${user.id}`).toBeDefined();
      // `joinedAt` is the user's own `createdAt`, not the migration's clock — the team screen orders
      // by it, and "joined today" for everybody would be wrong on every row.
      expect(home!.joinedAt.getTime(), `joinedAt for ${user.id}`).toBe(user.createdAt.getTime());
    }
  });

  it('**no membership carries another workspace\'s role**', async () => {
    /*
     * The check that replaces the field-by-field copy, and a better one: it is about *privilege*
     * rather than about a migration.
     *
     * `Membership.roleId` and `Membership.tenantId` are separate columns with separate foreign keys,
     * and nothing in the schema stops them disagreeing. A membership pointing at a `Role` belonging
     * to a different workspace would hand somebody that workspace's permissions here —
     * `resolvePermissions` reads the role it is given and asks no questions about where it came from.
     *
     * The team screen and the invite path both look the role up with `{ id, tenantId }` before
     * writing it, so this should be impossible. That is what makes it worth asserting against the
     * whole table rather than a fixture.
     */
    const withRole = await prisma.membership.findMany({
      where: { roleId: { not: null } },
      select: {
        id: true, tenantId: true, roleId: true,
        assignedRole: { select: { tenantId: true, name: true } },
      },
    });

    // Compared in TypeScript, because Prisma cannot compare a column on one model against a column
    // on a related one — and the filter that looks like it can, `{ equals: undefined }`, is the
    // no-filter footgun documented above.
    const wrong = withRole.filter((m) => m.assignedRole!.tenantId !== m.tenantId);
    expect(wrong, `memberships holding a role from another workspace: ${JSON.stringify(wrong)}`)
      .toEqual([]);
    // Not vacuous: there really are memberships with a role to have got wrong.
    expect(withRole.length).toBeGreaterThan(0);
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

  it('**no login is left without a membership**', async () => {
    /*
     * The property C5 depends on, and the one that could not be asserted until every write path
     * synced. The failure it catches is the worst available: a person whose login works today and
     * who, the moment `requireAuth` reads memberships instead of `User.tenantId`, belongs to no
     * workspace and cannot sign in anywhere.
     *
     * It is also the test that catches the *next* write path somebody adds and forgets to sync —
     * which is why it reads the whole table rather than a fixture. Any suite that creates a user
     * without a membership fails this, wherever it lives.
     */
    const orphans = await prisma.user.findMany({
      where: { memberships: { none: {} } },
      select: { id: true, phone: true, tenantId: true },
    });

    expect(orphans, `logins with no membership: ${JSON.stringify(orphans)}`).toEqual([]);
  });

  it('**is not vacuous: there are rows to have got wrong**', async () => {
    // Every check above is a "nothing is wrong" assertion and passes trivially against an empty
    // table. One positive claim, so an empty database cannot make this file meaningless in silence.
    const [users, memberships] = await Promise.all([
      prisma.user.count(),
      prisma.membership.count(),
    ]);

    expect(users).toBeGreaterThan(0);
    /*
     * **At least** one per login, not exactly one.
     *
     * `toBe(users)` was the original, and it was a true statement about the backfill that became a
     * false statement about the product: somebody in two workspaces has two memberships. The
     * inequality is what survives — every login has its home membership, and any surplus is somebody
     * who joined a second workspace, which is the entire point.
     */
    expect(memberships).toBeGreaterThanOrEqual(users);
  });
});
