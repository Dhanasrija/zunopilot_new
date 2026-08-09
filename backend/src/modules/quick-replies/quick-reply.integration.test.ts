import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { seedMemberships } from '../../test-support/members.js';
import { prisma } from '../../config/prisma.js';
import { buildApp } from '../../app.js';
import { signToken } from '../../utils/jwt.js';
import { seedDefaultRoles } from '../../services/role.service.js';

/*
 * Managing the sets of answers an agent can offer.
 *
 * ── The two things this file is really about ─────────────────────────────────
 *
 * **1. Meta's limits are refused here, not discovered at send time.** Three buttons, twenty
 * characters a label, 1024 of body. Past twenty Meta truncates a label *silently*, so a set saved
 * with a longer one looks fine in the editor and arrives on the customer's phone missing a word.
 *
 * **2. Who may bind a button to a workflow is not who may send one.** Reading is `inbox:reply`
 * because an agent needs the list; writing is `automation:write`, because deciding what a
 * customer's tap starts is configuration. An agent who can answer messages must not be able to
 * point a button at a workflow.
 *
 * The third property, and the least obvious: **editing a set replaces its buttons rather than
 * patching them**, because a button's row id is its identity on WhatsApp. Editing a label in place
 * would change what a tap on an already-sent question means — the customer sees "Delivery", taps
 * it, and the row now says "Pickup".
 */

const app = buildApp();
const TENANT = 'eeeeeeee-0000-0000-0000-0000000000a1';

let adminToken: string;
let agentToken: string;
let publishedWorkflowId: string;
let draftWorkflowId: string;

const wipe = () => prisma.tenant.deleteMany({ where: { id: TENANT } });

beforeEach(async () => {
  await wipe();
  await prisma.tenant.create({
    data: { id: TENANT, businessName: 'Quick Reply Co', category: 'RESTAURANT' },
  });
  await seedDefaultRoles(prisma, TENANT);

  const roles = await prisma.role.findMany({ where: { tenantId: TENANT } });
  const ownerRole = roles.find((r) => r.isOwner)!;
  // A real seeded role that can reply but cannot configure automation — the split this file tests.
  const agentRole = roles.find(
    (r) => !r.isOwner && r.permissions.includes('inbox:reply') && !r.permissions.includes('automation:write'),
  )!;

  const admin = await prisma.user.create({
    data: { tenantId: TENANT, phone: '15558805001', fullName: 'Owner', role: 'OWNER', roleId: ownerRole.id },
  });
  const agent = await prisma.user.create({
    data: { tenantId: TENANT, phone: '15558805002', fullName: 'Agent', role: 'AGENT', roleId: agentRole.id },
  });
  await seedMemberships();
  adminToken = signToken({ userId: admin.id, tenantId: TENANT });
  agentToken = signToken({ userId: agent.id, tenantId: TENANT });

  const published = await prisma.workflow.create({
    data: {
      tenantId: TENANT,
      name: 'Booking',
      slug: `booking_${Date.now()}`,
      category: 'CONVERSATION',
      status: 'PUBLISHED',
    },
  });
  publishedWorkflowId = published.id;

  const draft = await prisma.workflow.create({
    data: {
      tenantId: TENANT,
      name: 'Half-built',
      slug: `draft_${Date.now()}`,
      category: 'CONVERSATION',
      status: 'DRAFT',
    },
  });
  draftWorkflowId = draft.id;
});

afterAll(async () => {
  await wipe();
  await prisma.$disconnect();
});

const as = (token: string) => ({
  post: (body: object) => request(app).post('/api/quick-replies')
    .set('Authorization', `Bearer ${token}`).send(body),
  get: () => request(app).get('/api/quick-replies').set('Authorization', `Bearer ${token}`),
  patch: (id: string, body: object) => request(app).patch(`/api/quick-replies/${id}`)
    .set('Authorization', `Bearer ${token}`).send(body),
  remove: (id: string) => request(app).delete(`/api/quick-replies/${id}`)
    .set('Authorization', `Bearer ${token}`),
});

const A_SET = {
  name: 'Delivery or pickup',
  body: 'Would you like delivery or pickup?',
  buttons: [{ label: 'Delivery' }, { label: 'Pickup' }],
};

describe('creating a set', () => {
  it('**stores the answers in the order they were given**', async () => {
    const res = await as(adminToken).post(A_SET).expect(201);

    expect(res.body.data.name).toBe('Delivery or pickup');
    expect(res.body.data.buttons.map((b: { label: string }) => b.label)).toEqual(['Delivery', 'Pickup']);
    // Position, not insertion luck: the order is what the customer sees on their phone.
    expect(res.body.data.buttons.map((b: { position: number }) => b.position)).toEqual([0, 1]);
  });

  it('**gives every answer an id the client never chose**', async () => {
    const res = await as(adminToken).post(A_SET).expect(201);

    const ids = res.body.data.buttons.map((b: { id: string }) => b.id);
    expect(new Set(ids).size).toBe(2);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('**refuses an id the client tried to supply**', async () => {
    /*
     * Rather than dropping it. An id an agent could choose is an id that can collide with the
     * ordering flow's `cat:`/`item:`/`cart:` prefixes or with an operator's payload rule — and a
     * collision is not an error, it is the wrong mechanism answering. A client author who tried
     * should find out.
     */
    await as(adminToken).post({
      ...A_SET,
      buttons: [{ id: 'cat:steal', label: 'Delivery' }, { label: 'Pickup' }],
    }).expect(400);
  });

  it('refuses a fourth answer, which WhatsApp would drop', async () => {
    const res = await as(adminToken).post({
      ...A_SET,
      buttons: [{ label: 'One' }, { label: 'Two' }, { label: 'Three' }, { label: 'Four' }],
    }).expect(400);
    expect(res.body.message).toMatch(/three/i);
  });

  it('**refuses a label WhatsApp would truncate**', async () => {
    // Twenty-one characters. Meta cuts it without saying so, which is how a button reaches a
    // customer missing its last word and nobody can see why in the editor.
    const res = await as(adminToken).post({
      ...A_SET, buttons: [{ label: 'Delivery to my office' }],
    }).expect(400);
    expect(res.body.message).toMatch(/20 characters/i);
  });

  it('refuses two answers that read the same', async () => {
    // Meta rejects duplicate ids, and two identical pills leave nobody able to say which one the
    // customer pressed.
    await as(adminToken).post({
      ...A_SET, buttons: [{ label: 'Delivery' }, { label: 'delivery' }],
    }).expect(400);
  });

  it('**refuses a question longer than an interactive message allows**', async () => {
    // 1024, not the 4000 a plain text reply allows. Easy to assume they are the same limit.
    const res = await as(adminToken).post({ ...A_SET, body: 'x'.repeat(1025) }).expect(400);
    expect(res.body.message).toMatch(/1024/);
  });

  it('refuses a second set with the same name', async () => {
    await as(adminToken).post(A_SET).expect(201);
    const res = await as(adminToken).post(A_SET).expect(400);
    // Named, rather than surfaced as a constraint violation: the name is how an agent picks one.
    expect(res.body.message).toMatch(/already exists/i);
  });
});

describe('binding an answer to a workflow', () => {
  it('**accepts a published workflow, and says which one**', async () => {
    const res = await as(adminToken).post({
      name: 'Book a slot',
      body: 'Would you like to book?',
      buttons: [{ label: 'Yes, book', workflowId: publishedWorkflowId }, { label: 'Not now' }],
    }).expect(201);

    expect(res.body.data.buttons[0].workflowId).toBe(publishedWorkflowId);
    // The name comes back so the editor and the composer can name it without a second read.
    expect(res.body.data.buttons[0].workflow.name).toBe('Booking');
    expect(res.body.data.buttons[1].workflowId).toBeNull();
  });

  it('**refuses a workflow that is not published**', async () => {
    // Otherwise an agent's button starts a half-built flow on a live customer the moment somebody
    // taps it.
    const res = await as(adminToken).post({
      name: 'Book a slot',
      body: 'Would you like to book?',
      buttons: [{ label: 'Yes, book', workflowId: draftWorkflowId }],
    }).expect(400);
    expect(res.body.message).toMatch(/not published/i);
  });

  it('**refuses another workspace’s workflow**', async () => {
    /*
     * A workflow id is a uuid somebody could paste. Without the tenant in the `where`, a button in
     * this workspace could be pointed at a workflow in another — and the tap would start it.
     */
    const other = await prisma.tenant.create({
      data: { id: 'eeeeeeee-0000-0000-0000-0000000000a2', businessName: 'Not Yours', category: 'RESTAURANT' },
    });
    try {
      const theirs = await prisma.workflow.create({
        data: {
          tenantId: other.id, name: 'Theirs', slug: `theirs_${Date.now()}`,
          category: 'CONVERSATION', status: 'PUBLISHED',
        },
      });

      await as(adminToken).post({
        name: 'Sneaky', body: 'Tap this', buttons: [{ label: 'Tap', workflowId: theirs.id }],
      }).expect(400);
    } finally {
      await prisma.tenant.deleteMany({ where: { id: other.id } });
    }
  });
});

describe('editing a set', () => {
  it('**replaces the answers rather than editing them in place**', async () => {
    /*
     * The property that protects a customer holding a question already on their phone. A button's
     * row id *is* its identity on WhatsApp, so relabelling in place would change what an
     * outstanding tap means — they see "Delivery", tap it, and the row now says "Collection". New
     * rows mean the old ids resolve to nothing, which the inbound handler records and leaves to the
     * agent.
     */
    const created = await as(adminToken).post(A_SET).expect(201);
    const before = created.body.data.buttons.map((b: { id: string }) => b.id);

    const updated = await as(adminToken).patch(created.body.data.id, {
      buttons: [{ label: 'Collection' }, { label: 'Pickup' }],
    }).expect(200);

    const after = updated.body.data.buttons.map((b: { id: string }) => b.id);
    expect(after).toHaveLength(2);
    for (const id of after) expect(before).not.toContain(id);
    expect(updated.body.data.buttons.map((b: { label: string }) => b.label))
      .toEqual(['Collection', 'Pickup']);
  });

  it('leaves the answers alone when the request does not mention them', async () => {
    // Renaming a set must not retire its outstanding buttons as a side effect.
    const created = await as(adminToken).post(A_SET).expect(201);
    const before = created.body.data.buttons.map((b: { id: string }) => b.id);

    const updated = await as(adminToken).patch(created.body.data.id, { name: 'Renamed' }).expect(200);

    expect(updated.body.data.name).toBe('Renamed');
    expect(updated.body.data.buttons.map((b: { id: string }) => b.id)).toEqual(before);
  });

  it('can retire a set without deleting it', async () => {
    const created = await as(adminToken).post(A_SET).expect(201);
    await as(adminToken).patch(created.body.data.id, { isActive: false }).expect(200);

    // Gone from what an agent may send, still present for whoever manages them.
    expect((await as(agentToken).get().expect(200)).body.data).toHaveLength(0);
    expect((await as(adminToken).get().expect(200)).body.data).toHaveLength(1);
  });

  it('cannot reach another workspace’s set', async () => {
    const other = await prisma.tenant.create({
      data: { id: 'eeeeeeee-0000-0000-0000-0000000000a3', businessName: 'Not Yours', category: 'RESTAURANT' },
    });
    try {
      const theirs = await prisma.quickReply.create({
        data: {
          tenantId: other.id, name: 'Theirs', body: 'Theirs',
          buttons: { create: [{ label: 'Tap', position: 0 }] },
        },
      });

      await as(adminToken).patch(theirs.id, { name: 'Mine now' }).expect(404);
      await as(adminToken).remove(theirs.id).expect(404);
    } finally {
      await prisma.tenant.deleteMany({ where: { id: other.id } });
    }
  });
});

describe('who may do what', () => {
  it('**lets an agent read the sets, because they have to send them**', async () => {
    await as(adminToken).post(A_SET).expect(201);

    const res = await as(agentToken).get().expect(200);
    expect(res.body.data).toHaveLength(1);
  });

  it('**does not let an agent decide what a tap starts**', async () => {
    // The split that matters. Answering messages and configuring automation are different jobs,
    // and binding a button to a workflow is the second one.
    await as(agentToken).post({
      name: 'Mine', body: 'Tap this', buttons: [{ label: 'Yes', workflowId: publishedWorkflowId }],
    }).expect(403);
  });

  it('does not let an agent edit or delete one either', async () => {
    const created = await as(adminToken).post(A_SET).expect(201);

    await as(agentToken).patch(created.body.data.id, { name: 'Mine' }).expect(403);
    await as(agentToken).remove(created.body.data.id).expect(403);
  });
});

describe('deleting a set', () => {
  it('takes its answers with it', async () => {
    const created = await as(adminToken).post(A_SET).expect(201);

    await as(adminToken).remove(created.body.data.id).expect(200);

    expect(await prisma.quickReplyButton.count({ where: { quickReplyId: created.body.data.id } }))
      .toBe(0);
  });

  it('**survives the workflow it pointed at being deleted**', async () => {
    /*
     * `SetNull`, not `Cascade`. Tidying up an unused workflow must turn its buttons back into plain
     * answers, not silently remove a question the team asks a hundred times a week.
     */
    const created = await as(adminToken).post({
      name: 'Book a slot',
      body: 'Would you like to book?',
      buttons: [{ label: 'Yes, book', workflowId: publishedWorkflowId }],
    }).expect(201);

    await prisma.workflow.delete({ where: { id: publishedWorkflowId } });

    const still = await prisma.quickReply.findUniqueOrThrow({
      where: { id: created.body.data.id }, include: { buttons: true },
    });
    expect(still.buttons).toHaveLength(1);
    expect(still.buttons[0]!.workflowId).toBeNull();
  });
});
