import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../config/prisma.js';
import { ROLE_PERMISSIONS } from '../../config/permissions.js';

// Web Push delivery.
//
// **`web-push` is mocked, and only `web-push`.** Everything else — the subscriptions,
// the preferences, the pruning — is real, against real Postgres. What is being tested is
// how this module reacts to what a push service says, and the only way to produce a 410
// on demand is to stand in for the library.
//
// The behaviour that matters is the pruning. A push endpoint dies silently: a browser is
// uninstalled, a permission revoked, an endpoint rotated. Nothing tells us. If dead rows
// are retried forever a workspace's subscription table becomes all garbage and every
// notification spends sends on nobody.

const sendNotification = vi.fn();

vi.mock('web-push', () => ({
  default: {
    sendNotification: (...args: unknown[]) => sendNotification(...args),
    generateVAPIDKeys: () => ({ publicKey: 'pub', privateKey: 'priv' }),
  },
}));

const TENANT = 'dddddddd-d000-0000-0000-00000000d011';

let ownerId: string;
let agentId: string;
let notificationId: string;

/** A push-service error shaped the way `web-push` throws them. */
const httpError = (statusCode: number) => Object.assign(new Error(`push ${statusCode}`), { statusCode });

const wipe = () => prisma.tenant.deleteMany({ where: { id: TENANT } });

beforeEach(async () => {
  sendNotification.mockReset();
  // Read at the point of use, so setting them here is enough — no import-time snapshot
  // to work around.
  process.env.VAPID_PUBLIC_KEY = 'test-public-key';
  process.env.VAPID_PRIVATE_KEY = 'test-private-key';

  await wipe();
  const tenant = await prisma.tenant.create({
    data: {
      id: TENANT,
      businessName: 'Push Kitchen',
      category: 'RESTAURANT',
      roles: {
        create: [{
          name: 'Owner', permissions: [...ROLE_PERMISSIONS.OWNER], isOwner: true, isSystem: true,
        }],
      },
      users: {
        create: [
          { phone: '15550009951', fullName: 'Owner', role: 'OWNER' },
          { phone: '15550009952', fullName: 'Agent', role: 'AGENT' },
        ],
      },
    },
    include: { users: { orderBy: { phone: 'asc' } } },
  });
  ownerId = tenant.users[0].id;
  agentId = tenant.users[1].id;

  notificationId = (await prisma.notification.create({
    data: { tenantId: TENANT, kind: 'MESSAGE_RECEIVED', title: 'Asha', body: 'Hello' },
  })).id;
});

afterEach(() => {
  delete process.env.VAPID_PUBLIC_KEY;
  delete process.env.VAPID_PRIVATE_KEY;
});

afterAll(async () => {
  await wipe();
  await prisma.$disconnect();
});

/**
 * Subscribe a device **and turn the preference on**, exactly as `postSubscribe` does.
 *
 * Both halves are needed and that is not obvious: `push` defaults to false, so a row in
 * `PushSubscription` on its own sends nothing. The endpoint flips the preference in the
 * same request precisely because someone who has just granted permission and pressed the
 * button has already said what they want — and a test that only wrote the row would
 * quietly assert nothing.
 */
const subscribe = async (userId: string, endpoint: string) => {
  const created = await prisma.pushSubscription.create({
    data: { userId, endpoint, p256dh: 'p', auth: 'a' },
  });
  await prisma.notificationPreference.upsert({
    where: { userId }, update: { push: true }, create: { userId, push: true },
  });
  return created;
};

const notification = () => prisma.notification.findUniqueOrThrow({ where: { id: notificationId } });

/** Imported inside each test, after the env vars are set for that test. */
const load = () => import('./push.service.js');

describe('whether push is even available', () => {
  it('**is disabled with no keys, and says so rather than half-working**', async () => {
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    const { pushEnabled, pushPublicKey, pushNotification } = await load();

    expect(pushEnabled()).toBe(false);
    expect(pushPublicKey()).toBeNull();
    expect(await pushNotification(await notification())).toMatchObject({ skipped: 'not-configured' });
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('is disabled when only one of the pair is set', async () => {
    // A half-configured key pair cannot sign anything, and treating it as enabled would
    // fail every send with a confusing error instead of one clear "not configured".
    delete process.env.VAPID_PRIVATE_KEY;
    const { pushEnabled } = await load();
    expect(pushEnabled()).toBe(false);
  });

  it('**reads the keys at the point of use, not from an import-time snapshot**', async () => {
    // The trap this codebase has hit five times: `config/env.ts` snapshots the
    // environment at import, so a rotatable secret read from it reads as configured
    // after it has changed. Rotating mid-process must take effect.
    const { pushPublicKey } = await load();
    expect(pushPublicKey()).toBe('test-public-key');

    process.env.VAPID_PUBLIC_KEY = 'rotated-key';
    expect(pushPublicKey()).toBe('rotated-key');
  });
});

describe('sending', () => {
  it('reaches every device of every member for a workspace notification', async () => {
    await subscribe(ownerId, 'https://push.test/owner-laptop');
    await subscribe(ownerId, 'https://push.test/owner-phone');
    await subscribe(agentId, 'https://push.test/agent-phone');
    sendNotification.mockResolvedValue({ statusCode: 201 });

    const { pushNotification } = await load();
    const result = await pushNotification(await notification());

    expect(result.sent).toBe(3);
    expect(sendNotification).toHaveBeenCalledTimes(3);
  });

  it('**honours each person\'s preference independently**', async () => {
    // Two people on one workspace-wide notification can want different things, and one
    // opting out must not silence the other.
    await subscribe(ownerId, 'https://push.test/owner');
    await subscribe(agentId, 'https://push.test/agent');
    const { updatePreferences } = await import('./notification.service.js');
    await updatePreferences(agentId, { push: false });
    sendNotification.mockResolvedValue({ statusCode: 201 });

    const { pushNotification } = await load();
    const result = await pushNotification(await notification());

    expect(result.sent).toBe(1);
  });

  it('sends nothing when the kind is switched off', async () => {
    await subscribe(ownerId, 'https://push.test/owner');
    const { updatePreferences } = await import('./notification.service.js');
    await updatePreferences(ownerId, { messageReceived: false });

    const { pushNotification } = await load();
    expect(await pushNotification(await notification())).toMatchObject({ skipped: 'no-subscriptions' });
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('records when it last worked, so a stale device is visible', async () => {
    await subscribe(ownerId, 'https://push.test/owner');
    sendNotification.mockResolvedValue({ statusCode: 201 });

    const { pushNotification } = await load();
    await pushNotification(await notification());

    const row = await prisma.pushSubscription.findFirstOrThrow({ where: { userId: ownerId } });
    expect(row.lastUsedAt).not.toBeNull();
    expect(row.failureCount).toBe(0);
  });
});

describe('pruning dead subscriptions', () => {
  it('**deletes on 410 Gone immediately**', async () => {
    // The browser is gone for good. Retrying is pointless and keeping the row means
    // spending a send on nobody every time.
    await subscribe(ownerId, 'https://push.test/dead');
    sendNotification.mockRejectedValue(httpError(410));

    const { pushNotification } = await load();
    const result = await pushNotification(await notification());

    expect(result.failed).toBe(1);
    expect(await prisma.pushSubscription.count({ where: { userId: ownerId } })).toBe(0);
  });

  it('deletes on 404 too', async () => {
    await subscribe(ownerId, 'https://push.test/missing');
    sendNotification.mockRejectedValue(httpError(404));

    const { pushNotification } = await load();
    await pushNotification(await notification());

    expect(await prisma.pushSubscription.count({ where: { userId: ownerId } })).toBe(0);
  });

  it('**keeps a subscription through a transient failure**', async () => {
    // A push service having a bad minute is not a dead device. Deleting on a 500 would
    // silently unsubscribe people during an outage.
    await subscribe(ownerId, 'https://push.test/flaky');
    sendNotification.mockRejectedValue(httpError(500));

    const { pushNotification } = await load();
    await pushNotification(await notification());

    const row = await prisma.pushSubscription.findFirstOrThrow({ where: { userId: ownerId } });
    expect(row.failureCount).toBe(1);
  });

  it('**gives up on a subscription that keeps failing**', async () => {
    // Counted rather than retried forever: one permanently broken device must not
    // consume a send on every notification for the rest of time.
    await subscribe(ownerId, 'https://push.test/hopeless');
    await prisma.pushSubscription.updateMany({
      where: { userId: ownerId }, data: { failureCount: 4 },
    });
    sendNotification.mockRejectedValue(httpError(500));

    const { pushNotification } = await load();
    await pushNotification(await notification());

    expect(await prisma.pushSubscription.count({ where: { userId: ownerId } })).toBe(0);
  });

  it('one dead device does not stop a live one', async () => {
    await subscribe(ownerId, 'https://push.test/dead');
    await subscribe(ownerId, 'https://push.test/alive');
    sendNotification
      .mockRejectedValueOnce(httpError(410))
      .mockResolvedValueOnce({ statusCode: 201 });

    const { pushNotification } = await load();
    const result = await pushNotification(await notification());

    expect(result.sent).toBe(1);
    expect(result.failed).toBe(1);
    expect(await prisma.pushSubscription.count({ where: { userId: ownerId } })).toBe(1);
  });
});

describe('what it sends', () => {
  it('carries the id as the payload tag, so one event cannot stack twice', async () => {
    await subscribe(ownerId, 'https://push.test/owner');
    sendNotification.mockResolvedValue({ statusCode: 201 });

    const { pushNotification } = await load();
    await pushNotification(await notification());

    const [, payload] = sendNotification.mock.calls[0] as [unknown, string];
    const parsed = JSON.parse(payload) as { id: string; title: string; kind: string };
    expect(parsed.id).toBe(notificationId);
    expect(parsed.title).toBe('Asha');
    expect(parsed.kind).toBe('MESSAGE_RECEIVED');
  });
});
