import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { Prisma } from '@prisma/client';
import { buildApp } from '../app.js';
import { prisma } from '../config/prisma.js';
import { signToken } from '../utils/jwt.js';
import { seedDefaultRoles } from '../services/role.service.js';

// Pagination on the order and customer lists.
//
// The behaviour under test is not "does `skip` work" — it is that **the numbers the UI
// shows are true above the old 200-row cap**. Both endpoints used to answer with a bare
// `take: 200` and no total, and the pages filtered, paged and summed that array in the
// browser. So a workspace with more orders than the cap saw a pagination control that
// looked correct while covering a truncated set, and a revenue figure that was simply
// the sum of the first 200 rows.
//
// Hence the row count below: 240 is deliberately more than 200, because every assertion
// worth making here is invisible under it.

const TENANT = '99999999-9999-9999-9999-9999999900aa';
const app = buildApp();

const ORDER_COUNT = 240;
const CUSTOMER_COUNT = 12;

let token: string;
/** Set on 3 orders, to prove search reaches SQL rather than filtering a page. */
const NEEDLE_NAME = 'Zzyzx Searchtarget';

const wipe = async () => {
  // Orders first. `OrderItem.itemId` points at `MenuItem` **without** a cascade, so
  // dropping the tenant tries to delete the menu items out from under rows that still
  // reference them and the foreign key refuses. Deleting the orders takes their items
  // with them (that relation does cascade) and clears the way.
  await prisma.order.deleteMany({ where: { tenantId: TENANT } });
  await prisma.tenant.deleteMany({ where: { id: TENANT } });
};

beforeAll(async () => {
  await wipe();
  await prisma.tenant.create({
    data: { id: TENANT, businessName: 'Pagination Test', category: 'RESTAURANT' },
  });
  await seedDefaultRoles(prisma, TENANT);
  const ownerRole = await prisma.role.findFirst({
    where: { tenantId: TENANT, isOwner: true },
    select: { id: true },
  });
  const user = await prisma.user.create({
    data: {
      tenantId: TENANT,
      phone: '15557770001',
      fullName: 'Pagination Owner',
      role: 'OWNER',
      roleId: ownerRole?.id,
    },
  });
  token = signToken({ userId: user.id, tenantId: TENANT });

  const category = await prisma.menuCategory.create({
    data: { tenantId: TENANT, name: 'Mains' },
  });
  const item = await prisma.menuItem.create({
    data: {
      tenantId: TENANT,
      categoryId: category.id,
      name: 'Test Biryani',
      basePrice: new Prisma.Decimal(100),
    },
  });

  const customers = await Promise.all(
    Array.from({ length: CUSTOMER_COUNT }, (_, i) => prisma.customer.create({
      data: {
        tenantId: TENANT,
        waId: `1555777${String(i + 100).padStart(4, '0')}`,
        name: `Customer ${i}`,
        lastSeenAt: new Date(Date.now() - i * 86_400_000),
      },
    })),
  );

  const DAY = 86_400_000;
  // Every order is ₹100 exactly, so the expected revenue is arithmetic rather than a
  // number copied out of a previous run.
  for (let i = 0; i < ORDER_COUNT; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await prisma.order.create({
      data: {
        tenantId: TENANT,
        customerId: customers[i % customers.length]!.id,
        // A spread of statuses, with exactly 40 DELIVERED so the summary is checkable.
        status: i < 40 ? 'DELIVERED' : i < 80 ? 'NEW' : i < 120 ? 'PREPARING' : i < 160 ? 'ACCEPTED' : 'CANCELLED',
        customerName: i < 3 ? NEEDLE_NAME : `Buyer ${i}`,
        contactPhone: '15557770099',
        deliveryAddress: 'Somewhere',
        subtotal: new Prisma.Decimal(100),
        totalAmount: new Prisma.Decimal(100),
        items: {
          create: [{
            itemId: item.id,
            itemName: 'Test Biryani',
            quantity: 1,
            unitPrice: new Prisma.Decimal(100),
            lineTotal: new Prisma.Decimal(100),
          }],
        },
        // Half today, half well in the past, so a date bound actually splits the set.
        placedAt: i < 120 ? new Date() : new Date(Date.now() - 30 * DAY),
      },
    });
  }
}, 120_000);

afterAll(async () => {
  await wipe();
  await prisma.$disconnect();
});

const get = (path: string) =>
  request(app).get(path).set('Authorization', `Bearer ${token}`);

describe('GET /api/orders', () => {
  it('**reports a total above the old 200 cap**', async () => {
    // The assertion the whole change exists for. Before, this endpoint could not
    // describe more than 200 orders and did not say so.
    const response = await get('/api/orders?take=10&skip=0').expect(200);
    expect(response.body.data).toHaveLength(10);
    expect(response.body.meta).toEqual({ total: ORDER_COUNT, take: 10, skip: 0 });
  });

  it('reaches the last page, which the cap made unreachable', async () => {
    const response = await get(`/api/orders?take=10&skip=${ORDER_COUNT - 5}`).expect(200);
    expect(response.body.data).toHaveLength(5);
    expect(response.body.meta.total).toBe(ORDER_COUNT);
  });

  it('does not clamp skip to 200', async () => {
    // `queryInt`'s 200 default max would have pinned every page past 20 here.
    const response = await get('/api/orders?take=10&skip=230').expect(200);
    expect(response.body.data).toHaveLength(10);
  });

  it('returns an empty page past the end rather than erroring', async () => {
    const response = await get('/api/orders?take=10&skip=99999').expect(200);
    expect(response.body.data).toEqual([]);
    expect(response.body.meta.total).toBe(ORDER_COUNT);
  });

  it('caps take, so one request cannot ask for the whole table', async () => {
    const response = await get('/api/orders?take=9999').expect(200);
    expect(response.body.meta.take).toBe(200);
    expect(response.body.data.length).toBeLessThanOrEqual(200);
  });

  it('filters by status in SQL, and the total reflects the filter', async () => {
    const response = await get('/api/orders?status=DELIVERED&take=5').expect(200);
    expect(response.body.meta.total).toBe(40);
    expect(response.body.data).toHaveLength(5);
    expect(response.body.data.every((o: { status: string }) => o.status === 'DELIVERED')).toBe(true);
  });

  it('ignores an unknown status rather than returning nothing', async () => {
    // `queryEnum` drops it, so this must not become `status: 'NONSENSE'` in the where.
    const response = await get('/api/orders?status=NONSENSE&take=1').expect(200);
    expect(response.body.meta.total).toBe(ORDER_COUNT);
  });

  it('honours a date range with both bounds', async () => {
    // Yesterday needs a ceiling as well as a floor; `since` alone cannot express it.
    const now = Date.now();
    const since = new Date(now - 40 * 86_400_000).toISOString();
    const until = new Date(now - 20 * 86_400_000).toISOString();
    const response = await get(`/api/orders?since=${since}&until=${until}&take=1`).expect(200);
    expect(response.body.meta.total).toBe(ORDER_COUNT - 120);
  });

  it('searches by customer name across the whole table, not one page', async () => {
    const response = await get(`/api/orders?search=${encodeURIComponent(NEEDLE_NAME)}&take=50`).expect(200);
    expect(response.body.meta.total).toBe(3);
  });

  it('searches by exact order number when the query is numeric', async () => {
    const first = await get('/api/orders?take=1').expect(200);
    const { orderNumber } = first.body.data[0];
    const response = await get(`/api/orders?search=${orderNumber}&take=5`).expect(200);
    expect(response.body.meta.total).toBe(1);
    expect(response.body.data[0].orderNumber).toBe(orderNumber);
  });

  it('does not throw when a non-numeric search meets the Int column', async () => {
    // `orderNumber` is an Int: an `equals` against a non-number fails in the driver, so
    // the term has to be omitted rather than coerced.
    await get('/api/orders?search=not-a-number').expect(200);
  });

  it('narrows when filters are combined', async () => {
    const since = new Date(Date.now() - 1 * 86_400_000).toISOString();
    const response = await get(`/api/orders?status=DELIVERED&since=${since}&take=1`).expect(200);
    // The 40 DELIVERED orders are all in the recent half, so this stays 40 — the point
    // is that combining does not widen or reset the filter.
    expect(response.body.meta.total).toBe(40);
  });
});

describe('GET /api/orders/summary', () => {
  it('**sums revenue over every order, not the page**', async () => {
    // 240 orders at ₹100. The old client-side figure would have been ₹20,000 — the sum
    // of the 200 rows that fit under the cap.
    const response = await get('/api/orders/summary').expect(200);
    expect(Number(response.body.data.revenue)).toBe(ORDER_COUNT * 100);
    expect(response.body.data.total).toBe(ORDER_COUNT);
  });

  it('counts each status side by side', async () => {
    const response = await get('/api/orders/summary').expect(200);
    expect(response.body.data.delivered).toBe(40);
    expect(response.body.data.newOrders).toBe(40);
    // Accepted and preparing are one "in the kitchen" number, as the card has always
    // shown: 40 + 40.
    expect(response.body.data.preparing).toBe(80);
  });

  it('honours the date filter but not a status filter', async () => {
    const since = new Date(Date.now() - 1 * 86_400_000).toISOString();
    const dated = await get(`/api/orders/summary?since=${since}`).expect(200);
    expect(dated.body.data.total).toBe(120);

    // A status parameter must not narrow it, or the cards would each show the count of
    // whichever status was selected.
    const withStatus = await get(`/api/orders/summary?since=${since}&status=DELIVERED`).expect(200);
    expect(withStatus.body.data.total).toBe(120);
  });
});

describe('GET /api/customers', () => {
  it('paginates and reports the true total', async () => {
    const response = await get('/api/customers?take=5&skip=0').expect(200);
    expect(response.body.data).toHaveLength(5);
    expect(response.body.meta).toEqual({ total: CUSTOMER_COUNT, take: 5, skip: 0 });
  });

  it('keeps search composing with paging, and totals the search not the page', async () => {
    const response = await get('/api/customers?search=Customer%201&take=2').expect(200);
    // "Customer 1", "Customer 10" and "Customer 11" — a total the client could not have
    // known without fetching everything.
    expect(response.body.meta.total).toBe(3);
    expect(response.body.data).toHaveLength(2);
  });

  it('still returns the order and message counts the list renders', async () => {
    const response = await get('/api/customers?take=1').expect(200);
    expect(response.body.data[0]._count).toHaveProperty('orders');
    expect(response.body.data[0]._count).toHaveProperty('messages');
  });

  it('pages in a stable order, so a row cannot appear twice or be skipped', async () => {
    const first = await get('/api/customers?take=6&skip=0').expect(200);
    const second = await get('/api/customers?take=6&skip=6').expect(200);
    const ids = [...first.body.data, ...second.body.data].map((c: { id: string }) => c.id);
    expect(new Set(ids).size).toBe(CUSTOMER_COUNT);
  });
});
