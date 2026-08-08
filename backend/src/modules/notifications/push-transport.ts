import type { PushPlatform, PushSubscription } from '@prisma/client';

// What every way of reaching a device has in common.
//
// There are two: a browser's own push service, and Firebase Cloud Messaging for the
// Flutter app. They agree on almost nothing — different credentials, different request
// shapes, different vocabularies for "this device is gone" — so the seam is deliberately
// narrow. **A transport decides how to send and what the answer means; it never decides
// what happens to the row.** That policy (reset the failure count, count a failure, drop
// a dead device) lives once in `push.service.ts`, because two copies of it would drift
// and the drift would show up as devices that stop receiving pushes for no visible
// reason.

/** What the client receives. Kept small — Web Push payloads have a hard size limit. */
export interface PushPayload {
  id: string;
  title: string;
  body: string;
  link: string | null;
  kind: string;
  /**
   * Which workspace this is about.
   *
   * **Not decoration.** One login can now belong to several workspaces, and `link` is a
   * relative path with no workspace in it — so a push about workspace B, tapped while the
   * app is showing workspace A, would open A's inbox and find nothing there. The
   * notification would appear to have lied. The client switches workspace on this field
   * before it navigates.
   */
  tenantId: string;
}

/**
 * What a send attempt meant, in the only four flavours the caller can act on.
 *
 * The distinction between the last two is what stops a bad deploy wiping every device on
 * the platform: `failed` counts against the device and eventually drops it, and
 * `unavailable` never does. A malformed payload or an expired service account produces an
 * error for *every* device at once, and a policy that could not tell that apart from a
 * dead handset would delete them all within five notifications.
 */
export type PushOutcome =
  /** Delivered to the push service. */
  | 'ok'
  /** This device is gone for good — unsubscribed, uninstalled, token retired. Drop it. */
  | 'gone'
  /** This attempt failed and the device may be at fault. Counted. */
  | 'failed'
  /** Our end is at fault — no credentials, bad payload, provider outage. Not counted. */
  | 'unavailable';

export interface PushTransport {
  /** For logs, and for the "is this even configured" check. */
  readonly name: string;
  /** Can this transport send right now? False means "not configured", not "broken". */
  available(): boolean;
  send(device: PushSubscription, payload: PushPayload): Promise<PushOutcome>;
}

/**
 * Which transport reaches a given platform.
 *
 * A `Record` rather than a switch, so a new platform that nobody wired up is a type error
 * at the table instead of a device the fan-out silently skips.
 */
export type TransportTable = Record<PushPlatform, PushTransport>;
