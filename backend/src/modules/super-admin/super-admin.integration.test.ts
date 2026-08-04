import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../../config/prisma.js';
import { buildSuperAdminApp } from '../../superadmin-server.js';
import { buildApp } from '../../app.js';
import { signToken } from '../../utils/jwt.js';
import { superAdminConfigured } from './auth.js';

// The super admin surface.
//
// The tests that matter most here are not the features — they are the boundary.
// This console can read every workspace on the platform, so what has to be true
// is that nothing else can reach it and it cannot leak what it reads.

const SECRET = 'test-super-admin-secret-at-least-32-characters-long';
const TENANT_A = 'aaaaaaaa-5a00-0000-0000-000000000001';
const TENANT_B = 'aaaaaaaa-5a00-0000-0000-000000000002';
const EMAIL = 'ops-test@zunopilot.test';
const PASSWORD = 'OpsTest123!';

const app = buildSuperAdminApp();
const customerApp = buildApp();

let adminId: string;
let ownerId: string;
let saved: string | undefined;

const wipe = async () => {
  await prisma.auditEvent.deleteMany({ where: { tenantId: { in: [TENANT_A, TENANT_B] } } });
  await prisma.superAdmin.deleteMany({ where: { email: EMAIL } });
  await prisma.tenant.deleteMany({ where: { id: { in: [TENANT_A, TENANT_B] } } });
  // Catalog rows are global, not tenant-scoped, so the tenant cascade does not reach them.
  await prisma.connectorType.deleteMany({ where: { key: { startsWith: 'sa_test_' } } });
  await prisma.auditEvent.deleteMany({ where: { targetType: 'ConnectorType' } });
};

beforeEach(async () => {
  saved = process.env.SUPERADMIN_JWT_SECRET;
  process.env.SUPERADMIN_JWT_SECRET = SECRET;

  await wipe();

  const admin = await prisma.superAdmin.create({
    data: {
      email: EMAIL,
      fullName: 'Ops Tester',
      passwordHash: await bcrypt.hash(PASSWORD, 10),
    },
  });
  adminId = admin.id;

  const tenantA = await prisma.tenant.create({
    data: {
      id: TENANT_A,
      businessName: 'Alpha Workspace',
      category: 'RESTAURANT',
      users: {
        create: {
          email: 'owner@alpha.test',
          fullName: 'Alpha Owner',
          role: 'OWNER',
          passwordHash: 'x',
          emailVerified: true,
        },
      },
      whatsappAccounts: {
        create: {
          wabaId: 'waba-alpha',
          phoneNumberId: 'pn-alpha',
          // The value that must never come back out of this API.
          accessToken: 'super-secret-alpha-token',
          displayPhone: '+1 555 000 5001',
        },
      },
    },
    include: { users: true },
  });
  ownerId = tenantA.users[0].id;

  await prisma.tenant.create({
    data: { id: TENANT_B, businessName: 'Beta Workspace', category: 'ECOMMERCE_GROCERY' },
  });
});

afterEach(() => {
  if (saved === undefined) delete process.env.SUPERADMIN_JWT_SECRET;
  else process.env.SUPERADMIN_JWT_SECRET = saved;
});

afterAll(async () => {
  await wipe();
  await prisma.$disconnect();
});

const login = async (): Promise<string> => {
  const response = await request(app)
    .post('/sa/auth/login')
    .send({ email: EMAIL, password: PASSWORD })
    .expect(200);
  return response.body.data.token as string;
};

const asAdmin = (token: string) => ({ Authorization: `Bearer ${token}` });

describe('the boundary between operators and customers', () => {
  it('refuses a request with no token', async () => {
    await request(app).get('/sa/overview').expect(401);
  });

  it('refuses a *customer* token, even a perfectly valid one', async () => {
    // The whole reason for a separate secret and a separate port. A stolen or
    // forged tenant token must not become platform-wide read access.
    const tenantToken = signToken({ userId: ownerId });
    await request(app).get('/sa/overview').set(asAdmin(tenantToken)).expect(401);
  });

  it('refuses a super admin token on the customer API', async () => {
    const token = await login();
    await request(customerApp).get('/api/billing/subscription').set(asAdmin(token)).expect(401);
  });

  it('refuses a token signed with the right payload but the wrong secret', async () => {
    const forged = jwt.sign({ superAdminId: adminId }, 'not-the-super-admin-secret', {
      audience: 'zunopilot:super-admin',
    });
    await request(app).get('/sa/overview').set(asAdmin(forged)).expect(401);
  });

  it('refuses a token without the super admin audience', async () => {
    // Defence in depth: if the two secrets were ever set to the same value, the
    // audience claim still keeps the token types apart.
    const wrongAudience = jwt.sign({ superAdminId: adminId }, SECRET, { audience: 'something-else' });
    await request(app).get('/sa/overview').set(asAdmin(wrongAudience)).expect(401);
  });

  it('stops honouring a token the moment the operator is deactivated', async () => {
    const token = await login();
    await request(app).get('/sa/overview').set(asAdmin(token)).expect(200);

    await prisma.superAdmin.update({ where: { id: adminId }, data: { isActive: false } });

    // Not at token expiry — immediately. An 8-hour window after revoking
    // someone's platform-wide access is not acceptable.
    await request(app).get('/sa/overview').set(asAdmin(token)).expect(401);
  });

  it('will not run at all without a strong signing secret', () => {
    process.env.SUPERADMIN_JWT_SECRET = 'too-short';
    expect(superAdminConfigured()).toBe(false);
    delete process.env.SUPERADMIN_JWT_SECRET;
    expect(superAdminConfigured()).toBe(false);
    process.env.SUPERADMIN_JWT_SECRET = SECRET;
    expect(superAdminConfigured()).toBe(true);
  });
});

describe('signing in', () => {
  it('gives the same answer for a wrong password and an unknown address', async () => {
    const wrongPassword = await request(app)
      .post('/sa/auth/login').send({ email: EMAIL, password: 'nope' }).expect(401);
    const unknownEmail = await request(app)
      .post('/sa/auth/login').send({ email: 'nobody@zunopilot.test', password: PASSWORD }).expect(401);

    // Otherwise the response enumerates which operator accounts exist.
    expect(wrongPassword.body.message).toBe(unknownEmail.body.message);
  });

  it('refuses a deactivated operator', async () => {
    await prisma.superAdmin.update({ where: { id: adminId }, data: { isActive: false } });
    await request(app).post('/sa/auth/login').send({ email: EMAIL, password: PASSWORD }).expect(401);
  });

  it('records the sign-in', async () => {
    await login();
    const events = await prisma.auditEvent.findMany({
      where: { superAdminId: adminId, action: 'superadmin.login' },
    });
    expect(events).toHaveLength(1);
  });
});

describe('what the console returns', () => {
  it('never returns a WhatsApp access token', async () => {
    const token = await login();
    const response = await request(app)
      .get(`/sa/tenants/${TENANT_A}`).set(asAdmin(token)).expect(200);

    // Asserted against the serialised body rather than a field, so a token
    // appearing anywhere at any depth fails this.
    expect(JSON.stringify(response.body)).not.toContain('super-secret-alpha-token');
    expect(response.body.data.tenant.whatsappAccounts[0]).not.toHaveProperty('accessToken');
  });

  it('sees every workspace, which is the point of it', async () => {
    const token = await login();
    const response = await request(app).get('/sa/tenants').set(asAdmin(token)).expect(200);
    const names = response.body.data.map((t: { businessName: string }) => t.businessName);
    expect(names).toContain('Alpha Workspace');
    expect(names).toContain('Beta Workspace');
  });

  it('searches by owner email as well as by name', async () => {
    const token = await login();
    const response = await request(app)
      .get('/sa/tenants').query({ search: 'owner@alpha.test' }).set(asAdmin(token)).expect(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].businessName).toBe('Alpha Workspace');
  });

  it('rejects a malformed workspace id rather than querying with it', async () => {
    const token = await login();
    await request(app).get('/sa/tenants/not-a-uuid').set(asAdmin(token)).expect(400);
  });

  it('builds a timeline from rows that predate the console', async () => {
    const token = await login();
    const response = await request(app)
      .get(`/sa/tenants/${TENANT_A}/activity`).set(asAdmin(token)).expect(200);

    const kinds = response.body.data.entries.map((e: { kind: string }) => e.kind);
    // Nothing emitted an event for either of these — they are derived from
    // `Tenant.createdAt`, `User.createdAt` and `WhatsappAccount.connectedAt`.
    expect(kinds).toContain('tenant.created');
    expect(kinds).toContain('user.signup');
    expect(kinds).toContain('whatsapp.connected');
  });

  it('reports the plan catalogue as read-only, and says how to change it', async () => {
    const token = await login();
    const response = await request(app).get('/sa/plans').set(asAdmin(token)).expect(200);
    expect(response.body.data.editable).toBe(false);
    expect(response.body.data.howToChange.length).toBeGreaterThan(0);
  });
});

describe('what an operator can change', () => {
  it('actually locks the workspace out when suspended', async () => {
    const token = await login();
    const tenantToken = signToken({ userId: ownerId });

    // Works before.
    await request(customerApp).get('/api/billing/subscription')
      .set(asAdmin(tenantToken)).expect(200);

    await request(app).patch(`/sa/tenants/${TENANT_A}/active`)
      .set(asAdmin(token)).send({ isActive: false }).expect(200);

    // A suspension only some endpoints honour is not a suspension, so this is
    // enforced in `requireAuth` rather than per route. 403, not 401 — their
    // password is fine and telling them otherwise sends them resetting it.
    const blocked = await request(customerApp).get('/api/billing/subscription')
      .set(asAdmin(tenantToken)).expect(403);
    expect(blocked.body.message).toMatch(/suspended/i);

    await request(app).patch(`/sa/tenants/${TENANT_A}/active`)
      .set(asAdmin(token)).send({ isActive: true }).expect(200);
    await request(customerApp).get('/api/billing/subscription')
      .set(asAdmin(tenantToken)).expect(200);
  });

  it('suspends and restores a workspace without deleting anything', async () => {
    const token = await login();

    await request(app).patch(`/sa/tenants/${TENANT_A}/active`)
      .set(asAdmin(token)).send({ isActive: false, reason: 'non-payment' }).expect(200);

    const suspended = await prisma.tenant.findUniqueOrThrow({
      where: { id: TENANT_A },
      include: { users: true, whatsappAccounts: true },
    });
    expect(suspended.isActive).toBe(false);
    // Suspension is a flag. Everything the workspace had is still there.
    expect(suspended.users).toHaveLength(1);
    expect(suspended.whatsappAccounts).toHaveLength(1);

    await request(app).patch(`/sa/tenants/${TENANT_A}/active`)
      .set(asAdmin(token)).send({ isActive: true }).expect(200);
    expect((await prisma.tenant.findUniqueOrThrow({ where: { id: TENANT_A } })).isActive).toBe(true);
  });

  it('assigns a plan as MANUAL with overrides, and does not create a Razorpay subscription', async () => {
    const token = await login();

    await request(app).post(`/sa/tenants/${TENANT_A}/plan`).set(asAdmin(token)).send({
      plan: 'ENTERPRISE', interval: 'YEARLY', months: 24, numberLimit: 5, note: 'Pilot',
    }).expect(200);

    const subscription = await prisma.subscription.findUniqueOrThrow({
      where: { tenantId: TENANT_A },
    });
    expect(subscription.plan).toBe('ENTERPRISE');
    expect(subscription.status).toBe('MANUAL');
    expect(subscription.numberLimitOverride).toBe(5);
    // A hand-assigned plan is not a mandate.
    expect(subscription.razorpaySubscriptionId).toBeNull();
  });

  it('clears a scheduled change when a plan is assigned by hand', async () => {
    const token = await login();
    await prisma.subscription.create({
      data: {
        tenantId: TENANT_A,
        plan: 'STARTER',
        interval: 'MONTHLY',
        status: 'ACTIVE',
        pendingPlan: 'GROWTH',
        pendingInterval: 'MONTHLY',
        pendingEffectiveAt: new Date('2027-01-01'),
      },
    });

    await request(app).post(`/sa/tenants/${TENANT_A}/plan`).set(asAdmin(token))
      .send({ plan: 'BUSINESS', interval: 'YEARLY' }).expect(200);

    // Otherwise the hourly job later applies a downgrade against the plan an
    // operator has just replaced.
    const subscription = await prisma.subscription.findUniqueOrThrow({
      where: { tenantId: TENANT_A },
    });
    expect(subscription.pendingPlan).toBeNull();
    expect(subscription.pendingEffectiveAt).toBeNull();
  });

  it('refuses to strip the only active owner of a workspace', async () => {
    const token = await login();

    const deactivate = await request(app).patch(`/sa/users/${ownerId}`)
      .set(asAdmin(token)).send({ isActive: false }).expect(400);
    expect(deactivate.body.message).toMatch(/only active owner/i);

    // Demotion is the same hazard by another route.
    await request(app).patch(`/sa/users/${ownerId}`)
      .set(asAdmin(token)).send({ role: 'AGENT' }).expect(400);

    expect((await prisma.user.findUniqueOrThrow({ where: { id: ownerId } })).role).toBe('OWNER');
  });

  it('allows it once a second owner exists', async () => {
    const token = await login();
    await prisma.user.create({
      data: {
        tenantId: TENANT_A,
        email: 'second-owner@alpha.test',
        fullName: 'Second Owner',
        role: 'OWNER',
        passwordHash: 'x',
      },
    });

    await request(app).patch(`/sa/users/${ownerId}`)
      .set(asAdmin(token)).send({ isActive: false }).expect(200);
  });

});

describe('the audit trail', () => {
  it('records who changed what, against the workspace it affected', async () => {
    const token = await login();
    await request(app).patch(`/sa/tenants/${TENANT_A}/active`)
      .set(asAdmin(token)).send({ isActive: false, reason: 'non-payment' }).expect(200);

    const response = await request(app)
      .get('/sa/audit').query({ tenantId: TENANT_A }).set(asAdmin(token)).expect(200);

    const event = response.body.data.find((e: { action: string }) => e.action === 'tenant.suspended');
    expect(event).toBeTruthy();
    expect(event.superAdmin.email).toBe(EMAIL);
    expect(event.tenantName).toBe('Alpha Workspace');
    expect(event.summary).toContain('Alpha Workspace');
  });

  it('survives the workspace it refers to being deleted', async () => {
    const token = await login();
    await request(app).patch(`/sa/tenants/${TENANT_B}/active`)
      .set(asAdmin(token)).send({ isActive: false }).expect(200);

    // `AuditEvent.tenantId` is deliberately not a foreign key: a cascade would
    // erase the record of what was done to a workspace at the moment that record
    // matters most.
    await prisma.tenant.delete({ where: { id: TENANT_B } });

    const events = await prisma.auditEvent.findMany({ where: { tenantId: TENANT_B } });
    expect(events.length).toBeGreaterThan(0);
    expect(events[0].summary).toContain('Beta Workspace');
  });
});

describe('the connector type catalog', () => {
  // The operator's list of systems a workspace may connect to. It replaced a `z.enum` and
  // two hardcoded options in the tenant's picker, so the point of every rule below is that
  // adding a system stopped being a deploy without becoming a way to break existing ones.

  const makeType = (token: string, body: Record<string, unknown> = {}) =>
    request(app).post('/sa/connector-types').set(asAdmin(token)).send({
      key: 'sa_test_razorpay',
      label: 'Razorpay',
      kind: 'HTTP',
      allowedAuthTypes: ['BASIC'],
      defaultBaseUrl: 'https://api.razorpay.com/v1',
      usernameLabel: 'Key ID',
      secretLabel: 'Key Secret',
      ...body,
    });

  it('adds a type and audits it', async () => {
    const token = await login();
    const created = await makeType(token).expect(201);
    expect(created.body.data.key).toBe('sa_test_razorpay');

    const events = await prisma.auditEvent.findMany({
      where: { targetType: 'ConnectorType', targetId: created.body.data.id },
    });
    expect(events).toHaveLength(1);
    expect(events[0].action).toBe('connector_type.created');
  });

  it('refuses a duplicate key', async () => {
    const token = await login();
    await makeType(token).expect(201);
    const clash = await makeType(token, { label: 'Razorpay again' }).expect(409);
    expect(clash.body.message).toMatch(/already uses the key/);
  });

  it('**refuses a default base URL the egress guard blocks**', async () => {
    // The operator's suggestion is inherited by every workspace that picks the type, so a
    // bad one here would hand the same SSRF to all of them at once.
    const token = await login();
    await makeType(token, { defaultBaseUrl: 'http://169.254.169.254/latest/meta-data/' })
      .expect(400);
  });

  it('**cannot rename the key**', async () => {
    // A workspace's connector records which type it came from. Renaming would orphan that
    // link with no error anywhere, so `key` is absent from the update schema entirely.
    const token = await login();
    const created = await makeType(token).expect(201);

    await request(app)
      .patch(`/sa/connector-types/${created.body.data.id}`)
      .set(asAdmin(token))
      .send({ key: 'sa_test_renamed', label: 'Renamed' })
      .expect(200);

    const after = await prisma.connectorType.findUnique({ where: { id: created.body.data.id } });
    expect(after!.key).toBe('sa_test_razorpay');
    expect(after!.label).toBe('Renamed');
  });

  it('hides a type from new connections without deleting it', async () => {
    const token = await login();
    const created = await makeType(token).expect(201);

    await request(app)
      .patch(`/sa/connector-types/${created.body.data.id}`)
      .set(asAdmin(token))
      .send({ isActive: false })
      .expect(200);

    const events = await prisma.auditEvent.findMany({
      where: { targetType: 'ConnectorType', action: 'connector_type.updated' },
    });
    expect(events[0].summary).toMatch(/Hid the connector type/);
  });

  it('deletes a type nothing is using', async () => {
    const token = await login();
    const created = await makeType(token).expect(201);
    await request(app)
      .delete(`/sa/connector-types/${created.body.data.id}`)
      .set(asAdmin(token))
      .expect(200);
    expect(await prisma.connectorType.findUnique({ where: { id: created.body.data.id } })).toBeNull();
  });

  it('**refuses to delete a type a workspace is on**', async () => {
    // The foreign key is SET NULL, so a forced delete would not break those connectors —
    // but it would erase where they came from and make the operator's own count lie.
    const token = await login();
    const created = await makeType(token).expect(201);
    await prisma.connector.create({
      data: {
        tenantId: TENANT_A,
        connectorTypeId: created.body.data.id,
        key: 'payments',
        name: 'Payments',
        kind: 'HTTP',
        baseUrl: 'https://api.razorpay.com/v1',
      },
    });

    const refused = await request(app)
      .delete(`/sa/connector-types/${created.body.data.id}`)
      .set(asAdmin(token))
      .expect(409);
    expect(refused.body.message).toMatch(/Hide it from new connections instead/);

    const list = await request(app).get('/sa/connector-types').set(asAdmin(token)).expect(200);
    const row = list.body.data.find((t: { key: string }) => t.key === 'sa_test_razorpay');
    expect(row.connectors).toBe(1);
  });

  it('adds an operation template and keeps it scoped to its type', async () => {
    const token = await login();
    const created = await makeType(token).expect(201);
    const other = await makeType(token, { key: 'sa_test_other', label: 'Other' }).expect(201);

    const op = await request(app)
      .post(`/sa/connector-types/${created.body.data.id}/operations`)
      .set(asAdmin(token))
      .send({ key: 'fetch_payment', name: 'Fetch a payment', method: 'GET', path: '/payments/{id}' })
      .expect(201);

    // Reached through the other type's id, the same operation must not be found — an
    // operation id from the client is never trusted on its own.
    await request(app)
      .patch(`/sa/connector-types/${other.body.data.id}/operations/${op.body.data.id}`)
      .set(asAdmin(token))
      .send({ name: 'Hijacked' })
      .expect(404);
  });

  it('refuses two operations with the same key on one type', async () => {
    const token = await login();
    const created = await makeType(token).expect(201);
    const body = { key: 'fetch_payment', name: 'Fetch', method: 'GET', path: '/p/{id}' };
    await request(app).post(`/sa/connector-types/${created.body.data.id}/operations`)
      .set(asAdmin(token)).send(body).expect(201);
    const clash = await request(app).post(`/sa/connector-types/${created.body.data.id}/operations`)
      .set(asAdmin(token)).send(body).expect(409);
    expect(clash.body.message).toMatch(/already has an operation keyed/);
  });

  it('needs an operator token — a customer token is not enough', async () => {
    const tenantToken = signToken({ userId: ownerId });
    await request(app).get('/sa/connector-types').set(asAdmin(tenantToken)).expect(401);
    await request(app).get('/sa/connector-types').expect(401);
  });
});
