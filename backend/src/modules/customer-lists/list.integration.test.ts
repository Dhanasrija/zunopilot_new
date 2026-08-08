import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { seedMemberships } from '../../test-support/members.js';
import request from 'supertest';
import { buildApp } from '../../app.js';
import { prisma } from '../../config/prisma.js';
import { signToken } from '../../utils/jwt.js';
import { seedDefaultRoles } from '../../services/role.service.js';
import { previewAudience } from '../marketing/campaign.service.js';

// Curated customer lists.
//
// Two things are being protected. The first is the **workspace boundary**: a list id and
// an array of customer ids both arrive from the client, and the second is the sharper
// edge — taking `customerIds` at face value would let one workspace pull another's
// customers onto its own list and then name that list as a campaign audience.
//
// The second is **consent**. A list is a statement about your marketing, not about
// somebody's permission, so naming one as an audience must not reach a person who opted
// out. That is the test that would matter in a complaint.

const TENANT = '99999999-9999-9999-9999-99999999b001';
const OTHER = '99999999-9999-9999-9999-99999999b002';
const app = buildApp();

let token: string;
let otherToken: string;
let mine: string[];
let theirs: string[];

const wipe = async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [TENANT, OTHER] } } });
};

const makeWorkspace = async (tenantId: string, phone: string) => {
  await prisma.tenant.create({
    data: { id: tenantId, businessName: `Lists ${tenantId.slice(-4)}`, category: 'RESTAURANT' },
  });
  await seedDefaultRoles(prisma, tenantId);
  const ownerRole = await prisma.role.findFirst({
    where: { tenantId, isOwner: true },
    select: { id: true },
  });
  const user = await prisma.user.create({
    data: { tenantId, phone, fullName: 'Owner', role: 'OWNER', roleId: ownerRole?.id },
  });
  return signToken({ userId: user.id, tenantId });
};

const makeCustomers = async (tenantId: string, prefix: string, count: number) => {
  const created = await Promise.all(
    Array.from({ length: count }, (_, i) => prisma.customer.create({
      data: {
        tenantId,
        waId: `${prefix}${String(i).padStart(4, '0')}`,
        name: `Person ${i}`,
        // Consent on by default here so the opt-out test below is about the *filter*
        // rather than about seed data that never consented.
        marketingOptIn: true,
      },
      select: { id: true },
    })),
  );
  return created.map((c) => c.id);
};

beforeEach(async () => {
  await wipe();
  token = await makeWorkspace(TENANT, '15558880001');
  otherToken = await makeWorkspace(OTHER, '15558880002');
  mine = await makeCustomers(TENANT, '15558881', 6);
  theirs = await makeCustomers(OTHER, '15558882', 3);
});

afterAll(async () => {
  await wipe();
  await prisma.$disconnect();
});

const as = (t: string) => ({ Authorization: `Bearer ${t}` });
const newList = async (name = 'Regulars', t = token) => {
  const response = await request(app).post('/api/customer-lists').set(as(t))
    .send({ name }).expect(201);
  return response.body.data.id as string;
};

describe('creating a list', () => {
  it('starts empty and reports its member count', async () => {
    const response = await request(app).post('/api/customer-lists').set(as(token))
      .send({ name: 'Regulars', description: 'People who come back' }).expect(201);
    expect(response.body.data._count.members).toBe(0);
    expect(response.body.data.description).toBe('People who come back');
  });

  it('refuses a duplicate name with something a person can read', async () => {
    await newList('Regulars');
    const response = await request(app).post('/api/customer-lists').set(as(token))
      .send({ name: 'Regulars' }).expect(400);
    // Not the raw Prisma P2002, which names a database index and tells the person typing
    // a name nothing about what to do.
    expect(response.body.message).toContain('already exists');
  });

  it('lets a different workspace use the same name', async () => {
    await newList('Regulars');
    await request(app).post('/api/customer-lists').set(as(otherToken))
      .send({ name: 'Regulars' }).expect(201);
  });

  it('needs a name', async () => {
    await request(app).post('/api/customer-lists').set(as(token)).send({ name: '  ' }).expect(400);
  });
});

describe('the workspace boundary', () => {
  it("404s another workspace's list", async () => {
    const listId = await newList('Regulars');
    await request(app).get(`/api/customer-lists/${listId}`).set(as(otherToken)).expect(404);
    await request(app).patch(`/api/customer-lists/${listId}`).set(as(otherToken))
      .send({ name: 'Renamed' }).expect(404);
    await request(app).delete(`/api/customer-lists/${listId}`).set(as(otherToken)).expect(404);
    await request(app).get(`/api/customer-lists/${listId}/members`).set(as(otherToken)).expect(404);
  });

  it("**does not add another workspace's customers**", async () => {
    // The case that actually leaks. `customerIds` is an array of primary keys from the
    // client; taken at face value it would put a stranger's customers on this list, and
    // then a campaign could name the list as its audience.
    const listId = await newList('Regulars');
    const response = await request(app).post(`/api/customer-lists/${listId}/members`)
      .set(as(token))
      .send({ customerIds: [...mine.slice(0, 2), ...theirs] })
      .expect(200);

    expect(response.body.data.changed).toBe(2);
    // Reported rather than silently swallowed.
    expect(response.body.data.rejected).toBe(3);

    const members = await prisma.customerListMember.findMany({
      where: { listId },
      select: { customerId: true },
    });
    expect(members.map((m) => m.customerId).sort()).toEqual(mine.slice(0, 2).sort());
  });

  it('does not list another workspace\'s lists', async () => {
    await newList('Mine');
    await newList('Theirs', otherToken);
    const response = await request(app).get('/api/customer-lists').set(as(token)).expect(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].name).toBe('Mine');
  });

  it('refuses an unauthenticated request', async () => {
    await request(app).get('/api/customer-lists').expect(401);
  });
});

describe('membership', () => {
  it('is idempotent, so adding twice leaves one row', async () => {
    const listId = await newList();
    await request(app).post(`/api/customer-lists/${listId}/members`).set(as(token))
      .send({ customerIds: mine.slice(0, 3) }).expect(200);
    const again = await request(app).post(`/api/customer-lists/${listId}/members`).set(as(token))
      .send({ customerIds: mine.slice(0, 3) }).expect(200);

    // Nothing changed the second time, and nothing broke either — the request can be
    // retried.
    expect(again.body.data.changed).toBe(0);
    expect(await prisma.customerListMember.count({ where: { listId } })).toBe(3);
  });

  it('removes without touching the customer', async () => {
    const listId = await newList();
    await request(app).post(`/api/customer-lists/${listId}/members`).set(as(token))
      .send({ customerIds: mine }).expect(200);

    await request(app).delete(`/api/customer-lists/${listId}/members`).set(as(token))
      .send({ customerIds: mine.slice(0, 2) }).expect(200);

    expect(await prisma.customerListMember.count({ where: { listId } })).toBe(4);
    // Still customers. Removing from a list is not deleting a person.
    expect(await prisma.customer.count({ where: { tenantId: TENANT } })).toBe(6);
  });

  it('rejects an empty change rather than succeeding at nothing', async () => {
    const listId = await newList();
    await request(app).post(`/api/customer-lists/${listId}/members`).set(as(token))
      .send({ customerIds: [] }).expect(400);
  });

  it('paginates members with a true total', async () => {
    const listId = await newList();
    await request(app).post(`/api/customer-lists/${listId}/members`).set(as(token))
      .send({ customerIds: mine }).expect(200);

    const response = await request(app)
      .get(`/api/customer-lists/${listId}/members?take=4&skip=0`).set(as(token)).expect(200);
    expect(response.body.data).toHaveLength(4);
    expect(response.body.meta).toEqual({ total: 6, take: 4, skip: 0 });
  });

  it('surfaces consent on each member, so the screen can be honest', async () => {
    const listId = await newList();
    await prisma.customer.update({ where: { id: mine[0]! }, data: { marketingOptIn: false } });
    await request(app).post(`/api/customer-lists/${listId}/members`).set(as(token))
      .send({ customerIds: mine }).expect(200);

    const response = await request(app)
      .get(`/api/customer-lists/${listId}/members?take=50`).set(as(token)).expect(200);
    const optedIn = response.body.data.filter(
      (m: { customer: { marketingOptIn: boolean } }) => m.customer.marketingOptIn,
    );
    expect(optedIn).toHaveLength(5);
  });
});

describe('deleting a list', () => {
  it('**keeps every customer**', async () => {
    const listId = await newList();
    await request(app).post(`/api/customer-lists/${listId}/members`).set(as(token))
      .send({ customerIds: mine }).expect(200);

    const response = await request(app).delete(`/api/customer-lists/${listId}`)
      .set(as(token)).expect(200);
    expect(response.body.data).toEqual({ deleted: true, customersKept: true });

    expect(await prisma.customerListMember.count({ where: { listId } })).toBe(0);
    expect(await prisma.customer.count({ where: { tenantId: TENANT } })).toBe(6);
  });
});

describe('deleting a customer', () => {
  it('takes their memberships with them, leaving no orphan rows', async () => {
    const listId = await newList();
    await request(app).post(`/api/customer-lists/${listId}/members`).set(as(token))
      .send({ customerIds: mine }).expect(200);

    await prisma.customer.delete({ where: { id: mine[0]! } });
    expect(await prisma.customerListMember.count({ where: { listId } })).toBe(5);
  });
});

describe('GET /api/customers?listId=', () => {
  it('narrows to the list and totals the list, not the workspace', async () => {
    const listId = await newList();
    await request(app).post(`/api/customer-lists/${listId}/members`).set(as(token))
      .send({ customerIds: mine.slice(0, 4) }).expect(200);

    const response = await request(app)
      .get(`/api/customers?listId=${listId}&take=10`).set(as(token)).expect(200);
    expect(response.body.meta.total).toBe(4);
  });

  it('composes with search', async () => {
    const listId = await newList();
    await request(app).post(`/api/customer-lists/${listId}/members`).set(as(token))
      .send({ customerIds: mine }).expect(200);

    const response = await request(app)
      .get(`/api/customers?listId=${listId}&search=Person%201&take=10`).set(as(token)).expect(200);
    // "Person 1" only — 2 through 5 do not contain it, and neither does "Person 0".
    expect(response.body.meta.total).toBe(1);
  });

  it("returns nothing for another workspace's list id", async () => {
    const listId = await newList();
    await request(app).post(`/api/customer-lists/${listId}/members`).set(as(token))
      .send({ customerIds: mine }).expect(200);

    const response = await request(app)
      .get(`/api/customers?listId=${listId}&take=10`).set(as(otherToken)).expect(200);
    expect(response.body.meta.total).toBe(0);
  });
});

describe('a list as a campaign audience', () => {
  it('reaches the people on it', async () => {
    const listId = await newList();
    await request(app).post(`/api/customer-lists/${listId}/members`).set(as(token))
      .send({ customerIds: mine.slice(0, 4) }).expect(200);

    const preview = await previewAudience(TENANT, { listIds: [listId] });
    expect(preview.reachable).toBe(4);
  });

  it('**still excludes somebody who opted out**', async () => {
    // The invariant. Consent is applied outside the filter, so no combination of inputs —
    // a curated list included — reaches a person who said stop. Putting them on a list
    // does not put them back in.
    const listId = await newList();
    await request(app).post(`/api/customer-lists/${listId}/members`).set(as(token))
      .send({ customerIds: mine.slice(0, 4) }).expect(200);

    await prisma.customer.update({
      where: { id: mine[0]! },
      data: { optedOutAt: new Date() },
    });
    await prisma.customer.update({
      where: { id: mine[1]! },
      data: { marketingOptIn: false },
    });

    const preview = await previewAudience(TENANT, { listIds: [listId] });
    expect(preview.reachable).toBe(2);
    // And they are counted, so nobody reads "2 reachable" and assumes the list has 2
    // people on it.
    expect(preview.excludedNoConsent).toBe(2);
  });

  it('scopes the excluded count to the same filter as the reachable one', async () => {
    // Two customers off the list have no consent. They must not inflate the excluded
    // count for a list-filtered audience, or the denominator describes a different
    // population than the number beside it.
    const listId = await newList();
    await request(app).post(`/api/customer-lists/${listId}/members`).set(as(token))
      .send({ customerIds: mine.slice(0, 2) }).expect(200);
    await prisma.customer.updateMany({
      where: { id: { in: mine.slice(4) } },
      data: { marketingOptIn: false },
    });

    const preview = await previewAudience(TENANT, { listIds: [listId] });
    expect(preview.reachable).toBe(2);
    expect(preview.excludedNoConsent).toBe(0);
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
