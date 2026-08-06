import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { prisma } from '../config/prisma.js';
import { buildApp } from '../app.js';
import { signToken } from '../utils/jwt.js';
import { ROLE_PERMISSIONS } from '../config/permissions.js';
import { NODE_CONFIG_SCHEMAS } from '../modules/conversation-engine/domain/node-types.js';

// Renaming /api/menu to /api/catalogue, without breaking anyone mid-flight.
//
// "Menu" is a restaurant word and this platform also serves groceries and consultancies. The
// permission keys were `catalogue:*` all along; only the path lagged.
//
// Two things have to hold, and neither is about the new path working — that part is easy:
//
//   • **The old path keeps working.** The API and the frontend deploy separately, so a browser
//     holding the previous bundle will call `/api/menu` against a backend that has moved. An
//     untested compatibility alias is not a compatibility alias.
//
//   • **Published workflows still run.** `menu_categories` and `menu_items` are *persisted
//     inside workflow definitions*, not route names. A rename that swept them up would break
//     every live flow with a catalogue-sourced list node, silently and only at send time.

const app = buildApp();

const TENANT = 'eeeeeeee-f000-0000-0000-00000000f001';

let ownerToken: string;
let categoryId: string;

const wipe = () => prisma.tenant.deleteMany({ where: { id: TENANT } });

const seed = async () => {
  const tenant = await prisma.tenant.create({
    data: {
      id: TENANT,
      businessName: 'Rename Test Co',
      category: 'RESTAURANT',
      roles: {
        create: [{
          name: 'Owner', permissions: [...ROLE_PERMISSIONS.OWNER], isOwner: true, isSystem: true,
        }],
      },
      users: { create: [{ phone: '15550007701', fullName: 'Owner', role: 'OWNER' }] },
    },
    include: { users: true, roles: true },
  });
  await prisma.user.update({
    where: { id: tenant.users[0].id },
    data: { roleId: tenant.roles[0].id },
  });
  ownerToken = signToken({ userId: tenant.users[0].id });

  categoryId = (await prisma.menuCategory.create({
    data: { tenantId: TENANT, name: 'Mains' },
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

const auth = () => ({ Authorization: `Bearer ${ownerToken}` });

describe('the catalogue API', () => {
  it('answers on /api/catalogue', async () => {
    const res = await request(app).get('/api/catalogue/categories').set(auth()).expect(200);
    expect(res.body.data.map((c: { id: string }) => c.id)).toContain(categoryId);
  });

  it('**still answers on the old /api/menu**, so a stale browser bundle keeps working', async () => {
    // The alias is the rollout safety net. The tiers deploy separately; without this, everyone
    // with the app already open breaks the moment the backend ships.
    const res = await request(app).get('/api/menu/categories').set(auth()).expect(200);
    expect(res.body.data.map((c: { id: string }) => c.id)).toContain(categoryId);
  });

  it('returns identical data from both paths', async () => {
    const [fresh, legacy] = await Promise.all([
      request(app).get('/api/catalogue/items').set(auth()).expect(200),
      request(app).get('/api/menu/items').set(auth()).expect(200),
    ]);
    expect(legacy.body).toEqual(fresh.body);
  });

  it('carries writes on the new path', async () => {
    await request(app).post('/api/catalogue/categories')
      .set(auth()).send({ name: 'Desserts' }).expect(201);

    const res = await request(app).get('/api/catalogue/categories').set(auth()).expect(200);
    expect(res.body.data.map((c: { name: string }) => c.name)).toContain('Desserts');
  });

  it('**enforces the Selling module on the new path too**', async () => {
    // The gate lives on the router, so mounting it at a second path could have left one side
    // ungated — the sort of thing that only shows up when somebody guesses the URL.
    await prisma.tenantModule.create({
      data: { tenantId: TENANT, module: 'ECOMMERCE', enabled: false },
    });

    await request(app).get('/api/catalogue/categories').set(auth()).expect(404);
    await request(app).get('/api/menu/categories').set(auth()).expect(404);
  });

  it('still refuses an unauthenticated request on both', async () => {
    await request(app).get('/api/catalogue/categories').expect(401);
    await request(app).get('/api/menu/categories').expect(401);
  });
});

describe('what the rename must not have touched', () => {
  it('**still accepts menu_categories and menu_items as workflow list sources**', async () => {
    /*
     * These are values persisted inside published workflow definitions, not route names. A
     * search-and-replace that renamed them would leave every live flow with a catalogue-sourced
     * list node failing at send time, which is both invisible until a customer hits it and
     * unfixable without a data migration.
     */
    // Parsed rather than string-matched. A Zod schema does not serialise its enum values, so
    // `JSON.stringify(schema).toContain(...)` would have passed against a schema that had
    // dropped them entirely — a test that cannot fail for the reason it exists.
    const listMessage = NODE_CONFIG_SCHEMAS.LIST_MESSAGE;

    for (const source of ['menu_categories', 'menu_items'] as const) {
      const parsed = listMessage.safeParse({
        body: 'Pick one', buttonLabel: 'View', variableName: 'choice', source, rows: [],
      });
      expect(parsed.success, `LIST_MESSAGE should still accept source: ${source}`).toBe(true);
    }

    // And the opposite, so the assertion above is not vacuous.
    expect(listMessage.safeParse({
      body: 'Pick one', buttonLabel: 'View', variableName: 'choice',
      source: 'catalogue_categories', rows: [],
    }).success).toBe(false);
  });

  it('keeps the catalogue:* permission keys, which were always the generic name', async () => {
    const { PERMISSIONS } = await import('../config/permissions.js');
    expect(PERMISSIONS).toContain('catalogue:read');
    expect(PERMISSIONS).toContain('catalogue:write');
  });
});

describe('what a business calls its catalogue', () => {
  it('comes back on the session, defaulted rather than left null', async () => {
    // Defaulted on the server so every caller gets the same word and an unconfigured category
    // reads "Catalogue" rather than a restaurant's "Menu".
    const res = await request(app).get('/api/auth/me').set(auth()).expect(200);
    expect(res.body.data.tenant.catalogueNoun).toBeTruthy();
    expect(res.body.data.tenant.catalogueItemNoun).toBeTruthy();
  });

  it('**reads "Catalogue" for a workspace whose category says nothing**', async () => {
    // The safe failure: generic, never another category's word.
    await prisma.tenant.update({
      where: { id: TENANT },
      data: { businessCategoryId: null },
    });

    const res = await request(app).get('/api/auth/me').set(auth()).expect(200);
    expect(res.body.data.tenant.catalogueNoun).toBe('Catalogue');
    expect(res.body.data.tenant.catalogueItemNoun).toBe('Item');
  });

  it('uses the category’s own words when it has them', async () => {
    const grocery = await prisma.businessCategory.findUnique({
      where: { key: 'ECOMMERCE_GROCERY' },
    });
    expect(grocery?.catalogueNoun, 'the migration should have seeded this').toBe('Products');

    await prisma.tenant.update({
      where: { id: TENANT },
      data: { businessCategoryId: grocery!.id },
    });

    const res = await request(app).get('/api/auth/me').set(auth()).expect(200);
    expect(res.body.data.tenant.catalogueNoun).toBe('Products');
    expect(res.body.data.tenant.catalogueItemNoun).toBe('Product');
  });
});
