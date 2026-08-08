import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../config/prisma.js';
import { ROLE_PERMISSIONS } from '../config/permissions.js';
import {
  activeAdminCount, countSeats, requireActiveMember, syncMembership, syncMembershipsForTenant,
} from './membership.service.js';

/*
 * The three questions that used to be asked in ten places.
 *
 * The *call sites* are covered by `routes/tenant-isolation.integration.test.ts` — that file
 * proves each of the seven assignee checks still refuses somebody from another workspace, and
 * that the enforced and displayed seat counts agree. What it cannot reach is the one argument
 * whose absence is silent: `activeAdminCount`'s `client`.
 *
 * `role.controller` calls it **after its write, inside the transaction**, so it must see the
 * state that would result. Read through `prisma` instead and it sees the pre-write state — the
 * guard passes on exactly the edit it exists to refuse, and a workspace is left with nobody able
 * to manage the team. That failure is invisible from outside the transaction, so it needs
 * asserting here rather than through an endpoint.
 */

const TENANT = '55555555-5555-5555-5555-55555555b001';
const OTHER = '55555555-5555-5555-5555-55555555b002';

const wipe = async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [TENANT, OTHER] } } });
};

/** A workspace with an owner role, a plain role, and one person on each. */
const makeWorkspace = async (tenantId: string, phoneStem: string) => {
  const tenant = await prisma.tenant.create({
    data: {
      id: tenantId,
      businessName: `Members ${tenantId.slice(-4)}`,
      category: 'RESTAURANT',
      roles: {
        create: [
          { name: 'Owner', permissions: [...ROLE_PERMISSIONS.OWNER], isOwner: true, isSystem: true },
          { name: 'Floor', permissions: ['inbox:read'], sortOrder: 90 },
        ],
      },
    },
    include: { roles: true },
  });
  const ownerRole = tenant.roles.find((r) => r.isOwner)!;
  const plainRole = tenant.roles.find((r) => !r.isOwner)!;

  const owner = await prisma.user.create({
    data: {
      tenantId, phone: `${phoneStem}01`, fullName: 'The Owner', role: 'OWNER', roleId: ownerRole.id,
    },
  });
  const agent = await prisma.user.create({
    data: {
      tenantId, phone: `${phoneStem}02`, fullName: 'An Agent', role: 'AGENT', roleId: plainRole.id,
    },
  });

  return { ownerRole, plainRole, owner, agent };
};

describe('requireActiveMember', () => {
  let here: Awaited<ReturnType<typeof makeWorkspace>>;
  let elsewhere: Awaited<ReturnType<typeof makeWorkspace>>;

  beforeEach(async () => {
    await wipe();
    here = await makeWorkspace(TENANT, '1555601');
    elsewhere = await makeWorkspace(OTHER, '1555602');
  });

  afterAll(async () => {
    await wipe();
    await prisma.$disconnect();
  });

  it('returns the person, with the name its callers write into a timeline', () => (
    expect(requireActiveMember(TENANT, here.agent.id)).resolves.toEqual({
      id: here.agent.id, fullName: 'An Agent',
    })
  ));

  it('**refuses somebody from another workspace**', async () => {
    // A real, active person — just not here. This is the value that arrives in a request body,
    // so it is attacker-chosen, and accepting it would park work where nobody can see it.
    await expect(requireActiveMember(TENANT, elsewhere.agent.id)).rejects.toThrow(
      /not an active member of this workspace/i,
    );
  });

  it('**refuses somebody deactivated here**', async () => {
    await prisma.user.update({ where: { id: here.agent.id }, data: { isActive: false } });
    await expect(requireActiveMember(TENANT, here.agent.id)).rejects.toThrow();
  });

  it('refuses an id that is nobody, without leaking that it is nobody', async () => {
    // Same message and same status as the wrong-workspace case: whether an id exists somewhere
    // else on the platform is not this workspace's business.
    await expect(requireActiveMember(TENANT, '00000000-0000-4000-8000-000000000000'))
      .rejects.toThrow(/not an active member of this workspace/i);
  });

  it('throws a 400, because the id was a field of the request and not its subject', async () => {
    await expect(requireActiveMember(TENANT, elsewhere.agent.id))
      .rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('activeAdminCount', () => {
  let here: Awaited<ReturnType<typeof makeWorkspace>>;

  beforeEach(async () => {
    await wipe();
    here = await makeWorkspace(TENANT, '1555603');
    await makeWorkspace(OTHER, '1555604');
  });

  afterAll(async () => {
    await wipe();
    await prisma.$disconnect();
  });

  it('counts the owner and not the agent', async () => {
    expect(await activeAdminCount(TENANT)).toBe(1);
  });

  it('counts a custom role that grants team:manage', async () => {
    // "Owner" stopped being a fixed thing when custom roles arrived. What matters is whether
    // anybody left can reach the team screen.
    await prisma.role.update({
      where: { id: here.plainRole.id },
      data: { permissions: ['inbox:read', 'team:manage'] },
    });
    expect(await activeAdminCount(TENANT)).toBe(2);
  });

  it('**does not count another workspace’s admins**', async () => {
    // The other workspace has an owner too. If this returned 2, the last-admin guard would let a
    // workspace strand itself on the strength of a stranger.
    expect(await activeAdminCount(TENANT)).toBe(1);
  });

  it('ignores the person being changed, which is what the callers actually ask', async () => {
    expect(await activeAdminCount(TENANT, { excludingUserId: here.owner.id })).toBe(0);
  });

  it('does not count a deactivated admin', async () => {
    await prisma.user.update({ where: { id: here.owner.id }, data: { isActive: false } });
    expect(await activeAdminCount(TENANT)).toBe(0);
  });

  it('**sees an uncommitted write when given the caller’s transaction**', async () => {
    /*
     * The property that cannot be observed from outside. `role.controller` strips `team:manage`
     * from a role and *then* asks this, inside the same transaction, so it must see the stripped
     * role. Passing `prisma` would read the committed state, count the admin that is about to
     * stop being one, and wave the edit through.
     *
     * Asserted by doing exactly that: demote the owner role inside a transaction, then ask both
     * ways and require the answers to differ.
     */
    await prisma.$transaction(async (tx) => {
      await tx.role.update({
        where: { id: here.ownerRole.id },
        data: { isOwner: false, permissions: ['inbox:read'] },
      });

      // Through the transaction: the workspace now has nobody who can administer it.
      expect(await activeAdminCount(TENANT, { client: tx })).toBe(0);
      // Through a fresh connection: the demotion has not committed, so it still looks fine.
      // **This is the wrong answer**, and it is the answer the guard would have got.
      expect(await activeAdminCount(TENANT)).toBe(1);
    });
  });
});

describe('countSeats', () => {
  beforeEach(async () => {
    await wipe();
    await makeWorkspace(TENANT, '1555605');
    await makeWorkspace(OTHER, '1555606');
  });

  afterAll(async () => {
    await wipe();
    await prisma.$disconnect();
  });

  it('counts this workspace only', async () => {
    // Both workspaces hold two people. Counting 4 would bill one workspace for another's team.
    expect(await countSeats(TENANT)).toBe(2);
  });

  it('**stops counting somebody who was deactivated**', async () => {
    // Which is why reactivating consumes a seat exactly as inviting does.
    const agent = await prisma.user.findFirstOrThrow({
      where: { tenantId: TENANT, role: 'AGENT' },
    });
    await prisma.user.update({ where: { id: agent.id }, data: { isActive: false } });

    expect(await countSeats(TENANT)).toBe(1);
  });
});

describe('syncMembership', () => {
  /*
   * The dual-write. `Membership` is derived from `User` rather than told what to be, which is what
   * makes it impossible for a call site to pass the wrong role — so these tests drive the *user*
   * and assert the *membership*.
   *
   * The whole-database invariant in `membership-backfill.integration.test.ts` catches a membership
   * that is *missing*. It cannot reliably catch one whose values have drifted, because it scans at
   * an arbitrary moment relative to every other suite. That is what this block is for.
   */

  let here: Awaited<ReturnType<typeof makeWorkspace>>;

  const membershipOf = (userId: string) => prisma.membership.findUniqueOrThrow({
    where: { userId_tenantId: { userId, tenantId: TENANT } },
  });

  beforeEach(async () => {
    await wipe();
    here = await makeWorkspace(TENANT, '1555607');
    // `makeWorkspace` writes users directly, so no memberships exist yet — which is the state
    // `syncMembership` is for.
    await prisma.membership.deleteMany({ where: { tenantId: TENANT } });
  });

  afterAll(async () => {
    await wipe();
    await prisma.$disconnect();
  });

  it('creates a membership that copies the user', async () => {
    await syncMembership(here.agent.id);

    const membership = await membershipOf(here.agent.id);
    expect(membership.tenantId).toBe(TENANT);
    expect(membership.roleId).toBe(here.plainRole.id);
    expect(membership.legacyRole).toBe('AGENT');
    expect(membership.isActive).toBe(true);
    expect(membership.revokedAt).toBeNull();
    // The account's own creation time, matching the backfill, so ordering does not depend on
    // whether a row came from the migration or from this path.
    expect(membership.joinedAt.getTime()).toBe(here.agent.createdAt.getTime());
  });

  it('**carries a role change through**', async () => {
    await syncMembership(here.agent.id);
    await prisma.user.update({
      where: { id: here.agent.id },
      data: { roleId: here.ownerRole.id, role: 'OWNER' },
    });
    await syncMembership(here.agent.id);

    const membership = await membershipOf(here.agent.id);
    expect(membership.roleId).toBe(here.ownerRole.id);
    // The legacy floor has to move with it, or a later `roleId: null` would fall back to the wrong
    // permissions for this workspace.
    expect(membership.legacyRole).toBe('OWNER');
  });

  it('**stamps a revocation time when somebody is deactivated**', async () => {
    await syncMembership(here.agent.id);
    await prisma.user.update({ where: { id: here.agent.id }, data: { isActive: false } });
    await syncMembership(here.agent.id);

    const membership = await membershipOf(here.agent.id);
    expect(membership.isActive).toBe(false);
    expect(membership.revokedAt).not.toBeNull();
  });

  it('**does not move the revocation time on a later sync**', async () => {
    /*
     * `revokedAt` means *when they left*, so it moves only on the transition. Recomputing it every
     * time would push the timestamp forward whenever anything else about a revoked person changed,
     * so "left in March" would quietly become "left today" — and the team screen would be
     * confidently wrong about something nobody would think to check.
     */
    await syncMembership(here.agent.id);
    await prisma.user.update({ where: { id: here.agent.id }, data: { isActive: false } });
    await syncMembership(here.agent.id);
    const first = (await membershipOf(here.agent.id)).revokedAt;

    // Something unrelated changes, and the row is synced again.
    await prisma.user.update({ where: { id: here.agent.id }, data: { fullName: 'Renamed' } });
    await syncMembership(here.agent.id);

    expect((await membershipOf(here.agent.id)).revokedAt?.getTime()).toBe(first?.getTime());
  });

  it('clears the revocation time when somebody is brought back', async () => {
    await syncMembership(here.agent.id);
    await prisma.user.update({ where: { id: here.agent.id }, data: { isActive: false } });
    await syncMembership(here.agent.id);
    await prisma.user.update({ where: { id: here.agent.id }, data: { isActive: true } });
    await syncMembership(here.agent.id);

    const membership = await membershipOf(here.agent.id);
    expect(membership.isActive).toBe(true);
    expect(membership.revokedAt).toBeNull();
  });

  it('records who invited them, on the first write only', async () => {
    // `User` has nowhere to put this, so it is the one value the caller supplies. Passing it again
    // must not overwrite — the second sync is a role change, not a re-invitation.
    await syncMembership(here.agent.id, { invitedById: here.owner.id });
    await syncMembership(here.agent.id, { invitedById: null });

    expect((await membershipOf(here.agent.id)).invitedById).toBe(here.owner.id);
  });

  it('is idempotent', async () => {
    await syncMembership(here.agent.id);
    await syncMembership(here.agent.id);
    await syncMembership(here.agent.id);

    expect(await prisma.membership.count({ where: { userId: here.agent.id } })).toBe(1);
  });

  it('**never throws for a user that has gone**', async () => {
    // It is called from write paths that must not fail because of it. A deleted or raced user has
    // nothing to sync, and that is not an error.
    await expect(syncMembership('00000000-0000-4000-8000-000000000000')).resolves.toBeUndefined();
  });

  it('syncs a whole workspace in one call, for the seeds', async () => {
    const synced = await syncMembershipsForTenant(TENANT);

    expect(synced).toBe(2);
    expect(await prisma.membership.count({ where: { tenantId: TENANT } })).toBe(2);
  });
});
