import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { seedMemberships } from './test-support/members.js';
import request from 'supertest';
import crypto from 'node:crypto';
import { prisma } from './config/prisma.js';
import { buildApp } from './app.js';
import { signToken } from './utils/jwt.js';
import { verifyToken } from './utils/jwt.js';
import { jwtSecretWeakness } from './config/env.js';
import { ROLE_PERMISSIONS } from './config/permissions.js';
import { verifySignature } from './modules/conversation-engine/http/webhook-intake.js';

// The production-readiness fixes, asserted as properties rather than as code shapes.
//
// Each block below corresponds to something an audit found reachable in production. They are
// gathered in one file on purpose: what they have in common is not a module, it is a *failure
// direction*. Every one of them was a control that failed **open** — a missing secret read as
// configured, an unsignable webhook accepted, an unknown channel written somewhere, an
// internal error described to the caller.
//
// So the assertions are all written the same way round: **prove the unsafe thing is refused**,
// not that the safe path still works. A test that only checks the happy path is exactly what
// let these survive.

const app = buildApp();

const TENANT = 'ffffffff-f000-0000-0000-00000000f001';
const OTHER_TENANT = 'ffffffff-f000-0000-0000-00000000f002';

let ownerToken: string;
let noPermsToken: string;
let categoryId: string;
let workflowId: string;

const wipe = () => prisma.tenant.deleteMany({ where: { id: { in: [TENANT, OTHER_TENANT] } } });

const seed = async () => {
  const tenant = await prisma.tenant.create({
    data: {
      id: TENANT,
      businessName: 'Hardening Kitchen',
      category: 'RESTAURANT',
      roles: {
        create: [
          { name: 'Owner', permissions: [...ROLE_PERMISSIONS.OWNER], isOwner: true, isSystem: true },
          // A role holding *nothing*. This is the shape a workspace builds when it wants a
          // restricted seat, and the shape every gate below is really about.
          { name: 'Restricted', permissions: [], sortOrder: 90 },
        ],
      },
      users: {
        create: [
          { phone: '15550008881', fullName: 'Owner', role: 'OWNER' },
          { phone: '15550008882', fullName: 'Restricted', role: 'AGENT' },
        ],
      },
    },
    include: { users: { orderBy: { phone: 'asc' } }, roles: true },
  });

  await prisma.tenant.create({
    data: { id: OTHER_TENANT, businessName: 'Someone Else', category: 'RESTAURANT' },
  });

  const owner = tenant.users[0];
  const restricted = tenant.users[1];
  await prisma.user.update({
    where: { id: owner.id },
    data: { roleId: tenant.roles.find((r) => r.isOwner)!.id },
  });
  await prisma.user.update({
    where: { id: restricted.id },
    data: { roleId: tenant.roles.find((r) => !r.isOwner)!.id },
  });
  ownerToken = signToken({ userId: owner.id });
  noPermsToken = signToken({ userId: restricted.id });

  categoryId = (await prisma.menuCategory.create({
    data: { tenantId: TENANT, name: 'Curries' },
  })).id;

  workflowId = (await prisma.workflow.create({
    data: { tenantId: TENANT, name: 'Greeting', status: 'DRAFT' },
  })).id;
};

beforeEach(async () => {
  await wipe();
  await seed();
});

afterAll(async () => {
  await wipe();
  await prisma.$disconnect();
});

// ── 1. Secrets fail closed ────────────────────────────────────────────────────

describe('the session signing secret', () => {
  const original = process.env.JWT_SECRET;
  afterEach(() => { process.env.JWT_SECRET = original; });

  it('**refuses a secret shorter than 32 characters**', () => {
    process.env.JWT_SECRET = 'too-short';
    expect(jwtSecretWeakness()).toMatch(/9 characters/);
  });

  it('**names the old published placeholder specifically**', () => {
    // The length rule alone would reject this (it is 20 characters) but would report a count,
    // sending the operator off to lengthen a string that is public no matter how long it gets.
    // Asserting the *message* is what keeps the two checks in the useful order — with them
    // reversed, this branch was unreachable.
    process.env.JWT_SECRET = 'dev-secret-change-me';
    expect(jwtSecretWeakness()).toMatch(/placeholder/);
  });

  it('accepts a real one', () => {
    process.env.JWT_SECRET = crypto.randomBytes(48).toString('base64');
    expect(jwtSecretWeakness()).toBeNull();
  });
});

describe('token verification', () => {
  it('**refuses a token signed with the algorithm set to none**', () => {
    // The forgery `algorithms` pinning exists to stop: a header claiming a different
    // algorithm, hoping the verifier will believe it.
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ userId: 'attacker' })).toString('base64url');
    expect(() => verifyToken(`${header}.${payload}.`)).toThrow();
  });
});

// ── 2. The webhook fails closed ───────────────────────────────────────────────

describe('webhook signature verification', () => {
  const originalSecret = process.env.META_APP_SECRET;
  const originalAllow = process.env.ALLOW_UNSIGNED_WEBHOOKS;

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.META_APP_SECRET;
    else process.env.META_APP_SECRET = originalSecret;
    if (originalAllow === undefined) delete process.env.ALLOW_UNSIGNED_WEBHOOKS;
    else process.env.ALLOW_UNSIGNED_WEBHOOKS = originalAllow;
    vi.resetModules();
  });

  /** A request as `verifySignature` sees it: a raw body and whatever headers we choose. */
  const fakeRequest = (headers: Record<string, string> = {}) => ({
    get: (name: string) => headers[name.toLowerCase()],
    rawBody: Buffer.from('{"object":"whatsapp_business_account"}'),
  });

  it('**rejects an unsigned webhook when no app secret is configured**', async () => {
    // The load-bearing test in this file. This used to return `true` — the endpoint is
    // unauthenticated by design, so with the secret unset anyone could invent inbound
    // messages for any tenant.
    process.env.META_APP_SECRET = '';
    delete process.env.ALLOW_UNSIGNED_WEBHOOKS;
    vi.resetModules();
    const { verifySignature: fresh } = await import(
      './modules/conversation-engine/http/webhook-intake.js'
    );
    expect(fresh(fakeRequest() as never)).toBe(false);
  });

  it('accepts one only when the local-development opt-in is set by name', async () => {
    process.env.META_APP_SECRET = '';
    process.env.ALLOW_UNSIGNED_WEBHOOKS = 'true';
    vi.resetModules();
    const { verifySignature: fresh } = await import(
      './modules/conversation-engine/http/webhook-intake.js'
    );
    expect(fresh(fakeRequest() as never)).toBe(true);
  });

  it('rejects a wrong signature when a secret *is* configured', () => {
    expect(verifySignature(fakeRequest({
      'x-hub-signature-256': `sha256=${'0'.repeat(64)}`,
    }) as never)).toBe(false);
  });
});

describe('the verify handshake', () => {
  it('**never succeeds while the token is unconfigured**', async () => {
    // Removing the `'verify-token'` default introduced a subtler hole: an empty expected
    // value and an empty supplied value compare equal. Guarded explicitly, so an
    // unconfigured deployment cannot be handshaked by sending nothing.
    vi.resetModules();
    const original = process.env.META_WEBHOOK_VERIFY_TOKEN;
    process.env.META_WEBHOOK_VERIFY_TOKEN = '';
    try {
      const { buildApp: freshApp } = await import('./app.js');
      const res = await request(freshApp())
        .get('/api/webhook')
        .query({ 'hub.mode': 'subscribe', 'hub.verify_token': '', 'hub.challenge': 'let-me-in' });
      expect(res.status).toBe(403);
      expect(res.text).not.toContain('let-me-in');
    } finally {
      if (original === undefined) delete process.env.META_WEBHOOK_VERIFY_TOKEN;
      else process.env.META_WEBHOOK_VERIFY_TOKEN = original;
      vi.resetModules();
    }
  });
});

// ── 3. An unknown channel is dropped, not rehomed ─────────────────────────────

describe('a webhook for an unrecognised phone_number_id', () => {
  it('**creates nothing, in any tenant**', async () => {
    // It used to be written under `prisma.tenant.findFirst()` — a real business's inbox,
    // chosen arbitrarily. Counted across the whole table rather than per tenant, because the
    // bug's defining feature was landing somewhere nobody looked.
    const before = {
      customers: await prisma.customer.count(),
      conversations: await prisma.conversation.count(),
      messages: await prisma.message.count(),
    };

    const body = {
      object: 'whatsapp_business_account',
      entry: [{
        changes: [{
          field: 'messages',
          value: {
            metadata: { phone_number_id: 'no-such-channel-9999' },
            contacts: [{ wa_id: '919999900001', profile: { name: 'Stranger' } }],
            messages: [{
              id: 'wamid.unmatched.1', from: '919999900001', type: 'text',
              text: { body: 'hello?' }, timestamp: '1750000000',
            }],
          },
        }],
      }],
    };

    const secret = process.env.META_APP_SECRET || '';
    const raw = JSON.stringify(body);
    const res = await request(app)
      .post('/api/webhook')
      .set('Content-Type', 'application/json')
      .set('x-hub-signature-256', `sha256=${crypto.createHmac('sha256', secret).update(raw).digest('hex')}`)
      .send(raw);

    // Meta is still acked — anything else makes it retry a message we will never want.
    expect(res.status).toBe(200);

    // The handler continues after responding, so give the async work a moment to *not*
    // happen. A bare assertion would pass even if the write were merely slow.
    await new Promise((resolve) => { setTimeout(resolve, 300); });

    expect(await prisma.customer.count()).toBe(before.customers);
    expect(await prisma.conversation.count()).toBe(before.conversations);
    expect(await prisma.message.count()).toBe(before.messages);
  });
});

// ── 4. No cross-tenant write by mass assignment ───────────────────────────────

describe('updating a menu category', () => {
  it('**cannot move the row into another tenant**', async () => {
    // Asserted on the row, not the response. The response echoed the new tenantId, but even
    // a handler that hid it would still have moved the row.
    const res = await request(app)
      .patch(`/api/menu/categories/${categoryId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Renamed', tenantId: OTHER_TENANT });

    expect(res.status).toBe(200);
    const row = await prisma.menuCategory.findUniqueOrThrow({ where: { id: categoryId } });
    expect(row.tenantId).toBe(TENANT);
    // The legitimate part of the request still applied — this is a filter, not a rejection.
    expect(row.name).toBe('Renamed');
  });

  it('ignores any other unknown field it is handed', async () => {
    const res = await request(app)
      .patch(`/api/menu/categories/${categoryId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Still fine', id: '00000000-0000-0000-0000-000000000999' });

    expect(res.status).toBe(200);
    // The id in the path wins; the one in the body is not a way to reach another row.
    await expect(
      prisma.menuCategory.findUnique({ where: { id: categoryId } }),
    ).resolves.not.toBeNull();
  });
});

// ── 5. Errors do not describe the schema ──────────────────────────────────────

describe('an unexpected database error', () => {
  it('**tells the caller nothing about the schema**', async () => {
    // Provoked with a real duplicate rather than a mock, so this exercises the same Prisma
    // error a live constraint violation produces.
    await prisma.menuCategory.create({ data: { tenantId: TENANT, name: 'Dupe', sortOrder: 1 } });

    const res = await request(app)
      .post('/api/customers')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ waId: '919999911111', name: 'First' });
    expect([200, 201]).toContain(res.status);

    // The same waId again: unique on (tenantId, waId).
    const dup = await request(app)
      .post('/api/customers')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ waId: '919999911111', name: 'Second' });

    expect(dup.status).toBeGreaterThanOrEqual(400);
    const serialised = JSON.stringify(dup.body);
    // Prisma's own message names the model and the failing constraint. None of it may leave.
    for (const leak of ['tenantId_waId', 'Customer_', 'prisma', 'Invalid `prisma']) {
      expect(serialised, `leaked ${leak}`).not.toContain(leak);
    }
    expect(serialised).not.toContain('stack');
  });
});

// ── 6. The gates that were unreachable now hold ───────────────────────────────

describe('a role holding no permissions', () => {
  it('**cannot read a workflow through the engine route**', async () => {
    // The engine router is mounted before the legacy one, so it answered this URL first and
    // its handler had no permission check — the legacy `workflows:read` gate on the identical
    // path never ran.
    const res = await request(app)
      .get(`/api/workflows/${workflowId}`)
      .set('Authorization', `Bearer ${noPermsToken}`);
    expect(res.status).toBe(403);
  });

  it('**cannot hand a live conversation off, or give it back**', async () => {
    const customer = await prisma.customer.create({
      data: { tenantId: TENANT, waId: '919999922222', name: 'Ravi' },
    });
    const conversation = await prisma.conversation.create({
      data: { tenantId: TENANT, customerId: customer.id, status: 'OPEN' },
    });

    for (const path of ['handoff', 'resume-bot']) {
      // eslint-disable-next-line no-await-in-loop
      const res = await request(app)
        .post(`/api/conversations/${conversation.id}/${path}`)
        .set('Authorization', `Bearer ${noPermsToken}`)
        .send({});
      expect(res.status, path).toBe(403);
    }
  });

  it('the owner can still do both, so the gate is not simply closed', async () => {
    const res = await request(app)
      .get(`/api/workflows/${workflowId}`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
  });
});

// ── 7. Health tells the truth ─────────────────────────────────────────────────

describe('the health endpoint', () => {
  it('reports ok while the database answers', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('**returns 503 when the database does not**', async () => {
    // The property that matters to a load balancer, and the one a blind 200 could never have.
    const spy = vi.spyOn(prisma, '$queryRaw').mockRejectedValueOnce(new Error('no connection'));
    try {
      const res = await request(app).get('/health');
      expect(res.status).toBe(503);
      expect(res.body.status).toBe('unavailable');
    } finally {
      spy.mockRestore();
    }
  });
});

// ── 8. Every response is traceable ────────────────────────────────────────────

describe('request correlation', () => {
  it('returns an id on every response', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['x-request-id']).toMatch(/^[\w-]+$/);
  });

  it('honours the proxy’s id, so one identifier spans the hop', async () => {
    const res = await request(app).get('/health').set('X-Request-Id', 'edge-abc-123');
    expect(res.headers['x-request-id']).toBe('edge-abc-123');
  });

  it('substitutes its own id when the inbound one is not well formed', async () => {
    // The regex is the reason an inbound value can be trusted enough to echo. A newline would
    // be the interesting case, but Node refuses to *send* one, so the reachable version is a
    // value that is legal HTTP and still not an identifier — spaces, punctuation, or something
    // long enough to be a payload rather than a name.
    const hostile = 'id with spaces; and=punctuation';
    const res = await request(app).get('/health').set('X-Request-Id', hostile);
    expect(res.headers['x-request-id']).not.toBe(hostile);
    expect(res.headers['x-request-id']).toMatch(/^[\w-]+$/);
  });

  it('substitutes its own id when the inbound one is absurdly long', async () => {
    const res = await request(app).get('/health').set('X-Request-Id', 'a'.repeat(500));
    expect(res.headers['x-request-id']!.length).toBeLessThan(200);
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
