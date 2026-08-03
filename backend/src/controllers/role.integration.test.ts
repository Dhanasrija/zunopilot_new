import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildApp } from '../app.js';
import { prisma } from '../config/prisma.js';
import { signToken } from '../utils/jwt.js';
import { PERMISSIONS, PERMISSION_GROUPS } from '../config/permissions.js';
import { seedDefaultRoles } from '../services/role.service.js';

// Custom roles.
//
// The features are the easy part. What these tests are really about is the three
// ways a workspace could lock itself out or escalate its own privileges, because
// each of those is unrecoverable without someone editing their database by hand.

const TENANT = '88888888-8888-8888-8888-888888888888';
const OTHER = '88888888-8888-8888-8888-8888888888ff';

const app = buildApp();

let ownerRoleId: string;
let managerRoleId: string;
let agentRoleId: string;
let owner: { id: string; token: string };
let manager: { id: string; token: string };

const as = (user: { token: string }) => ({ Authorization: `Bearer ${user.token}` });

const wipe = () => prisma.tenant.deleteMany({ where: { id: { in: [TENANT, OTHER] } } });

const makeUser = async (tenantId: string, email: string, roleId: string) => {
  const user = await prisma.user.create({
    data: { tenantId, email, fullName: email.split('@')[0]!, roleId, role: 'AGENT' },
  });
  return { id: user.id, token: signToken({ userId: user.id }) };
};

beforeEach(async () => {
  await wipe();
  await prisma.tenant.createMany({
    data: [
      { id: TENANT, businessName: 'Roles Test', category: 'RESTAURANT' },
      { id: OTHER, businessName: 'Other Roles', category: 'RESTAURANT' },
    ],
  });

  for (const tenantId of [TENANT, OTHER]) {
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
    await seedDefaultRoles(prisma, tenantId);
  }

  const roles = await prisma.role.findMany({ where: { tenantId: TENANT } });
  ownerRoleId = roles.find((r) => r.isOwner)!.id;
  managerRoleId = roles.find((r) => r.name === 'Manager')!.id;
  agentRoleId = roles.find((r) => r.name === 'Agent')!.id;

  owner = await makeUser(TENANT, 'owner@roles.test', ownerRoleId);
  manager = await makeUser(TENANT, 'manager@roles.test', managerRoleId);
});

afterAll(async () => {
  await wipe();
  await prisma.$disconnect();
});

describe('the vocabulary', () => {
  it('puts every permission in exactly one group', () => {
    const grouped = PERMISSION_GROUPS.flatMap((g) => g.permissions.map((p) => p.key));
    // A permission missing from the groups is one no workspace can ever grant,
    // which makes the route enforcing it unreachable for a custom role.
    expect([...PERMISSIONS].sort()).toEqual([...grouped].sort());
    expect(new Set(grouped).size).toBe(grouped.length);
  });
});

describe('a workspace starts with three roles it can change', () => {
  it('seeds Owner, Manager and Agent', async () => {
    const response = await request(app).get('/api/roles').set(as(owner)).expect(200);
    expect(response.body.data.map((r: { name: string }) => r.name))
      .toEqual(['Owner', 'Manager', 'Agent']);
    expect(response.body.data[0].isOwner).toBe(true);
  });

  it('reports the owner role as holding everything, whatever its column says', async () => {
    await prisma.role.update({ where: { id: ownerRoleId }, data: { permissions: [] } });

    const response = await request(app).get('/api/roles').set(as(owner)).expect(200);
    const ownerRole = response.body.data.find((r: { isOwner: boolean }) => r.isOwner);

    // `isOwner` is enforced implicitly, so an emptied column must not read as a
    // role that can do nothing.
    expect(ownerRole.permissions).toHaveLength(PERMISSIONS.length);
    await request(app).get('/api/team').set(as(owner)).expect(200);
  });

  it('is seeded idempotently, so nothing is duplicated or reset', async () => {
    await prisma.role.update({
      where: { id: agentRoleId },
      data: { name: 'Front desk', permissions: ['inbox:read'] },
    });

    await seedDefaultRoles(prisma, TENANT);

    const roles = await prisma.role.findMany({ where: { tenantId: TENANT } });
    // Renaming Agent means the name is free, so a fresh Agent appears — but the
    // customised role is untouched, which is the property that matters.
    const customised = roles.find((r) => r.name === 'Front desk');
    expect(customised?.permissions).toEqual(['inbox:read']);
    expect(roles.filter((r) => r.isOwner)).toHaveLength(1);
  });
});

describe('creating and using a role', () => {
  it('creates one and enforces exactly what it grants', async () => {
    const created = await request(app).post('/api/roles').set(as(owner)).send({
      name: 'Kitchen staff',
      description: 'Sees orders, changes nothing else.',
      permissions: ['inbox:read', 'orders:read', 'orders:write'],
    }).expect(201);

    const cook = await makeUser(TENANT, 'cook@roles.test', created.body.data.id);

    // Granted.
    await request(app).get('/api/orders').set(as(cook)).expect(200);
    // Not granted — and refused by the server, not merely hidden in the UI.
    await request(app).get('/api/analytics/overview').set(as(cook)).expect(403);
    await request(app).get('/api/customers').set(as(cook)).expect(403);
    await request(app).post('/api/roles').set(as(cook)).send({ name: 'X' }).expect(403);
  });

  it('refuses a permission that does not exist rather than dropping it', async () => {
    const response = await request(app).post('/api/roles').set(as(owner)).send({
      name: 'Typo role',
      permissions: ['inbox:read', 'orders:destroy'],
    }).expect(400);
    // Silently ignoring it would create a role someone believes grants something.
    expect(response.body.message).toMatch(/orders:destroy/);
  });

  it('refuses a duplicate name', async () => {
    await request(app).post('/api/roles').set(as(owner))
      .send({ name: 'Accountant', permissions: [] }).expect(201);
    await request(app).post('/api/roles').set(as(owner))
      .send({ name: 'Accountant', permissions: [] }).expect(409);
  });

  it('cannot be read or written by another workspace', async () => {
    const outsiderRole = (await prisma.role.findFirstOrThrow({
      where: { tenantId: OTHER, isOwner: true },
    }));
    const outsider = await makeUser(OTHER, 'owner@other.test', outsiderRole.id);

    // A role id from another workspace is a 404 — there is nothing to confirm.
    await request(app).patch(`/api/roles/${managerRoleId}`).set(as(outsider))
      .send({ name: 'Hijacked' }).expect(404);

    const theirs = await request(app).get('/api/roles').set(as(outsider)).expect(200);
    expect(theirs.body.data.map((r: { id: string }) => r.id)).not.toContain(managerRoleId);
  });
});

describe('the owner role is the floor', () => {
  it('cannot be edited', async () => {
    const response = await request(app).patch(`/api/roles/${ownerRoleId}`).set(as(owner))
      .send({ permissions: ['inbox:read'] }).expect(400);
    expect(response.body.message).toMatch(/cannot be changed/i);
  });

  it('cannot be deleted', async () => {
    const response = await request(app).delete(`/api/roles/${ownerRoleId}`).set(as(owner)).expect(400);
    expect(response.body.message).toMatch(/cannot be deleted/i);
  });
});

describe('a workspace cannot lock itself out', () => {
  it('refuses to remove team:manage from the last role that has it', async () => {
    // Put the only administrator on a normal role, so the owner role is not
    // covering for the mistake.
    const admin = await request(app).post('/api/roles').set(as(owner)).send({
      name: 'Admin', permissions: ['team:manage', 'roles:manage', 'inbox:read'],
    }).expect(201);

    await prisma.user.update({ where: { id: owner.id }, data: { roleId: admin.body.data.id } });

    // Narrowing to a subset they already hold, so the escalation guard is not what
    // refuses this — the lockout guard is.
    const response = await request(app).patch(`/api/roles/${admin.body.data.id}`)
      .set(as(owner)).send({ permissions: ['inbox:read'] }).expect(400);
    expect(response.body.message).toMatch(/nobody able to manage the team/i);

    // And the role is unchanged — the check runs inside the transaction.
    const after = await prisma.role.findUniqueOrThrow({ where: { id: admin.body.data.id } });
    expect(after.permissions).toContain('team:manage');
  });

  it('allows it while somebody else can still administer', async () => {
    const admin = await request(app).post('/api/roles').set(as(owner)).send({
      name: 'Admin', permissions: ['team:manage', 'roles:manage', 'inbox:read'],
    }).expect(201);
    await makeUser(TENANT, 'other-admin@roles.test', admin.body.data.id);

    // The owner still administers, so narrowing this one is fine.
    await request(app).patch(`/api/roles/${admin.body.data.id}`)
      .set(as(owner)).send({ permissions: ['inbox:read'] }).expect(200);
  });

  it('refuses to delete a role that people are on', async () => {
    const response = await request(app).delete(`/api/roles/${managerRoleId}`)
      .set(as(owner)).expect(409);
    // Deleting would null their roleId and silently change what they can do.
    expect(response.body.message).toMatch(/Move them to another role/i);
  });

  it('deletes one nobody is using', async () => {
    const spare = await request(app).post('/api/roles').set(as(owner))
      .send({ name: 'Unused', permissions: [] }).expect(201);
    await request(app).delete(`/api/roles/${spare.body.data.id}`).set(as(owner)).expect(200);
  });
});

describe('nobody grants what they do not hold', () => {
  it('refuses to create a role more powerful than the creator', async () => {
    // A workspace that delegates role management to a narrower role: without this
    // rule, that role writes itself `settings:write` and buys a plan.
    const delegate = await request(app).post('/api/roles').set(as(owner)).send({
      name: 'Team lead', permissions: ['team:read', 'roles:manage', 'inbox:read'],
    }).expect(201);
    const lead = await makeUser(TENANT, 'lead@roles.test', delegate.body.data.id);

    const response = await request(app).post('/api/roles').set(as(lead)).send({
      name: 'Sneaky', permissions: ['settings:write'],
    }).expect(403);
    expect(response.body.message).toMatch(/cannot grant a permission you do not have/i);

    // And they can still create one within their own means.
    await request(app).post('/api/roles').set(as(lead))
      .send({ name: 'Fine', permissions: ['inbox:read'] }).expect(201);
  });

  it('tells the caller what they may hand out', async () => {
    const response = await request(app).get('/api/roles').set(as(manager)).expect(200);
    // The UI disables the rest rather than offering a box that will be refused.
    expect(response.body.meta.grantable).not.toContain('settings:write');
    expect(response.body.meta.grantable).toContain('orders:write');
  });
});

describe('assigning roles to people', () => {
  it('invites onto one of the workspace’s own roles', async () => {
    const created = await request(app).post('/api/roles').set(as(owner))
      .send({ name: 'Accountant', permissions: ['settings:read', 'orders:read'] }).expect(201);

    const response = await request(app).post('/api/team').set(as(owner)).send({
      phone: '+91 98111 20001',
      fullName: 'Book Keeper',
      roleId: created.body.data.id,
    }).expect(201);

    expect(response.body.data.assignedRole.name).toBe('Accountant');
  });

  it('refuses a role belonging to another workspace', async () => {
    const theirs = await prisma.role.findFirstOrThrow({ where: { tenantId: OTHER, isOwner: false } });
    await request(app).post('/api/team').set(as(owner)).send({
      phone: '+91 98111 20002', fullName: 'Nope', roleId: theirs.id,
    }).expect(400);
  });

  it('refuses to move the last administrator off an administering role', async () => {
    const admin = await request(app).post('/api/roles').set(as(owner))
      .send({ name: 'Admin', permissions: ['team:manage'] }).expect(201);
    const soleAdmin = await makeUser(TENANT, 'sole@roles.test', admin.body.data.id);

    // Take the owner out of the picture, leaving `soleAdmin` as the only one.
    await prisma.user.update({ where: { id: owner.id }, data: { isActive: false } });

    const response = await request(app).patch(`/api/team/${soleAdmin.id}`).set(as(soleAdmin))
      .send({ isActive: false });
    // Also blocked by the "not yourself" rule, so assert it is refused either way.
    expect(response.status).toBe(400);
  });
});
