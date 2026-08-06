/* eslint-env serviceworker */

// The service worker, and only for push.
//
// **It caches nothing, deliberately.** A worker that intercepts `fetch` becomes
// responsible for every request the app makes, and a stale-cache bug in that position
// serves an old build to someone who reloaded to escape one. The only reason this file
// exists is that Web Push has nowhere else to run: a push arrives when no page is open,
// so the handler cannot live in the app.
//
// Kept as plain JS in `public/` rather than bundled, so its URL and scope are stable.
// A worker's scope is the directory it is served from — at the root it can receive push
// for the whole origin, which is what a bundled, hashed filename could not guarantee.

// Take over immediately rather than waiting for every old tab to close. There is no
// cached content to be inconsistent about, so the usual reason to wait does not apply.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  // A push with no data still has to show something: `userVisibleOnly` is true on the
  // subscription, and a browser that receives a push and shows nothing may revoke the
  // permission entirely.
  let payload = {
    title: 'ZunoPilot',
    body: 'Something needs your attention.',
    link: '/inbox',
    id: undefined,
    kind: undefined,
  };

  try {
    if (event.data) payload = { ...payload, ...event.data.json() };
  } catch {
    // Malformed payload — fall through to the generic notification above rather than
    // silently showing nothing.
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: '/app-logo.png',
      badge: '/app-logo.png',
      // The notification's own id, so the same event pushed twice replaces rather than
      // stacks — the phone equivalent of the desktop `tag`.
      tag: payload.id || 'zunopilot',
      // Only a handoff insists. An ordinary message should not sit on screen until
      // dismissed.
      requireInteraction: payload.kind === 'HANDOFF_REQUESTED',
      data: { link: payload.link || '/inbox' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const link = (event.notification.data && event.notification.data.link) || '/inbox';

  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({
      type: 'window',
      // Required to see tabs this worker did not itself open — without it a person
      // with the app already open gets a second one.
      includeUncontrolled: true,
    });

    // Reuse a tab on this origin if there is one. Opening a duplicate ZunoPilot beside
    // the one already showing the Inbox is the most common complaint about web push.
    for (const client of clients) {
      if (new URL(client.url).origin === self.location.origin) {
        await client.focus();
        // `navigate` is not available on every client (and throws when the tab is not
        // controlled), so the failure is tolerated: a focused tab on the wrong page is
        // still better than a new window.
        if ('navigate' in client) {
          try {
            await client.navigate(link);
          } catch {
            /* focused but not navigated — acceptable */
          }
        }
        return;
      }
    }

    await self.clients.openWindow(link);
  })());
});
