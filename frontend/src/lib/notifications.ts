import { api } from './api';

// The notifications API, and the browser plumbing around it.
//
// Kept in one file because the three layers are one feature and share a vocabulary:
// what the server knows (`AppNotification`), what this person wants (`Preference`), and
// what this *device* can do (permission, subscription). Splitting them would mean three
// files that only ever change together.

export type NotificationKind = 'MESSAGE_RECEIVED' | 'HANDOFF_REQUESTED' | 'ORDER_CREATED';

export interface AppNotification {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  link: string | null;
  conversationId: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationPreference {
  inApp: boolean;
  browser: boolean;
  push: boolean;
  messageReceived: boolean;
  handoffRequested: boolean;
  orderCreated: boolean;
}

export interface PushCapability {
  /** False when the server has no VAPID keys. The UI must then offer nothing. */
  available: boolean;
  publicKey: string | null;
  /**
   * False when the server has no FCM credentials.
   *
   * Nothing on the web depends on this — it is here because it comes back in the same payload,
   * and because the device list below now shows phones registered by the app. Deliberately a
   * second flag rather than one combined one: a server can reach the app and not the browser,
   * and a single flag would have this page offering a subscribe button that cannot work.
   */
  mobileAvailable?: boolean;
}

export interface PushDevice {
  id: string;
  /** `WEB` for a browser; `ANDROID` or `IOS` for the app. */
  platform: 'WEB' | 'ANDROID' | 'IOS';
  /** Null on a phone, where there is no push-service URL. */
  endpoint: string | null;
  /** What the app calls this phone — "Pixel 8". Null for a browser. */
  deviceName: string | null;
  appVersion: string | null;
  /** Set for a browser. Null for a phone, which sends `deviceName` instead. */
  userAgent: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}

export const fetchUnreadCount = async (): Promise<number> => {
  const r = await api.get<{ data: { count: number } }>('/notifications/unread-count');
  return r.data.data.count;
};

export const fetchNotifications = async (limit = 30): Promise<{
  notifications: AppNotification[];
  unread: number;
}> => {
  const r = await api.get<{ data: { notifications: AppNotification[]; unread: number } }>(
    '/notifications', { params: { limit } },
  );
  return r.data.data;
};

export const markNotificationRead = (id: string) =>
  api.post(`/notifications/${id}/read`);

export const markAllNotificationsRead = () => api.post('/notifications/read-all');

export const fetchPreferences = async (): Promise<{
  preference: NotificationPreference;
  push: PushCapability;
}> => {
  const r = await api.get<{ data: { preference: NotificationPreference; push: PushCapability } }>(
    '/notifications/preferences',
  );
  return r.data.data;
};

export const savePreferences = async (
  patch: Partial<NotificationPreference>,
): Promise<NotificationPreference> => {
  const r = await api.put<{ data: { preference: NotificationPreference } }>(
    '/notifications/preferences', patch,
  );
  return r.data.data.preference;
};

export const fetchPushDevices = async (): Promise<PushDevice[]> => {
  const r = await api.get<{ data: PushDevice[] }>('/notifications/push/devices');
  return r.data.data;
};

// ── Browser capability ────────────────────────────────────────────────────────

export const browserNotificationsSupported = (): boolean =>
  typeof window !== 'undefined' && 'Notification' in window;

export const notificationPermission = (): NotificationPermission | 'unsupported' =>
  browserNotificationsSupported() ? Notification.permission : 'unsupported';

/**
 * Ask for permission.
 *
 * **Must be called from a click.** Chrome and Safari both require a user gesture, and
 * a request fired on page load is not merely rude — it is silently denied, which then
 * looks like a broken feature. That is why nothing in this codebase calls this except
 * a button handler.
 */
export const requestNotificationPermission = async (): Promise<NotificationPermission> => {
  if (!browserNotificationsSupported()) return 'denied';
  return Notification.requestPermission();
};

/**
 * Show one desktop notification.
 *
 * `tag` is the notification's id, so the same event arriving twice — two tabs polling,
 * a re-render — replaces rather than stacks. Clicking focuses this tab and navigates.
 */
export const showBrowserNotification = (
  notification: AppNotification,
  onClick: (link: string | null) => void,
): void => {
  if (notificationPermission() !== 'granted') return;

  const shown = new Notification(notification.title, {
    body: notification.body,
    tag: notification.id,
    icon: '/app-logo.png',
    // Handoffs interrupt; ordinary messages do not steal focus from what someone is
    // reading. `requireInteraction` is Chrome-only and ignored elsewhere, which is fine.
    requireInteraction: notification.kind === 'HANDOFF_REQUESTED',
  });

  shown.onclick = () => {
    window.focus();
    shown.close();
    onClick(notification.link);
  };
};

// ── Web Push ──────────────────────────────────────────────────────────────────

/**
 * The VAPID public key arrives base64url; `applicationServerKey` wants bytes.
 *
 * Backed by an explicitly allocated `ArrayBuffer` rather than `Uint8Array.from`, which
 * infers `ArrayBufferLike` — and `ArrayBufferLike` includes `SharedArrayBuffer`, which
 * `applicationServerKey` will not accept. Allocating the buffer says which kind it is.
 */
const urlBase64ToUint8Array = (base64: string): Uint8Array<ArrayBuffer> => {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const normalised = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(normalised);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
};

export const pushSupported = (): boolean =>
  typeof navigator !== 'undefined'
  && 'serviceWorker' in navigator
  && typeof window !== 'undefined'
  && 'PushManager' in window;

/**
 * Register the service worker.
 *
 * Idempotent — the browser returns the existing registration for the same scope, so
 * calling this on every mount costs nothing.
 */
export const registerServiceWorker = async (): Promise<ServiceWorkerRegistration | null> => {
  if (!pushSupported()) return null;
  try {
    return await navigator.serviceWorker.register('/sw.js');
  } catch {
    // A failed registration is not worth a toast: push simply stays unavailable.
    return null;
  }
};

/**
 * Subscribe this device and tell the server.
 *
 * Returns a plain-English reason when it cannot, because every one of these is
 * something the person can act on — and "it didn't work" is not.
 */
export const subscribeToPush = async (publicKey: string): Promise<
  { ok: true } | { ok: false; reason: string }
> => {
  if (!pushSupported()) {
    return { ok: false, reason: 'This browser cannot receive push notifications.' };
  }
  if (notificationPermission() !== 'granted') {
    return { ok: false, reason: 'Allow notifications first, then turn on push.' };
  }

  const registration = await registerServiceWorker();
  if (!registration) {
    return { ok: false, reason: 'The background worker could not start in this browser.' };
  }

  // `ready` rather than using the registration directly: a freshly registered worker
  // is still installing, and subscribing against it fails.
  const active = await navigator.serviceWorker.ready;

  const existing = await active.pushManager.getSubscription();
  const subscription = existing ?? await active.pushManager.subscribe({
    // Required to be true by every browser that implements this: a push that shows
    // nothing is not allowed.
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });

  const json = subscription.toJSON() as { endpoint?: string; keys?: Record<string, string> };
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
    return { ok: false, reason: 'The browser returned an unusable subscription.' };
  }

  await api.post('/notifications/push/subscribe', {
    endpoint: json.endpoint,
    keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
  });
  return { ok: true };
};

/** Unsubscribe this device, both in the browser and on the server. */
export const unsubscribeFromPush = async (): Promise<void> => {
  if (!pushSupported()) return;
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return;

  // Server first: if the browser unsubscribe succeeded and the API call then failed,
  // the row would linger and be pushed to forever until it 410s.
  await api.post('/notifications/push/unsubscribe', { endpoint: subscription.endpoint });
  await subscription.unsubscribe();
};

/** Is *this* browser currently subscribed? Distinct from the account-level preference. */
export const isPushSubscribedHere = async (): Promise<boolean> => {
  if (!pushSupported()) return false;
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  return Boolean(subscription);
};
