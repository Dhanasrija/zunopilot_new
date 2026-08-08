import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { seedMemberships } from '../test-support/members.js';
import request from 'supertest';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma.js';
import { buildApp } from '../app.js';
import { signToken } from '../utils/jwt.js';
import { ROLE_PERMISSIONS } from '../config/permissions.js';

// Number masking, asserted the only way that means anything.
//
// **The whole suite turns on one idea: never assert that a *field* is masked.** A
// field-by-field check passes happily while a nested `include` ships the number one level
// down — which is exactly how it reached the browser on Orders, a screen nobody thought of
// as showing a phone number. So every test here serialises the entire response and asserts
// the digits are absent from it.
//
// That formulation is what caught `Order.contactPhone`, a denormalised copy of the number on
// the order row, sitting beside a customer that *was* being masked.
//
// The three axes, all of which must hold:
//
//   • **agent + masking on**  → no full number anywhere
//   • **owner + masking on**  → the real number, because the owner runs the business
//   • **anyone + masking off** → unchanged from before this feature existed

const app = buildApp();

const TENANT = 'eeeeeeee-e000-0000-0000-00000000e001';
const WA_ID = '917702009876';
/** The last four are deliberately visible, so a substring check must use the full string. */
const FULL_DIGITS = WA_ID;

let ownerToken: string;
let agentToken: string;
let customerId: string;
let conversationId: string;
let orderId: string;
let ticketId: string;
let listId: string;

const wipe = () => prisma.tenant.deleteMany({ where: { id: TENANT } });

/** Everything a masked agent could reach a number through. */
const surfaces = () => [
  { name: 'customers list', path: '/api/customers' },
  { name: 'customer detail', path: `/api/customers/${customerId}` },
  { name: 'conversations list', path: '/api/inbox/conversations' },
  { name: 'conversation detail', path: `/api/inbox/conversations/${conversationId}` },
  { name: 'orders list', path: '/api/orders' },
  { name: 'order detail', path: `/api/orders/${orderId}` },
  { name: 'tickets list', path: '/api/tickets' },
  { name: 'ticket detail', path: `/api/tickets/${ticketId}` },
  { name: 'list members', path: `/api/customer-lists/${listId}/members` },
];

const seed = async () => {
  const tenant = await prisma.tenant.create({
    data: {
      id: TENANT,
      businessName: 'Masking Kitchen',
      category: 'RESTAURANT',
      // On from the start for most tests; the "off" block turns it back.
      maskCustomerNumbers: true,
      roles: {
        create: [
          { name: 'Owner', permissions: [...ROLE_PERMISSIONS.OWNER], isOwner: true, isSystem: true },
          // A real Agent role: everything an agent normally holds, which deliberately does
          // **not** include `customers:view_full_number`.
          { name: 'Agent', permissions: [...ROLE_PERMISSIONS.AGENT], sortOrder: 30 },
        ],
      },
      users: {
        create: [
          { phone: '15550009971', fullName: 'Owner', role: 'OWNER' },
          { phone: '15550009972', fullName: 'Agent', role: 'AGENT' },
        ],
      },
      // Support and the lists screen are gated by module, so both have to be on for their
      // endpoints to be reachable at all rather than 404.
      modules: { create: [{ module: 'SUPPORT', enabled: true }] },
    },
    include: { users: { orderBy: { phone: 'asc' } }, roles: true },
  });

  const owner = tenant.users[0];
  const agent = tenant.users[1];
  const ownerRole = tenant.roles.find((r) => r.isOwner)!;
  const agentRole = tenant.roles.find((r) => !r.isOwner)!;
  await prisma.user.update({ where: { id: owner.id }, data: { roleId: ownerRole.id } });
  await prisma.user.update({ where: { id: agent.id }, data: { roleId: agentRole.id } });
  ownerToken = signToken({ userId: owner.id });
  agentToken = signToken({ userId: agent.id });

  const customer = await prisma.customer.create({
    data: { tenantId: TENANT, waId: WA_ID, name: 'Asha Patel', phone: WA_ID },
  });
  customerId = customer.id;

  conversationId = (await prisma.conversation.create({
    data: { tenantId: TENANT, customerId: customer.id, status: 'OPEN' },
  })).id;

  // `contactPhone` set exactly as checkout sets it — this is the field the whole-payload
  // assertion exists to catch.
  orderId = (await prisma.order.create({
    data: {
      tenantId: TENANT,
      customerId: customer.id,
      customerName: 'Asha Patel',
      contactPhone: WA_ID,
      deliveryAddress: '1 Test Street',
      subtotal: new Prisma.Decimal(100),
      totalAmount: new Prisma.Decimal(100),
    },
  })).id;

  ticketId = (await prisma.ticket.create({
    data: {
      tenantId: TENANT,
      number: 'TKT-9001',
      sequence: 9001,
      subject: 'Where is my order',
      body: 'Asking about the order',
      customerId: customer.id,
      conversationId,
      openedById: agent.id,
    },
  })).id;

  const list = await prisma.customerList.create({
    data: { tenantId: TENANT, name: 'Regulars', createdByUserId: owner.id },
  });
  listId = list.id;
  await prisma.customerListMember.create({
    data: { listId: list.id, customerId: customer.id },
  });
};

beforeEach(async () => {
  await wipe();
  await seed();
});

afterAll(async () => {
  await wipe();
  await prisma.$disconnect();
});

const get = (path: string, token: string) =>
  request(app).get(path).set('Authorization', `Bearer ${token}`);

const setMasking = (on: boolean) =>
  prisma.tenant.update({ where: { id: TENANT }, data: { maskCustomerNumbers: on } });

describe('an agent, with masking on', () => {
  it('**gets no full number from any surface**', async () => {
    // The load-bearing test. Whole-payload, not field-by-field.
    for (const { name, path } of surfaces()) {
      // eslint-disable-next-line no-await-in-loop
      const res = await get(path, agentToken);
      expect(res.status, `${name} should be reachable`).toBe(200);
      expect(JSON.stringify(res.body), `${name} leaked the number`).not.toContain(FULL_DIGITS);
    }
  });

  it('still gets a usable last four, so the screens remain workable', async () => {
    const res = await get('/api/customers', agentToken);
    const [customer] = res.body.data;
    expect(customer.waId).toBe('+••••••••9876');
    expect(customer.numberMasked).toBe(true);
    // The name is untouched — masking hides the number, not the person.
    expect(customer.name).toBe('Asha Patel');
  });

  it('**gets the order’s contactPhone masked too**', async () => {
    // Called out separately because it is the field that made the whole-payload assertion
    // necessary: a snapshot of the number on the order row, beside a masked customer.
    const res = await get(`/api/orders/${orderId}`, agentToken);
    expect(res.body.data.contactPhone).toBe('+••••••••9876');
  });

  it('gets a masked number inside a customer’s order history', async () => {
    // The customer detail nests orders, so the same field appears one level down.
    const res = await get(`/api/customers/${customerId}`, agentToken);
    expect(JSON.stringify(res.body.data.orders)).not.toContain(FULL_DIGITS);
  });
});

describe('the owner, with masking on', () => {
  it('**sees the real number everywhere**', async () => {
    // The owner runs the business and is the person the switch protects *against* their own
    // team, not against themselves.
    for (const { name, path } of surfaces()) {
      // eslint-disable-next-line no-await-in-loop
      const res = await get(path, ownerToken);
      expect(res.status, name).toBe(200);
      expect(JSON.stringify(res.body), `${name} should show the owner the number`)
        .toContain(FULL_DIGITS);
    }
  });

  it('is told the number is not masked', async () => {
    const res = await get('/api/customers', ownerToken);
    expect(res.body.data[0].numberMasked).toBe(false);
  });
});

describe('with masking off', () => {
  it('**every role sees the number, exactly as before this feature**', async () => {
    // The backward-compatibility claim. The column defaults to false, so this is the state
    // every existing workspace is in.
    await setMasking(false);

    for (const token of [ownerToken, agentToken]) {
      for (const { name, path } of surfaces()) {
        // eslint-disable-next-line no-await-in-loop
        const res = await get(path, token);
        expect(JSON.stringify(res.body), name).toContain(FULL_DIGITS);
      }
    }
  });
});

describe('searching by number', () => {
  it('**still works for a masked agent on six or more digits**', async () => {
    // Confirming a number a customer just read out. Taking this away makes the Inbox painful.
    const res = await get('/api/customers?search=009876', agentToken);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].id).toBe(customerId);
  });

  it('**returns nothing on a short numeric query, so it cannot be used as an oracle**', async () => {
    // Without a floor, an agent could try `9`, then `98`, and rebuild the number from which
    // rows come back. Answered as an empty page rather than an error — an error would confirm
    // the rule exists.
    for (const short of ['9', '98', '987', '9876', '09876']) {
      // eslint-disable-next-line no-await-in-loop
      const res = await get(`/api/customers?search=${short}`, agentToken);
      expect(res.body.data, `search=${short}`).toHaveLength(0);
    }
  });

  it('leaves the owner’s short searches alone', async () => {
    const res = await get('/api/customers?search=9876', ownerToken);
    expect(res.body.data).toHaveLength(1);
  });

  it('**never limits a name search**', async () => {
    // The floor must apply to digits, not to short words — "Jo" is a perfectly good query.
    const res = await get('/api/customers?search=Asha', agentToken);
    expect(res.body.data).toHaveLength(1);
  });

  it('applies the same floor to the orders list', async () => {
    // `Order.contactPhone` is matched with `contains` too, so the oracle exists there as well.
    expect((await get('/api/orders?search=98', agentToken)).body.data).toHaveLength(0);
    expect((await get('/api/orders?search=009876', agentToken)).body.data).toHaveLength(1);
  });
});

describe('a role granted the permission', () => {
  it('**sees full numbers without being made an owner**', async () => {
    // The escape hatch the permission exists for: one trusted manager, no promotion.
    const role = await prisma.role.findFirstOrThrow({
      where: { tenantId: TENANT, isOwner: false },
    });
    await prisma.role.update({
      where: { id: role.id },
      data: { permissions: [...role.permissions, 'customers:view_full_number'] },
    });

    const res = await get('/api/customers', agentToken);
    expect(JSON.stringify(res.body)).toContain(FULL_DIGITS);
    expect(res.body.data[0].numberMasked).toBe(false);
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
