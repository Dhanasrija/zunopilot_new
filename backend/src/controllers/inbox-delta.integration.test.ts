import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { seedMemberships } from '../test-support/members.js';
import { buildApp } from '../app.js';
import { prisma } from '../config/prisma.js';
import { signToken } from '../utils/jwt.js';
import { seedDefaultRoles } from '../services/role.service.js';

/*
 * Asking what changed, instead of downloading the thread again.
 *
 * ── What this is for ────────────────────────────────────────────────────────
 *
 * The web Inbox polls the conversation list and the open thread **once a second**, and both reads
 * return everything. That is affordable on a laptop and not on a phone, which is why the Flutter
 * app needs a delta — and why the properties below are about the three ways a delta silently loses
 * something rather than about the happy path.
 *
 *   1. **A status tick is a change to a row that already exists.** SENT → DELIVERED → READ arrive
 *      as three webhooks against one message. A cursor on `createdAt` would hand the client the
 *      message once and never mention it again, so the ticks would never move — and the ticks are
 *      the reason the poll is one second in the first place.
 *
 *   2. **A removal has to be reported as a removal.** Filtering deleted rows out of a delta makes
 *      "deleted" indistinguishable from "unchanged", and the client shows the message for ever.
 *
 *   3. **A cursor made only of a timestamp skips ties.** `updateMany` stamps every row it touches
 *      with one value, so clearing a thread gives hundreds of messages the same `updatedAt`. A
 *      cursor that advanced past a full page would step over whatever ties fell after the cut.
 *
 * The fourth property is the boring but expensive one: **the response for a client that sends no
 * cursor is byte-for-byte what it was before this existed**, because the web app is that client.
 */

const TENANT = '77777777-7777-7777-7777-77777777d001';
const app = buildApp();

let token: string;
let conversationId: string;
let customerId: string;

const wipe = () => prisma.tenant.deleteMany({ where: { id: TENANT } });

/** One workspace, one conversation, two messages an hour old. */
const seed = async () => {
  await prisma.tenant.create({
    data: { id: TENANT, businessName: 'Delta Diner', category: 'RESTAURANT' },
  });
  await seedDefaultRoles(prisma, TENANT);
  const ownerRole = await prisma.role.findFirstOrThrow({ where: { tenantId: TENANT, isOwner: true } });
  const user = await prisma.user.create({
    data: { tenantId: TENANT, phone: '15558804001', fullName: 'Owner', role: 'OWNER', roleId: ownerRole.id },
  });
  await seedMemberships();
  token = signToken({ userId: user.id, tenantId: TENANT });

  const customer = await prisma.customer.create({
    data: { tenantId: TENANT, waId: '15558804099', name: 'Asha' },
  });
  customerId = customer.id;
  const conversation = await prisma.conversation.create({
    data: { tenantId: TENANT, customerId: customer.id, status: 'OPEN', lastMessageAt: new Date() },
  });
  conversationId = conversation.id;

  const anHourAgo = Date.now() - 3_600_000;
  await prisma.message.create({
    data: {
      tenantId: TENANT, conversationId: conversation.id, customerId: customer.id,
      direction: 'INBOUND', type: 'TEXT', status: 'RECEIVED', body: 'Do you deliver?',
      createdAt: new Date(anHourAgo),
    },
  });
  return prisma.message.create({
    data: {
      tenantId: TENANT, conversationId: conversation.id, customerId: customer.id,
      direction: 'OUTBOUND', type: 'TEXT', status: 'SENT', body: 'We do.',
      sentByUserId: user.id, createdAt: new Date(anHourAgo + 1_000),
    },
  });
};

let reply: Awaited<ReturnType<typeof seed>>;

beforeEach(async () => {
  await wipe();
  reply = await seed();
});

afterAll(async () => {
  await wipe();
  await prisma.$disconnect();
});

const messages = (query = '') => request(app)
  .get(`/api/inbox/conversations/${conversationId}/messages${query}`)
  .set('Authorization', `Bearer ${token}`);

const conversations = (query = '') => request(app)
  .get(`/api/inbox/conversations${query}`)
  .set('Authorization', `Bearer ${token}`);

/** Read the whole thread, and take the cursor it hands back. */
const catchUp = async () => {
  const res = await messages().expect(200);
  return res.body.meta as { nextSince: string; nextSinceId: string | null; hasMore: boolean };
};

describe('the thread, without a cursor', () => {
  it('**is exactly what it always was**', async () => {
    // The web Inbox is this client, and it reads `data` as an array. A delta bolted on as a wrapper
    // object would have broken every screen in the product on deploy.
    const res = await messages().expect(200);

    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0].body).toBe('Do you deliver?');
    // Oldest first, still.
    expect(res.body.data[1].body).toBe('We do.');
  });

  it('hands back a cursor taken before the read, not after it', async () => {
    const before = new Date();
    const meta = await catchUp();

    // Between the two: a cursor stamped after the query finished would step over anything written
    // while it ran.
    expect(new Date(meta.nextSince).getTime()).toBeGreaterThanOrEqual(before.getTime() - 1_000);
    expect(new Date(meta.nextSince).getTime()).toBeLessThanOrEqual(Date.now());
    expect(meta.hasMore).toBe(false);
  });
});

describe('the thread, with a cursor', () => {
  it('says nothing when nothing has happened', async () => {
    const meta = await catchUp();

    const res = await messages(`?since=${encodeURIComponent(meta.nextSince)}`).expect(200);
    expect(res.body.data).toEqual([]);
  });

  it('**does not advance the cursor on an empty delta**', async () => {
    /*
     * The subtle one. Advancing to "now" when nothing came back would step over any row written
     * between the query running and the response being built — a message lost, with no error and
     * nothing to notice.
     */
    const meta = await catchUp();

    const res = await messages(`?since=${encodeURIComponent(meta.nextSince)}`).expect(200);
    expect(res.body.meta.nextSince).toBe(meta.nextSince);
  });

  it('carries a new message and nothing else', async () => {
    const meta = await catchUp();

    const fresh = await prisma.message.create({
      data: {
        tenantId: TENANT, conversationId, customerId,
        direction: 'INBOUND', type: 'TEXT', status: 'RECEIVED', body: 'And to Gachibowli?',
      },
    });

    const res = await messages(`?since=${encodeURIComponent(meta.nextSince)}`).expect(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].id).toBe(fresh.id);
  });

  it('**carries a delivery tick, which is a change to a row the client already has**', async () => {
    /*
     * The property that decides whether the app can stop polling. A tick is not a new row: the
     * status webhook updates the message that was sent minutes ago. On a `createdAt` cursor this
     * test returns an empty array and the app's ticks never move.
     */
    const meta = await catchUp();

    await prisma.message.update({
      where: { id: reply.id },
      data: { status: 'DELIVERED', deliveredAt: new Date() },
    });

    const res = await messages(`?since=${encodeURIComponent(meta.nextSince)}`).expect(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].id).toBe(reply.id);
    expect(res.body.data[0].status).toBe('DELIVERED');
  });

  it('**reports a removal as a tombstone, with the content stripped**', async () => {
    const meta = await catchUp();

    await request(app)
      .delete(`/api/inbox/messages/${reply.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const res = await messages(`?since=${encodeURIComponent(meta.nextSince)}`).expect(200);
    const [row] = res.body.data;

    expect(row.id).toBe(reply.id);
    expect(row.deletedAt).not.toBeNull();
    // The client's rule is "deletedAt set means drop it", but the body is withheld here as well —
    // so a client that has not implemented that rule yet still cannot show what an agent deleted.
    expect(row.body).toBeUndefined();
  });

  it('a full read still hides the removed message entirely', async () => {
    // The other half of the same behaviour: dropping `deletedAt: null` for the delta must not have
    // leaked removed messages into the ordinary read.
    await request(app)
      .delete(`/api/inbox/messages/${reply.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const res = await messages().expect(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data.map((m: { id: string }) => m.id)).not.toContain(reply.id);
  });

  it('**breaks ties at one timestamp with the id, rather than skipping them**', async () => {
    /*
     * The tie is made the way production makes it: one `updateMany`, which stamps every row it
     * touches with a single timestamp. Clearing a thread does exactly this, to every message in it.
     *
     * A timestamp-only cursor cannot express "after this row but not before it", so a client that
     * received the first of a tie and asked for more would either be handed it again for ever or
     * never be handed the second.
     */
    await prisma.message.updateMany({
      where: { conversationId },
      data: { status: 'DELIVERED' },
    });

    const both = await prisma.message.findMany({
      where: { conversationId }, orderBy: { id: 'asc' }, select: { id: true, updatedAt: true },
    });
    // The premise of the test: both rows really do share one timestamp.
    expect(both[0]!.updatedAt.getTime()).toBe(both[1]!.updatedAt.getTime());
    const iso = both[0]!.updatedAt.toISOString();

    // Standing exactly on the shared timestamp, having seen the first of the two.
    const res = await messages(
      `?since=${encodeURIComponent(iso)}&sinceId=${both[0]!.id}`,
    ).expect(200);

    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].id).toBe(both[1]!.id);
  });

  it('refuses a cursor it cannot read', async () => {
    // Rather than silently doing a full read, which would work and would hide the client's bug for
    // months while every poll re-downloaded the thread.
    const res = await messages('?since=yesterday%20afternoon').expect(400);
    expect(res.body.message).toMatch(/ISO 8601/);
  });
});

describe('the conversation list, with a cursor', () => {
  it('**carries only the conversation that changed**', async () => {
    const other = await prisma.conversation.create({
      data: {
        tenantId: TENANT,
        customerId: (await prisma.customer.create({
          data: { tenantId: TENANT, waId: '15558804098', name: 'Ravi' },
        })).id,
        status: 'OPEN',
        lastMessageAt: new Date(),
      },
    });

    const first = await conversations().expect(200);
    expect(first.body.data).toHaveLength(2);

    await prisma.conversation.update({ where: { id: other.id }, data: { unreadCount: 3 } });

    const res = await conversations(
      `?since=${encodeURIComponent(first.body.meta.nextSince)}`,
    ).expect(200);

    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].id).toBe(other.id);
    expect(res.body.data[0].unreadCount).toBe(3);
  });

  it('is still tenant-scoped when a cursor is in play', async () => {
    /*
     * The cursor adds an `OR` to the `where`, and an `OR` written at the wrong nesting level would
     * be read as "this tenant's rows **or** anything modified since" — every workspace's
     * conversations, with a valid token. Worth one assertion.
     */
    const otherTenant = await prisma.tenant.create({
      data: { id: '77777777-7777-7777-7777-77777777d002', businessName: 'Not Yours', category: 'RESTAURANT' },
    });
    try {
      const stranger = await prisma.customer.create({
        data: { tenantId: otherTenant.id, waId: '15558804097', name: 'Stranger' },
      });
      await prisma.conversation.create({
        data: {
          tenantId: otherTenant.id, customerId: stranger.id, status: 'OPEN', lastMessageAt: new Date(),
        },
      });

      const res = await conversations('?since=1970-01-01T00:00:00.000Z').expect(200);

      expect(res.body.data.length).toBeGreaterThan(0);
      for (const row of res.body.data) expect(row.tenantId).toBe(TENANT);
    } finally {
      await prisma.tenant.deleteMany({ where: { id: otherTenant.id } });
    }
  });

  it('reports when there is more waiting, so the client asks again now', async () => {
    // `hasMore` exists so a client that has fallen behind catches up in a burst instead of one page
    // per poll interval. With two conversations and no cursor there is nothing more.
    const res = await conversations().expect(200);
    expect(res.body.meta.hasMore).toBe(false);
  });
});

describe('what the cursor is made of', () => {
  it('**is `updatedAt`, and every message write moves it**', async () => {
    /*
     * Guards the schema rather than the endpoint. `Message.updatedAt` is `@updatedAt`, which Prisma
     * sets on the client side — so a write that bypassed Prisma, or a column that lost the
     * attribute in a schema tidy-up, would leave the delta permanently blind to that kind of change
     * with nothing failing anywhere else.
     */
    const before = await prisma.message.findUniqueOrThrow({ where: { id: reply.id } });

    await prisma.message.update({ where: { id: reply.id }, data: { status: 'READ' } });

    const afterWrite = await prisma.message.findUniqueOrThrow({ where: { id: reply.id } });
    expect(afterWrite.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());
    // And the row is still the same age it was: `createdAt` is not what moved.
    expect(afterWrite.createdAt.getTime()).toBe(before.createdAt.getTime());
  });

  it('starts life equal to createdAt for a row nobody has touched', async () => {
    // What the migration's backfill asserts for every message that existed before the column did.
    // A default of NOW() there would have made the whole history look freshly changed, and the
    // first delta any client asked for would have been the entire thread.
    const fresh = await prisma.message.create({
      data: {
        tenantId: TENANT, conversationId, customerId,
        direction: 'INBOUND', type: 'TEXT', status: 'RECEIVED', body: 'Untouched',
      },
    });
    expect(fresh.updatedAt.getTime()).toBe(fresh.createdAt.getTime());
  });
});
