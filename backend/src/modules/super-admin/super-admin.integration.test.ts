import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { seedMemberships } from '../../test-support/members.js';
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

  // Catalog rows are global, not tenant-scoped, so neither the tenant cascade nor
  // the tenant-scoped audit delete above reaches them or their audit trail.
  //
  // **Scoped by target id, and the order matters.** This was
  // `deleteMany({ where: { targetType: 'ConnectorType' } })`, which is every
  // connector-type audit row in the database — a suite wiping a real operator's
  // audit history as a side effect of tidying up after itself. The ids have to be
  // read before the types are deleted, because that is the only thing tying the
  // audit rows back to this test.
  const mine = await prisma.connectorType.findMany({
    where: { key: { startsWith: 'sa_test_' } },
    select: { id: true },
  });
  await prisma.auditEvent.deleteMany({
    where: { targetType: 'ConnectorType', targetId: { in: mine.map((t) => t.id) } },
  });
  await prisma.connectorType.deleteMany({ where: { key: { startsWith: 'sa_test_' } } });
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

describe('what a workspace is listed as', () => {
  /*
   * The console showed `Tenant.category`, the enum that predates the categories table — which reads
   * `RESTAURANT` for every workspace on the platform because nothing has written it since. So every
   * customer looked like a restaurant, including the IT consultancies.
   *
   * The fixture's workspaces have the enum set and **no category row**, which is what makes the
   * assertion decisive: the label must be null rather than "restaurant".
   */
  it('**reports the category the workspace chose, not the legacy enum**', async () => {
    const token = await login();
    const res = await request(app).get('/sa/tenants?take=50').set(asAdmin(token)).expect(200);

    const row = res.body.data.find((r: { id: string }) => r.id === TENANT_A);
    // No category row on this fixture, so there is nothing to report — and "not set" is the truth.
    expect(row.category).toBeNull();
    // The enum is still carried, under a name that says what it is.
    expect(row.legacyCategory).toBe('RESTAURANT');
  });

  it('reports the label once a category is chosen', async () => {
    const token = await login();
    const category = await prisma.businessCategory.create({
      data: { key: `SA_TEST_LABEL_${Date.now()}`, label: 'Test Trade' },
    });
    try {
      await prisma.tenant.update({
        where: { id: TENANT_A }, data: { businessCategoryId: category.id },
      });

      const res = await request(app).get('/sa/tenants?take=50').set(asAdmin(token)).expect(200);
      const row = res.body.data.find((r: { id: string }) => r.id === TENANT_A);
      expect(row.category).toBe('Test Trade');
    } finally {
      await prisma.tenant.update({ where: { id: TENANT_A }, data: { businessCategoryId: null } });
      await prisma.businessCategory.delete({ where: { id: category.id } });
    }
  });

  it('**flags a workspace that verified a code and never finished setup**', async () => {
    // The unnamed rows in the workspace list. Without this the console gives an operator no way to
    // tell an abandoned signup from a real workspace whose owner has not named it yet.
    const token = await login();
    const res = await request(app).get('/sa/tenants?take=50').set(asAdmin(token)).expect(200);

    const row = res.body.data.find((r: { id: string }) => r.id === TENANT_A);
    // The fixture never completes onboarding, so this is the flag's true state here.
    expect(row.onboardingCompletedAt).toBeNull();
  });
});

describe('the signup funnel', () => {
  /*
   * The two lists worth getting right are the ones that could mislead:
   *
   *   • Somebody who mistyped a code, let it expire and then got in **must not** appear as an
   *     abandonment — their first challenge is still sitting there unconsumed, and counting it would
   *     put live customers on a chase list.
   *   • "Left at the code" covers 24 hours because the sweep deletes older rows. The window is
   *     asserted in the query rather than assumed, so a box whose sweep is behind still reports the
   *     period the page claims.
   */
  const PHONE_GAVE_UP = '15550007001';
  const PHONE_TRIED_THEN_SUCCEEDED = '15550007002';

  afterEach(async () => {
    await prisma.otpChallenge.deleteMany({
      where: { phone: { in: [PHONE_GAVE_UP, PHONE_TRIED_THEN_SUCCEEDED] } },
    });
  });

  /** An expired, unconsumed challenge — somebody who asked for a code and never used it. */
  const expiredUnused = (phone: string, minutesAgo: number, attempts = 0) =>
    prisma.otpChallenge.create({
      data: {
        phone,
        codeHash: 'not-a-real-hash',
        attempts,
        createdAt: new Date(Date.now() - minutesAgo * 60_000),
        expiresAt: new Date(Date.now() - (minutesAgo - 10) * 60_000),
      },
    });

  it('**lists a number that asked for a code and never entered it**', async () => {
    const token = await login();
    await expiredUnused(PHONE_GAVE_UP, 60, 2);

    const res = await request(app).get('/sa/signups').set(asAdmin(token)).expect(200);

    const row = res.body.data.abandonedAtCode.find((r: { phone: string }) => r.phone === PHONE_GAVE_UP);
    expect(row).toBeDefined();
    // Wrong entries carried separately: somebody who tried and failed is a delivery or usability
    // problem, and somebody who never opened the SMS is not the same person.
    expect(row.wrongCodeAttempts).toBe(2);
    expect(res.body.data.abandonedWindowHours).toBe(24);
  });

  it('**does not list somebody who failed once and then got in**', async () => {
    const token = await login();
    await expiredUnused(PHONE_TRIED_THEN_SUCCEEDED, 30);
    // …and then asked again and verified.
    await prisma.otpChallenge.create({
      data: {
        phone: PHONE_TRIED_THEN_SUCCEEDED,
        codeHash: 'not-a-real-hash',
        expiresAt: new Date(Date.now() + 600_000),
        consumedAt: new Date(),
      },
    });

    const res = await request(app).get('/sa/signups').set(asAdmin(token)).expect(200);

    expect(res.body.data.abandonedAtCode.map((r: { phone: string }) => r.phone))
      .not.toContain(PHONE_TRIED_THEN_SUCCEEDED);
  });

  it('**counts one person per number, not one per code they asked for**', async () => {
    // The resend cooldown means a determined person generates several challenges. Three rows is one
    // person who did not sign up.
    const token = await login();
    await expiredUnused(PHONE_GAVE_UP, 90);
    await expiredUnused(PHONE_GAVE_UP, 70);
    await expiredUnused(PHONE_GAVE_UP, 50);

    const res = await request(app).get('/sa/signups').set(asAdmin(token)).expect(200);

    const rows = res.body.data.abandonedAtCode
      .filter((r: { phone: string }) => r.phone === PHONE_GAVE_UP);
    expect(rows).toHaveLength(1);
    expect(rows[0].requests).toBe(3);
  });

  it('ignores a request older than the retention window', async () => {
    // Asserted in the query, not left to the sweep — which is a scheduled job that can be behind.
    const token = await login();
    await expiredUnused(PHONE_GAVE_UP, 60 * 30);

    const res = await request(app).get('/sa/signups').set(asAdmin(token)).expect(200);

    expect(res.body.data.abandonedAtCode.map((r: { phone: string }) => r.phone))
      .not.toContain(PHONE_GAVE_UP);
  });

  it('**separates workspaces that verified but never finished the profile**', async () => {
    const token = await login();

    // TENANT_A is onboarded by the fixture; make a half-finished one beside it.
    const stuck = await prisma.tenant.create({
      data: {
        businessName: '',
        category: 'RESTAURANT',
        users: { create: [{ phone: '15550007003', fullName: '', role: 'OWNER' }] },
      },
    });
    await seedMemberships();

    try {
      const res = await request(app).get('/sa/signups').set(asAdmin(token)).expect(200);

      const row = res.body.data.abandonedAtProfile
        .find((r: { tenantId: string }) => r.tenantId === stuck.id);
      expect(row).toBeDefined();
      // The number is the point: it is the only way to follow one of these up.
      expect(row.owner.phone).toBe('15550007003');
      // And it is not counted as a completed signup.
      expect(res.body.data.completed.map((r: { tenantId: string }) => r.tenantId))
        .not.toContain(stuck.id);
    } finally {
      await prisma.tenant.delete({ where: { id: stuck.id } });
    }
  });

  it('needs an operator token', async () => {
    await request(app).get('/sa/signups').expect(401);
    await request(app).get('/sa/signups')
      .set(asAdmin(signToken({ userId: ownerId, tenantId: TENANT_A }))).expect(401);
  });
});

describe('which model answers a workspace', () => {
  /*
   * An operator's choice, and the reason it is one: it decides who we pay per message and how long a
   * customer waits. A workspace has no route to it at all.
   *
   * The property worth protecting is the refusal. Pinning a workspace to a vendor with no key on this
   * server produces a workspace whose every message quietly falls back — working, on the wrong model,
   * with the console displaying the one it is not using.
   *
   * ── Every case below sets the keys it needs ──────────────────────────────────
   *
   * The first version of these tests said "OPENAI is configured in the test environment", which was
   * true on the laptop they were written on and false in CI, where no vendor key exists at all — so
   * the console correctly refused the pin and three tests failed for the right reason. Reading the
   * ambient environment is the same mistake that let a hardcoded `available: true` survive a mutation
   * check earlier in this work.
   *
   * So each case builds a fresh app against an environment it states. `env.ts` snapshots
   * `process.env` at import, which is why this is `resetModules` rather than assignment.
   */

  /**
   * Run something against an app whose vendor keys are exactly these.
   *
   * A blank string rather than `delete`: `.env` is loaded on import, and dotenv fills in any key that
   * is *absent* — so deleting one hands the developer's real key back and the test stops testing what
   * it says.
   */
  const withVendors = async (
    keys: { OPENAI_API_KEY?: string; GROQ_LLM_API_KEY?: string },
    body: (app: ReturnType<typeof buildSuperAdminApp>) => Promise<void>,
  ) => {
    const saved: Record<string, string | undefined> = {};
    for (const [key, value] of Object.entries({ OPENAI_API_KEY: '', GROQ_LLM_API_KEY: '', ...keys })) {
      saved[key] = process.env[key];
      process.env[key] = value;
    }
    vi.resetModules();
    try {
      const { buildSuperAdminApp: build } = await import('../../superadmin-server.js');
      await body(build());
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      vi.resetModules();
    }
  };

  it('**pins a workspace to a vendor, and un-pins it**', async () => {
    const token = await login();

    await withVendors({ OPENAI_API_KEY: 'sk-test-openai' }, async (fresh) => {
      await request(fresh).patch(`/sa/tenants/${TENANT_A}/llm-vendor`).set(asAdmin(token))
        .send({ vendor: 'OPENAI', note: 'cost test' }).expect(200);
    });

    expect((await prisma.tenant.findUniqueOrThrow({ where: { id: TENANT_A } })).llmVendor)
      .toBe('OPENAI');

    // Null is a real choice — it is how an operator hands a workspace back to the platform default,
    // so that changing `LLM_VENDOR` later reaches it again. It needs no key: un-pinning is always
    // possible, which matters because the alternative would trap a workspace on a vendor whose key
    // has since been removed.
    const back = await request(app).patch(`/sa/tenants/${TENANT_A}/llm-vendor`).set(asAdmin(token))
      .send({ vendor: null }).expect(200);

    expect(back.body.data.pinned).toBeNull();
    expect((await prisma.tenant.findUniqueOrThrow({ where: { id: TENANT_A } })).llmVendor).toBeNull();
  });

  it('**refuses a vendor with no API key on this server**', async () => {
    // A stored choice nothing can serve would make every message fall back to the platform default
    // while the console showed the pinned vendor — worse than refusing.
    const token = await login();

    await withVendors({ OPENAI_API_KEY: 'sk-test-openai' }, async (fresh) => {
      const res = await request(fresh).patch(`/sa/tenants/${TENANT_A}/llm-vendor`)
        .set(asAdmin(token)).send({ vendor: 'GROQ' }).expect(400);

      expect(res.body.message).toContain('GROQ_LLM_API_KEY');
      expect((await prisma.tenant.findUniqueOrThrow({ where: { id: TENANT_A } })).llmVendor)
        .toBeNull();
    });
  });

  it('records who changed it, and to what', async () => {
    // This changes which vendor is billed for a workspace's traffic. Six months later the question is
    // "who moved this workspace and why", and only the audit trail can answer it.
    const token = await login();
    await withVendors({ OPENAI_API_KEY: 'sk-test-openai' }, async (fresh) => {
      await request(fresh).patch(`/sa/tenants/${TENANT_A}/llm-vendor`).set(asAdmin(token))
        .send({ vendor: 'OPENAI', note: 'latency complaint' }).expect(200);
    });

    const event = await prisma.auditEvent.findFirstOrThrow({
      where: { tenantId: TENANT_A, action: 'tenant.llm_vendor_changed' },
      orderBy: { createdAt: 'desc' },
    });
    expect(event.superAdminId).toBe(adminId);
    expect(JSON.stringify(event.metadata)).toContain('latency complaint');
  });

  it('**tells the console what each option resolves to, and which are unavailable**', async () => {
    const token = await login();

    // One vendor configured and one not, stated rather than inherited — so the payload has to report
    // both states in the same response and cannot be right by accident.
    await withVendors({ OPENAI_API_KEY: 'sk-test-openai' }, async (fresh) => {
      const res = await request(fresh).get(`/sa/tenants/${TENANT_A}`).set(asAdmin(token)).expect(200);

      const { llm } = res.body.data;
      expect(llm.vendors.map((v: { vendor: string }) => v.vendor)).toEqual(['OPENAI', 'GROQ']);

      const openai = llm.vendors.find((v: { vendor: string }) => v.vendor === 'OPENAI');
      // A model name per option, so the selector offers a model rather than a brand.
      expect(openai.available).toBe(true);
      expect(openai.model).toBeTruthy();

      const groq = llm.vendors.find((v: { vendor: string }) => v.vendor === 'GROQ');
      expect(groq.available).toBe(false);
      expect(groq.model).toBeNull();

      // And that generation is pinned, so nobody wonders why a Groq workspace's drafts name a GPT model.
      expect(llm.authoringVendor).toBe('OPENAI');
    });
  });

  it('needs an operator token — a customer token is not enough', async () => {
    const tenantToken = signToken({ userId: ownerId, tenantId: TENANT_A });
    await request(app).patch(`/sa/tenants/${TENANT_A}/llm-vendor`)
      .set(asAdmin(tenantToken)).send({ vendor: 'OPENAI' }).expect(401);
    await request(app).patch(`/sa/tenants/${TENANT_A}/llm-vendor`)
      .send({ vendor: 'OPENAI' }).expect(401);
  });
});

describe('the starting copy for a kind of business', () => {
  /*
   * Two fields on a category that **change live behaviour for every workspace on it** which has not
   * written its own — how its assistant sounds, and what it declines. That is the point of them
   * living here rather than being copied into each workspace at signup, and it is why an operator
   * editing them is audited like everything else on this console.
   */
  // SCREAMING_SNAKE — the schema refuses anything else, because templates match on it.
  const KEY = `SA_TEST_CAT_${Date.now()}`;
  let categoryId: string;

  afterEach(async () => {
    await prisma.auditEvent.deleteMany({ where: { targetType: 'BusinessCategory', targetId: categoryId } });
    await prisma.businessCategory.deleteMany({ where: { key: KEY } });
  });

  it('**is set on the category and read back**', async () => {
    const token = await login();

    const created = await request(app).post('/sa/business-categories').set(asAdmin(token)).send({
      key: KEY,
      label: 'Test Trade',
      defaultPersona: 'Plain and specific, no marketing language.',
      defaultOutOfScopeTopics: 'recruitment enquiries\ninternships',
    }).expect(201);
    categoryId = created.body.data.id;

    const list = await request(app).get('/sa/business-categories').set(asAdmin(token)).expect(200);
    const row = list.body.data.find((c: { id: string }) => c.id === categoryId);
    expect(row.defaultPersona).toBe('Plain and specific, no marketing language.');
    expect(row.defaultOutOfScopeTopics).toContain('internships');
  });

  it('**can be cleared back to the house default**', async () => {
    const token = await login();
    const created = await request(app).post('/sa/business-categories').set(asAdmin(token)).send({
      key: KEY, label: 'Test Trade', defaultPersona: 'Mine.',
    }).expect(201);
    categoryId = created.body.data.id;

    // What the console's blank field sends. Null, not an empty string: workspaces on this category
    // go back to inheriting the house text rather than to having no persona at all.
    await request(app).patch(`/sa/business-categories/${categoryId}`).set(asAdmin(token))
      .send({ defaultPersona: null }).expect(200);

    const after = await prisma.businessCategory.findUniqueOrThrow({ where: { id: categoryId } });
    expect(after.defaultPersona).toBeNull();
  });

  it('refuses a persona long enough to be a second prompt', async () => {
    const token = await login();
    const created = await request(app).post('/sa/business-categories').set(asAdmin(token))
      .send({ key: KEY, label: 'Test Trade' }).expect(201);
    categoryId = created.body.data.id;

    await request(app).patch(`/sa/business-categories/${categoryId}`).set(asAdmin(token))
      .send({ defaultPersona: 'x'.repeat(5000) }).expect(400);
  });

  it('records who changed it', async () => {
    // These fields reach customers of every workspace on the category, so "who wrote this" has to be
    // answerable months later.
    const token = await login();
    const created = await request(app).post('/sa/business-categories').set(asAdmin(token))
      .send({ key: KEY, label: 'Test Trade' }).expect(201);
    categoryId = created.body.data.id;

    await request(app).patch(`/sa/business-categories/${categoryId}`).set(asAdmin(token))
      .send({ defaultOutOfScopeTopics: 'nutrition advice' }).expect(200);

    const events = await prisma.auditEvent.findMany({
      where: { targetType: 'BusinessCategory', targetId: categoryId },
      orderBy: { createdAt: 'asc' },
    });
    expect(events.map((e) => e.action)).toEqual(['category.created', 'category.updated']);
    expect(events[1]!.superAdminId).toBe(adminId);
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
