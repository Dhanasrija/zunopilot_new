import type { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../config/prisma.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ApiError } from '../../utils/ApiError.js';
import { tenantIdOf, userOf } from '../../middleware/auth.js';
import {
  listFor, markAllRead, markRead, preferencesFor, unreadCountFor, updatePreferences,
} from './notification.service.js';
import { pushPublicKey, pushEnabled } from './push.service.js';

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
       * `pushEnabled` is false when the server has no VAPID keys, and the UI must
       * hide the control rather than offer a button that cannot work.
       */
      push: { available: pushEnabled(), publicKey: pushPublicKey() },
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
  if (!pushEnabled()) throw ApiError.unprocessable('Push is not configured on this server');

  const userId = userOf(req).id;
  const { endpoint, keys } = parsed.data;

  await prisma.pushSubscription.upsert({
    where: { endpoint },
    update: {
      userId,
      p256dh: keys.p256dh,
      auth: keys.auth,
      userAgent: req.get('user-agent')?.slice(0, 300) ?? null,
      // Reset on re-subscribe: this endpoint demonstrably works again.
      failureCount: 0,
    },
    create: {
      userId,
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
    // Never the keys. They are useless without our private key, but there is no reason
    // to hand them back either.
    select: { id: true, endpoint: true, userAgent: true, createdAt: true, lastUsedAt: true },
  });
  res.json({ success: true, data: devices });
});
