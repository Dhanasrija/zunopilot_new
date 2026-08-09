import type { Notification, PushSubscription } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { logger } from '../../config/logger.js';
import { recipientsOf, preferencesFor, wants } from './notification.service.js';
import type { PushOutcome, PushPayload, TransportTable } from './push-transport.js';
import { fcmTransport } from './fcm.js';
import { webPushTransport, webPushAvailable, pushPublicKey } from './push-web.js';

// Getting a notification onto a device that is not looking at the app.
//
// This module owns two things and no more: **which devices a notification goes to**, and
// **what happens to a device that did not accept it**. How a send is actually performed
// belongs to a transport — `push-web.ts` for browsers, `fcm.ts` for the Flutter app.
//
// ── Every device, always ─────────────────────────────────────────────────────
//
// A person may be signed in on a laptop, a work phone and their own phone at the same
// time, and they do not know which one we picked. So all of them are sent to, and only the
// people who asked not to be are skipped. The alternative — most-recent device wins — reads
// to the person as push working intermittently, which is indistinguishable from broken.

// Re-exported so callers have one import for "what can this server do".
export { webPushAvailable, pushPublicKey };

const transports: TransportTable = {
  WEB: webPushTransport,
  ANDROID: fcmTransport,
  IOS: fcmTransport,
};

/**
 * Can this server push at all, by any route?
 *
 * The delivery worker's gate. Distinct from `webPushAvailable`, which answers the narrower
 * question the browser cares about.
 */
export const pushAvailable = (): boolean =>
  Object.values(transports).some((transport) => transport.available());

/** How many strikes before a device is dropped rather than retried forever. */
const MAX_FAILURES = 5;

/**
 * Record what a send attempt did to the device, and say whether it landed.
 *
 * The whole of the dead-row policy, in one place:
 *
 * - **`gone` deletes immediately.** A dead endpoint retried forever is how a push table
 *   silently becomes all garbage and every notification spends its sends on nobody.
 * - **`failed` is counted**, and a device that keeps failing is eventually dropped, so one
 *   broken handset cannot consume sends indefinitely.
 * - **`unavailable` is recorded against nothing at all.** It means *we* could not send —
 *   no credentials, a rejected service account, a provider outage — and that is true of
 *   every device simultaneously. Counting it would delete every registration on the
 *   platform within five notifications of a bad deploy.
 */
const applyOutcome = async (device: PushSubscription, outcome: PushOutcome): Promise<boolean> => {
  if (outcome === 'ok') {
    await prisma.pushSubscription.update({
      where: { id: device.id },
      data: { lastUsedAt: new Date(), failureCount: 0 },
    }).catch(() => {});
    return true;
  }

  if (outcome === 'unavailable') return false;

  if (outcome === 'gone') {
    await prisma.pushSubscription.delete({ where: { id: device.id } }).catch(() => {});
    logger.debug('Dropped a dead push device', { id: device.id, platform: device.platform });
    return false;
  }

  const failureCount = device.failureCount + 1;
  if (failureCount >= MAX_FAILURES) {
    await prisma.pushSubscription.delete({ where: { id: device.id } }).catch(() => {});
    logger.warn('Dropped a push device after repeated failures', {
      id: device.id, platform: device.platform, failureCount,
    });
    return false;
  }

  await prisma.pushSubscription.update({
    where: { id: device.id },
    data: { failureCount },
  }).catch(() => {});
  return false;
};

export interface PushResult {
  /** Why nothing was sent, when nothing was. */
  skipped?: 'not-configured' | 'no-recipients' | 'no-subscriptions';
  sent: number;
  failed: number;
  /**
   * Devices we could not even attempt — a phone registered on a server with no FCM
   * credentials, say. Separate from `failed` because it says nothing about the device, and
   * because a number here is a configuration problem to go and fix.
   */
  unavailable: number;
}

/**
 * Push a notification to every device of everyone it is addressed to.
 *
 * Preferences are honoured per person, not per notification: two people on the same
 * workspace-wide notification can want different things, and one having push off must not
 * stop the other being told.
 */
export const pushNotification = async (notification: Notification): Promise<PushResult> => {
  if (!pushAvailable()) return { skipped: 'not-configured', sent: 0, failed: 0, unavailable: 0 };

  const userIds = await recipientsOf(notification);
  if (!userIds.length) return { skipped: 'no-recipients', sent: 0, failed: 0, unavailable: 0 };

  const payload: PushPayload = {
    id: notification.id,
    title: notification.title,
    body: notification.body,
    link: notification.link,
    kind: notification.kind,
    // Which workspace this is about — see `PushPayload`. Without it a push about one
    // workspace, tapped while the app is showing another, opens the wrong inbox.
    tenantId: notification.tenantId,
  };

  let sent = 0;
  let failed = 0;
  let unavailable = 0;

  for (const userId of userIds) {
    // eslint-disable-next-line no-await-in-loop
    const preference = await preferencesFor(userId);
    if (!wants(preference, notification.kind, 'push')) continue;

    // eslint-disable-next-line no-await-in-loop
    const devices = await prisma.pushSubscription.findMany({ where: { userId } });
    for (const device of devices) {
      // Sequential rather than Promise.all: a workspace's devices are a handful, and a
      // burst of parallel sends to one push service is how you get rate limited.
      // eslint-disable-next-line no-await-in-loop
      const outcome = await transports[device.platform].send(device, payload);
      // eslint-disable-next-line no-await-in-loop
      const landed = await applyOutcome(device, outcome);

      if (landed) sent += 1;
      else if (outcome === 'unavailable') unavailable += 1;
      else failed += 1;
    }
  }

  if (unavailable) {
    logger.warn('Some devices could not be pushed to because a transport is not configured', {
      notificationId: notification.id, unavailable,
    });
  }

  if (!sent && !failed && !unavailable) {
    return { skipped: 'no-subscriptions', sent: 0, failed: 0, unavailable: 0 };
  }
  return { sent, failed, unavailable };
};
