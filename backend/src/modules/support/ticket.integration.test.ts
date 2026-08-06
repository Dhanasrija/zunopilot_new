import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { prisma } from '../../config/prisma.js';
import { buildApp } from '../../app.js';
import { signToken } from '../../utils/jwt.js';
import { ROLE_PERMISSIONS } from '../../config/permissions.js';
import { CUSTOMER_SERVICE_WINDOW_MS, windowStateFor } from './ticket.service.js';

// Support tickets.
//
// The boundary, then the two things that would actually hurt a customer if they
// were wrong: a reference number with a hole in it, and an update the agent
// believes was delivered when it was not.

const app = buildApp();

const TENANT_A = 'aaaaaaaa-b000-0000-0000-000000000001';
const TENANT_B = 'aaaaaaaa-b000-0000-0000-000000000002';

let ownerA: string;
let agentA: string;
let agentAId: string;
let ownerB: string;
let customerAId: string;
let conversationAId: string;

const wipe = async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [TENANT_A, TENANT_B] } } });
};

const makeTenant = async (id: string, name: string, base: string) => {
  const tenant = await prisma.tenant.create({
    data: {
      id,
      businessName: name,
      onboardingCompletedAt: new Date(),
      roles: {
        create: [
          { name: 'Owner', permissions: [...ROLE_PERMISSIONS.OWNER], isOwner: true, isSystem: true },
          { name: 'Agent', permissions: [...ROLE_PERMISSIONS.AGENT], isSystem: true, sortOrder: 30 },
        ],
      },
      users: {
        create: [
          { phone: `${base}1`, fullName: `${name} Owner`, role: 'OWNER' },
          { phone: `${base}2`, fullName: `${name} Agent`, role: 'AGENT' },
        ],
      },
      modules: { create: { module: 'SUPPORT', enabled: true } },
      // A `mock-token-` channel is always served by the mock provider, so a send
      // in these tests can never reach Meta.
      whatsappAccounts: {
        create: {
          wabaId: `waba-${base}`,
          phoneNumberId: `pn-${base}`,
          accessToken: 'mock-token-not-a-credential',
        },
      },
    },
    include: { users: { orderBy: { phone: 'asc' } }, roles: true },
  });

  const ownerRole = tenant.roles.find((r) => r.isOwner)!;
  const agentRole = tenant.roles.find((r) => !r.isOwner)!;
  await prisma.user.update({ where: { id: tenant.users[0].id }, data: { roleId: ownerRole.id } });
  await prisma.user.update({ where: { id: tenant.users[1].id }, data: { roleId: agentRole.id } });

  return {
    agentId: tenant.users[1].id,
    ownerToken: signToken({ userId: tenant.users[0].id }),
    agentToken: signToken({ userId: tenant.users[1].id }),
  };
};

/** A customer with a conversation, and an inbound message `agoMs` ago. */
const makeConversation = async (tenantId: string, waId: string, agoMs: number) => {
  const customer = await prisma.customer.create({ data: { tenantId, waId, phone: waId } });
  const conversation = await prisma.conversation.create({
    data: { tenantId, customerId: customer.id, status: 'OPEN', lastMessageAt: new Date() },
  });
  await prisma.message.create({
    data: {
      tenantId,
      conversationId: conversation.id,
      customerId: customer.id,
      direction: 'INBOUND',
      type: 'TEXT',
      status: 'RECEIVED',
      body: 'My order never arrived',
      createdAt: new Date(Date.now() - agoMs),
    },
  });
  return { customerId: customer.id, conversationId: conversation.id };
};

beforeEach(async () => {
  await wipe();
  const a = await makeTenant(TENANT_A, 'Alpha', '1555b1000');
  const b = await makeTenant(TENANT_B, 'Beta', '1555b2000');
  ownerA = a.ownerToken;
  agentA = a.agentToken;
  agentAId = a.agentId;
  ownerB = b.ownerToken;

  // One minute ago — comfortably inside the 24-hour window.
  const conv = await makeConversation(TENANT_A, '15558880001', 60_000);
  customerAId = conv.customerId;
  conversationAId = conv.conversationId;
});

afterAll(async () => {
  await wipe();
  await prisma.$disconnect();
});

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

const raise = (token: string, body: Record<string, unknown> = {}) =>
  request(app).post('/api/tickets').set(auth(token)).send({
    subject: 'Order never arrived', body: 'Customer says nothing was delivered.', ...body,
  });

describe('the boundary', () => {
  it('404s every route for a workspace without the module', async () => {
    await prisma.tenantModule.updateMany({
      where: { tenantId: TENANT_A, module: 'SUPPORT' }, data: { enabled: false },
    });
    await request(app).get('/api/tickets').set(auth(ownerA)).expect(404);
    await raise(ownerA).expect(404);
  });

  it('403s an agent trying to resolve, which needs tickets:close', async () => {
    const created = await raise(ownerA).expect(201);
    // The seeded Agent holds tickets:read and tickets:write but not close.
    await request(app)
      .patch(`/api/tickets/${created.body.data.id}/status`)
      .set(auth(agentA))
      .send({ status: 'RESOLVED' })
      .expect(403);
  });

  it('lets that same agent move it between working states', async () => {
    // The permission depends on the *value*, so the write itself must still work.
    const created = await raise(ownerA).expect(201);
    await request(app)
      .patch(`/api/tickets/${created.body.data.id}/status`)
      .set(auth(agentA))
      .send({ status: 'IN_PROGRESS' })
      .expect(200);
  });

  it('403s an agent trying to reassign', async () => {
    const created = await raise(ownerA).expect(201);
    await request(app)
      .patch(`/api/tickets/${created.body.data.id}/assignee`)
      .set(auth(agentA))
      .send({ assigneeId: agentAId })
      .expect(403);
  });

  it('never returns another workspace’s tickets', async () => {
    const created = await raise(ownerA).expect(201);
    await request(app).get(`/api/tickets/${created.body.data.id}`).set(auth(ownerB)).expect(404);
    const list = await request(app).get('/api/tickets').set(auth(ownerB)).expect(200);
    expect(list.body.data.tickets).toHaveLength(0);
  });

  it('refuses a conversation belonging to another workspace', async () => {
    await raise(ownerB, { conversationId: conversationAId }).expect(400);
  });
});

describe('ticket numbers', () => {
  it('are gapless and sequential within a workspace', async () => {
    const numbers: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      const created = await raise(ownerA, { subject: `Issue ${i}` }).expect(201);
      numbers.push(created.body.data.number);
    }
    // Customers quote these back. A jump reads as a ticket that was lost.
    expect(numbers).toEqual(['ZT-000001', 'ZT-000002', 'ZT-000003', 'ZT-000004']);
  });

  it('restart per workspace, so one tenant cannot infer another’s volume', async () => {
    await raise(ownerA).expect(201);
    await raise(ownerA).expect(201);
    const beta = await raise(ownerB).expect(201);
    expect(beta.body.data.number).toBe('ZT-000001');
  });

  it('consume nothing when the raise fails', async () => {
    await raise(ownerA).expect(201);
    // A bad conversation id is rejected before the transaction opens.
    await raise(ownerA, { conversationId: '00000000-0000-4000-8000-000000000000' }).expect(400);
    const next = await raise(ownerA).expect(201);
    expect(next.body.data.number).toBe('ZT-000002');
  });

  it('survive concurrent raises — every one succeeds, and still gapless', async () => {
    // This test earned its keep. The first version only asserted "no duplicate
    // sequences", which passed while **five of eight** concurrent raises were
    // failing outright on the unique index — an agent clicking Raise at the same
    // moment as a colleague got an error. Asserting that all of them succeed is
    // what actually catches that.
    const responses = await Promise.all(
      Array.from({ length: 8 }, (_, i) => raise(ownerA, { subject: `Race ${i}` })),
    );

    expect(responses.every((r) => r.status === 201)).toBe(true);

    const sequences = responses.map((r) => r.body.data.sequence as number).sort((a, b) => a - b);
    expect(sequences).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});

describe('raising from a conversation', () => {
  it('takes the customer from the conversation rather than the request', async () => {
    // Trusting the request would let a ticket be filed against the wrong person.
    const created = await raise(ownerA, {
      conversationId: conversationAId,
      customerId: '00000000-0000-4000-8000-000000000000',
    }).expect(201);
    expect(created.body.data.customerId).toBe(customerAId);
  });

  it('opens with an OPENED event', async () => {
    const created = await raise(ownerA, { conversationId: conversationAId }).expect(201);
    const detail = await request(app)
      .get(`/api/tickets/${created.body.data.id}`).set(auth(ownerA)).expect(200);
    expect(detail.body.data.events).toHaveLength(1);
    expect(detail.body.data.events[0].type).toBe('OPENED');
  });
});

describe('the 24-hour customer service window', () => {
  it('is open when the customer messaged recently', async () => {
    const state = await windowStateFor(TENANT_A, conversationAId);
    expect(state.open).toBe(true);
    expect(state.reason).toBe('open');
  });

  it('is closed once 24 hours have passed since their last inbound message', async () => {
    const stale = await makeConversation(TENANT_A, '15558880002', CUSTOMER_SERVICE_WINDOW_MS + 60_000);
    const state = await windowStateFor(TENANT_A, stale.conversationId);
    expect(state.open).toBe(false);
    expect(state.reason).toBe('expired');
  });

  it('is not reopened by anything the business sends', async () => {
    // Meta's rule is about the *customer's* last message. An outbound reply that
    // reset the clock would let a business message someone indefinitely.
    const stale = await makeConversation(TENANT_A, '15558880003', CUSTOMER_SERVICE_WINDOW_MS + 60_000);
    await prisma.message.create({
      data: {
        tenantId: TENANT_A,
        conversationId: stale.conversationId,
        customerId: stale.customerId,
        direction: 'OUTBOUND',
        type: 'TEXT',
        status: 'SENT',
        body: 'Still looking into this',
      },
    });
    expect((await windowStateFor(TENANT_A, stale.conversationId)).open).toBe(false);
  });

  it('is reported with the ticket, so the agent knows before typing', async () => {
    const created = await raise(ownerA, { conversationId: conversationAId }).expect(201);
    const detail = await request(app)
      .get(`/api/tickets/${created.body.data.id}`).set(auth(ownerA)).expect(200);
    expect(detail.body.data.window.open).toBe(true);
  });
});

describe('sending a customer update', () => {
  it('delivers inside the window and mirrors it into the Inbox', async () => {
    const created = await raise(ownerA, { conversationId: conversationAId }).expect(201);
    const sent = await request(app)
      .post(`/api/tickets/${created.body.data.id}/updates`)
      .set(auth(ownerA))
      .send({ body: 'Your replacement is on its way.' })
      .expect(201);

    expect(sent.body.data.sent).toBe(true);

    // The Inbox stays the one place a conversation lives — an update visible
    // only on the ticket is a message the next agent will not know was sent.
    const mirrored = await prisma.message.findFirst({
      where: { conversationId: conversationAId, direction: 'OUTBOUND' },
    });
    expect(mirrored?.body).toBe('Your replacement is on its way.');

    const event = await prisma.ticketEvent.findFirstOrThrow({
      where: { ticketId: created.body.data.id, type: 'CUSTOMER_UPDATE' },
    });
    expect(event.visibleToCustomer).toBe(true);
    expect(event.messageId).toBe(mirrored!.id);
  });

  it('stamps firstRespondedAt once and never moves it', async () => {
    const created = await raise(ownerA, { conversationId: conversationAId }).expect(201);
    const id = created.body.data.id as string;

    await request(app).post(`/api/tickets/${id}/updates`).set(auth(ownerA))
      .send({ body: 'Looking into it.' }).expect(201);
    const first = (await prisma.ticket.findUniqueOrThrow({ where: { id } })).firstRespondedAt;

    await request(app).post(`/api/tickets/${id}/updates`).set(auth(ownerA))
      .send({ body: 'Resolved now.' }).expect(201);
    const after = (await prisma.ticket.findUniqueOrThrow({ where: { id } })).firstRespondedAt;

    // A first-response time that moves is not one.
    expect(after?.toISOString()).toBe(first?.toISOString());
  });

  it('refuses outside the window, saves the text, and explains why', async () => {
    const stale = await makeConversation(TENANT_A, '15558880004', CUSTOMER_SERVICE_WINDOW_MS + 60_000);
    const created = await raise(ownerA, { conversationId: stale.conversationId }).expect(201);

    const result = await request(app)
      .post(`/api/tickets/${created.body.data.id}/updates`)
      .set(auth(ownerA))
      .send({ body: 'Your refund has been processed.' })
      // 200, not an error: the agent cannot fix this by retrying, and their text
      // was kept.
      .expect(200);

    expect(result.body.data.sent).toBe(false);
    expect(result.body.data.reason).toContain('24 hours');

    // Nothing was sent...
    expect(await prisma.message.count({
      where: { conversationId: stale.conversationId, direction: 'OUTBOUND' },
    })).toBe(0);

    // ...but the promise was not lost, and it is not marked as seen.
    const event = await prisma.ticketEvent.findFirstOrThrow({
      where: { ticketId: created.body.data.id, type: 'UPDATE_NOT_SENT' },
    });
    expect(event.body).toBe('Your refund has been processed.');
    expect(event.visibleToCustomer).toBe(false);

    // And it must not count as a response.
    expect((await prisma.ticket.findUniqueOrThrow({
      where: { id: created.body.data.id },
    })).firstRespondedAt).toBeNull();
  });

  it('refuses when the ticket has no conversation at all', async () => {
    const created = await raise(ownerA).expect(201);
    const result = await request(app)
      .post(`/api/tickets/${created.body.data.id}/updates`)
      .set(auth(ownerA))
      .send({ body: 'An update nobody can receive.' })
      .expect(200);

    expect(result.body.data.sent).toBe(false);
    expect(result.body.data.window.reason).toBe('no_conversation');
  });

  it('keeps an internal note off the customer’s record entirely', async () => {
    const created = await raise(ownerA, { conversationId: conversationAId }).expect(201);
    await request(app).post(`/api/tickets/${created.body.data.id}/notes`).set(auth(ownerA))
      .send({ body: 'Third time this customer has complained.' }).expect(201);

    const note = await prisma.ticketEvent.findFirstOrThrow({
      where: { ticketId: created.body.data.id, type: 'NOTE' },
    });
    // The flag that must never be wrong in either direction.
    expect(note.visibleToCustomer).toBe(false);
    expect(await prisma.message.count({
      where: { conversationId: conversationAId, direction: 'OUTBOUND' },
    })).toBe(0);
  });
});

describe('working a ticket', () => {
  it('records a resolution and clears it on reopen', async () => {
    const created = await raise(ownerA).expect(201);
    const id = created.body.data.id as string;

    await request(app).patch(`/api/tickets/${id}/status`).set(auth(ownerA))
      .send({ status: 'RESOLVED' }).expect(200);
    expect((await prisma.ticket.findUniqueOrThrow({ where: { id } })).resolvedAt).not.toBeNull();

    await request(app).patch(`/api/tickets/${id}/status`).set(auth(ownerA))
      .send({ status: 'IN_PROGRESS' }).expect(200);

    // "Resolved on" must mean the resolution that stuck, not the first attempt.
    const reopened = await prisma.ticket.findUniqueOrThrow({ where: { id } });
    expect(reopened.resolvedAt).toBeNull();

    const types = (await prisma.ticketEvent.findMany({ where: { ticketId: id } })).map((e) => e.type);
    expect(types).toContain('RESOLVED');
    expect(types).toContain('REOPENED');
  });

  it('writes no event when the status did not change', async () => {
    const created = await raise(ownerA).expect(201);
    await request(app).patch(`/api/tickets/${created.body.data.id}/status`).set(auth(ownerA))
      .send({ status: 'OPEN' }).expect(200);
    expect(await prisma.ticketEvent.count({
      where: { ticketId: created.body.data.id, type: 'STATUS_CHANGED' },
    })).toBe(0);
  });

  it('filters to the open queue', async () => {
    const done = await raise(ownerA, { subject: 'Already handled' }).expect(201);
    await raise(ownerA, { subject: 'Still open' }).expect(201);
    await request(app).patch(`/api/tickets/${done.body.data.id}/status`).set(auth(ownerA))
      .send({ status: 'CLOSED' }).expect(200);

    const open = await request(app).get('/api/tickets?open=true').set(auth(ownerA)).expect(200);
    expect(open.body.data.tickets).toHaveLength(1);
    expect(open.body.data.tickets[0].subject).toBe('Still open');
  });
});
