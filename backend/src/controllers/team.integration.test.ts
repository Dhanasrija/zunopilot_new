import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { seedMemberships } from '../test-support/members.js';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { buildApp } from '../app.js';
import { prisma } from '../config/prisma.js';
import { signToken } from '../utils/jwt.js';
import { PERMISSIONS, ROLE_PERMISSIONS, can, type Permission } from '../config/permissions.js';
import { seedDefaultRoles } from '../services/role.service.js';

// Team access, over HTTP, because the thing being tested is the boundary: what
// a request with a given role is allowed to do. Testing the controllers
// directly would skip the middleware, which is where the policy is applied.

const TENANT = '99999999-9999-9999-9999-999999999999';
const OTHER_TENANT = '99999999-9999-9999-9999-99999999aaaa';

const app = buildApp();

let owner: { id: string; token: string };
let secondOwner: { id: string; token: string };
let manager: { id: string; token: string };
let agent: { id: string; token: string };
let outsider: { id: string; token: string };

/** The workspace's own role rows, by their seeded name. */
const roleIds: Record<string, Record<string, string>> = {};

const makeUser = async (
  tenantId: string,
  email: string,
  role: 'OWNER' | 'MANAGER' | 'AGENT',
) => {
  const user = await prisma.user.create({
    data: {
      tenantId,
      email,
      fullName: email.split('@')[0]!,
      role,
      // Attached to the workspace's own role — that is what permissions are read
      // from now. The enum stays only as the fallback label.
      roleId: roleIds[tenantId]?.[role],
      passwordHash: await bcrypt.hash('Password123!', 4),
      emailVerified: true,
    },
  });
  return { id: user.id, token: signToken({ userId: user.id, tenantId }) };
};

const wipe = async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [TENANT, OTHER_TENANT] } } });
};

beforeEach(async () => {
  await wipe();
  await prisma.tenant.createMany({
    data: [
      { id: TENANT, businessName: 'Team Test', category: 'RESTAURANT' },
      { id: OTHER_TENANT, businessName: 'Other Workspace', category: 'RESTAURANT' },
    ],
  });

  // A workspace with four people is a workspace on a paid plan. Without this
  // the seat limit — correctly — refuses the fifth invite before any of the
  // team rules are reached.
  for (const tenantId of [TENANT, OTHER_TENANT]) {
    await prisma.subscription.create({
      data: {
        tenantId,
        plan: 'BUSINESS',
        interval: 'YEARLY',
        status: 'ACTIVE',
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 86_400_000 * 365),
      },
    });
  }

  // Every workspace gets its starting roles, exactly as signup does.
  for (const tenantId of [TENANT, OTHER_TENANT]) {
    const roles = await seedDefaultRoles(prisma, tenantId);
    roleIds[tenantId] = {
      OWNER: roles.find((r) => r.isOwner)!.id,
      MANAGER: roles.find((r) => r.name === 'Manager')!.id,
      AGENT: roles.find((r) => r.name === 'Agent')!.id,
    };
  }

  owner = await makeUser(TENANT, 'owner@team.test', 'OWNER');
  secondOwner = await makeUser(TENANT, 'owner2@team.test', 'OWNER');
  manager = await makeUser(TENANT, 'manager@team.test', 'MANAGER');
  agent = await makeUser(TENANT, 'agent@team.test', 'AGENT');
  outsider = await makeUser(OTHER_TENANT, 'someone@other.test', 'OWNER');
});

afterAll(async () => {
  await wipe();
  await prisma.$disconnect();
});

const as = (who: { token: string }) => ({ Authorization: `Bearer ${who.token}` });

describe('the permission matrix', () => {
  it('is a strict hierarchy — an owner can do anything a manager can, and so on', () => {
    for (const permission of ROLE_PERMISSIONS.AGENT) {
      expect(can('MANAGER', permission)).toBe(true);
      expect(can('OWNER', permission)).toBe(true);
    }
    for (const permission of ROLE_PERMISSIONS.MANAGER) {
      expect(can('OWNER', permission)).toBe(true);
    }
  });

  it('grants every declared permission to someone', () => {
    // A permission nobody holds is a route nobody can reach, which is a bug
    // that only shows up when a customer hits it.
    for (const permission of PERMISSIONS) {
      expect(can('OWNER', permission as Permission)).toBe(true);
    }
  });

  it('keeps an agent out of the things that reconfigure the business', () => {
    for (const permission of ['team:manage', 'settings:write', 'workflows:publish', 'channel:manage'] as const) {
      expect(can('AGENT', permission)).toBe(false);
    }
  });
});

describe('reading the roster', () => {
  it('lets any member see who is on the team', async () => {
    // An agent needs to know who to hand a conversation to.
    const response = await request(app).get('/api/team').set(as(agent));
    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(4);
  });

  it('never shows a password hash', async () => {
    const response = await request(app).get('/api/team').set(as(owner));
    expect(JSON.stringify(response.body)).not.toContain('passwordHash');
    expect(response.body.data[0]).not.toHaveProperty('passwordHash');
  });

  it('shows only this workspace', async () => {
    const response = await request(app).get('/api/team').set(as(outsider));
    expect(response.body.data.map((m: { email: string }) => m.email)).toEqual(['someone@other.test']);
  });

  it('tells the caller what they may do', async () => {
    const response = await request(app).get('/api/team/me/permissions').set(as(agent));
    expect(response.body.data.role).toBe('AGENT');
    expect(response.body.data.permissions).toContain('inbox:reply');
    expect(response.body.data.permissions).not.toContain('team:manage');
  });
});

describe('changing the team', () => {
  it('refuses a manager and an agent', async () => {
    for (const who of [manager, agent]) {
      const response = await request(app).post('/api/team').set(as(who))
        .send({ email: 'new@team.test', fullName: 'New', role: 'AGENT' });
      expect(response.status).toBe(403);
    }
  });

  it('invites by mobile number, with no password to hand over', async () => {
    const response = await request(app).post('/api/team').set(as(owner))
      .send({ phone: '+91 98999 10001', fullName: 'New Person', roleId: roleIds[TENANT]!.AGENT });

    expect(response.status).toBe(201);
    expect(response.body.data.phone).toBe('919899910001');
    // The invited colleague signs in with a code sent to that number, so there is
    // nothing to generate, read out, or ask them to change.
    expect(response.body.meta?.temporaryPassword).toBeUndefined();
    expect(JSON.stringify(response.body)).not.toMatch(/password/i);

    const created = await prisma.user.findUniqueOrThrow({ where: { phone: '919899910001' } });
    expect(created.passwordHash).toBeNull();
    // Derived from the calling code, the same way it is at signup.
    expect(created.country).toBe('IN');

    /*
     * **And a membership, written alongside the user.**
     *
     * Asserted here rather than left to the whole-database invariant in
     * `membership-backfill.integration.test.ts`, which cannot catch this: that file scans
     * persistent rows, and this suite deletes its tenant in teardown — so an un-synced colleague
     * is gone before the scan runs. Removing the sync from `inviteMember` left that invariant
     * green. Every write path needs its own assertion.
     */
    const membership = await prisma.membership.findUniqueOrThrow({
      where: { userId_tenantId: { userId: created.id, tenantId: TENANT } },
    });
    expect(membership.roleId).toBe(roleIds[TENANT]!.AGENT);
    expect(membership.isActive).toBe(true);
    // The one value `User` has nowhere to record.
    expect(membership.invitedById).toBe(owner.id);
  });

  it('treats email as optional, and does not claim an unverified address is verified', async () => {
    const response = await request(app).post('/api/team').set(as(owner))
      .send({ phone: '+91 98999 10002', fullName: 'No Email Person', roleId: roleIds[TENANT]!.AGENT });

    expect(response.status).toBe(201);
    expect(response.body.data.email).toBeNull();

    const withEmail = await request(app).post('/api/team').set(as(owner))
      .send({
        phone: '+91 98999 10003',
        email: 'Colleague@Team.test',
        fullName: 'With Email',
        roleId: roleIds[TENANT]!.AGENT,
      });
    expect(withEmail.status).toBe(201);
    expect(withEmail.body.data.email).toBe('colleague@team.test');
    // Somebody else typing an address is not that person confirming it.
    expect(withEmail.body.data.emailVerified).toBe(false);
  });

  it('**attaches a number that already has an account, rather than refusing it**', async () => {
    /*
     * **The behaviour this whole change exists for**, and it is the reverse of what this test used
     * to assert. `User.phone` is globally unique, so a number registered anywhere on the platform
     * used to be refused outright with a deliberately vague "already in use" — which is why running
     * two businesses meant using two phone numbers.
     */
    const created = await request(app).post('/api/team').set(as(owner))
      .send({ phone: '+91 98999 19999', fullName: 'X', roleId: roleIds[TENANT]!.AGENT });
    expect(created.status).toBe(201);
    expect(created.body.meta.attached).toBe(false);

    // Now remove them, so the same number is a login that exists but is not on this team.
    await request(app).delete(`/api/team/${created.body.data.id}`).set(as(owner)).expect(200);

    const again = await request(app).post('/api/team').set(as(owner))
      .send({ phone: '919899919999', fullName: 'Y', roleId: roleIds[TENANT]!.AGENT });
    expect(again.status).toBe(201);
    // `attached` so the toast can say what actually happened rather than "they can sign in now".
    expect(again.body.meta.attached).toBe(true);
    // The same login, revived — not a second row. `@@unique([userId, tenantId])` makes that
    // structural, so the roster cannot show one person twice.
    expect(again.body.data.id).toBe(created.body.data.id);
    // **Their own name wins.** One shared profile, so the name typed on somebody else's invite form
    // must not rename them.
    expect(again.body.data.fullName).toBe('X');
  });

  it('**still refuses somebody who is already on this team**', async () => {
    // Inviting the same person twice is a mistake, and silently succeeding would look like it
    // worked. This is the one case that stays a conflict.
    //
    // Invited fresh rather than reusing a fixture member: those are created with an email and no
    // phone, and the invite form requires a number — so `agent.phone` would fail validation and the
    // test would pass on a 400 that has nothing to do with what it is checking.
    await request(app).post('/api/team').set(as(owner))
      .send({ phone: '919899918888', fullName: 'On The Team', roleId: roleIds[TENANT]!.AGENT })
      .expect(201);

    const again = await request(app).post('/api/team').set(as(owner))
      .send({ phone: '+91 98999 18888', fullName: 'Dup', roleId: roleIds[TENANT]!.AGENT });

    expect(again.status).toBe(409);
    expect(again.body.message).toMatch(/already on this team/i);
    // Still never names another workspace.
    expect(again.body.message).not.toMatch(/workspace|tenant/i);
  });

  it('refuses an email already in use anywhere', async () => {
    const response = await request(app).post('/api/team').set(as(owner))
      .send({
        phone: '+91 98999 10004',
        email: 'someone@other.test',
        fullName: 'X',
        roleId: roleIds[TENANT]!.AGENT,
      });
    expect(response.status).toBe(409);
  });

  it('still refuses an invite with no number at all', async () => {
    const response = await request(app).post('/api/team').set(as(owner))
      .send({ fullName: 'Nameless Number', roleId: roleIds[TENANT]!.AGENT });
    expect(response.status).toBe(400);
  });

  it('changes a role, on the user and on their membership', async () => {
    const response = await request(app).patch(`/api/team/${agent.id}`).set(as(owner))
      .send({ roleId: roleIds[TENANT]!.MANAGER });
    expect(response.status).toBe(200);
    expect(response.body.data.assignedRole.name).toBe('Manager');

    // The membership is what permissions will be read from, so a role change that reached only
    // the user would take effect nowhere once the switch flips.
    const membership = await prisma.membership.findUniqueOrThrow({
      where: { userId_tenantId: { userId: agent.id, tenantId: TENANT } },
    });
    expect(membership.roleId).toBe(roleIds[TENANT]!.MANAGER);
  });

  it('cannot touch a member of another workspace', async () => {
    const response = await request(app).patch(`/api/team/${outsider.id}`).set(as(owner))
      .send({ roleId: roleIds[TENANT]!.AGENT });
    // Not found, not forbidden — the existence of that id is not ours to confirm.
    expect(response.status).toBe(404);
  });
});

describe('the guard rails', () => {
  it('lets one owner demote another while a second owner remains', async () => {
    // The last-owner check must not over-block: two owners means either can be
    // changed.
    const response = await request(app).patch(`/api/team/${secondOwner.id}`).set(as(owner))
      .send({ roleId: roleIds[TENANT]!.MANAGER });
    expect(response.status).toBe(200);
    expect(response.body.data.role).toBe('MANAGER');
  });

  it('keeps a workspace with an owner, whichever way you come at it', async () => {
    // Reachable today only through the self-protection rules — an owner cannot
    // demote or deactivate themselves, and only an owner can manage the team,
    // so there is no request that can remove the last one. The explicit
    // last-owner check in the controller is defence in depth for the day that
    // stops being true (a support tool, or a relaxed self-rule).
    await request(app).patch(`/api/team/${secondOwner.id}`).set(as(owner)).send({ roleId: roleIds[TENANT]!.AGENT });

    const soleOwner = await request(app).patch(`/api/team/${owner.id}`).set(as(owner))
      .send({ roleId: roleIds[TENANT]!.AGENT });
    expect(soleOwner.status).toBe(400);

    const stillOwners = await prisma.user.count({
      where: { tenantId: TENANT, role: 'OWNER', isActive: true },
    });
    expect(stillOwners).toBeGreaterThanOrEqual(1);
  });

  it('will not let you change your own role', async () => {
    // Always a mistake, and one nobody else can undo if you were the only owner.
    const response = await request(app).patch(`/api/team/${owner.id}`).set(as(owner))
      .send({ roleId: roleIds[TENANT]!.AGENT });
    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/your own role/i);
  });

  it('will not let you deactivate or remove yourself', async () => {
    expect((await request(app).patch(`/api/team/${owner.id}`).set(as(owner))
      .send({ isActive: false })).status).toBe(400);
    expect((await request(app).delete(`/api/team/${owner.id}`).set(as(owner))).status).toBe(400);
  });

  it('deactivates rather than deletes, and frees their conversations', async () => {
    const customer = await prisma.customer.create({ data: { tenantId: TENANT, waId: '15550003333' } });
    const conversation = await prisma.conversation.create({
      data: { tenantId: TENANT, customerId: customer.id, status: 'OPEN', assignedAgentId: agent.id },
    });

    const response = await request(app).delete(`/api/team/${agent.id}`).set(as(owner));
    expect(response.status).toBe(200);

    /*
     * **The membership goes, the login stays.**
     *
     * This asserted `user.isActive === false`, which was indistinguishable from "out of this
     * workspace" while a person had one. Writing it now would sign them out of every workspace they
     * belong to — including the business they run — because an unrelated one removed them.
     * `User.isActive` is the operator's global kill switch and is not this endpoint's to touch.
     */
    const stillThere = await prisma.user.findUniqueOrThrow({ where: { id: agent.id } });
    expect(stillThere.isActive).toBe(true);

    const revoked = await prisma.membership.findUniqueOrThrow({
      where: { userId_tenantId: { userId: agent.id, tenantId: TENANT } },
    });
    expect(revoked.isActive).toBe(false);
    expect(revoked.revokedAt).not.toBeNull();

    // And their queue goes back to the shared pool.
    const released = await prisma.conversation.findUniqueOrThrow({ where: { id: conversation.id } });
    expect(released.assignedAgentId).toBeNull();

    /*
     * **And the membership goes with them, with a time on it.**
     *
     * The membership is what will decide whether they can reach this workspace, so a deactivation
     * that reached only `User.isActive` would stop working the moment the switch flips — and once
     * a person can belong to several workspaces, writing `User.isActive` is the *wrong* field
     * anyway: it would sign them out of all of them.
     */
    const membership = await prisma.membership.findUniqueOrThrow({
      where: { userId_tenantId: { userId: agent.id, tenantId: TENANT } },
    });
    expect(membership.isActive).toBe(false);
    expect(membership.revokedAt).not.toBeNull();
  });

  it('frees their conversations whichever way they are deactivated', async () => {
    const customer = await prisma.customer.create({ data: { tenantId: TENANT, waId: '15550004444' } });
    const conversation = await prisma.conversation.create({
      data: { tenantId: TENANT, customerId: customer.id, status: 'OPEN', assignedAgentId: agent.id },
    });

    // The UI's Deactivate button uses PATCH, and this path used to only flip the
    // flag — leaving customers waiting on somebody who could no longer sign in,
    // and invisible because the inbox still showed the conversation as owned.
    const response = await request(app).patch(`/api/team/${agent.id}`).set(as(owner))
      .send({ isActive: false });
    expect(response.status).toBe(200);
    expect(response.body.data.isActive).toBe(false);

    const released = await prisma.conversation.findUniqueOrThrow({ where: { id: conversation.id } });
    expect(released.assignedAgentId).toBeNull();
  });

  it('does not disturb a closed conversation when someone is deactivated', async () => {
    const customer = await prisma.customer.create({ data: { tenantId: TENANT, waId: '15550005555' } });
    const closed = await prisma.conversation.create({
      data: { tenantId: TENANT, customerId: customer.id, status: 'CLOSED', assignedAgentId: agent.id },
    });

    await request(app).patch(`/api/team/${agent.id}`).set(as(owner)).send({ isActive: false });

    // Only live queues are handed back. A closed conversation keeps its record of
    // who handled it, which is the whole reason deactivation is not a delete.
    const after = await prisma.conversation.findUniqueOrThrow({ where: { id: closed.id } });
    expect(after.assignedAgentId).toBe(agent.id);
  });

  it('refuses the deactivated member on their very next request', async () => {
    await request(app).delete(`/api/team/${agent.id}`).set(as(owner));
    const response = await request(app).get('/api/team').set(as(agent));
    expect(response.status).toBe(401);
  });
});

/*
 * Memberships for the users this fixture inserts directly.
 *
 * In the product every path that creates a user writes a `Membership` too. Fixtures bypass those
 * paths, so without this they produce a login belonging to no workspace — which works while
 * `requireAuth` reads `User.tenantId` and 401s the moment it reads memberships.
 *
 * Registered last in the file so it runs after every fixture hook above, whichever of them created
 * the users. Idempotent. See `test-support/members.ts` for why this is an explicit call rather than
 * a global hook.
 */
beforeEach(async () => { await seedMemberships(); });
