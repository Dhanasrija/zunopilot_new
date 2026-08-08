import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildApp } from '../app.js';
import { prisma } from '../config/prisma.js';
import { signToken } from '../utils/jwt.js';
import { seedDefaultRoles } from '../services/role.service.js';
import { windowStateFor } from '../modules/support/ticket.service.js';

/*
 * Removing a message from the Inbox.
 *
 * A soft delete, and the interesting half of this file is not that hiding works — it is **which
 * reads honour it and which must not**. Get that split wrong in either direction and the failure
 * is quiet:
 *
 *   • Miss a human-facing read, and a removed message reappears somewhere else. The conversation
 *     preview and the customer's profile are the two that are easy to forget, because neither is
 *     the screen you were looking at when you removed it.
 *   • Filter something that reasons about what *actually happened*, and an agent tidying a thread
 *     silently changes what WhatsApp permits. `windowStateFor` reads the customer's last inbound
 *     message to decide whether a free reply is still allowed; if a removal could close that
 *     window, the button would break sending.
 *
 * So there are assertions in both directions, and the second set is the reason this file is long.
 */

const TENANT = '88888888-8888-8888-8888-88888888e001';
const OTHER = '88888888-8888-8888-8888-88888888e002';
const app = buildApp();

let owner: string;
let agent: string;
let otherOwner: string;
let ctx: Awaited<ReturnType<typeof makeThread>>;

const wipe = async () => {
  /*
   * Notes go first, explicitly.
   *
   * `InternalNote.author` has no `onDelete`, so it is Restrict — unlike `Message.sentByUserId`,
   * which is SetNull. Deleting the tenant cascades to its users, and a note still pointing at one
   * blocks the whole teardown with a foreign-key error that names the note rather than the cause.
   */
  await prisma.internalNote.deleteMany({
    where: { conversation: { tenantId: { in: [TENANT, OTHER] } } },
  });
  await prisma.tenant.deleteMany({ where: { id: { in: [TENANT, OTHER] } } });
};

/** A workspace, a customer, a conversation, and three messages in it. */
const makeThread = async (tenantId: string, phone: string) => {
  await prisma.tenant.create({
    data: { id: tenantId, businessName: `Del ${tenantId.slice(-4)}`, category: 'RESTAURANT' },
  });
  await seedDefaultRoles(prisma, tenantId);
  const roles = await prisma.role.findMany({ where: { tenantId } });
  const ownerRole = roles.find((r) => r.isOwner)!;
  const agentRole = roles.find((r) => !r.isOwner && !r.permissions.includes('inbox:delete'))!;

  const ownerUser = await prisma.user.create({
    data: { tenantId, phone, fullName: 'Owner', role: 'OWNER', roleId: ownerRole.id },
  });
  const agentUser = await prisma.user.create({
    data: {
      tenantId, phone: `${phone}9`, fullName: 'Agent', role: 'AGENT', roleId: agentRole.id,
    },
  });

  const customer = await prisma.customer.create({
    data: { tenantId, waId: `1555800${tenantId.slice(-4)}`, name: 'Asha' },
  });
  const conversation = await prisma.conversation.create({
    data: { tenantId, customerId: customer.id, status: 'OPEN', lastMessageAt: new Date() },
  });

  const make = (over: Record<string, unknown>) => prisma.message.create({
    data: {
      tenantId,
      conversationId: conversation.id,
      customerId: customer.id,
      direction: 'INBOUND',
      type: 'TEXT',
      status: 'RECEIVED',
      ...over,
    },
  });

  /*
   * An hour ago, so the 24-hour window is open and a removal could plausibly close it — and
   * **strictly increasing**, so `newest` really is the newest.
   *
   * The first version gave `first` and `newest` the same timestamp, which made `reply` the latest
   * by `createdAt`. The conversation-list preview takes one row ordered by `createdAt desc`, so it
   * was returning `reply` and the assertion "the preview no longer contains `newest`" passed
   * whether the filter was there or not — the mutation check caught it, the test did not.
   */
  const anHourAgo = Date.now() - 60 * 60 * 1000;
  const at = (offsetMs: number) => new Date(anHourAgo + offsetMs);

  const first = await make({ body: 'Do you deliver to Banjara Hills?', createdAt: at(0) });
  const reply = await make({
    direction: 'OUTBOUND', status: 'SENT', body: 'We do — 45 minutes.', sentByUserId: ownerUser.id,
    createdAt: at(1_000),
  });
  const newest = await make({ body: 'Great, order placed.', createdAt: at(2_000) });

  return {
    customer, conversation, first, reply, newest, ownerUser, agentUser,
    ownerToken: signToken({ userId: ownerUser.id, tenantId }),
    agentToken: signToken({ userId: agentUser.id, tenantId }),
  };
};

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

const thread = (token: string) => request(app)
  .get(`/api/inbox/conversations/${ctx.conversation.id}/messages`).set(auth(token));

beforeEach(async () => {
  await wipe();
  ctx = await makeThread(TENANT, '15558000001');
  owner = ctx.ownerToken;
  agent = ctx.agentToken;
  otherOwner = (await makeThread(OTHER, '15558000002')).ownerToken;
});

afterAll(async () => {
  await wipe();
  await prisma.$disconnect();
});

describe('removing one message', () => {
  it('**takes it out of the thread and leaves the rest**', async () => {
    await request(app).delete(`/api/inbox/messages/${ctx.reply.id}`)
      .set(auth(owner)).expect(200);

    const after = await thread(owner).expect(200);
    const ids = after.body.data.map((m: { id: string }) => m.id);
    expect(ids).not.toContain(ctx.reply.id);
    expect(ids).toContain(ctx.first.id);
    expect(ids).toContain(ctx.newest.id);
  });

  it('**keeps the row, with who removed it and when**', async () => {
    // The point of a soft delete. A message is the evidence in a payment dispute, and an agent
    // tidying a thread must not be able to destroy the record of what a customer was promised.
    await request(app).delete(`/api/inbox/messages/${ctx.reply.id}`).set(auth(owner)).expect(200);

    const row = await prisma.message.findUnique({ where: { id: ctx.reply.id } });
    expect(row).not.toBeNull();
    expect(row!.deletedAt).not.toBeNull();
    expect(row!.deletedByUserId).toBe(ctx.ownerUser.id);
    // The content survives, because that is the record.
    expect(row!.body).toBe('We do — 45 minutes.');
  });

  it('is idempotent, and keeps the first remover', async () => {
    await request(app).delete(`/api/inbox/messages/${ctx.reply.id}`).set(auth(owner)).expect(200);
    const first = await prisma.message.findUnique({ where: { id: ctx.reply.id } });

    // A second attempt is a 404 rather than a silent overwrite of who did it.
    await request(app).delete(`/api/inbox/messages/${ctx.reply.id}`).set(auth(owner)).expect(404);

    const second = await prisma.message.findUnique({ where: { id: ctx.reply.id } });
    expect(second!.deletedAt).toEqual(first!.deletedAt);
    expect(second!.deletedByUserId).toBe(ctx.ownerUser.id);
  });
});

describe('everywhere else a message is shown', () => {
  it("**disappears from the conversation list's preview too**", async () => {
    // The most obvious way a half-applied soft delete announces itself: gone from the thread,
    // still quoted in the list beside the customer's name.
    await request(app).delete(`/api/inbox/messages/${ctx.newest.id}`).set(auth(owner)).expect(200);

    const list = await request(app).get('/api/inbox/conversations').set(auth(owner)).expect(200);
    const row = list.body.data.find((c: { id: string }) => c.id === ctx.conversation.id);
    const previewIds = (row.messages ?? []).map((m: { id: string }) => m.id);
    expect(previewIds).not.toContain(ctx.newest.id);
    // And it falls back to the one before, rather than showing nothing. Asserting the positive
    // too is what makes this test fail when the filter is removed — without it, a preview that
    // still quoted the removed message would only be caught by luck of the ordering.
    expect(previewIds).toEqual([ctx.reply.id]);
  });

  it("**disappears from the customer's own history**", async () => {
    // Same messages under a different heading. Filtering one and not the other is the bug.
    await request(app).delete(`/api/inbox/messages/${ctx.reply.id}`).set(auth(owner)).expect(200);

    const history = await request(app)
      .get(`/api/customers/${ctx.customer.id}/messages`).set(auth(owner)).expect(200);
    const ids = history.body.data.map((m: { id: string }) => m.id);
    expect(ids).not.toContain(ctx.reply.id);
    expect(ids).toContain(ctx.first.id);
  });
});

describe('what a removal must NOT change', () => {
  it('**does not close the 24-hour window**', async () => {
    /*
     * The invariant that matters most. `windowStateFor` reads the customer's last inbound message
     * to decide whether WhatsApp still allows a free-form reply — a fact about Meta's rules, not
     * about our UI. If removing a message could close that window, an agent tidying a thread
     * would silently break their own ability to answer.
     */
    const before = await windowStateFor(TENANT, ctx.conversation.id);
    expect(before.open).toBe(true);

    // Remove every inbound message, which is the worst case for this.
    await request(app).delete(`/api/inbox/messages/${ctx.first.id}`).set(auth(owner)).expect(200);
    await request(app).delete(`/api/inbox/messages/${ctx.newest.id}`).set(auth(owner)).expect(200);

    const after = await windowStateFor(TENANT, ctx.conversation.id);
    expect(after.open).toBe(true);
    expect(after.lastInboundAt).toEqual(before.lastInboundAt);
  });

  it('**does not change the analytics counters**', async () => {
    // Reports are the record of what happened. Tidying an inbox is not a correction to history.
    const read = () => request(app).get('/api/analytics/message-stats').set(auth(owner));
    const before = await read().expect(200);

    await request(app).delete(`/api/inbox/messages/${ctx.reply.id}`).set(auth(owner)).expect(200);

    const after = await read().expect(200);
    expect(after.body.data).toEqual(before.body.data);
  });
});

describe('clearing a whole thread', () => {
  it('**removes every message and reports how many**', async () => {
    const response = await request(app)
      .delete(`/api/inbox/conversations/${ctx.conversation.id}/messages`)
      .set(auth(owner)).expect(200);

    expect(response.body.data.removed).toBe(3);
    expect((await thread(owner).expect(200)).body.data).toEqual([]);
  });

  it('**leaves the conversation, the customer and the notes standing**', async () => {
    // Messages only. Deleting the conversation row would cascade into its notes and workflow
    // instances and unlink any ticket — a great deal of collateral for "clear this chat".
    await prisma.internalNote.create({
      data: {
        conversationId: ctx.conversation.id,
        authorId: ctx.ownerUser.id,
        body: 'Called to confirm the address.',
      },
    });

    await request(app).delete(`/api/inbox/conversations/${ctx.conversation.id}/messages`)
      .set(auth(owner)).expect(200);

    const conversation = await request(app)
      .get(`/api/inbox/conversations/${ctx.conversation.id}`).set(auth(owner)).expect(200);
    expect(conversation.body.data.notes).toHaveLength(1);
    expect(conversation.body.data.customer.id).toBe(ctx.customer.id);

    // And it is still in the list, reading as empty rather than vanishing.
    const list = await request(app).get('/api/inbox/conversations').set(auth(owner)).expect(200);
    expect(list.body.data.map((c: { id: string }) => c.id)).toContain(ctx.conversation.id);
  });

  it('leaves lastMessageAt alone, so the queue does not reorder', async () => {
    const before = await prisma.conversation.findUnique({ where: { id: ctx.conversation.id } });

    await request(app).delete(`/api/inbox/conversations/${ctx.conversation.id}/messages`)
      .set(auth(owner)).expect(200);

    const after = await prisma.conversation.findUnique({ where: { id: ctx.conversation.id } });
    expect(after!.lastMessageAt).toEqual(before!.lastMessageAt);
  });

  it('answers 0 on an already-empty thread rather than failing', async () => {
    await request(app).delete(`/api/inbox/conversations/${ctx.conversation.id}/messages`)
      .set(auth(owner)).expect(200);
    const again = await request(app)
      .delete(`/api/inbox/conversations/${ctx.conversation.id}/messages`)
      .set(auth(owner)).expect(200);
    expect(again.body.data.removed).toBe(0);
  });
});

describe('who may do it', () => {
  it('**an agent may not**, though they can reply', async () => {
    // The only inbox capability that takes something away. The person who most needs to answer
    // customers is not automatically the person who should be able to clear a thread.
    await request(app).delete(`/api/inbox/messages/${ctx.reply.id}`).set(auth(agent)).expect(403);
    await request(app).delete(`/api/inbox/conversations/${ctx.conversation.id}/messages`)
      .set(auth(agent)).expect(403);

    // Still there.
    const ids = (await thread(agent).expect(200)).body.data.map((m: { id: string }) => m.id);
    expect(ids).toContain(ctx.reply.id);
  });

  it('an owner may, without the permission being granted to them by hand', async () => {
    // `resolvePermissions` gives an owner role everything, so a new key needs no data migration.
    await request(app).delete(`/api/inbox/messages/${ctx.reply.id}`).set(auth(owner)).expect(200);
  });

  it('needs a session at all', async () => {
    await request(app).delete(`/api/inbox/messages/${ctx.reply.id}`).expect(401);
  });
});

describe('across workspaces', () => {
  it("**cannot remove another workspace's message**", async () => {
    await request(app).delete(`/api/inbox/messages/${ctx.reply.id}`)
      .set(auth(otherOwner)).expect(404);

    const row = await prisma.message.findUnique({ where: { id: ctx.reply.id } });
    expect(row!.deletedAt).toBeNull();
  });

  it("cannot clear another workspace's thread", async () => {
    await request(app).delete(`/api/inbox/conversations/${ctx.conversation.id}/messages`)
      .set(auth(otherOwner)).expect(404);
    expect(await prisma.message.count({
      where: { conversationId: ctx.conversation.id, deletedAt: null },
    })).toBe(3);
  });
});
