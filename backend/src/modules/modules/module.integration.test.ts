import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { prisma } from '../../config/prisma.js';
import { buildSuperAdminApp } from '../../superadmin-server.js';
import { buildApp } from '../../app.js';
import { signToken } from '../../utils/jwt.js';
import { requireAuth, requireModule } from '../../middleware/auth.js';
import { errorHandler } from '../../middleware/errorHandler.js';
import { moduleStateFor } from './module.service.js';

// The optional-module gate.
//
// These are boundary tests rather than feature tests. What has to hold is that a
// module nobody was given is invisible and unreachable, that only an operator can
// grant one, and that granting one to a workspace grants it to *that* workspace.
//
// `requireModule` is mounted on a throwaway app here rather than on a real
// module's routes, because the middleware is the thing under test and it must
// behave identically before Leads, Marketing or Support exist.

const SECRET = 'test-super-admin-secret-at-least-32-characters-long';
const TENANT_A = 'aaaaaaaa-9000-0000-0000-000000000001';
const TENANT_B = 'aaaaaaaa-9000-0000-0000-000000000002';
const EMAIL = 'modules-test@zunopilot.test';
const PASSWORD = 'ModulesTest123!';

const superAdminApp = buildSuperAdminApp();
const customerApp = buildApp();

/** A minimal app carrying the real middleware, so the gate is what is exercised. */
const gatedApp = (() => {
  const app = express();
  app.get('/leads-probe', requireAuth, requireModule('LEADS'), (_req, res) => {
    res.json({ success: true, data: { reached: true } });
  });
  app.use(errorHandler);
  return app;
})();

let ownerAToken: string;
let ownerBToken: string;
/**
 * One operator login per test.
 *
 * `/sa/auth/login` is rate limited per IP — raised under `NODE_ENV=test` but not
 * removed, because a limiter that does not run in tests is a limiter nobody has
 * ever exercised. Re-authenticating inside every helper call exhausts it and the
 * failures then look like the feature is broken.
 */
let opToken: string;

const wipe = async () => {
  await prisma.auditEvent.deleteMany({ where: { tenantId: { in: [TENANT_A, TENANT_B] } } });
  await prisma.superAdmin.deleteMany({ where: { email: EMAIL } });
  await prisma.tenant.deleteMany({ where: { id: { in: [TENANT_A, TENANT_B] } } });
};

const makeTenant = async (id: string, name: string, phone: string) => {
  const tenant = await prisma.tenant.create({
    data: {
      id,
      businessName: name,
      onboardingCompletedAt: new Date(),
      users: { create: { phone, fullName: `${name} Owner`, role: 'OWNER' } },
    },
    include: { users: true },
  });
  return signToken({ userId: tenant.users[0].id });
};

beforeEach(async () => {
  process.env.SUPERADMIN_JWT_SECRET = SECRET;
  await wipe();

  await prisma.superAdmin.create({
    data: { email: EMAIL, fullName: 'Modules Tester', passwordHash: await bcrypt.hash(PASSWORD, 10) },
  });

  ownerAToken = await makeTenant(TENANT_A, 'Alpha', '15559000001');
  ownerBToken = await makeTenant(TENANT_B, 'Beta', '15559000002');

  const login = await request(superAdminApp)
    .post('/sa/auth/login')
    .send({ email: EMAIL, password: PASSWORD })
    .expect(200);
  opToken = login.body.data.token as string;
});

afterAll(async () => {
  await wipe();
  await prisma.$disconnect();
});

const asBearer = (token: string) => ({ Authorization: `Bearer ${token}` });

const setModule = (tenantId: string, module: string, enabled: boolean, note?: string) =>
  request(superAdminApp)
    .patch(`/sa/tenants/${tenantId}/modules`)
    .set(asBearer(opToken))
    .send({ module, enabled, ...(note ? { note } : {}) });

describe('a module nobody was given', () => {
  it('is off for a workspace that has never been configured', async () => {
    // **The add-ons are off and `AI_AGENT` is on**, and the asymmetry is the point rather than
    // an oversight. Marketing, Leads and Support are things a workspace does not have until an
    // operator grants one, so off-by-default protects us from handing out what nobody bought.
    // The AI agent is already running for every workspace on the platform, so off-by-default
    // would have muted all of them the moment it shipped — the same rule pointing the other way.
    expect(await moduleStateFor(TENANT_A)).toEqual({
      MARKETING: false, LEADS: false, SUPPORT: false, AI_AGENT: true, ECOMMERCE: true,
    });
  });

  it('refuses its routes with 404, not 403', async () => {
    // 403 would confirm the feature exists and this workspace cannot have it,
    // which on an unreleased module is a roadmap leak. 404 is indistinguishable
    // from a route that was never built.
    await request(gatedApp).get('/leads-probe').set(asBearer(ownerAToken)).expect(404);
  });

  it('still refuses an unauthenticated request with 401', async () => {
    // Order matters: authentication is answered before module state, or the gate
    // becomes an unauthenticated probe of which workspaces have which modules.
    await request(gatedApp).get('/leads-probe').expect(401);
  });

  it('does not appear in the session payload', async () => {
    const response = await request(customerApp)
      .get('/api/auth/me')
      .set(asBearer(ownerAToken))
      .expect(200);
    // `AI_AGENT` is present because it is on by default; the add-ons are absent because they are
    // not. Asserted as "these three are missing" rather than "the list is empty", so the test
    // keeps meaning the same thing if another default-on capability is added later.
    expect(response.body.data.modules).not.toContain('LEADS');
    expect(response.body.data.modules).not.toContain('MARKETING');
    expect(response.body.data.modules).not.toContain('SUPPORT');
  });
});

describe('granting a module', () => {
  it('opens the routes and shows up in the session', async () => {
    await setModule(TENANT_A, 'LEADS', true).expect(200);

    await request(gatedApp).get('/leads-probe').set(asBearer(ownerAToken)).expect(200);

    const response = await request(customerApp)
      .get('/api/auth/me')
      .set(asBearer(ownerAToken))
      .expect(200);
    expect(response.body.data.modules).toContain('LEADS');
  });

  it('grants it to that workspace only', async () => {
    await setModule(TENANT_A, 'LEADS', true).expect(200);

    await request(gatedApp).get('/leads-probe').set(asBearer(ownerAToken)).expect(200);
    await request(gatedApp).get('/leads-probe').set(asBearer(ownerBToken)).expect(404);
  });

  it('takes effect on the next request, without a new token', async () => {
    // The same token before and after. Module state is a row, not a claim, so an
    // operator switching one off cannot be outlived by a token issued earlier.
    await setModule(TENANT_A, 'SUPPORT', true).expect(200);
    await request(gatedApp).get('/leads-probe').set(asBearer(ownerAToken)).expect(404);

    await setModule(TENANT_A, 'LEADS', true).expect(200);
    await request(gatedApp).get('/leads-probe').set(asBearer(ownerAToken)).expect(200);

    await setModule(TENANT_A, 'LEADS', false).expect(200);
    await request(gatedApp).get('/leads-probe').set(asBearer(ownerAToken)).expect(404);
  });

  it('is recorded on the audit trail with who and why', async () => {
    await setModule(TENANT_A, 'MARKETING', true, 'Pilot customer, agreed on a call').expect(200);

    const events = await prisma.auditEvent.findMany({ where: { tenantId: TENANT_A } });
    const enabled = events.find((event) => event.action === 'tenant.module_enabled');
    expect(enabled).toBeTruthy();
    expect(enabled!.summary).toContain('MARKETING');
    expect(enabled!.targetId).toBe('MARKETING');
    expect(enabled!.metadata).toMatchObject({ note: 'Pilot customer, agreed on a call' });
  });

  it('records disabling separately from enabling', async () => {
    await setModule(TENANT_A, 'LEADS', true).expect(200);
    await setModule(TENANT_A, 'LEADS', false).expect(200);

    const actions = (await prisma.auditEvent.findMany({ where: { tenantId: TENANT_A } }))
      .map((event) => event.action);
    expect(actions).toContain('tenant.module_enabled');
    expect(actions).toContain('tenant.module_disabled');
  });

  it('is idempotent — toggling twice leaves one row, not two', async () => {
    await setModule(TENANT_A, 'LEADS', true).expect(200);
    await setModule(TENANT_A, 'LEADS', true).expect(200);

    const rows = await prisma.tenantModule.findMany({
      where: { tenantId: TENANT_A, module: 'LEADS' },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].enabled).toBe(true);
  });
});

describe('who may grant one', () => {
  it('refuses an unauthenticated toggle', async () => {
    await request(superAdminApp)
      .patch(`/sa/tenants/${TENANT_A}/modules`)
      .send({ module: 'LEADS', enabled: true })
      .expect(401);
  });

  it('refuses a customer token, even the owner of that very workspace', async () => {
    // The point of the whole design: a workspace cannot grant itself a module.
    await request(superAdminApp)
      .patch(`/sa/tenants/${TENANT_A}/modules`)
      .set(asBearer(ownerAToken))
      .send({ module: 'LEADS', enabled: true })
      .expect(401);

    expect(await moduleStateFor(TENANT_A)).toMatchObject({ LEADS: false });
  });

  it('refuses a module key that is not one of ours', async () => {
    await request(superAdminApp)
      .patch(`/sa/tenants/${TENANT_A}/modules`)
      .set(asBearer(opToken))
      .send({ module: 'BILLING', enabled: true })
      .expect(400);
  });

  it('404s for a workspace that does not exist', async () => {
    await request(superAdminApp)
      .patch('/sa/tenants/aaaaaaaa-9000-0000-0000-00000000dead/modules')
      .set(asBearer(opToken))
      .send({ module: 'LEADS', enabled: true })
      .expect(404);
  });
});

describe('the operator console view', () => {
  it('lists every module, including ones never configured', async () => {
    await setModule(TENANT_A, 'LEADS', true).expect(200);

    const response = await request(superAdminApp)
      .get(`/sa/tenants/${TENANT_A}/modules`)
      .set(asBearer(opToken))
      .expect(200);

    // A console that only rendered the rows that exist would have no switch to
    // turn the first module on with.
    //
    // The exact list is asserted rather than a length alone, because the console indexes its
    // copy by module key — `MODULE_COPY[setting.module].label` — and crashes on a key it does not
    // know. So a new enum value that reaches this endpoint without a matching entry in
    // `superadmin/src/pages/TenantDetail.tsx` breaks the page, and this is the test that says so.
    expect(response.body.data).toHaveLength(5);
    expect(response.body.data.map((s: { module: string }) => s.module).sort())
      .toEqual(['AI_AGENT', 'ECOMMERCE', 'LEADS', 'MARKETING', 'SUPPORT']);
    // On by default, and reported as such so the console shows it already enabled.
    expect(response.body.data.find((s: { module: string }) => s.module === 'AI_AGENT').enabled).toBe(true);
    expect(response.body.data.find((s: { module: string }) => s.module === 'LEADS').enabled).toBe(true);
    expect(response.body.data.find((s: { module: string }) => s.module === 'SUPPORT').enabled).toBe(false);
  });
});
