import webpush from 'web-push';
import type { Notification, PushSubscription } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { logger } from '../../config/logger.js';
import { recipientsOf, preferencesFor, wants } from './notification.service.js';

// Web Push: reaching a device with the app closed.
//
// **Why Web Push and not a vendor SDK.** It is the only option that needs no third
// party, no app store presence and no per-message cost — the browser's own push
// service delivers, authenticated by a VAPID key pair we hold. The cost is a real
// platform caveat, stated here because it will otherwise be discovered as a bug:
// **on iOS this only works once the site has been added to the home screen.** Safari
// implements Web Push for installed web apps only. Desktop Safari, Chrome, Edge and
// Android Chrome all work from a normal tab.
//
// **Why the keys are read from `process.env` at the point of use, with no fallback.**
// `config/env.ts` snapshots the environment at import, and a rotatable secret read
// from that snapshot reads as configured after it has been changed — a trap this
// codebase has hit five times. There is also deliberately no fallback to any other
// secret: a push key pair that silently became something else would mean every
// existing subscription breaks with no error anyone would connect to the cause.

/** VAPID configuration, or null when the server has none. */
const vapid = (): { publicKey: string; privateKey: string; subject: string } | null => {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return null;

  // `mailto:` or an https URL, required by the spec so a push service can contact the
  // sender. Falls back to a mailto built from the public URL rather than refusing,
  // because a missing subject is a much smaller problem than disabled push.
  const subject = process.env.VAPID_SUBJECT || 'mailto:support@zunopilot.com';
  return { publicKey, privateKey, subject };
};

/**
 * Is push usable at all?
 *
 * The client asks before offering the control, so a server without keys shows nothing
 * rather than a button that fails when pressed.
 */
export const pushEnabled = (): boolean => vapid() !== null;

/** The public key, which the browser needs to build a subscription. Safe to expose. */
export const pushPublicKey = (): string | null => vapid()?.publicKey ?? null;

/** What the service worker receives. Kept small — push payloads have a size limit. */
interface PushPayload {
  id: string;
  title: string;
  body: string;
  link: string | null;
  kind: string;
}

/**
 * Send one notification to one subscription.
 *
 * Returns whether the subscription is still alive. **404 and 410 mean gone for good**
 * — the browser was uninstalled, the permission revoked, or the endpoint expired — and
 * the row is deleted immediately rather than retried, because a dead endpoint retried
 * forever is how a push queue silently becomes all garbage.
 */
const sendTo = async (
  subscription: PushSubscription,
  payload: PushPayload,
  config: NonNullable<ReturnType<typeof vapid>>,
): Promise<boolean> => {
  try {
    await webpush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      },
      JSON.stringify(payload),
      {
        vapidDetails: {
          subject: config.subject,
          publicKey: config.publicKey,
          privateKey: config.privateKey,
        },
        // A notification nobody saw within a few minutes is stale for this product.
        TTL: 600,
      },
    );

    await prisma.pushSubscription.update({
      where: { id: subscription.id },
      data: { lastUsedAt: new Date(), failureCount: 0 },
    });
    return true;
  } catch (err) {
    const status = (err as { statusCode?: number }).statusCode;

    if (status === 404 || status === 410) {
      await prisma.pushSubscription.delete({ where: { id: subscription.id } }).catch(() => {});
      logger.debug('Dropped a dead push subscription', { id: subscription.id, status });
      return false;
    }

    // Anything else might be transient — a push service having a bad minute. Counted,
    // and dropped once it is clearly not coming back, so one broken device cannot
    // consume sends forever.
    const failureCount = subscription.failureCount + 1;
    if (failureCount >= 5) {
      await prisma.pushSubscription.delete({ where: { id: subscription.id } }).catch(() => {});
      logger.warn('Dropped a push subscription after repeated failures', {
        id: subscription.id, failureCount, status,
      });
      return false;
    }

    await prisma.pushSubscription.update({
      where: { id: subscription.id },
      data: { failureCount },
    }).catch(() => {});
    logger.warn('Push send failed', { id: subscription.id, status, failureCount });
    return false;
  }
};

export interface PushResult {
  /** Why nothing was sent, when nothing was. */
  skipped?: 'not-configured' | 'no-recipients' | 'no-subscriptions';
  sent: number;
  failed: number;
}

/**
 * Push a notification to every subscribed device of everyone it is addressed to.
 *
 * Preferences are honoured per person, not per notification: two people on the same
 * workspace-wide notification can want different things, and one having push off must
 * not stop the other being told.
 */
export const pushNotification = async (notification: Notification): Promise<PushResult> => {
  const config = vapid();
  if (!config) return { skipped: 'not-configured', sent: 0, failed: 0 };

  const userIds = await recipientsOf(notification);
  if (!userIds.length) return { skipped: 'no-recipients', sent: 0, failed: 0 };

  const payload: PushPayload = {
    id: notification.id,
    title: notification.title,
    body: notification.body,
    link: notification.link,
    kind: notification.kind,
  };

  let sent = 0;
  let failed = 0;

  for (const userId of userIds) {
    const preference = await preferencesFor(userId);
    if (!wants(preference, notification.kind, 'push')) continue;

    const subscriptions = await prisma.pushSubscription.findMany({ where: { userId } });
    for (const subscription of subscriptions) {
      // Sequential rather than Promise.all: a workspace's devices are a handful, and
      // a burst of parallel sends to one push service is how you get rate limited.
      // eslint-disable-next-line no-await-in-loop
      const ok = await sendTo(subscription, payload, config);
      if (ok) sent += 1;
      else failed += 1;
    }
  }

  if (!sent && !failed) return { skipped: 'no-subscriptions', sent: 0, failed: 0 };
  return { sent, failed };
};
