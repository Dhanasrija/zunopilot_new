import webpush from 'web-push';
import type { PushSubscription } from '@prisma/client';
import { logger } from '../../config/logger.js';
import type { PushOutcome, PushPayload, PushTransport } from './push-transport.js';

// Web Push: reaching a browser with the tab closed.
//
// **Why Web Push and not a vendor SDK for the web.** It is the only option that needs no
// third party, no app store presence and no per-message cost — the browser's own push
// service delivers, authenticated by a VAPID key pair we hold. The cost is a real platform
// caveat, stated here because it will otherwise be discovered as a bug: **on iOS this only
// works once the site has been added to the home screen.** Safari implements Web Push for
// installed web apps only. Desktop Safari, Chrome, Edge and Android Chrome all work from a
// normal tab. The Flutter app does not use this transport at all — see `fcm.ts`.
//
// **Why the keys are read from `process.env` at the point of use, with no fallback.**
// `config/env.ts` snapshots the environment at import, and a rotatable secret read from
// that snapshot reads as configured after it has been changed — a trap this codebase has
// hit five times. There is also deliberately no fallback to any other secret: a push key
// pair that silently became something else would mean every existing subscription breaks
// with no error anyone would connect to the cause.

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
 * Is browser push usable?
 *
 * The web client asks before offering the control, so a server without VAPID keys shows
 * nothing rather than a button that fails when pressed. **Deliberately not "is push
 * configured at all"** — a server with FCM but no VAPID can reach the app and not the
 * browser, and telling the browser otherwise would offer exactly that broken button.
 */
export const webPushAvailable = (): boolean => vapid() !== null;

/** The public key, which the browser needs to build a subscription. Safe to expose. */
export const pushPublicKey = (): string | null => vapid()?.publicKey ?? null;

const send = async (device: PushSubscription, payload: PushPayload): Promise<PushOutcome> => {
  const config = vapid();
  if (!config) return 'unavailable';
  if (!device.endpoint || !device.p256dh || !device.auth) {
    // A WEB row without its keys cannot be encrypted to. Not "gone" — it is malformed,
    // and deleting rows on the strength of our own bad data is how you lose the good ones.
    logger.warn('A browser push row is missing its endpoint or keys', { id: device.id });
    return 'failed';
  }

  try {
    await webpush.sendNotification(
      {
        endpoint: device.endpoint,
        keys: { p256dh: device.p256dh, auth: device.auth },
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
    return 'ok';
  } catch (err) {
    const status = (err as { statusCode?: number }).statusCode;

    // **404 and 410 mean gone for good** — the browser was uninstalled, the permission
    // revoked, or the endpoint expired.
    if (status === 404 || status === 410) {
      logger.debug('A browser push endpoint is gone', { id: device.id, status });
      return 'gone';
    }

    // 401/403 is our VAPID pair being wrong, which is every subscription at once.
    if (status === 401 || status === 403) {
      logger.error('A push service refused our VAPID credentials', { status });
      return 'unavailable';
    }

    logger.warn('Browser push send failed', { id: device.id, status });
    return 'failed';
  }
};

export const webPushTransport: PushTransport = {
  name: 'web-push',
  available: webPushAvailable,
  send,
};
