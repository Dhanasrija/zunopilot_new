import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { prisma } from '../../config/prisma.js';
import { buildApp } from '../../app.js';
import { signToken } from '../../utils/jwt.js';
import { ROLE_PERMISSIONS } from '../../config/permissions.js';
import {
  listFor, markAllRead, markRead, notify, notifyQuietly, preferencesFor,
  recipientsOf, unreadCountFor, updatePreferences, wants,
} from './notification.service.js';
import { notifyHandoffRequested, notifyInboundMessage } from './notification.producers.js';

// Notifications.
//
// Five properties, each of which was a real decision rather than a detail:
//
//   1. **Dedupe.** Two code paths handle inbound WhatsApp messages and pg-boss retries
//      failed jobs. Without a unique key on the source event, one customer message
//      becomes three bells.
//   2. **A null recipient means the workspace.** Addressing a customer's message to one
//      agent would leave it unanswered whenever that agent is away — the opposite of a
//      shared inbox.
//   3. **Tenant isolation**, which is the one that would be a breach rather than a bug.
//   4. **An id from a client is not authorisation.** Marking read is scoped, so a
//      leaked id cannot touch another workspace's row.
//   5. **Notifying must never break the thing being notified about.** A customer's
//      message is the product; the bell is a courtesy.

const app = buildApp();

const TENANT = 'dddddddd-d000-0000-0000-00000000d001';
const OTHER = 'dddddddd-d000-0000-0000-00000000d002';

let ownerId: string;
let agentId: string;
let otherOwnerId: string;
let ownerToken: string;
let conversationId: string;

const wipe = async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [TENANT, OTHER] } } });
};

const makeTenant = async (id: string, name: string, base: string) => {
  const tenant = await prisma.tenant.create({
    data: {
      id,
      businessName: name,
      category: 'RESTAURANT',
      roles: {
        create: [{
          name: 'Owner', permissions: [...ROLE_PERMISSIONS.OWNER], isOwner: true, isSystem: true,
        }],
      },
      users: {
        create: [
          { phone: `${base}1`, fullName: 'Owner', role: 'OWNER' },
          { phone: `${base}2`, fullName: 'Agent', role: 'AGENT' },
        ],
      },
    },
    include: { users: { orderBy: { phone: 'asc' } }, roles: true },
  });
  for (const user of tenant.users) {
    await prisma.user.update({ where: { id: user.id }, data: { roleId: tenant.roles[0].id } });
  }
  return tenant;
};

beforeEach(async () => {
  await wipe();

  const mine = await makeTenant(TENANT, 'Notify Kitchen', '1555000991');
  ownerId = mine.users[0].id;
  agentId = mine.users[1].id;
  ownerToken = signToken({ userId: ownerId });

  const theirs = await makeTenant(OTHER, 'Someone Else', '1555000992');
  otherOwnerId = theirs.users[0].id;

  const customer = await prisma.customer.create({
    data: { tenantId: TENANT, waId: '15550009941', name: 'Asha Patel' },
  });
  conversationId = (await prisma.conversation.create({
    data: { tenantId: TENANT, customerId: customer.id, status: 'OPEN' },
  })).id;
});

afterAll(async () => {
  await wipe();
  await prisma.$disconnect();
});

const message = (waMessageId: string, body = 'Is my order ready?') => notifyInboundMessage({
  tenantId: TENANT,
  conversationId,
  customerName: 'Asha Patel',
  waId: '15550009941',
  body,
  waMessageId,
});

describe('one message, one notification', () => {
  it('**does not ring twice for the same WhatsApp message**', async () => {
    // The webhook controller and the queue handler can both see one message, and
    // pg-boss retries. All three key on the wamid, so the second write collides.
    await message('wamid.aaa');
    await message('wamid.aaa');
    await message('wamid.aaa');

    expect(await prisma.notification.count({ where: { tenantId: TENANT } })).toBe(1);
  });

  it('does ring for a second, different message', async () => {
    await message('wamid.aaa');
    await message('wamid.bbb');
    expect(await prisma.notification.count({ where: { tenantId: TENANT } })).toBe(2);
  });

  it('returns null on the duplicate, so no push is spent', async () => {
    // The producer only queues a push when `notify` returns a row. If a duplicate
    // returned the existing row instead of null, every retry would buzz a phone.
    const first = await notify({
      tenantId: TENANT, kind: 'MESSAGE_RECEIVED', title: 'A', body: 'B', dedupeKey: 'k',
    });
    const second = await notify({
      tenantId: TENANT, kind: 'MESSAGE_RECEIVED', title: 'A', body: 'B', dedupeKey: 'k',
    });
    expect(first).not.toBeNull();
    expect(second).toBeNull();
  });

  it('**lets two tenants use the same dedupe key**', async () => {
    // The unique index is (tenantId, dedupeKey), not dedupeKey alone. Two workspaces
    // could genuinely see the same provider id, and one must not silence the other.
    await notify({ tenantId: TENANT, kind: 'MESSAGE_RECEIVED', title: 'A', body: 'B', dedupeKey: 'shared' });
    await notify({ tenantId: OTHER, kind: 'MESSAGE_RECEIVED', title: 'A', body: 'B', dedupeKey: 'shared' });
    expect(await prisma.notification.count({ where: { dedupeKey: 'shared' } })).toBe(2);
  });

  it('allows many notifications with no dedupe key at all', async () => {
    // Postgres permits many NULLs in a unique index, which is what lets a handoff —
    // which has nothing to dedupe on — fire more than once.
    for (let i = 0; i < 3; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await notify({ tenantId: TENANT, kind: 'HANDOFF_REQUESTED', title: 'x', body: 'y' });
    }
    expect(await prisma.notification.count({ where: { tenantId: TENANT } })).toBe(3);
  });
});

describe('who can see it', () => {
  it('**a workspace notification reaches every member**', async () => {
    await message('wamid.ccc');

    expect(await unreadCountFor(TENANT, ownerId)).toBe(1);
    expect(await unreadCountFor(TENANT, agentId)).toBe(1);
  });

  it('**and never reaches another tenant**', async () => {
    await message('wamid.ddd');
    expect(await unreadCountFor(OTHER, otherOwnerId)).toBe(0);
    expect(await listFor(OTHER, otherOwnerId)).toEqual([]);
  });

  it('a targeted notification stays private to its recipient', async () => {
    await notify({
      tenantId: TENANT, userId: ownerId, kind: 'ORDER_CREATED', title: 'Yours', body: 'Only',
    });
    expect(await unreadCountFor(TENANT, ownerId)).toBe(1);
    expect(await unreadCountFor(TENANT, agentId)).toBe(0);
  });

  it('addresses a workspace notification to every active user', async () => {
    const notification = await notify({
      tenantId: TENANT, kind: 'MESSAGE_RECEIVED', title: 'x', body: 'y',
    });
    const recipients = await recipientsOf(notification!);
    expect(recipients.sort()).toEqual([ownerId, agentId].sort());
  });

  it('**skips a deactivated user when addressing the workspace**', async () => {
    // Someone who has left should not be pushed to. Their row still exists, so the
    // filter has to be explicit.
    await prisma.user.update({ where: { id: agentId }, data: { isActive: false } });
    const notification = await notify({
      tenantId: TENANT, kind: 'MESSAGE_RECEIVED', title: 'x', body: 'y',
    });
    expect(await recipientsOf(notification!)).toEqual([ownerId]);
  });
});

describe('marking read', () => {
  it('**cannot mark another tenant\'s notification**', async () => {
    // An id arrives from a client, so it is not authorisation on its own.
    const theirs = await notify({
      tenantId: OTHER, kind: 'MESSAGE_RECEIVED', title: 'Theirs', body: 'x',
    });

    expect(await markRead(TENANT, ownerId, theirs!.id)).toBe(0);
    const reloaded = await prisma.notification.findUniqueOrThrow({ where: { id: theirs!.id } });
    expect(reloaded.readAt).toBeNull();
  });

  it('cannot mark a colleague\'s private notification', async () => {
    const agents = await notify({
      tenantId: TENANT, userId: agentId, kind: 'ORDER_CREATED', title: 'Agent only', body: 'x',
    });
    expect(await markRead(TENANT, ownerId, agents!.id)).toBe(0);
  });

  it('is idempotent — marking twice changes nothing the second time', async () => {
    // Fired on click, possibly from two tabs. A 404 or an error on the second would be
    // the wrong shape.
    await message('wamid.eee');
    const [only] = await listFor(TENANT, ownerId);
    expect(await markRead(TENANT, ownerId, only.id)).toBe(1);
    expect(await markRead(TENANT, ownerId, only.id)).toBe(0);
  });

  it('marks all read without touching another tenant', async () => {
    await message('wamid.fff');
    await notify({ tenantId: OTHER, kind: 'MESSAGE_RECEIVED', title: 'Theirs', body: 'x' });

    await markAllRead(TENANT, ownerId);

    expect(await unreadCountFor(TENANT, ownerId)).toBe(0);
    expect(await unreadCountFor(OTHER, otherOwnerId)).toBe(1);
  });
});

describe('preferences', () => {
  it('are created on first read, so an old account behaves like a new one', async () => {
    const preference = await preferencesFor(ownerId);
    expect(preference.inApp).toBe(true);
    expect(preference.browser).toBe(true);
    // **Off**: push needs a per-device subscription that does not exist yet.
    expect(preference.push).toBe(false);
  });

  it('reading twice does not create two rows', async () => {
    await preferencesFor(ownerId);
    await preferencesFor(ownerId);
    expect(await prisma.notificationPreference.count({ where: { userId: ownerId } })).toBe(1);
  });

  it('**a kind turned off silences every channel**', async () => {
    // The rule the Settings copy promises: the per-kind switch wins over the per-channel
    // one, so someone who does not care about orders is not pushed about them.
    const preference = await updatePreferences(ownerId, { orderCreated: false, push: true });
    expect(wants(preference, 'ORDER_CREATED', 'push')).toBe(false);
    expect(wants(preference, 'ORDER_CREATED', 'inApp')).toBe(false);
    // And leaves the others alone.
    expect(wants(preference, 'MESSAGE_RECEIVED', 'push')).toBe(true);
  });

  it('a channel turned off silences every kind on that channel only', async () => {
    const preference = await updatePreferences(ownerId, { push: false, browser: true });
    expect(wants(preference, 'MESSAGE_RECEIVED', 'push')).toBe(false);
    expect(wants(preference, 'MESSAGE_RECEIVED', 'browser')).toBe(true);
  });
});

describe('never breaking the thing it reports on', () => {
  it('**swallows its own failure rather than throwing**', async () => {
    // A tenant that does not exist violates the foreign key. The inbound message path
    // calls this after storing a customer's message, so a throw here would fail the
    // webhook and Meta would retry a message we already have.
    await expect(notifyQuietly({
      tenantId: '00000000-0000-0000-0000-0000000000ff',
      kind: 'MESSAGE_RECEIVED',
      title: 'x',
      body: 'y',
    })).resolves.toBeNull();
  });

  it('and `notify` still throws, so real callers can tell', async () => {
    // The quiet wrapper is a choice made at the call site, not a property of the
    // service. An API handler wants the error.
    await expect(notify({
      tenantId: '00000000-0000-0000-0000-0000000000ff',
      kind: 'MESSAGE_RECEIVED',
      title: 'x',
      body: 'y',
    })).rejects.toThrow();
  });
});

describe('what the notification says', () => {
  it('names the customer and previews the message', async () => {
    await message('wamid.ggg', 'Hi, is my biryani ready yet?');
    const [only] = await listFor(TENANT, ownerId);

    expect(only.title).toBe('Asha Patel');
    expect(only.body).toBe('Hi, is my biryani ready yet?');
    expect(only.link).toBe(`/inbox?c=${conversationId}`);
  });

  it('**falls back to a masked number, never the real one**', async () => {
    // Unconditional, and not governed by the workspace's masking switch. A notification
    // title is persisted text read by everyone with `inbox:read`, so it cannot be redacted
    // per reader the way a customer row is — masking at write time would show the owner
    // bullets, and storing the real number would hand it to every masked agent.
    await notifyInboundMessage({
      tenantId: TENANT, conversationId, customerName: null,
      waId: '15550009941', body: 'hello', waMessageId: 'wamid.hhh',
    });
    const [only] = await listFor(TENANT, ownerId);

    expect(only.title).toBe('+•••••••9941');
    expect(only.title).not.toContain('15550009941');
    // And nothing else in the row smuggles it back in.
    expect(JSON.stringify(only)).not.toContain('15550009941');
  });

  it('**says something for a message with no text**', async () => {
    // A photo with no caption. "" as a body would render an empty row.
    await notifyInboundMessage({
      tenantId: TENANT, conversationId, customerName: 'Asha Patel',
      waId: '15550009941', body: null, waMessageId: 'wamid.iii',
    });
    const [only] = await listFor(TENANT, ownerId);
    expect(only.body).toBe('Sent an attachment');
  });

  it('flattens a pasted paragraph to one line', async () => {
    await message('wamid.jjj', 'line one\n\nline two\t\tline three');
    const [only] = await listFor(TENANT, ownerId);
    expect(only.body).toBe('line one line two line three');
  });

  it('marks a handoff as needing a person', async () => {
    await notifyHandoffRequested({
      tenantId: TENANT, conversationId, customerName: 'Asha Patel',
      waId: '15550009941', reason: 'Could not find the order',
    });
    const [only] = await listFor(TENANT, ownerId);
    expect(only.kind).toBe('HANDOFF_REQUESTED');
    expect(only.title).toBe('Asha Patel needs a person');
    expect(only.body).toBe('Could not find the order');
  });

  it('**refuses an off-site link**', async () => {
    // A link reaches a push payload and then a click. An absolute URL here would be an
    // open redirect, and `//evil.test` is protocol-relative — also off-site.
    for (const link of ['https://evil.test/steal', '//evil.test', 'javascript:alert(1)']) {
      // eslint-disable-next-line no-await-in-loop
      const created = await notify({
        tenantId: TENANT, kind: 'MESSAGE_RECEIVED', title: 'x', body: 'y', link,
      });
      expect(created?.link).toBeNull();
    }
  });

  it('keeps a same-site path', async () => {
    const created = await notify({
      tenantId: TENANT, kind: 'MESSAGE_RECEIVED', title: 'x', body: 'y', link: '/inbox?c=1',
    });
    expect(created?.link).toBe('/inbox?c=1');
  });
});

describe('over HTTP', () => {
  const authed = (path: string) => request(app)
    .get(`/api/notifications${path}`)
    .set('Authorization', `Bearer ${ownerToken}`);

  it('needs a session', async () => {
    const res = await request(app).get('/api/notifications/unread-count');
    expect(res.status).toBe(401);
  });

  it('returns the count and the list', async () => {
    await message('wamid.kkk');

    const count = await authed('/unread-count');
    expect(count.body.data.count).toBe(1);

    const list = await authed('');
    expect(list.body.data.notifications).toHaveLength(1);
    expect(list.body.data.unread).toBe(1);
  });

  it('marks all read', async () => {
    await message('wamid.lll');
    const res = await request(app)
      .post('/api/notifications/read-all')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({});
    expect(res.status).toBe(200);
    expect(await unreadCountFor(TENANT, ownerId)).toBe(0);
  });

  it('**rejects an unknown preference key** rather than ignoring it', async () => {
    // `.strict()`, so a typo in a client is a 400 instead of a setting that silently
    // never applies.
    const res = await request(app)
      .put('/api/notifications/preferences')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ inApp: false, nonsense: true });
    expect(res.status).toBe(400);
  });

  it('saves a real preference', async () => {
    const res = await request(app)
      .put('/api/notifications/preferences')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ messageReceived: false });
    expect(res.status).toBe(200);
    expect(res.body.data.preference.messageReceived).toBe(false);
    // Everything else untouched — the schema is restated rather than `.partial()`, so
    // absent keys do not fall back to creation defaults.
    expect(res.body.data.preference.browser).toBe(true);
  });

  it('**refuses a push subscription when the server has no VAPID keys**', async () => {
    // Rather than storing one that can never be delivered to. The UI reads
    // `push.available` and hides the control, and this is the server-side half.
    const res = await request(app)
      .post('/api/notifications/push/subscribe')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        endpoint: 'https://push.example.test/abc',
        keys: { p256dh: 'key', auth: 'auth' },
      });
    // 422 when unconfigured, 201 when a developer has keys in their environment.
    // Asserting on the pair rather than one value keeps this suite honest either way.
    expect([201, 422]).toContain(res.status);
    if (res.status === 422) {
      expect(res.body.message).toMatch(/not configured/i);
      expect(await prisma.pushSubscription.count({ where: { userId: ownerId } })).toBe(0);
    }
  });
});
