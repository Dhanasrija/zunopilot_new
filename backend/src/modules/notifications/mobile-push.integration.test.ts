import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { seedMemberships } from '../../test-support/members.js';
import { prisma } from '../../config/prisma.js';
import { buildApp } from '../../app.js';
import { signToken } from '../../utils/jwt.js';
import { ROLE_PERMISSIONS } from '../../config/permissions.js';

/*
 * Reaching the Flutter app, on every phone a person is signed in on.
 *
 * ── What is real and what is not ─────────────────────────────────────────────
 *
 * `axios.post` and Google's token minting are stood in for. Everything else — the registrations,
 * the preferences, the fan-out, the pruning — is real, against real Postgres. What is being tested
 * is how this code behaves given what FCM says, and the only way to produce an `UNREGISTERED` on
 * demand is to be the one answering.
 *
 * ── The four things that go wrong with device tokens ─────────────────────────
 *
 * None of them are the happy path, and each one is invisible in normal use:
 *
 *   1. **Only one phone gets the push.** A person signed in on a work phone and their own has two
 *      registrations and no idea which one we picked. Sending to whichever registered last reads,
 *      from the outside, as push working sometimes.
 *
 *   2. **A rotated token leaves the old row behind.** FCM tokens rotate on reinstall, on restore
 *      from a backup, when app data is cleared, sometimes on their own. Keyed on the token, one
 *      phone accumulates rows and gets buzzed once per rotation, because a retired token keeps
 *      accepting deliveries for a while before it starts refusing them.
 *
 *   3. **A token that moved to another login keeps its old owner.** Hand the phone to a colleague
 *      who signs in as themselves, and the previous person's notifications keep arriving on a
 *      screen that is now somebody else's.
 *
 *   4. **Our own outage deletes everybody's devices.** A bad payload or an expired service account
 *      fails for every device at once. A policy that cannot tell that apart from a dead handset
 *      drops every registration on the platform within five notifications.
 */

const post = vi.fn();

// The real axios, with only `post` replaced: this file builds the whole app, and mocking the module
// wholesale would take `create` and `isAxiosError` out from under the WhatsApp providers too.
vi.mock('axios', async (importOriginal) => {
  const actual = await importOriginal<typeof import('axios')>();
  return {
    ...actual,
    default: Object.assign(Object.create(Object.getPrototypeOf(actual.default)), actual.default, {
      post: (...args: unknown[]) => post(...args),
    }),
  };
});

vi.mock('google-auth-library', () => ({
  GoogleAuth: class {
    getAccessToken() { return Promise.resolve('ya29.test-access-token'); }
  },
}));

const app = buildApp();
const TENANT = 'dddddddd-d000-0000-0000-00000000d021';

let ownerId: string;
let colleagueId: string;
let ownerToken: string;
let colleagueToken: string;
let notificationId: string;

/** An FCM v1 error, shaped the way axios surfaces one. */
const fcmError = (status: number, errorCode?: string) => Object.assign(new Error(`fcm ${status}`), {
  isAxiosError: true,
  response: {
    status,
    data: errorCode
      ? { error: { status: 'NOT_FOUND', details: [{ errorCode }] } }
      : { error: { status: 'INTERNAL' } },
  },
});

const wipe = () => prisma.tenant.deleteMany({ where: { id: TENANT } });

beforeEach(async () => {
  post.mockReset();
  post.mockResolvedValue({ status: 200, data: { name: 'projects/zp/messages/1' } });

  /*
   * Read at the point of use, so setting them here is enough — there is no import-time snapshot to
   * work around, and the credential cache is keyed on these values, so changing them between tests
   * invalidates it without `vi.resetModules()`.
   */
  process.env.FCM_PROJECT_ID = 'zunopilot-test';
  process.env.FCM_CLIENT_EMAIL = 'push@zunopilot-test.iam.gserviceaccount.com';
  process.env.FCM_PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\\ntest\\n-----END PRIVATE KEY-----\\n';
  // Browser push off unless a test wants it, so a mobile assertion cannot be satisfied by a
  // browser row that happened to be lying around.
  delete process.env.VAPID_PUBLIC_KEY;
  delete process.env.VAPID_PRIVATE_KEY;

  await wipe();
  const tenant = await prisma.tenant.create({
    data: {
      id: TENANT,
      businessName: 'Push Kitchen Mobile',
      category: 'RESTAURANT',
      roles: {
        create: [{
          name: 'Owner', permissions: [...ROLE_PERMISSIONS.OWNER], isOwner: true, isSystem: true,
        }],
      },
      users: {
        create: [
          { phone: '15550009961', fullName: 'Owner', role: 'OWNER' },
          { phone: '15550009962', fullName: 'Colleague', role: 'AGENT' },
        ],
      },
    },
    include: { users: { orderBy: { phone: 'asc' } } },
  });
  ownerId = tenant.users[0]!.id;
  colleagueId = tenant.users[1]!.id;
  await seedMemberships();
  ownerToken = signToken({ userId: ownerId, tenantId: TENANT });
  colleagueToken = signToken({ userId: colleagueId, tenantId: TENANT });

  notificationId = (await prisma.notification.create({
    data: { tenantId: TENANT, kind: 'MESSAGE_RECEIVED', title: 'Asha', body: 'Hello' },
  })).id;
});

afterEach(() => {
  delete process.env.FCM_PROJECT_ID;
  delete process.env.FCM_CLIENT_EMAIL;
  delete process.env.FCM_PRIVATE_KEY;
});

afterAll(async () => {
  await wipe();
  await prisma.$disconnect();
});

const register = (token: string, body: Record<string, unknown>) => request(app)
  .post('/api/notifications/push/devices')
  .set('Authorization', `Bearer ${token}`)
  .send(body);

const phone = (over: Record<string, unknown> = {}) => ({
  platform: 'ANDROID',
  token: 'fcm-token-alpha-000000000000000000',
  deviceId: 'install-aaaaaaaa',
  deviceName: 'Pixel 8',
  appVersion: '1.0.0',
  ...over,
});

/** What `pushNotification` was actually asked to deliver, per call. */
const sentTokens = () => post.mock.calls.map((call) => (
  (call[1] as { message: { token: string } }).message.token
));

const notification = () => prisma.notification.findUniqueOrThrow({ where: { id: notificationId } });
const load = () => import('./push.service.js');

describe('registering a phone', () => {
  it('**stores the token against the app\'s own install id, and turns push on**', async () => {
    const res = await register(ownerToken, phone()).expect(201);

    expect(res.body.data.device.platform).toBe('ANDROID');
    expect(res.body.data.device.deviceName).toBe('Pixel 8');
    // The same reasoning as the browser's subscribe: somebody who has just granted notification
    // permission on their phone has already said what they want, and making them then find a
    // toggle would be a second hurdle for one decision.
    expect(res.body.data.preference.push).toBe(true);

    const row = await prisma.pushSubscription.findFirstOrThrow({ where: { userId: ownerId } });
    expect(row.deviceToken).toBe('fcm-token-alpha-000000000000000000');
    expect(row.deviceId).toBe('install-aaaaaaaa');
    // No web fields on a mobile row, and the migration had to make all three nullable for that.
    expect(row.endpoint).toBeNull();
    expect(row.p256dh).toBeNull();
  });

  it('refuses when the server has no FCM credentials, rather than accepting a token it cannot use', async () => {
    delete process.env.FCM_PROJECT_ID;

    const res = await register(ownerToken, phone()).expect(422);
    expect(res.body.message).toMatch(/not configured/i);
    expect(await prisma.pushSubscription.count({ where: { userId: ownerId } })).toBe(0);
  });

  it('will not take a WEB registration, which has no token to send to', async () => {
    // `POST /push/subscribe` is the browser's route. Accepting `WEB` here would create a row with
    // no endpoint and no keys — a device the fan-out can never reach, and nothing to say why.
    await register(ownerToken, phone({ platform: 'WEB' })).expect(400);
  });

  it('needs an install id, because the token cannot be the key', async () => {
    await register(ownerToken, { platform: 'ANDROID', token: 'fcm-token-alpha-000000000000000000' }).expect(400);
  });

  it('**replaces the row when the token rotates, rather than adding a second one**', async () => {
    await register(ownerToken, phone()).expect(201);
    // Same phone, same install, new token — what a reinstall or a background refresh produces.
    await register(ownerToken, phone({ token: 'fcm-token-beta-0000000000000000000' })).expect(201);

    const rows = await prisma.pushSubscription.findMany({ where: { userId: ownerId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.deviceToken).toBe('fcm-token-beta-0000000000000000000');
  });

  it('**takes a token off the login that used to hold it**', async () => {
    /*
     * The phone changed hands, or a second person signed in on it. The old row would otherwise keep
     * the token and keep delivering the first person's notifications to the second person's screen.
     */
    await register(ownerToken, phone()).expect(201);
    await register(colleagueToken, phone({ deviceId: 'install-bbbbbbbb' })).expect(201);

    expect(await prisma.pushSubscription.count({ where: { userId: ownerId } })).toBe(0);
    const theirs = await prisma.pushSubscription.findFirstOrThrow({ where: { userId: colleagueId } });
    expect(theirs.deviceToken).toBe('fcm-token-alpha-000000000000000000');
  });

  it('never hands the token back in the devices list', async () => {
    await register(ownerToken, phone()).expect(201);

    const res = await request(app).get('/api/notifications/push/devices')
      .set('Authorization', `Bearer ${ownerToken}`).expect(200);

    expect(res.body.data[0].platform).toBe('ANDROID');
    expect(res.body.data[0].deviceName).toBe('Pixel 8');
    // A token in a response body is a token in somebody's log.
    expect(JSON.stringify(res.body)).not.toContain('fcm-token-alpha-000000000000000000');
  });
});

describe('unregistering', () => {
  it('removes the device and leaves the preference alone', async () => {
    const created = await register(ownerToken, phone()).expect(201);
    const { id } = created.body.data.device;

    await request(app).delete(`/api/notifications/push/devices/${id}`)
      .set('Authorization', `Bearer ${ownerToken}`).expect(200);

    expect(await prisma.pushSubscription.count({ where: { userId: ownerId } })).toBe(0);
    // Signing out of one phone must not silence the other one.
    const preference = await prisma.notificationPreference.findUniqueOrThrow({ where: { userId: ownerId } });
    expect(preference.push).toBe(true);
  });

  it('is not authorisation to unregister somebody else\'s phone', async () => {
    const created = await register(ownerToken, phone()).expect(201);

    const res = await request(app)
      .delete(`/api/notifications/push/devices/${created.body.data.device.id}`)
      .set('Authorization', `Bearer ${colleagueToken}`).expect(200);

    // 200 with nothing removed, not a 404: an id that is not yours is indistinguishable from one
    // that never existed, and it should stay that way.
    expect(res.body.data.removed).toBe(0);
    expect(await prisma.pushSubscription.count({ where: { userId: ownerId } })).toBe(1);
  });
});

describe('delivering to every device', () => {
  it('**sends to both phones a person is signed in on**', async () => {
    await register(ownerToken, phone()).expect(201);
    await register(ownerToken, phone({ token: 'fcm-token-personal-00000000000000', deviceId: 'install-cccccccc' }))
      .expect(201);

    const { pushNotification } = await load();
    const result = await pushNotification(await notification());

    expect(result.sent).toBe(2);
    expect(sentTokens().sort()).toEqual(['fcm-token-alpha-000000000000000000', 'fcm-token-personal-00000000000000']);
  });

  it('reaches a browser and a phone in the same fan-out', async () => {
    /*
     * The two transports have to coexist: somebody at a desk with the app on their phone is the
     * normal case, not an edge one. One table and one loop is what makes this true by construction
     * rather than by remembering to send twice.
     */
    process.env.VAPID_PUBLIC_KEY = 'test-public-key';
    process.env.VAPID_PRIVATE_KEY = 'test-private-key';
    await register(ownerToken, phone()).expect(201);
    await prisma.pushSubscription.create({
      data: {
        userId: ownerId,
        platform: 'WEB',
        endpoint: 'https://push.example.test/owner-laptop',
        p256dh: 'p',
        auth: 'a',
      },
    });

    const { pushNotification } = await load();
    const result = await pushNotification(await notification());

    // The browser send goes through `web-push`, which is not mocked here and will fail against a
    // fake endpoint — so what is asserted is that the phone was still reached and the browser was
    // still attempted, not that both landed.
    expect(sentTokens()).toEqual(['fcm-token-alpha-000000000000000000']);
    expect(result.sent + result.failed).toBe(2);
  });

  it('carries the workspace, so a tap opens the right inbox', async () => {
    /*
     * One login can be in several workspaces, and `link` is a relative path with no workspace in
     * it. Without `tenantId` the app would follow `/inbox?c=…` inside whichever workspace happened
     * to be open, find nothing, and the notification would look like a lie.
     */
    await register(ownerToken, phone()).expect(201);

    const { pushNotification } = await load();
    await pushNotification(await notification());

    const body = post.mock.calls[0]![1] as { message: { data: Record<string, string> } };
    expect(body.message.data.tenantId).toBe(TENANT);
    expect(body.message.data.id).toBe(notificationId);
  });

  it('sends high priority, so a waiting customer is not queued until the phone wakes', async () => {
    await register(ownerToken, phone()).expect(201);
    const { pushNotification } = await load();
    await pushNotification(await notification());

    const body = post.mock.calls[0]![1] as {
      message: { android: { priority: string }; notification: { title: string } };
    };
    expect(body.message.android.priority).toBe('high');
    // A tray notification as well as data, so something appears while the app is not running.
    expect(body.message.notification.title).toBe('Asha');
  });

  it('respects a person who turned push off, on every device', async () => {
    await register(ownerToken, phone()).expect(201);
    await prisma.notificationPreference.update({ where: { userId: ownerId }, data: { push: false } });

    const { pushNotification } = await load();
    const result = await pushNotification(await notification());

    expect(post).not.toHaveBeenCalled();
    expect(result.skipped).toBe('no-subscriptions');
  });
});

describe('what happens to a device that did not accept the push', () => {
  it('**drops it on UNREGISTERED, and keeps sending to the other one**', async () => {
    await register(ownerToken, phone()).expect(201);
    await register(ownerToken, phone({ token: 'fcm-token-live-0000000000000000000', deviceId: 'install-dddddddd' }))
      .expect(201);

    post.mockImplementation((_url: string, body: { message: { token: string } }) => (
      body.message.token === 'fcm-token-alpha-000000000000000000'
        ? Promise.reject(fcmError(404, 'UNREGISTERED'))
        : Promise.resolve({ status: 200, data: {} })
    ));

    const { pushNotification } = await load();
    const result = await pushNotification(await notification());

    expect(result.sent).toBe(1);
    const rows = await prisma.pushSubscription.findMany({ where: { userId: ownerId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.deviceToken).toBe('fcm-token-live-0000000000000000000');
  });

  it('counts an ordinary failure rather than dropping the device on the first one', async () => {
    await register(ownerToken, phone()).expect(201);
    post.mockRejectedValue(fcmError(400));

    const { pushNotification } = await load();
    expect((await pushNotification(await notification())).failed).toBe(1);

    const row = await prisma.pushSubscription.findFirstOrThrow({ where: { userId: ownerId } });
    expect(row.failureCount).toBe(1);
  });

  it('**does not count our own failure against the device**', async () => {
    /*
     * The property that stops a bad deploy wiping the platform's registrations. A rejected service
     * account or a malformed payload fails for every device simultaneously; five notifications later
     * an unguarded failure counter would have deleted every one of them, and nobody's phone would
     * work again until they reinstalled.
     */
    await register(ownerToken, phone()).expect(201);
    post.mockRejectedValue(fcmError(401));

    const { pushNotification } = await load();
    const result = await pushNotification(await notification());

    expect(result.unavailable).toBe(1);
    expect(result.failed).toBe(0);
    const row = await prisma.pushSubscription.findFirstOrThrow({ where: { userId: ownerId } });
    expect(row.failureCount).toBe(0);
  });

  it('does not treat INVALID_ARGUMENT as a dead token', async () => {
    // FCM answers `INVALID_ARGUMENT` both for a token it cannot parse and for a message *we* built
    // wrongly, and the response does not reliably distinguish them. Keeping the device costs a few
    // retries; deleting it on our own mistake costs the registration.
    await register(ownerToken, phone()).expect(201);
    post.mockRejectedValue(fcmError(400, 'INVALID_ARGUMENT'));

    const { pushNotification } = await load();
    await pushNotification(await notification());

    expect(await prisma.pushSubscription.count({ where: { userId: ownerId } })).toBe(1);
  });

  it('drops a device that has failed five times, so one handset cannot eat every send', async () => {
    await register(ownerToken, phone()).expect(201);
    await prisma.pushSubscription.updateMany({ where: { userId: ownerId }, data: { failureCount: 4 } });
    post.mockRejectedValue(fcmError(400));

    const { pushNotification } = await load();
    await pushNotification(await notification());

    expect(await prisma.pushSubscription.count({ where: { userId: ownerId } })).toBe(0);
  });

  it('clears the failure count once the device works again', async () => {
    await register(ownerToken, phone()).expect(201);
    await prisma.pushSubscription.updateMany({ where: { userId: ownerId }, data: { failureCount: 3 } });

    const { pushNotification } = await load();
    await pushNotification(await notification());

    const row = await prisma.pushSubscription.findFirstOrThrow({ where: { userId: ownerId } });
    expect(row.failureCount).toBe(0);
    expect(row.lastUsedAt).not.toBeNull();
  });
});

describe('a server that cannot push at all', () => {
  it('says so instead of trying', async () => {
    // Both transports unconfigured. The delivery worker gates on this, so a box with neither set
    // does no work per notification rather than failing per device.
    await prisma.pushSubscription.create({
      data: { userId: ownerId, platform: 'ANDROID', deviceToken: 'orphan', deviceId: 'install-ffffffff' },
    });
    delete process.env.FCM_PROJECT_ID;

    const { pushAvailable, pushNotification } = await load();
    expect(pushAvailable()).toBe(false);
    expect(await pushNotification(await notification())).toMatchObject({ skipped: 'not-configured' });
    expect(post).not.toHaveBeenCalled();
  });

  it('reports a phone as unreachable when only the browser transport is configured', async () => {
    /*
     * Honest rather than convenient. Counting this as a delivery failure would blame the phone for a
     * missing credential, and counting it as nothing would make the whole thing look like it worked.
     */
    process.env.VAPID_PUBLIC_KEY = 'test-public-key';
    process.env.VAPID_PRIVATE_KEY = 'test-private-key';
    await prisma.pushSubscription.create({
      data: { userId: ownerId, platform: 'ANDROID', deviceToken: 'stranded', deviceId: 'install-eeeeeeee' },
    });
    await prisma.notificationPreference.upsert({
      where: { userId: ownerId }, update: { push: true }, create: { userId: ownerId, push: true },
    });
    delete process.env.FCM_PROJECT_ID;
    delete process.env.FCM_CLIENT_EMAIL;
    delete process.env.FCM_PRIVATE_KEY;

    const { pushNotification } = await load();
    const result = await pushNotification(await notification());

    expect(result.unavailable).toBe(1);
    expect(result.sent).toBe(0);
    // And the device survives: the credential is what is missing, not the phone.
    expect(await prisma.pushSubscription.count({ where: { userId: ownerId } })).toBe(1);
  });

  it('tells the client which transports it can actually use', async () => {
    // The browser hides its subscribe button on `available: false`; the app checks the other one.
    const res = await request(app).get('/api/notifications/preferences')
      .set('Authorization', `Bearer ${ownerToken}`).expect(200);

    expect(res.body.data.push.mobileAvailable).toBe(true);
    expect(res.body.data.push.available).toBe(false);
  });
});
