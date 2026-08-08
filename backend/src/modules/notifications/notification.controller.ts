import type { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../config/prisma.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ApiError } from '../../utils/ApiError.js';
import { tenantIdOf, userOf } from '../../middleware/auth.js';
import {
  listFor, markAllRead, markRead, preferencesFor, unreadCountFor, updatePreferences,
} from './notification.service.js';
import { pushPublicKey, webPushAvailable } from './push.service.js';
import { fcmAvailable } from './fcm.js';

// Notification endpoints.
//
// **Every one of these is scoped to the caller and needs no new permission.** A
// notification is personal — your own plus your workspace's — so the authorisation is
// simply "you are signed in", and the service's `visibleTo` does the rest. Adding a
// `notifications:read` permission would let an admin build a role that can use the
// product but never be told anything, which is not a useful thing to be able to do.

export const getUnreadCount = asyncHandler(async (req: Request, res: Response) => {
  const count = await unreadCountFor(tenantIdOf(req), userOf(req).id);
  res.json({ success: true, data: { count } });
});

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  unreadOnly: z.coerce.boolean().default(false),
});

export const getNotifications = asyncHandler(async (req: Request, res: Response) => {
  const parsed = listQuery.safeParse(req.query);
  if (!parsed.success) throw ApiError.badRequest('Bad query');

  const [notifications, unread] = await Promise.all([
    listFor(tenantIdOf(req), userOf(req).id, parsed.data),
    unreadCountFor(tenantIdOf(req), userOf(req).id),
  ]);
  res.json({ success: true, data: { notifications, unread } });
});

export const postMarkRead = asyncHandler(async (req: Request, res: Response) => {
  const count = await markRead(tenantIdOf(req), userOf(req).id, req.params.id);
  // Not a 404 when nothing changed: it may already have been read, by this person in
  // another tab or by a colleague on a shared notification. Idempotent is the right
  // shape for something a client fires on click.
  res.json({ success: true, data: { changed: count } });
});

export const postMarkAllRead = asyncHandler(async (req: Request, res: Response) => {
  const count = await markAllRead(tenantIdOf(req), userOf(req).id);
  res.json({ success: true, data: { changed: count } });
});

export const getPreferences = asyncHandler(async (req: Request, res: Response) => {
  const preference = await preferencesFor(userOf(req).id);
  res.json({
    success: true,
    data: {
      preference,
      /**
       * What the client needs to decide whether to offer push at all.
       *
       * **Two answers, because there are two transports.** `available` is false when the
       * server has no VAPID keys, and the browser must hide its control rather than offer a
       * button that cannot work. `mobileAvailable` is the same question for FCM, and the two
       * are genuinely independent — a server can reach the app and not the browser. One
       * combined flag would have the web UI offering a subscribe button on a box with only
       * FCM configured, which is exactly the broken button this field exists to prevent.
       */
      push: {
        available: webPushAvailable(),
        publicKey: pushPublicKey(),
        mobileAvailable: fcmAvailable(),
      },
    },
  });
});

const preferencesBody = z.object({
  inApp: z.boolean().optional(),
  browser: z.boolean().optional(),
  push: z.boolean().optional(),
  messageReceived: z.boolean().optional(),
  handoffRequested: z.boolean().optional(),
  orderCreated: z.boolean().optional(),
// Restated plainly rather than `.partial()` on a schema with defaults. `.partial()`
// does not suppress `.default()`, so absent keys parse to the creation defaults and
// every "is this field present" guard becomes true — the trap this codebase has hit
// three times.
}).strict();

export const putPreferences = asyncHandler(async (req: Request, res: Response) => {
  const parsed = preferencesBody.safeParse(req.body);
  if (!parsed.success) throw ApiError.badRequest('Unknown or invalid preference');

  const preference = await updatePreferences(userOf(req).id, parsed.data);
  res.json({ success: true, data: { preference } });
});

// ── Push subscriptions ────────────────────────────────────────────────────────

const subscriptionBody = z.object({
  endpoint: z.string().url().max(2000),
  keys: z.object({
    p256dh: z.string().min(1).max(500),
    auth: z.string().min(1).max(500),
  }),
});

/**
 * Register this browser for push.
 *
 * Keyed on `endpoint`, so re-subscribing the same browser updates its row instead of
 * accumulating duplicates — and moves it to this user if the device changed hands,
 * which is the correct outcome for a shared terminal.
 *
 * Subscribing also switches the `push` preference on. Someone who has just granted
 * permission and clicked the button has said what they want; making them then find a
 * toggle would be a second hurdle for the same decision.
 */
export const postSubscribe = asyncHandler(async (req: Request, res: Response) => {
  const parsed = subscriptionBody.safeParse(req.body);
  if (!parsed.success) throw ApiError.badRequest('That is not a usable push subscription');
  if (!webPushAvailable()) throw ApiError.unprocessable('Push is not configured on this server');

  const userId = userOf(req).id;
  const { endpoint, keys } = parsed.data;

  await prisma.pushSubscription.upsert({
    where: { endpoint },
    update: {
      userId,
      platform: 'WEB',
      p256dh: keys.p256dh,
      auth: keys.auth,
      userAgent: req.get('user-agent')?.slice(0, 300) ?? null,
      // Reset on re-subscribe: this endpoint demonstrably works again.
      failureCount: 0,
    },
    create: {
      userId,
      platform: 'WEB',
      endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
      userAgent: req.get('user-agent')?.slice(0, 300) ?? null,
    },
  });

  const preference = await updatePreferences(userId, { push: true });
  res.status(201).json({ success: true, data: { preference } });
});

const unsubscribeBody = z.object({ endpoint: z.string().url().max(2000) });

/**
 * Drop this browser's subscription.
 *
 * Deliberately does **not** turn the `push` preference off: the person may still want
 * push on their other device, and silencing every device because one was revoked would
 * be a surprise.
 */
export const postUnsubscribe = asyncHandler(async (req: Request, res: Response) => {
  const parsed = unsubscribeBody.safeParse(req.body);
  if (!parsed.success) throw ApiError.badRequest('Which endpoint?');

  // Scoped by userId: an endpoint is not authorisation to delete someone else's row.
  const { count } = await prisma.pushSubscription.deleteMany({
    where: { endpoint: parsed.data.endpoint, userId: userOf(req).id },
  });
  res.json({ success: true, data: { removed: count } });
});

/** The devices this person has subscribed, so they can see and revoke them. */
export const getDevices = asyncHandler(async (req: Request, res: Response) => {
  const devices = await prisma.pushSubscription.findMany({
    where: { userId: userOf(req).id },
    orderBy: { createdAt: 'desc' },
    // Never the keys, and never the FCM token. None of them are credentials of ours and
    // none of them are useful to the person reading this list, so there is no reason to
    // hand them back — and a token in a response body is a token in a log.
    select: {
      id: true,
      platform: true,
      endpoint: true,
      deviceName: true,
      appVersion: true,
      userAgent: true,
      createdAt: true,
      lastUsedAt: true,
    },
  });
  res.json({ success: true, data: devices });
});

// ── The app's devices ─────────────────────────────────────────────────────────

const deviceBody = z.object({
  // Only the two mobile platforms. `WEB` has its own endpoint, and accepting it here
  // would let a caller create a browser row with no keys — a device the fan-out can
  // never send to and nothing would explain why.
  platform: z.enum(['ANDROID', 'IOS']),
  /** The FCM registration token. Long, opaque, and not stable — see below. */
  token: z.string().min(20).max(4096),
  /**
   * The app's own install id, generated once and kept.
   *
   * **Required, because the token cannot play this part.** An FCM token rotates — on
   * reinstall, on restore from a backup, when app data is cleared, and sometimes on its
   * own. Without a stable id, every rotation would leave the previous row in place and the
   * same phone would be sent to twice, then three times, each stale token still accepting
   * deliveries for a while before it starts answering UNREGISTERED.
   */
  deviceId: z.string().min(8).max(128),
  /** "Pixel 8", for the list a person revokes from. */
  deviceName: z.string().max(120).optional(),
  appVersion: z.string().max(40).optional(),
}).strict();

/**
 * Register this phone for push, or update what is registered for it.
 *
 * Called on sign-in and on every token refresh the app is told about. Idempotent by
 * construction: the same phone re-registering rewrites one row.
 *
 * Like `postSubscribe`, this switches the `push` preference on — somebody who has just
 * granted notification permission on their phone has already said what they want.
 */
export const postDevice = asyncHandler(async (req: Request, res: Response) => {
  const parsed = deviceBody.safeParse(req.body);
  if (!parsed.success) throw ApiError.badRequest('That is not a usable device registration');
  if (!fcmAvailable()) {
    throw ApiError.unprocessable('Mobile push is not configured on this server');
  }

  const userId = userOf(req).id;
  const { platform, token, deviceId, deviceName, appVersion } = parsed.data;

  const device = await prisma.$transaction(async (tx) => {
    /*
     * Take this token off any other row first.
     *
     * Two real situations produce a token that already belongs somewhere else: a phone
     * handed to a colleague who signs in as themselves, and two logins used on one device.
     * `deviceToken` is unique, so without this the upsert below would fail — but the reason
     * it is unique is the more important half: a token left on the old row keeps delivering
     * that person's notifications to a screen that is now somebody else's.
     */
    await tx.pushSubscription.deleteMany({
      where: { deviceToken: token, NOT: { userId, deviceId } },
    });

    return tx.pushSubscription.upsert({
      // The stable pair, not the token.
      where: { userId_deviceId: { userId, deviceId } },
      update: {
        platform,
        deviceToken: token,
        deviceName: deviceName ?? null,
        appVersion: appVersion ?? null,
        // Reset on re-register: this device demonstrably works again.
        failureCount: 0,
      },
      create: {
        userId,
        platform,
        deviceToken: token,
        deviceId,
        deviceName: deviceName ?? null,
        appVersion: appVersion ?? null,
      },
      select: { id: true, platform: true, deviceName: true, appVersion: true, createdAt: true },
    });
  });

  const preference = await updatePreferences(userId, { push: true });
  res.status(201).json({ success: true, data: { device, preference } });
});

/**
 * Stop pushing to one device, whichever transport it is on.
 *
 * By id rather than by token, so signing out of the app does not have to send the token
 * back — and so the same call works for a browser row the person revoked from the list.
 *
 * Like `postUnsubscribe`, this deliberately leaves the `push` preference alone: the person
 * may still want push on their other phone.
 */
export const deleteDevice = asyncHandler(async (req: Request, res: Response) => {
  // Scoped by userId: an id is not authorisation to unregister someone else's phone.
  const { count } = await prisma.pushSubscription.deleteMany({
    where: { id: req.params.id, userId: userOf(req).id },
  });
  // Not a 404 when nothing matched. Signing out twice, or on a device whose row was
  // already pruned as dead, is not an error worth showing anybody.
  res.json({ success: true, data: { removed: count } });
});
