import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../config/prisma.js';
import { ROLE_PERMISSIONS } from '../config/permissions.js';
import { activeAdminCount, countSeats, requireActiveMember } from './membership.service.js';

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
