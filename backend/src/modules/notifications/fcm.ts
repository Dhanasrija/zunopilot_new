import { readFileSync, statSync } from 'node:fs';
import axios from 'axios';
import { GoogleAuth } from 'google-auth-library';
import type { PushSubscription } from '@prisma/client';
import { logger } from '../../config/logger.js';
import type { PushOutcome, PushPayload, PushTransport } from './push-transport.js';

// Firebase Cloud Messaging, which is how the Flutter app is reached.
//
// **HTTP v1, not the legacy server key.** The legacy endpoint is switched off, and v1 is
// OAuth2 against a service account — so the credential here is a private key, not a
// bearer token that can be pasted anywhere.
//
// **iOS goes through here too.** Firebase forwards to APNs using the key uploaded in the
// Firebase console, which means one transport, one credential and one set of error codes
// instead of two. The cost is that APNs failures arrive translated; the alternative was a
// second transport with its own `.p8`, its own JWT and its own idea of what "gone" means.
//
// ── Why the credentials are read at the point of use ─────────────────────────
//
// `config/env.ts` snapshots `process.env` at import, and a rotatable secret read from that
// snapshot still reads as configured after it has been changed — a trap this codebase has
// hit five times. So nothing here goes through `env`. The service-account file is also
// re-read when its modification time changes, so rotating the key on the box does not need
// a restart to take effect.

const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
/** Long enough for a slow mobile network round trip, short enough not to hold a worker. */
const TIMEOUT_MS = 8_000;

interface ServiceAccount {
  projectId: string;
  clientEmail: string;
  privateKey: string;
}

/**
 * Read the service account, two ways.
 *
 * A file path is the documented way and the one to prefer: a PEM private key in a `.env`
 * file has embedded newlines, which every shell, process manager and CI secret store
 * mangles differently. The three loose variables exist because some hosts only offer
 * environment variables, and `\n` is unescaped for exactly that case.
 */
const readServiceAccount = (): ServiceAccount | null => {
  const file = process.env.FCM_SERVICE_ACCOUNT_FILE;
  if (file) {
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as {
        project_id?: string; client_email?: string; private_key?: string;
      };
      if (!parsed.project_id || !parsed.client_email || !parsed.private_key) {
        logger.error('FCM service account file is missing project_id, client_email or private_key', { file });
        return null;
      }
      return {
        projectId: parsed.project_id,
        clientEmail: parsed.client_email,
        privateKey: parsed.private_key,
      };
    } catch (err) {
      // Deliberately not thrown: a broken credential must cost pushes, not the process.
      logger.error('Could not read the FCM service account file', {
        file, error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  const projectId = process.env.FCM_PROJECT_ID;
  const clientEmail = process.env.FCM_CLIENT_EMAIL;
  const privateKey = process.env.FCM_PRIVATE_KEY;
  if (!projectId || !clientEmail || !privateKey) return null;

  return { projectId, clientEmail, privateKey: privateKey.replace(/\\n/g, '\n') };
};

/**
 * What identifies the current credential, so a rotation invalidates the cached client.
 *
 * Includes the file's modification time, which is the only way to notice a key that was
 * replaced in place — the path is unchanged, so a fingerprint of the path alone would keep
 * signing with the retired key until the next restart.
 */
const fingerprint = (): string => {
  const file = process.env.FCM_SERVICE_ACCOUNT_FILE;
  if (file) {
    try {
      return `file:${file}:${statSync(file).mtimeMs}`;
    } catch {
      return `file:${file}:missing`;
    }
  }
  return `env:${process.env.FCM_PROJECT_ID ?? ''}:${process.env.FCM_CLIENT_EMAIL ?? ''}:${
    (process.env.FCM_PRIVATE_KEY ?? '').length}`;
};

let cache: { key: string; account: ServiceAccount; auth: GoogleAuth } | null = null;

/**
 * The signing client, built once per credential.
 *
 * `GoogleAuth` mints and caches the access token itself and refreshes it before expiry, so
 * this is the whole of the OAuth handling. Rebuilding it per message would fetch a token
 * per message — a second round trip to Google before every notification.
 */
const client = (): { account: ServiceAccount; auth: GoogleAuth } | null => {
  const key = fingerprint();
  if (cache?.key === key) return cache;

  const account = readServiceAccount();
  if (!account) {
    cache = null;
    return null;
  }

  cache = {
    key,
    account,
    auth: new GoogleAuth({
      credentials: { client_email: account.clientEmail, private_key: account.privateKey },
      scopes: [SCOPE],
    }),
  };
  return cache;
};

/** Is FCM configured on this server? */
export const fcmAvailable = (): boolean => client() !== null;

/** The project the app must be registered against, for the console and for diagnostics. */
export const fcmProjectId = (): string | null => client()?.account.projectId ?? null;

/**
 * Does this error mean the token is dead, rather than that we are?
 *
 * **Only `UNREGISTERED` and a 404 count.** FCM answers `INVALID_ARGUMENT` both for a token
 * it cannot parse and for a message *we* built wrongly, and the two are not reliably
 * distinguishable from the response — so a payload bug would present as every device on
 * the platform being invalid at once. Treating that as "keep the device, count the
 * failure" costs a few retries; treating it as "gone" costs every registration we have.
 */
const isDeadToken = (status: number | undefined, errorCode: string | undefined): boolean =>
  status === 404 || errorCode === 'UNREGISTERED';

/** FCM's own error code, buried in the v1 error envelope. */
const errorCodeOf = (data: unknown): string | undefined => {
  const details = (data as { error?: { details?: { errorCode?: string }[]; status?: string } })?.error;
  return details?.details?.find((entry) => entry.errorCode)?.errorCode ?? details?.status;
};

/**
 * One notification to one device.
 *
 * Sends `notification` **and** `data`: the first is what Android and iOS draw in the tray
 * while the app is backgrounded, without the app running any code; the second is what the
 * app reads when the person taps it. Data-only would mean nothing appears unless the app
 * happens to be alive, which is the opposite of what push is for.
 */
const send = async (device: PushSubscription, payload: PushPayload): Promise<PushOutcome> => {
  const resolved = client();
  if (!resolved) return 'unavailable';
  if (!device.deviceToken) {
    logger.warn('A mobile push row has no token', { id: device.id });
    return 'failed';
  }

  let accessToken: string | null | undefined;
  try {
    accessToken = await resolved.auth.getAccessToken();
  } catch (err) {
    // A rejected service account is our problem on every device at once, so it must not be
    // counted against any of them.
    logger.error('Could not get an FCM access token', {
      error: err instanceof Error ? err.message : String(err),
    });
    return 'unavailable';
  }
  if (!accessToken) return 'unavailable';

  try {
    await axios.post(
      `https://fcm.googleapis.com/v1/projects/${resolved.account.projectId}/messages:send`,
      {
        message: {
          token: device.deviceToken,
          notification: { title: payload.title, body: payload.body },
          // Every value must be a string — FCM rejects a data map with anything else, and
          // a null would be sent as the word "null" if it got through.
          data: {
            id: payload.id,
            kind: payload.kind,
            tenantId: payload.tenantId,
            ...(payload.link ? { link: payload.link } : {}),
          },
          android: {
            // A customer waiting on a reply is time-sensitive; normal priority lets
            // Android hold the message until the device next wakes.
            priority: 'high',
            notification: { channelId: 'zunopilot_messages', sound: 'default' },
          },
          apns: {
            headers: { 'apns-priority': '10' },
            payload: { aps: { sound: 'default' } },
          },
        },
      },
      { timeout: TIMEOUT_MS, headers: { Authorization: `Bearer ${accessToken}` } },
    );
    return 'ok';
  } catch (err) {
    const status = axios.isAxiosError(err) ? err.response?.status : undefined;
    const errorCode = axios.isAxiosError(err) ? errorCodeOf(err.response?.data) : undefined;

    if (isDeadToken(status, errorCode)) {
      logger.debug('FCM says this token is gone', { id: device.id, status, errorCode });
      return 'gone';
    }

    // 401/403 is a credential problem and 5xx is Google having a bad minute: both are
    // every device at once, so neither is the device's fault.
    if (status === 401 || status === 403 || (status !== undefined && status >= 500)) {
      logger.error('FCM refused the request', { status, errorCode });
      return 'unavailable';
    }

    logger.warn('FCM send failed', { id: device.id, status, errorCode });
    return 'failed';
  }
};

export const fcmTransport: PushTransport = {
  name: 'fcm',
  available: fcmAvailable,
  send,
};
