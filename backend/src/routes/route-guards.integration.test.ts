import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { seedMemberships } from '../test-support/members.js';
import request from 'supertest';
import { buildApp } from '../app.js';
import { prisma } from '../config/prisma.js';
import { signToken } from '../utils/jwt.js';
import { ROLE_PERMISSIONS } from '../config/permissions.js';
import type { Permission } from '../config/permissions.js';

/*
 * The route groups nothing else touches.
 *
 * A coverage audit found eight mounted under `/api` with **no test making a single HTTP request
 * to them**: whatsapp, templates, assistants, automation, workflow-instances, workflow-templates,
 * pricing and webhooks. Some of the logic underneath was well covered — the workflow engine in
 * particular is tested exhaustively from `startInstance()` down — but the *routes* were not, and
 * a route is more than its handler: it is the auth middleware, the permission guard and the
 * validator in front of it.
 *
 * ── Why this file tests guards rather than behaviour ─────────────────────────
 *
 * A test per endpoint asserting what it returns would be a large file that mostly re-checks
 * services with their own suites. The property that is *only* observable here, and that was
 * genuinely unasserted, is the front door: **can this be reached without a session, and can it
 * be reached without the permission it names?**
 *
 * That framing found a real gap on the first run. Twelve GETs across `/assistants`,
 * `/workflow-templates` and `/workflow-instances` had `requireAuth` and no permission check at
 * all, while the sibling workflow routes required `workflows:read` — so a seat built with zero
 * permissions could read routing prompts and, through `GET /workflow-instances/:id`, the
 * customer data a flow had collected. The table below is written as the *intended* contract and
 * the routes were brought up to it; see the note in `conversation-engine/http/routes.ts`.
 *
 * Written as one table rather than one `it` per endpoint so that adding a route without a guard
 * is a one-line omission somebody notices, and so the list can be diffed against the routers.
 */

const app = buildApp();

const TENANT = 'dddddddd-0000-0000-0000-0000000000d1';
const OTHER_TENANT = 'dddddddd-0000-0000-0000-0000000000d2';

let ownerToken: string;
/** A real, valid session that simply holds no permissions. The restricted-seat shape. */
let noPermsToken: string;
/** A valid session belonging to a *different* workspace. */
let outsiderToken: string;

type Method = 'get' | 'post' | 'patch' | 'put' | 'delete';

interface Guarded {
  method: Method;
  path: string;
  /** The permission the route names, or `null` for authenticated-but-unpermissioned. */
  permission: Permission | null;
}

/**
 * Every endpoint in the eight groups, with the permission it enforces.
 *
 * Ids in the paths are deliberately non-existent. A guard must refuse **before** the handler
 * looks anything up — if a 404 comes back instead of a 403, the lookup happened first and the
 * route has told an unauthorised caller whether a record exists.
 */
const GUARDED: Guarded[] = [
  // ── /api/whatsapp ───────────────────────────────────────────────────────────
  { method: 'get', path: '/api/whatsapp', permission: 'settings:read' },
  { method: 'post', path: '/api/whatsapp/embedded-signup', permission: 'channel:manage' },
  { method: 'patch', path: '/api/whatsapp/token', permission: 'channel:manage' },
  { method: 'delete', path: '/api/whatsapp', permission: 'channel:disconnect' },

  // ── /api/templates ──────────────────────────────────────────────────────────
  { method: 'get', path: '/api/templates', permission: 'templates:write' },
  { method: 'put', path: '/api/templates', permission: 'templates:write' },
  { method: 'get', path: '/api/templates/meta', permission: 'templates:write' },
  { method: 'post', path: '/api/templates/meta', permission: 'templates:write' },
  { method: 'delete', path: '/api/templates/no-such-template', permission: 'templates:delete' },

  // ── /api/automation ─────────────────────────────────────────────────────────
  { method: 'get', path: '/api/automation/keywords', permission: 'automation:write' },
  { method: 'post', path: '/api/automation/keywords', permission: 'automation:write' },
  { method: 'patch', path: '/api/automation/keywords/no-such-id', permission: 'automation:write' },
  { method: 'delete', path: '/api/automation/keywords/no-such-id', permission: 'automation:write' },
  { method: 'get', path: '/api/automation/fallback', permission: 'automation:write' },
  { method: 'put', path: '/api/automation/fallback', permission: 'automation:write' },

  // ── /api/assistants ─────────────────────────────────────────────────────────
  // The reads in this block are the ones that had no guard at all.
  { method: 'get', path: '/api/assistants', permission: 'workflows:read' },
  { method: 'get', path: '/api/assistants/00000000-0000-4000-8000-000000000001', permission: 'workflows:read' },
  { method: 'patch', path: '/api/assistants/00000000-0000-4000-8000-000000000001', permission: 'workflows:author' },
  { method: 'get', path: '/api/assistants/00000000-0000-4000-8000-000000000001/routing', permission: 'workflows:read' },
  { method: 'patch', path: '/api/assistants/00000000-0000-4000-8000-000000000001/routing', permission: 'workflows:author' },
  { method: 'get', path: '/api/assistants/00000000-0000-4000-8000-000000000001/rules', permission: 'workflows:read' },
  { method: 'post', path: '/api/assistants/00000000-0000-4000-8000-000000000001/rules', permission: 'workflows:author' },
  { method: 'get', path: '/api/assistants/00000000-0000-4000-8000-000000000001/routing-conflicts', permission: 'workflows:read' },
  { method: 'get', path: '/api/assistants/00000000-0000-4000-8000-000000000001/candidates', permission: 'workflows:read' },
  { method: 'get', path: '/api/assistants/00000000-0000-4000-8000-000000000001/routing-tests', permission: 'workflows:read' },
  { method: 'get', path: '/api/assistants/00000000-0000-4000-8000-000000000001/workflows', permission: 'workflows:read' },
  { method: 'post', path: '/api/assistants/00000000-0000-4000-8000-000000000001/workflows', permission: 'workflows:author' },

  // ── /api/workflow-templates ─────────────────────────────────────────────────
  { method: 'get', path: '/api/workflow-templates', permission: 'workflows:read' },

  // ── /api/workflow-instances ─────────────────────────────────────────────────
  { method: 'get', path: '/api/workflow-instances', permission: 'workflows:read' },
  { method: 'get', path: '/api/workflow-instances/no-such-instance', permission: 'workflows:read' },
  { method: 'get', path: '/api/workflow-instances/no-such-instance/executions', permission: 'workflows:read' },
  { method: 'post', path: '/api/workflow-instances/no-such-instance/cancel', permission: 'workflows:author' },
];

const label = (r: Guarded) => `${r.method.toUpperCase()} ${r.path}`;

const call = (r: Guarded, token?: string) => {
  const req = request(app)[r.method](r.path);
  return token ? req.set('Authorization', `Bearer ${token}`) : req;
};

beforeAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [TENANT, OTHER_TENANT] } } });

  const tenant = await prisma.tenant.create({
    data: {
      id: TENANT,
      businessName: 'Guard Test Kitchen',
      category: 'RESTAURANT',
      roles: {
        create: [
          { name: 'Owner', permissions: [...ROLE_PERMISSIONS.OWNER], isOwner: true, isSystem: true },
          // Holds nothing. Not a broken account — the shape a workspace builds deliberately when
          // it wants a seat that can do one narrow thing, and the shape every guard is about.
          { name: 'Restricted', permissions: [], sortOrder: 90 },
        ],
      },
    },
    include: { roles: true },
  });

  const ownerRole = tenant.roles.find((r) => r.isOwner)!;
  const restrictedRole = tenant.roles.find((r) => !r.isOwner)!;

  const owner = await prisma.user.create({
    data: { tenantId: TENANT, phone: '15550009001', fullName: 'Guard Owner', role: 'OWNER', roleId: ownerRole.id },
  });
  const restricted = await prisma.user.create({
    data: { tenantId: TENANT, phone: '15550009002', fullName: 'Guard Restricted', role: 'AGENT', roleId: restrictedRole.id },
  });

  const other = await prisma.tenant.create({
    data: {
      id: OTHER_TENANT,
      businessName: 'Someone Else',
      category: 'RESTAURANT',
      roles: { create: [{ name: 'Owner', permissions: [...ROLE_PERMISSIONS.OWNER], isOwner: true, isSystem: true }] },
    },
    include: { roles: true },
  });
  const outsider = await prisma.user.create({
    data: {
      tenantId: OTHER_TENANT, phone: '15550009003', fullName: 'Outsider',
      role: 'OWNER', roleId: other.roles[0]!.id,
    },
  });

  ownerToken = signToken({ userId: owner.id });
  noPermsToken = signToken({ userId: restricted.id });
  outsiderToken = signToken({ userId: outsider.id });
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [TENANT, OTHER_TENANT] } } });
  await prisma.$disconnect();
});

describe('no session, no access', () => {
  it.each(GUARDED.map((r) => [label(r), r] as const))(
    '%s refuses an anonymous request',
    async (_name, route) => {
      const res = await call(route);
      expect(res.status).toBe(401);
    },
  );

  it.each(GUARDED.map((r) => [label(r), r] as const))(
    '%s refuses a token signed with the wrong secret',
    async (_name, route) => {
      // A forged or stale-secret token must be indistinguishable from no token at all.
      const forged = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJhbnkifQ.not-a-real-signature';
      const res = await call(route, forged);
      expect(res.status).toBe(401);
    },
  );
});

describe('a session is not a permission', () => {
  it.each(GUARDED.map((r) => [label(r), r] as const))(
    '**%s refuses a member of the workspace who does not hold its permission**',
    async (_name, route) => {
      /*
       * The heart of the file. This caller is genuinely signed in and genuinely belongs to the
       * workspace — the only thing they lack is the permission the route names. Twelve of these
       * returned 200 before the guards were added.
       */
      const res = await call(route, noPermsToken);
      expect(res.status).toBe(403);
    },
  );

  it.each(GUARDED.map((r) => [label(r), r] as const))(
    '%s refuses before it looks anything up',
    async (_name, route) => {
      // Every id in the table is fabricated. A 404 here would mean the handler ran first and
      // leaked whether the record exists to somebody not allowed to ask.
      const res = await call(route, noPermsToken);
      expect(res.status).not.toBe(404);
      expect(res.status).not.toBe(200);
    },
  );
});

describe('the owner gets through the guard', () => {
  it.each(GUARDED.map((r) => [label(r), r] as const))(
    '%s is not refused for an owner',
    async (_name, route) => {
      /*
       * The other half, and the reason the table is not just "everything 403s".
       *
       * A guard naming a permission nobody holds would pass every assertion above while making
       * the feature unreachable. So the owner — who holds all of them — must get *past* the
       * guard. What happens after is not this file's business: a fabricated id legitimately
       * 404s, an empty body legitimately 400s. Only 401 and 403 mean the door itself is wrong.
       */
      const res = await call(route, ownerToken);
      expect([401, 403]).not.toContain(res.status);
    },
  );
});

describe('another workspace’s owner is still an outsider', () => {
  it.each(
    GUARDED.filter((r) => r.path.includes('00000000') || r.path.includes('no-such'))
      .map((r) => [label(r), r] as const),
  )(
    '%s never returns another tenant’s record',
    async (_name, route) => {
      // These ids do not exist anywhere, so the only safe answers are "refused" or "not found".
      // A 200 would mean the route resolved an id without scoping it to the caller's workspace.
      const res = await call(route, outsiderToken);
      expect(res.status).not.toBe(200);
    },
  );
});

describe('the two that are public on purpose', () => {
  it('**serves the pricing catalogue without a session** — the page must show what checkout charges', () => {
    // Deliberately unauthenticated, and worth a test precisely because "why is this open?" is
    // the question a future reader will ask. Locking it would break the marketing pricing page.
    return request(app).get('/api/pricing').expect(200);
  });

  it('leaks nothing tenant-specific through it', async () => {
    const res = await request(app).get('/api/pricing');
    const body = JSON.stringify(res.body);
    expect(body).not.toContain('Guard Test Kitchen');
    expect(body).not.toContain(TENANT);
    // No Razorpay secrets, no keys.
    expect(body).not.toMatch(/rzp_(test|live)_/);
    expect(body).not.toMatch(/secret/i);
  });

  it('**refuses an unsigned Razorpay webhook** — the signature is the only thing authenticating it', async () => {
    // No session by design, so the signature carries the whole burden. Anything but a refusal
    // here means anyone who knows the URL can mark an invoice paid.
    const res = await request(app)
      .post('/api/webhooks/razorpay')
      .send({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_forged', amount: 100 } } } });

    expect([400, 401, 403]).toContain(res.status);
  });

  it('refuses one carrying a wrong signature just the same', async () => {
    const res = await request(app)
      .post('/api/webhooks/razorpay')
      .set('x-razorpay-signature', 'deadbeef')
      .send({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_forged', amount: 100 } } } });

    expect([400, 401, 403]).toContain(res.status);
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
