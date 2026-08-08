import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { seedMemberships } from '../../test-support/members.js';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { prisma } from '../../config/prisma.js';
import { buildSuperAdminApp } from '../../superadmin-server.js';
import { buildApp } from '../../app.js';
import { signToken } from '../../utils/jwt.js';
import { sweepImpersonationGrants } from './impersonation.js';

// Support access.
//
// The most invasive capability in the product, so the tests are about the four
// promises rather than the happy path:
//
//   consent-gated — no path grants access without an owner approving
//   time-boxed    — three clocks, narrowest wins
//   read-only     — no write can be attributed to the customer
//   audited       — and visible to the *customer*, not only to us
//
// A failure in any of these is not a bug in a feature, it is a broken promise
// about someone else's customers' conversations.

const SECRET = 'test-super-admin-secret-at-least-32-characters-long';
const TENANT = 'aaaaaaaa-1b00-0000-0000-000000000001';
const OTHER = 'aaaaaaaa-1b00-0000-0000-000000000002';
const EMAIL = 'imp-ops@zunopilot.test';
const PASSWORD = 'ImpOps123!';
const REASON = 'Customer reports the order flow stops after choosing a quantity.';

const app = buildSuperAdminApp();
const customerApp = buildApp();

let adminId: string;
let ownerId: string;
let agentId: string;
let saved: string | undefined;

const wipe = async () => {
  await prisma.auditEvent.deleteMany({ where: { tenantId: { in: [TENANT, OTHER] } } });
  await prisma.superAdmin.deleteMany({ where: { email: EMAIL } });
  await prisma.tenant.deleteMany({ where: { id: { in: [TENANT, OTHER] } } });
};

beforeEach(async () => {
  saved = process.env.SUPERADMIN_JWT_SECRET;
  process.env.SUPERADMIN_JWT_SECRET = SECRET;
  await wipe();

  adminId = (await prisma.superAdmin.create({
    data: {
      email: EMAIL,
      fullName: 'Support Engineer',
      passwordHash: await bcrypt.hash(PASSWORD, 10),
    },
  })).id;

  const tenant = await prisma.tenant.create({
    data: {
      id: TENANT,
      businessName: 'Consent Test Co',
      category: 'RESTAURANT',
      users: {
        create: [
          {
            email: 'owner@consent.test',
            fullName: 'Consent Owner',
            role: 'OWNER',
            passwordHash: 'x',
            emailVerified: true,
          },
          {
            email: 'agent@consent.test',
            fullName: 'Consent Agent',
            role: 'AGENT',
            passwordHash: 'x',
            emailVerified: true,
          },
        ],
      },
    },
    include: { users: { orderBy: { role: 'asc' } } },
  });
  ownerId = tenant.users.find((u) => u.role === 'OWNER')!.id;
  agentId = tenant.users.find((u) => u.role === 'AGENT')!.id;

  await prisma.tenant.create({
    data: { id: OTHER, businessName: 'Other Co', category: 'RESTAURANT' },
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

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

const opsToken = async (): Promise<string> => (await request(app)
  .post('/sa/auth/login').send({ email: EMAIL, password: PASSWORD }).expect(200))
  .body.data.token as string;

/** Ask for access. Returns the grant id. */
const askForAccess = async (ops: string, reason = REASON): Promise<string> => (await request(app)
  .post(`/sa/tenants/${TENANT}/impersonation`).set(bearer(ops)).send({ reason }).expect(201))
  .body.data.id as string;

const approve = (grantId: string, hours = 1) => request(customerApp)
  .post(`/api/support-access/${grantId}/approve`)
  .set(bearer(signToken({ userId: ownerId })))
  .send({ hours });

/** Ask, approve, and take a session token. */
const activeSession = async (): Promise<{ ops: string; grantId: string; token: string }> => {
  const ops = await opsToken();
  const grantId = await askForAccess(ops);
  await approve(grantId).expect(200);
  const started = await request(app)
    .post(`/sa/tenants/${TENANT}/impersonation/${grantId}/token`)
    .set(bearer(ops)).expect(200);
  return { ops, grantId, token: started.body.data.token as string };
};

describe('consent is the gate', () => {
  it('gives an operator no way to grant themselves access', async () => {
    const ops = await opsToken();
    const grantId = await askForAccess(ops);

    // Requested is not approved.
    const grant = await prisma.impersonationGrant.findUniqueOrThrow({ where: { id: grantId } });
    expect(grant.status).toBe('PENDING');
    expect(grant.approvedUntil).toBeNull();

    // And a token cannot be taken until someone says yes.
    await request(app)
      .post(`/sa/tenants/${TENANT}/impersonation/${grantId}/token`)
      .set(bearer(ops)).expect(403);
  });

  it('requires a reason a person could actually consent to', async () => {
    const ops = await opsToken();
    await request(app).post(`/sa/tenants/${TENANT}/impersonation`)
      .set(bearer(ops)).send({ reason: 'debugging' }).expect(400);
  });

  it('shows the workspace who asked and why, verbatim', async () => {
    const ops = await opsToken();
    await askForAccess(ops);

    const response = await request(customerApp).get('/api/support-access')
      .set(bearer(signToken({ userId: ownerId }))).expect(200);

    const pending = response.body.data.grants[0];
    expect(pending.status).toBe('PENDING');
    expect(pending.reason).toBe(REASON);
    expect(pending.requestedBy.email).toBe(EMAIL);
  });

  it('lets an agent see the request but not answer it', async () => {
    const ops = await opsToken();
    const grantId = await askForAccess(ops);
    const agent = signToken({ userId: agentId });

    // Everyone should be able to see that someone outside looked at their
    // customers; only an owner decides.
    await request(customerApp).get('/api/support-access').set(bearer(agent)).expect(200);
    await request(customerApp).post(`/api/support-access/${grantId}/approve`)
      .set(bearer(agent)).send({ hours: 1 }).expect(403);
  });

  it('honours a denial', async () => {
    const ops = await opsToken();
    const grantId = await askForAccess(ops);

    await request(customerApp).post(`/api/support-access/${grantId}/deny`)
      .set(bearer(signToken({ userId: ownerId }))).expect(200);

    await request(app).post(`/sa/tenants/${TENANT}/impersonation/${grantId}/token`)
      .set(bearer(await opsToken())).expect(403);
  });

  it('refuses a workspace with no active owner to ask', async () => {
    const ops = await opsToken();
    // Nobody to consent means no access — never a fallback to self-approval.
    await request(app).post(`/sa/tenants/${OTHER}/impersonation`)
      .set(bearer(ops)).send({ reason: REASON }).expect(422);
  });

  it('will not stack a second request while one is open', async () => {
    const ops = await opsToken();
    await askForAccess(ops);
    await request(app).post(`/sa/tenants/${TENANT}/impersonation`)
      .set(bearer(ops)).send({ reason: REASON }).expect(409);
  });

  it('only lets the engineer who asked use the access', async () => {
    const ops = await opsToken();
    const grantId = await askForAccess(ops);
    await approve(grantId).expect(200);

    const someoneElse = await prisma.superAdmin.create({
      data: {
        email: 'other-ops@zunopilot.test',
        fullName: 'Other Engineer',
        passwordHash: await bcrypt.hash(PASSWORD, 10),
      },
    });
    const otherToken = (await request(app).post('/sa/auth/login')
      .send({ email: 'other-ops@zunopilot.test', password: PASSWORD }).expect(200))
      .body.data.token as string;

    // The workspace consented to a named person, not to the company.
    await request(app).post(`/sa/tenants/${TENANT}/impersonation/${grantId}/token`)
      .set(bearer(otherToken)).expect(403);

    await prisma.superAdmin.delete({ where: { id: someoneElse.id } });
  });
});

describe('the session is read-only', () => {
  it('can read the workspace', async () => {
    const { token } = await activeSession();
    await request(customerApp).get('/api/billing/subscription').set(bearer(token)).expect(200);
    await request(customerApp).get('/api/customers').set(bearer(token)).expect(200);
  });

  it('cannot write anything at all', async () => {
    const { token } = await activeSession();

    // Every one of these would otherwise be attributed to the customer.
    const writes = [
      request(customerApp).post('/api/customers').set(bearer(token)).send({ waId: '15550001111', name: 'X' }),
      request(customerApp).put('/api/billing/overage-cap').set(bearer(token)).send({ overageCapPaise: 0 }),
      request(customerApp).patch('/api/tenant').set(bearer(token)).send({ businessName: 'Renamed' }),
    ];

    for (const write of writes) {
      const response = await write;
      expect(response.status).toBe(403);
      expect(response.body.message).toMatch(/read-only/i);
    }

    // And nothing changed.
    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: TENANT } });
    expect(tenant.businessName).toBe('Consent Test Co');
  });

  it('cannot approve its own extension', async () => {
    const { token, grantId } = await activeSession();
    // The obvious escalation: use the read-only session to approve more access.
    await request(customerApp).post(`/api/support-access/${grantId}/approve`)
      .set(bearer(token)).send({ hours: 8 }).expect(403);
  });

  it('cannot reach the operator console', async () => {
    const { token } = await activeSession();
    // It is a tenant token, so the separate secret and audience already refuse it.
    await request(app).get('/sa/overview').set(bearer(token)).expect(401);
  });
});

describe('the session is time-boxed', () => {
  it('caps the approved window', async () => {
    const ops = await opsToken();
    const grantId = await askForAccess(ops);
    await request(customerApp).post(`/api/support-access/${grantId}/approve`)
      .set(bearer(signToken({ userId: ownerId }))).send({ hours: 99 }).expect(400);
  });

  it('never mints a token that outlives the window', async () => {
    const ops = await opsToken();
    const grantId = await askForAccess(ops);
    await approve(grantId, 1).expect(200);

    // Squeeze the window to under a minute; the token must shrink with it rather
    // than keeping its own 15-minute TTL.
    const until = new Date(Date.now() + 40_000);
    await prisma.impersonationGrant.update({
      where: { id: grantId }, data: { approvedUntil: until },
    });

    const started = await request(app)
      .post(`/sa/tenants/${TENANT}/impersonation/${grantId}/token`)
      .set(bearer(ops)).expect(200);

    expect(new Date(started.body.data.tokenExpiresAt).getTime())
      .toBeLessThanOrEqual(until.getTime());
  });

  it('refuses a token once the window has passed', async () => {
    const { token, grantId } = await activeSession();
    await request(customerApp).get('/api/billing/subscription').set(bearer(token)).expect(200);

    await prisma.impersonationGrant.update({
      where: { id: grantId },
      data: { approvedUntil: new Date(Date.now() - 1000) },
    });

    // The token itself is still cryptographically valid. The grant is what says no.
    await request(customerApp).get('/api/billing/subscription').set(bearer(token)).expect(403);
  });

  it('lets an unanswered request lapse, and refuses to answer it late', async () => {
    const ops = await opsToken();
    const grantId = await askForAccess(ops);

    await prisma.impersonationGrant.update({
      where: { id: grantId }, data: { requestExpiresAt: new Date(Date.now() - 1000) },
    });

    // Answering a lapsed request would resurrect consent that had timed out.
    await approve(grantId).expect(400);
    expect((await prisma.impersonationGrant.findUniqueOrThrow({ where: { id: grantId } })).status)
      .toBe('EXPIRED');
  });

  it('sweeps lapsed requests and closed windows', async () => {
    const ops = await opsToken();
    const pending = await askForAccess(ops);
    await prisma.impersonationGrant.update({
      where: { id: pending }, data: { requestExpiresAt: new Date(Date.now() - 1000) },
    });

    const swept = await sweepImpersonationGrants();
    expect(swept.expired).toBeGreaterThanOrEqual(1);
    expect((await prisma.impersonationGrant.findUniqueOrThrow({ where: { id: pending } })).status)
      .toBe('EXPIRED');
  });
});

describe('the workspace stays in control', () => {
  it('can end a live session, and it stops on the next request', async () => {
    const { token, grantId } = await activeSession();
    await request(customerApp).get('/api/billing/subscription').set(bearer(token)).expect(200);

    await request(customerApp).post(`/api/support-access/${grantId}/revoke`)
      .set(bearer(signToken({ userId: ownerId }))).expect(200);

    // Not at token expiry — immediately, because the grant is read from the
    // database on every request.
    const blocked = await request(customerApp).get('/api/billing/subscription')
      .set(bearer(token)).expect(403);
    expect(blocked.body.message).toMatch(/ended by the workspace/i);
  });

  it('cannot have a revoked session restarted', async () => {
    const { ops, grantId } = await activeSession();
    await request(customerApp).post(`/api/support-access/${grantId}/revoke`)
      .set(bearer(signToken({ userId: ownerId }))).expect(200);

    await request(app).post(`/sa/tenants/${TENANT}/impersonation/${grantId}/token`)
      .set(bearer(ops)).expect(403);
  });

  it('sees what was actually looked at', async () => {
    const { token, grantId } = await activeSession();
    await request(customerApp).get('/api/customers').set(bearer(token)).expect(200);
    await request(customerApp).get('/api/orders').set(bearer(token)).expect(200);

    // The path log is written best-effort and not awaited, so give it a tick.
    await new Promise((resolve) => setTimeout(resolve, 250));

    const log = await request(customerApp).get(`/api/support-access/${grantId}/log`)
      .set(bearer(signToken({ userId: ownerId }))).expect(200);

    const paths = log.body.data.entries.map((e: { path: string }) => e.path);
    expect(paths.some((p: string) => p.includes('/api/customers'))).toBe(true);
    expect(paths.some((p: string) => p.includes('/api/orders'))).toBe(true);
    expect(log.body.data.requestCount).toBeGreaterThanOrEqual(2);
  });

  it('cannot see another workspace\'s grants', async () => {
    const ops = await opsToken();
    const grantId = await askForAccess(ops);

    const outsider = await prisma.user.create({
      data: {
        tenantId: OTHER,
        email: 'owner@other.test',
        fullName: 'Other Owner',
        role: 'OWNER',
        passwordHash: 'x',
      },
    });
    // This person is created inside the test body, so no hook can cover them.
    await seedMemberships();

    // A grant id from another workspace is a 404, not a 403 — there is nothing to
    // confirm the existence of.
    await request(customerApp).post(`/api/support-access/${grantId}/approve`)
      .set(bearer(signToken({ userId: outsider.id }))).send({ hours: 1 }).expect(404);
  });
});

describe('every step is on the record', () => {
  it('audits the request, the approval, the session and the end', async () => {
    const { ops, grantId } = await activeSession();
    await request(app).post(`/sa/tenants/${TENANT}/impersonation/${grantId}/end`)
      .set(bearer(ops)).expect(200);

    const events = await prisma.auditEvent.findMany({
      where: { tenantId: TENANT },
      orderBy: { createdAt: 'asc' },
      select: { action: true, summary: true },
    });
    const actions = events.map((e) => e.action);

    expect(actions).toContain('impersonation.requested');
    expect(actions).toContain('impersonation.approved');
    expect(actions).toContain('impersonation.started');
    expect(actions).toContain('impersonation.ended');
  });

  it('records the approval against the operator who asked, not just the workspace', async () => {
    const ops = await opsToken();
    const grantId = await askForAccess(ops);
    await approve(grantId).expect(200);

    const event = await prisma.auditEvent.findFirstOrThrow({
      where: { tenantId: TENANT, action: 'impersonation.approved' },
    });
    // So "who was allowed in" is answerable from the audit log alone.
    expect(event.superAdminId).toBe(adminId);
    expect(event.summary).toContain('owner@consent.test');
  });

  it('freezes the view to the approver, so a later role change cannot widen it', async () => {
    const ops = await opsToken();
    const grantId = await askForAccess(ops);
    await approve(grantId).expect(200);

    const grant = await prisma.impersonationGrant.findUniqueOrThrow({ where: { id: grantId } });
    expect(grant.viewAsUserId).toBe(ownerId);
    expect(grant.respondedByUserId).toBe(ownerId);
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
