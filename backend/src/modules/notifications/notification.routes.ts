import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import {
  deleteDevice, getDevices, getNotifications, getPreferences, getUnreadCount,
  postDevice, postMarkAllRead, postMarkRead, postSubscribe, postUnsubscribe, putPreferences,
} from './notification.controller.js';

// Notifications.
//
// **`requireAuth` and nothing else — no `requirePermission`, no `requireModule`.**
//
// Every route here is scoped to the caller by the service's `visibleTo`, so being
// signed in *is* the authorisation. A `notifications:read` permission would only make
// it possible to build a role that uses the product but is never told anything, which
// is not a state anyone wants to configure. And notifications are not a sellable
// module: they are how a shared inbox works at all, so gating them behind a tier would
// mean the cheapest plan silently loses customer messages.
//
// Ordering note: the two `/push/...` paths come before nothing dynamic, so there is no
// shadowing to worry about here — but `/read-all` is deliberately spelled with a dash
// rather than sitting under `/:id`, so it can never be mistaken for a notification id.

const router = Router();
router.use(requireAuth);

router.get('/', getNotifications);
router.get('/unread-count', getUnreadCount);
router.post('/read-all', postMarkAllRead);

router.get('/preferences', getPreferences);
router.put('/preferences', putPreferences);

router.get('/push/devices', getDevices);
router.post('/push/subscribe', postSubscribe);
router.post('/push/unsubscribe', postUnsubscribe);

// The Flutter app's half. `POST` registers or re-registers a phone by its own install id;
// `DELETE` takes any device off, whichever transport it uses, which is what signing out of
// the app calls. `/push/devices/:id` cannot shadow anything — every other path under
// `/push/` is a fixed word.
router.post('/push/devices', postDevice);
router.delete('/push/devices/:id', deleteDevice);

// Last, so every fixed path above wins over it.
router.post('/:id/read', postMarkRead);

export default router;
