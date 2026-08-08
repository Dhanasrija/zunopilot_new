import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { seedMemberships } from '../../test-support/members.js';
import request from 'supertest';
import { prisma } from '../../config/prisma.js';
import { buildApp } from '../../app.js';
import { signToken } from '../../utils/jwt.js';
import { ROLE_PERMISSIONS } from '../../config/permissions.js';

// Switching selling off for a workspace that does not sell.
//
// **The nav is not the control.** Hiding "Orders" and "Menu" from the sidebar is a courtesy to
// whoever is looking at it; the thing that has to hold is that the API refuses, because a typed
// URL, a stale bookmark or a bored developer with a network tab all bypass a hidden link. So
// every assertion here is against the endpoints, and the nav is left to the frontend's own
// `RequireCapability`.
//
// The other half is backward compatibility: every workspace can see Orders and Menu today, so
// the module has to default ON or this feature takes them away from all of them on deploy.

const app = buildApp();

const TENANT = 'dddddddd-d000-0000-0000-00000000d001';

let ownerToken: string;

/** Everything selling reaches through. */
const SELLING_ROUTES = [
  { name: 'orders list', method: 'get' as const, path: '/api/orders' },
  { name: 'orders summary', method: 'get' as const, path: '/api/orders/summary' },
  { name: 'menu categories', method: 'get' as const, path: '/api/menu/categories' },
  { name: 'menu items', method: 'get' as const, path: '/api/menu/items' },
  { name: 'addon groups', method: 'get' as const, path: '/api/menu/addon-groups' },
];

const wipe = () => prisma.tenant.deleteMany({ where: { id: TENANT } });

const seed = async () => {
  const tenant = await prisma.tenant.create({
    data: {
      id: TENANT,
      businessName: 'Bright Futures Clinic',
      category: 'RESTAURANT',
      roles: {
        create: [{
          name: 'Owner', permissions: [...ROLE_PERMISSIONS.OWNER], isOwner: true, isSystem: true,
        }],
      },
      users: { create: [{ phone: '15550008001', fullName: 'Owner', role: 'OWNER' }] },
    },
    include: { users: true, roles: true },
  });
  await prisma.user.update({
    where: { id: tenant.users[0].id },
    data: { roleId: tenant.roles[0].id },
  });
  ownerToken = signToken({ userId: tenant.users[0].id });
};

const setSelling = (enabled: boolean) => prisma.tenantModule.upsert({
  where: { tenantId_module: { tenantId: TENANT, module: 'ECOMMERCE' } },
  update: { enabled },
  create: { tenantId: TENANT, module: 'ECOMMERCE', enabled },
});

beforeEach(async () => {
  await wipe();
  await seed();
});

afterAll(async () => {
  await wipe();
  await prisma.$disconnect();
});

describe('a workspace that sells', () => {
  it('**reaches Orders and Menu with no module row at all**', async () => {
    // The backward-compatibility claim, and the reason this module defaults on. A workspace that
    // existed before this feature has no `TenantModule` row, and must be unaffected by it.
    expect(await prisma.tenantModule.findFirst({ where: { tenantId: TENANT } })).toBeNull();

    for (const route of SELLING_ROUTES) {
      // eslint-disable-next-line no-await-in-loop
      const res = await request(app)[route.method](route.path)
        .set('Authorization', `Bearer ${ownerToken}`);
      expect(res.status, `${route.name} should be reachable`).toBe(200);
    }
  });

  it('carries ECOMMERCE in the session, so the nav renders it', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(res.body.data.modules).toContain('ECOMMERCE');
  });
});

describe('a workspace with selling switched off', () => {
  it('**cannot reach any of it, hidden nav or not**', async () => {
    await setSelling(false);

    for (const route of SELLING_ROUTES) {
      // eslint-disable-next-line no-await-in-loop
      const res = await request(app)[route.method](route.path)
        .set('Authorization', `Bearer ${ownerToken}`);
      // 404 rather than 403, matching every other module gate: 403 confirms the feature exists
      // and this workspace may not have it, which is a thing an operator may not want disclosed.
      expect(res.status, `${route.name} should refuse`).toBe(404);
    }
  });

  it('refuses writes too, not only the screens someone can see', async () => {
    // The reads are what the nav links to, so they are the ones that get tested and the writes
    // are the ones that get forgotten.
    await setSelling(false);

    await request(app)
      .post('/api/menu/categories')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Starters' })
      .expect(404);

    await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ customerName: 'Someone', items: [] })
      .expect(404);
  });

  it('drops ECOMMERCE from the session, so the nav hides both entries', async () => {
    await setSelling(false);

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(res.body.data.modules).not.toContain('ECOMMERCE');
  });

  it('**still answers 401 before 404 for a request with no token**', async () => {
    // Order matters: if the module gate ran first, an unauthenticated caller could probe which
    // workspaces sell things.
    await setSelling(false);
    await request(app).get('/api/orders').expect(401);
  });

  it('leaves the data alone, so switching it back on restores everything', async () => {
    // A rollout switch that deleted a workspace's catalogue would be one nobody could use.
    const category = await prisma.menuCategory.create({
      data: { tenantId: TENANT, name: 'Mains' },
    });

    await setSelling(false);
    await request(app).get('/api/menu/categories')
      .set('Authorization', `Bearer ${ownerToken}`).expect(404);

    await setSelling(true);
    const res = await request(app).get('/api/menu/categories')
      .set('Authorization', `Bearer ${ownerToken}`).expect(200);
    expect(res.body.data.map((c: { id: string }) => c.id)).toContain(category.id);
  });

  it('does not touch anything else the workspace has', async () => {
    // Selling is off; the Inbox and Customers are not part of it and must keep working.
    await setSelling(false);

    await request(app).get('/api/customers')
      .set('Authorization', `Bearer ${ownerToken}`).expect(200);
    await request(app).get('/api/inbox/conversations')
      .set('Authorization', `Bearer ${ownerToken}`).expect(200);
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
