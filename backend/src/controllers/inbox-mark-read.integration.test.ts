import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildApp } from '../app.js';
import { prisma } from '../config/prisma.js';
import { signToken } from '../utils/jwt.js';
import { seedDefaultRoles } from '../services/role.service.js';

/*
 * Reading a thread.
 *
 * **Two columns describe one fact** — "nobody has looked at this yet". `Conversation.unreadCount`
 * draws the badge on the row; unread `Notification` rows draw the bell. Before this they were
 * cleared by different actions, so the bell could insist eight things were waiting while the
 * Inbox showed nothing outstanding, and neither number was wrong on its own terms.
 *
 * So the assertions come in pairs: the badge cleared, *and* the bell agrees. And the harder half
 * is what must **not** be cleared — a colleague's own notification, another thread's, another
 * tenant's. Marking too much read is the failure that loses work silently, because the thing that
 * disappears is the reminder that something needed doing.
 */

const TENANT = '77777777-7777-7777-7777-77777777f001';
const OTHER = '77777777-7777-7777-7777-77777777f002';
const app = buildApp();

const wipe = async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [TENANT, OTHER] } } });
};

/** A workspace with two people, one conversation carrying three unread messages, and a second thread. */
const makeWorkspace = async (tenantId: string, phone: string) => {
  await prisma.tenant.create({
    data: { id: tenantId, businessName: `Read ${tenantId.slice(-4)}`, category: 'RESTAURANT' },
  });
  await seedDefaultRoles(prisma, tenantId);
  const roles = await prisma.role.findMany({ where: { tenantId } });
  const ownerRole = roles.find((r) => r.isOwner)!;
  const agentRole = roles.find((r) => !r.isOwner)!;

  const ownerUser = await prisma.user.create({
    data: { tenantId, phone, fullName: 'Owner', role: 'OWNER', roleId: ownerRole.id },
  });
  const agentUser = await prisma.user.create({
    data: { tenantId, phone: `${phone}9`, fullName: 'Agent', role: 'AGENT', roleId: agentRole.id },
  });

  const customer = await prisma.customer.create({
    data: { tenantId, waId: `1555900${tenantId.slice(-4)}`, name: 'Asha' },
  });

  const thread = await prisma.conversation.create({
    data: {
      tenantId, customerId: customer.id, status: 'OPEN', lastMessageAt: new Date(), unreadCount: 3,
    },
  });
  // A second thread, so "cleared the right one" is testable rather than assumed.
  const otherThread = await prisma.conversation.create({
    data: {
      tenantId, customerId: customer.id, status: 'OPEN', lastMessageAt: new Date(), unreadCount: 5,
    },
  });

  await prisma.message.create({
    data: {
      tenantId,
      conversationId: thread.id,
      customerId: customer.id,
      direction: 'INBOUND',
      type: 'TEXT',
      status: 'RECEIVED',
      body: 'Do you deliver to Banjara Hills?',
    },
  });

  return {
    customer, thread, otherThread, ownerUser, agentUser,
    ownerToken: signToken({ userId: ownerUser.id, tenantId }),
    agentToken: signToken({ userId: agentUser.id, tenantId }),
  };
};

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

/** A notification, unread. `dedupeKey` left null — many nulls are fine under a unique index. */
const notify = (
  tenantId: string,
  over: { userId?: string | null; conversationId?: string | null; title?: string } = {},
) => prisma.notification.create({
  data: {
    tenantId,
    kind: 'MESSAGE_RECEIVED',
    title: over.title ?? 'Asha sent a message',
    body: 'Do you deliver to Banjara Hills?',
    userId: over.userId ?? null,
    conversationId: over.conversationId ?? null,
  },
});

const readAtOf = async (id: string) =>
  (await prisma.notification.findUniqueOrThrow({ where: { id } })).readAt;

const unreadCountOf = async (id: string) =>
  (await prisma.conversation.findUniqueOrThrow({ where: { id } })).unreadCount;

describe('POST /api/inbox/conversations/:id/read', () => {
  let ctx: Awaited<ReturnType<typeof makeWorkspace>>;
  let other: Awaited<ReturnType<typeof makeWorkspace>>;

  beforeEach(async () => {
    await wipe();
    ctx = await makeWorkspace(TENANT, '15559990001');
    other = await makeWorkspace(OTHER, '15559990002');
  });

  afterAll(async () => {
    await wipe();
    await prisma.$disconnect();
  });

  const markRead = (conversationId: string, token: string) =>
    request(app).post(`/api/inbox/conversations/${conversationId}/read`).set(auth(token));

  it('**clears the badge and the bell together**', async () => {
    /*
     * The whole point. Before this, the frontend never called this route at all, so `unreadCount`
     * only ever incremented and the badge on every row was a lifetime count of inbound messages.
     */
    const workspaceWide = await notify(TENANT, { conversationId: ctx.thread.id });

    const res = await markRead(ctx.thread.id, ctx.ownerToken).expect(200);
    expect(res.body.data).toEqual({ cleared: true, notificationsRead: 1 });

    expect(await unreadCountOf(ctx.thread.id)).toBe(0);
    expect(await readAtOf(workspaceWide.id)).not.toBeNull();
  });

  it('**does not clear a colleague’s own notification**', async () => {
    /*
     * A notification addressed to a *named* person is about their queue, not about whether the
     * messages have been seen. A handoff assigned to the agent must survive the owner reading the
     * thread, or the agent loses the only record that it was theirs to answer.
     *
     * This is what `visibleTo`'s `OR` buys, and it is the assertion that fails if someone
     * simplifies the where clause to `{ tenantId, conversationId }`.
     */
    const mine = await notify(TENANT, { userId: ctx.ownerUser.id, conversationId: ctx.thread.id });
    const theirs = await notify(TENANT, { userId: ctx.agentUser.id, conversationId: ctx.thread.id });
    const workspaceWide = await notify(TENANT, { conversationId: ctx.thread.id });

    const res = await markRead(ctx.thread.id, ctx.ownerToken).expect(200);
    expect(res.body.data.notificationsRead).toBe(2);

    expect(await readAtOf(mine.id)).not.toBeNull();
    expect(await readAtOf(workspaceWide.id)).not.toBeNull();
    expect(await readAtOf(theirs.id)).toBeNull();
  });

  it('**leaves another thread’s notification alone**', async () => {
    // Without the `conversationId` filter this route would be `read-all` wearing a path parameter.
    const here = await notify(TENANT, { conversationId: ctx.thread.id });
    const elsewhere = await notify(TENANT, { conversationId: ctx.otherThread.id });
    const unattached = await notify(TENANT, { conversationId: null, title: 'Order #41 placed' });

    await markRead(ctx.thread.id, ctx.ownerToken).expect(200);

    expect(await readAtOf(here.id)).not.toBeNull();
    expect(await readAtOf(elsewhere.id)).toBeNull();
    expect(await unreadCountOf(ctx.otherThread.id)).toBe(5);
    // A notification with no conversation — an order, say — is not about any thread, so reading
    // one cannot dismiss it.
    expect(await readAtOf(unattached.id)).toBeNull();
  });

  it('**cannot reach another tenant**', async () => {
    const mine = await notify(TENANT, { conversationId: ctx.thread.id });
    const theirs = await notify(OTHER, { conversationId: other.thread.id });

    // The other tenant's conversation id, with this tenant's token.
    const res = await markRead(other.thread.id, ctx.ownerToken).expect(200);
    expect(res.body.data).toEqual({ cleared: false, notificationsRead: 0 });

    expect(await unreadCountOf(other.thread.id)).toBe(3);
    expect(await readAtOf(theirs.id)).toBeNull();
    // And nothing of ours was collaterally cleared by the miss.
    expect(await readAtOf(mine.id)).toBeNull();
    expect(await unreadCountOf(ctx.thread.id)).toBe(3);
  });

  it('is idempotent, because it fires on every thread open', async () => {
    await notify(TENANT, { conversationId: ctx.thread.id });

    const first = await markRead(ctx.thread.id, ctx.ownerToken).expect(200);
    const second = await markRead(ctx.thread.id, ctx.ownerToken).expect(200);

    expect(first.body.data.notificationsRead).toBe(1);
    // Already read: nothing to change, and still not an error. The page calls this on open and
    // again on every new message, so a second call must be cheap and quiet.
    expect(second.body.data).toEqual({ cleared: true, notificationsRead: 0 });
    expect(await unreadCountOf(ctx.thread.id)).toBe(0);
  });

  it('an unknown conversation is a no-op, not a 404', async () => {
    // `updateMany`, so a thread a colleague cleared mid-poll does not produce an error toast.
    const res = await markRead('00000000-0000-4000-8000-000000000000', ctx.ownerToken).expect(200);
    expect(res.body.data).toEqual({ cleared: false, notificationsRead: 0 });
  });

  it('**the bell’s own count agrees afterwards**', async () => {
    /*
     * The consequence, asserted through the endpoint the bell actually polls rather than through
     * the rows. Counting from the table would pass even if `visibleTo` and this route disagreed
     * about what the owner can see.
     */
    await notify(TENANT, { conversationId: ctx.thread.id });
    await notify(TENANT, { userId: ctx.ownerUser.id, conversationId: ctx.thread.id });
    await notify(TENANT, { conversationId: ctx.otherThread.id });

    const before = await request(app).get('/api/notifications/unread-count').set(auth(ctx.ownerToken));
    expect(before.body.data.count).toBe(3);

    await markRead(ctx.thread.id, ctx.ownerToken).expect(200);

    const after = await request(app).get('/api/notifications/unread-count').set(auth(ctx.ownerToken));
    // Two gone, the other thread's still waiting — the bell now counts what is genuinely unread.
    expect(after.body.data.count).toBe(1);
  });

  it('an agent with inbox:read may mark read', async () => {
    // No permission of its own: recording that you looked at something you were allowed to look
    // at cannot need more rights than the looking did.
    await markRead(ctx.thread.id, ctx.agentToken).expect(200);
    expect(await unreadCountOf(ctx.thread.id)).toBe(0);
  });

  it('refuses an unauthenticated caller', async () => {
    await request(app).post(`/api/inbox/conversations/${ctx.thread.id}/read`).expect(401);
    expect(await unreadCountOf(ctx.thread.id)).toBe(3);
  });
});

describe('clearing a thread also clears its counters', () => {
  let ctx: Awaited<ReturnType<typeof makeWorkspace>>;

  beforeEach(async () => {
    await wipe();
    ctx = await makeWorkspace(TENANT, '15559990003');
  });

  afterAll(async () => {
    await wipe();
    await prisma.$disconnect();
  });

  it('**an emptied thread cannot still show an unread badge**', async () => {
    /*
     * The sharpest version of the two counters disagreeing: a badge saying 3 on a thread with
     * nothing in it, and a bell entry quoting a message that is no longer there. Clearing a
     * thread is unambiguously "I have dealt with this".
     */
    const about = await notify(TENANT, { conversationId: ctx.thread.id });
    const elsewhere = await notify(TENANT, { conversationId: ctx.otherThread.id });

    await request(app)
      .delete(`/api/inbox/conversations/${ctx.thread.id}/messages`)
      .set(auth(ctx.ownerToken))
      .expect(200);

    expect(await unreadCountOf(ctx.thread.id)).toBe(0);
    expect(await readAtOf(about.id)).not.toBeNull();
    // Still scoped to the one thread.
    expect(await readAtOf(elsewhere.id)).toBeNull();
    expect(await unreadCountOf(ctx.otherThread.id)).toBe(5);
  });
});
