import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { prisma } from '../../config/prisma.js';
import { buildApp } from '../../app.js';
import { signToken } from '../../utils/jwt.js';
import { ROLE_PERMISSIONS } from '../../config/permissions.js';
import { linkLeadToCustomer, sweepDueReminders } from './lead.service.js';

// Leads.
//
// The boundary first — a module nobody was given, a role without the permission,
// another workspace's rows — and only then the pipeline behaviour that makes the
// module worth having.

const app = buildApp();

const TENANT_A = 'aaaaaaaa-a000-0000-0000-000000000001';
const TENANT_B = 'aaaaaaaa-a000-0000-0000-000000000002';

let ownerA: string;
let agentA: string;
let ownerAId: string;
let agentAId: string;
let ownerB: string;

const wipe = async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [TENANT_A, TENANT_B] } } });
};

/** A workspace with an owner and an agent, and the Leads module already on. */
const makeTenant = async (id: string, name: string, base: string, withModule = true) => {
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
      ...(withModule ? { modules: { create: { module: 'LEADS', enabled: true } } } : {}),
    },
    include: { users: { orderBy: { phone: 'asc' } }, roles: true },
  });

  const agentRole = tenant.roles.find((role) => !role.isOwner)!;
  const ownerRole = tenant.roles.find((role) => role.isOwner)!;
  await prisma.user.update({ where: { id: tenant.users[0].id }, data: { roleId: ownerRole.id } });
  await prisma.user.update({ where: { id: tenant.users[1].id }, data: { roleId: agentRole.id } });

  return {
    ownerId: tenant.users[0].id,
    agentId: tenant.users[1].id,
    ownerToken: signToken({ userId: tenant.users[0].id }),
    agentToken: signToken({ userId: tenant.users[1].id }),
  };
};

beforeEach(async () => {
  await wipe();
  const a = await makeTenant(TENANT_A, 'Alpha', '1555a10000'.replace('a', '1'));
  const b = await makeTenant(TENANT_B, 'Beta', '1555a20000'.replace('a', '2'));
  ownerA = a.ownerToken;
  agentA = a.agentToken;
  ownerAId = a.ownerId;
  agentAId = a.agentId;
  ownerB = b.ownerToken;
});

afterAll(async () => {
  await wipe();
  await prisma.$disconnect();
});

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

const addLead = (token: string, body: Record<string, unknown>) =>
  request(app).post('/api/leads').set(auth(token)).send(body);

describe('the boundary', () => {
  it('404s every route for a workspace without the module', async () => {
    await prisma.tenantModule.updateMany({
      where: { tenantId: TENANT_A, module: 'LEADS' },
      data: { enabled: false },
    });

    await request(app).get('/api/leads').set(auth(ownerA)).expect(404);
    await addLead(ownerA, { name: 'Nope', phone: '15551110001' }).expect(404);
  });

  it('403s a role that holds no lead permissions', async () => {
    // The seeded Agent gets leads:read and leads:write but not assign or delete,
    // so those are the honest test of the gate.
    await request(app).delete(`/api/leads/${TENANT_A}`).set(auth(agentA)).expect(403);
    await request(app)
      .post('/api/leads/bulk-assign')
      .set(auth(agentA))
      .send({ leadIds: [TENANT_A], ownerId: null })
      .expect(403);
  });

  it('lets an agent read and write, which is their job', async () => {
    await addLead(agentA, { name: 'Agent Added', phone: '15551110009' }).expect(201);
    await request(app).get('/api/leads').set(auth(agentA)).expect(200);
  });

  it('never returns another workspace’s leads', async () => {
    const created = await addLead(ownerA, { name: 'Alpha Lead', phone: '15551110002' }).expect(201);
    const leadId = created.body.data.id as string;

    await request(app).get(`/api/leads/${leadId}`).set(auth(ownerB)).expect(404);
    const list = await request(app).get('/api/leads').set(auth(ownerB)).expect(200);
    expect(list.body.data.leads).toHaveLength(0);
  });

  it('refuses to assign a lead to somebody from another workspace', async () => {
    const created = await addLead(ownerA, { name: 'Alpha Lead', phone: '15551110003' }).expect(201);
    const otherOwner = await prisma.user.findFirstOrThrow({ where: { tenantId: TENANT_B } });

    await request(app)
      .patch(`/api/leads/${created.body.data.id}/owner`)
      .set(auth(ownerA))
      .send({ ownerId: otherOwner.id })
      .expect(400);
  });
});

describe('adding a lead', () => {
  it('normalises the phone the same way login does', async () => {
    const created = await addLead(ownerA, { name: 'Spaced', phone: '+1 555 111 0004' }).expect(201);
    // Stored as E.164 digits, so it can ever match a `Customer.waId`.
    expect(created.body.data.phone).toBe('15551110004');
  });

  it('refuses a duplicate number and says where the existing lead is', async () => {
    await addLead(ownerA, { name: 'First', phone: '15551110005' }).expect(201);
    const second = await addLead(ownerA, { name: 'Second', phone: '+1 555 111 0005' }).expect(409);

    // Naming the existing lead is the point: a bare "duplicate" makes someone go
    // looking, and the alternative — a second row — detaches all the history.
    expect(second.body.message).toContain('First');

    expect(await prisma.lead.count({ where: { tenantId: TENANT_A } })).toBe(1);
  });

  it('lets two workspaces hold the same number', async () => {
    await addLead(ownerA, { name: 'Alpha', phone: '15551110006' }).expect(201);
    await addLead(ownerB, { name: 'Beta', phone: '15551110006' }).expect(201);
  });

  it('rejects a number that is not one', async () => {
    await addLead(ownerA, { name: 'Bad', phone: '123' }).expect(400);
  });

  it('opens the timeline with a CREATED event', async () => {
    const created = await addLead(ownerA, { name: 'Timeline', phone: '15551110007', source: 'Walk-in' })
      .expect(201);

    const detail = await request(app)
      .get(`/api/leads/${created.body.data.id}`)
      .set(auth(ownerA))
      .expect(200);

    expect(detail.body.data.events).toHaveLength(1);
    expect(detail.body.data.events[0].type).toBe('CREATED');
    expect(detail.body.data.events[0].body).toContain('Walk-in');
  });
});

describe('working the pipeline', () => {
  const seedLead = async () => {
    const created = await addLead(ownerA, { name: 'Pipeline', phone: '15551110010' }).expect(201);
    return created.body.data.id as string;
  };

  it('records a status change with both ends of the move', async () => {
    const leadId = await seedLead();
    await request(app)
      .patch(`/api/leads/${leadId}/status`)
      .set(auth(ownerA))
      .send({ status: 'QUALIFIED', note: 'Budget confirmed' })
      .expect(200);

    const event = await prisma.leadEvent.findFirstOrThrow({
      where: { leadId, type: 'STATUS_CHANGED' },
    });
    expect(event.fromStatus).toBe('NEW');
    expect(event.toStatus).toBe('QUALIFIED');
    expect(event.body).toBe('Budget confirmed');
  });

  it('allows a lead to move backwards', async () => {
    // Real pipelines go backwards — a declined proposal returns to CONTACTED. A
    // state machine that refuses that teaches people to record something untrue.
    const leadId = await seedLead();
    for (const status of ['PROPOSAL', 'CONTACTED', 'WON']) {
      await request(app).patch(`/api/leads/${leadId}/status`).set(auth(ownerA))
        .send({ status }).expect(200);
    }
    expect(await prisma.leadEvent.count({ where: { leadId, type: 'STATUS_CHANGED' } })).toBe(3);
  });

  it('writes no event when the status did not actually change', async () => {
    const leadId = await seedLead();
    await request(app).patch(`/api/leads/${leadId}/status`).set(auth(ownerA))
      .send({ status: 'NEW' }).expect(200);
    expect(await prisma.leadEvent.count({ where: { leadId, type: 'STATUS_CHANGED' } })).toBe(0);
  });

  it('records assignment and unassignment separately', async () => {
    const leadId = await seedLead();
    await request(app).patch(`/api/leads/${leadId}/owner`).set(auth(ownerA))
      .send({ ownerId: agentAId }).expect(200);
    await request(app).patch(`/api/leads/${leadId}/owner`).set(auth(ownerA))
      .send({ ownerId: null }).expect(200);

    const types = (await prisma.leadEvent.findMany({ where: { leadId } })).map((e) => e.type);
    expect(types).toContain('ASSIGNED');
    expect(types).toContain('UNASSIGNED');
  });

  it('bulk assigns, reporting the ones it could not', async () => {
    const first = await seedLead();
    const second = (await addLead(ownerA, { name: 'Second', phone: '15551110011' })).body.data.id;

    const response = await request(app)
      .post('/api/leads/bulk-assign')
      .set(auth(ownerA))
      .send({ leadIds: [first, second, 'aaaaaaaa-a000-0000-0000-0000000000ff'], ownerId: agentAId })
      .expect(200);

    // A bad id must not roll back the ones that worked.
    expect(response.body.data.assigned).toBe(2);
    expect(response.body.data.failed).toHaveLength(1);
  });
});

describe('calls', () => {
  const seedLead = async () => (await addLead(ownerA, { name: 'Caller', phone: '15551110020' })).body.data.id as string;

  it('freezes the number dialled, so correcting the lead later does not rewrite history', async () => {
    const leadId = await seedLead();
    await request(app).post(`/api/leads/${leadId}/calls`).set(auth(ownerA))
      .send({ outcome: 'CONNECTED', notes: 'Wants a quote' }).expect(201);

    await request(app).patch(`/api/leads/${leadId}`).set(auth(ownerA))
      .send({ phone: '15551110021' }).expect(200);

    const call = await prisma.callLog.findFirstOrThrow({ where: { leadId } });
    expect(call.phone).toBe('15551110020');
  });

  it('only counts a connected call as contact', async () => {
    const leadId = await seedLead();
    await request(app).post(`/api/leads/${leadId}/calls`).set(auth(ownerA))
      .send({ outcome: 'NO_ANSWER' }).expect(201);
    // Ringing out is not contact. Marking it as such is how a stale lead looks
    // fresh on every list that sorts by last contacted.
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: leadId } })).lastContactedAt).toBeNull();

    await request(app).post(`/api/leads/${leadId}/calls`).set(auth(ownerA))
      .send({ outcome: 'CONNECTED' }).expect(201);
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: leadId } })).lastContactedAt).not.toBeNull();
  });

  it('never accepts a duration from the client', async () => {
    // There is no telephony provider, so a duration could only be an agent's
    // guess — and a guess in the field a provider would fill is indistinguishable
    // from a measurement.
    const leadId = await seedLead();
    await request(app).post(`/api/leads/${leadId}/calls`).set(auth(ownerA))
      .send({ outcome: 'CONNECTED', durationSeconds: 600 }).expect(201);

    expect((await prisma.callLog.findFirstOrThrow({ where: { leadId } })).durationSeconds).toBeNull();
  });
});

describe('reminders', () => {
  const seedLead = async () => (await addLead(ownerA, { name: 'Remind', phone: '15551110030' })).body.data.id as string;

  it('caches the earliest open one onto the lead', async () => {
    const leadId = await seedLead();
    const later = new Date(Date.now() + 7 * 864e5);
    const sooner = new Date(Date.now() + 864e5);

    await request(app).post(`/api/leads/${leadId}/reminders`).set(auth(ownerA))
      .send({ dueAt: later.toISOString(), note: 'Follow up next week' }).expect(201);
    await request(app).post(`/api/leads/${leadId}/reminders`).set(auth(ownerA))
      .send({ dueAt: sooner.toISOString(), note: 'Call tomorrow' }).expect(201);

    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
    expect(lead.nextActionAt?.toISOString()).toBe(sooner.toISOString());
  });

  it('recomputes the cache when one is completed, rather than leaving it stale', async () => {
    const leadId = await seedLead();
    const soon = new Date(Date.now() + 3600_000);
    const created = await request(app).post(`/api/leads/${leadId}/reminders`).set(auth(ownerA))
      .send({ dueAt: soon.toISOString(), note: 'Only one' }).expect(201);

    await request(app)
      .patch(`/api/leads/reminders/${created.body.data.id}/complete`)
      .set(auth(ownerA))
      .expect(200);

    expect((await prisma.lead.findUniqueOrThrow({ where: { id: leadId } })).nextActionAt).toBeNull();
  });

  it('defaults to the lead’s owner rather than whoever set it', async () => {
    const leadId = await seedLead();
    await request(app).patch(`/api/leads/${leadId}/owner`).set(auth(ownerA))
      .send({ ownerId: agentAId }).expect(200);

    await request(app).post(`/api/leads/${leadId}/reminders`).set(auth(ownerA))
      .send({ dueAt: new Date(Date.now() + 3600_000).toISOString(), note: 'Owner’s job' }).expect(201);

    const reminder = await prisma.reminder.findFirstOrThrow({ where: { leadId } });
    expect(reminder.assigneeId).toBe(agentAId);
  });

  it('the sweep marks a due reminder once, not on every pass', async () => {
    const leadId = await seedLead();
    await request(app).post(`/api/leads/${leadId}/reminders`).set(auth(ownerA))
      .send({ dueAt: new Date(Date.now() - 60_000).toISOString(), note: 'Overdue' }).expect(201);

    expect(await sweepDueReminders()).toBeGreaterThanOrEqual(1);
    // Second pass finds nothing new — otherwise a badge counts the same reminder
    // again every five minutes.
    const before = await prisma.reminder.count({
      where: { tenantId: TENANT_A, notifiedAt: null, completedAt: null },
    });
    await sweepDueReminders();
    expect(await prisma.reminder.count({
      where: { tenantId: TENANT_A, notifiedAt: null, completedAt: null },
    })).toBe(before);
  });

  it('lists a person’s own open reminders with a due count', async () => {
    const leadId = await seedLead();
    await request(app).post(`/api/leads/${leadId}/reminders`).set(auth(ownerA))
      .send({ dueAt: new Date(Date.now() - 60_000).toISOString(), note: 'Overdue', assigneeId: ownerAId })
      .expect(201);
    await request(app).post(`/api/leads/${leadId}/reminders`).set(auth(ownerA))
      .send({ dueAt: new Date(Date.now() + 864e5).toISOString(), note: 'Later', assigneeId: ownerAId })
      .expect(201);

    const mine = await request(app).get('/api/leads/reminders/mine').set(auth(ownerA)).expect(200);
    expect(mine.body.data.reminders).toHaveLength(2);
    expect(mine.body.data.dueCount).toBe(1);
  });
});

describe('linking a lead to the customer who messages', () => {
  it('links on first inbound and records it on the timeline', async () => {
    const created = await addLead(ownerA, { name: 'Will Message', phone: '15551110040' }).expect(201);
    const leadId = created.body.data.id as string;

    const customer = await prisma.customer.create({
      data: { tenantId: TENANT_A, waId: '15551110040', phone: '15551110040' },
    });
    await linkLeadToCustomer(TENANT_A, customer.id, '15551110040');

    expect((await prisma.lead.findUniqueOrThrow({ where: { id: leadId } })).customerId).toBe(customer.id);
    expect(await prisma.leadEvent.count({ where: { leadId, type: 'LINKED_TO_CUSTOMER' } })).toBe(1);
  });

  it('is a no-op for a number nobody added as a lead', async () => {
    const customer = await prisma.customer.create({
      data: { tenantId: TENANT_A, waId: '15551110041', phone: '15551110041' },
    });
    // Runs on every inbound message, so the common case must be silent and safe.
    await expect(linkLeadToCustomer(TENANT_A, customer.id, '15551110041')).resolves.toBeUndefined();
  });

  it('does not relink a lead that already has a customer', async () => {
    const created = await addLead(ownerA, { name: 'Already', phone: '15551110042' }).expect(201);
    const leadId = created.body.data.id as string;

    const first = await prisma.customer.create({
      data: { tenantId: TENANT_A, waId: '15551110042', phone: '15551110042' },
    });
    await linkLeadToCustomer(TENANT_A, first.id, '15551110042');
    await linkLeadToCustomer(TENANT_A, first.id, '15551110042');

    expect(await prisma.leadEvent.count({ where: { leadId, type: 'LINKED_TO_CUSTOMER' } })).toBe(1);
  });

  it('links straight away when the lead is added after they already messaged', async () => {
    const customer = await prisma.customer.create({
      data: { tenantId: TENANT_A, waId: '15551110043', phone: '15551110043' },
    });
    const created = await addLead(ownerA, { name: 'Messaged First', phone: '15551110043' }).expect(201);

    expect(created.body.data.customerId).toBe(customer.id);
  });
});
