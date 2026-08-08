# The mobile app: push instead of polling

What the Flutter app has to do, and what the server now does for it.

The starting point is that the web Inbox **polls every second** — the conversation list and the open
thread — and the notification bell every fifteen. That is affordable on a laptop and not on a phone,
and it is why two things exist now: push, so the app is told when something happened, and delta
reads, so being told costs one small request instead of the whole inbox.

The rule to build against: **push is the wake-up, not the data.** A payload is small, best-effort and
occasionally dropped by the platform. Treat it as "go and look", and get the truth from a delta read.

---

## 1. Registering a device

```
POST /api/notifications/push/devices
Authorization: Bearer <token>

{
  "platform": "ANDROID",          // or "IOS"
  "token": "<FCM registration token>",
  "deviceId": "<the app's own install id>",
  "deviceName": "Pixel 8",        // optional, shown in Settings
  "appVersion": "1.4.0"           // optional
}
```

Call it **on sign-in and on every token refresh** (`FirebaseMessaging.onTokenRefresh`). It is
idempotent — the same `deviceId` rewrites one row.

**`deviceId` is not optional and it is not the FCM token.** Generate it once on first launch, store
it, and never change it. An FCM token rotates: on reinstall, on restore from a backup, when app data
is cleared, and sometimes on its own. If the token were the key, each rotation would leave the old
row behind and the phone would be pushed to twice, then three times — a retired token keeps accepting
deliveries for a while before it starts refusing them.

A **422** means this server has no FCM credentials. Check `push.mobileAvailable` from
`GET /api/notifications/preferences` before offering anything push-related in the UI.

### Signing out

```
DELETE /api/notifications/push/devices/:id
```

The id comes from `GET /api/notifications/push/devices`, which lists every device — phones and
browsers together, with `platform` and `deviceName`, and never the token itself. Deleting one device
deliberately **leaves the `push` preference on**: the person may still want push on their other
phone.

### Several phones, one login

All of them are pushed to. Nothing needs to be done for this, but it is worth knowing why: sending
only to the most recently registered device reads, from the outside, as push working sometimes — which
is indistinguishable from broken.

---

## 2. What a push carries

```json
{
  "notification": { "title": "Asha", "body": "Do you deliver to Banjara Hills?" },
  "data": {
    "id": "<notification id>",
    "kind": "MESSAGE_RECEIVED",
    "tenantId": "<workspace id>",
    "link": "/inbox?c=<conversation id>"
  }
}
```

`notification` is what Android and iOS draw in the tray while the app is backgrounded, with no app
code running. `data` is what you read when the person taps it.

**Switch to `tenantId` before following `link`.** One login can belong to several workspaces, and
`link` is a relative path with no workspace in it — so following it while the app is showing a
different workspace opens that workspace's inbox, finds nothing, and the notification looks like it
lied. Call `POST /api/auth/switch-workspace` first if `tenantId` is not the active one, then navigate.

Sent at high priority (`apns-priority: 10`, Android `high`), because a waiting customer is
time-sensitive. Android notifications use the channel id `zunopilot_messages` — create that channel in
the app or the tray notification will be silent on Android 8+.

---

## 3. Delta reads

Both Inbox reads take a cursor. Without one they behave exactly as they always have, so nothing
existing changes.

```
GET /api/inbox/conversations/:id/messages?since=<nextSince>&sinceId=<nextSinceId>
GET /api/inbox/conversations?since=<nextSince>&sinceId=<nextSinceId>
```

```json
{
  "success": true,
  "data": [ /* only what changed */ ],
  "meta": { "nextSince": "…", "nextSinceId": "…", "hasMore": false }
}
```

Echo `nextSince` and `nextSinceId` back on the next call. While `hasMore` is true, call again
**immediately** rather than waiting for the next tick — that is how a client that has been offline
catches up in a burst instead of one page per interval.

Four things about it that will otherwise be discovered as bugs:

- **A delivery tick is a change to a message you already have**, not a new one. Upsert by `id`; do
  not append. This is the whole reason the cursor is on when a row changed rather than when it was
  created.
- **A removal arrives as a tombstone**: `id`, `conversationId`, `direction`, the timestamps and
  `deletedAt`, with no content. `deletedAt` set means drop it from the thread.
- **An empty delta hands your own cursor back.** It does not advance to now, so do not treat an
  unchanged cursor as an error.
- **A filter plus a cursor has one gap.** A conversation that changes *out* of the filtered set —
  closed while you are looking at OPEN — is not in the delta, because it no longer matches. Poll the
  unfiltered list and filter locally where it needs to be exact.

A cursor the server cannot parse is a **400**, deliberately, rather than a silent full read: the
alternative hides the bug while every poll re-downloads the thread.

### What to poll, and when

| State | What to do |
|---|---|
| A thread open in the foreground | Delta the thread every 3–5s, and on every push |
| App in the foreground, no thread open | Delta the conversation list every 10–15s |
| Backgrounded | Nothing. Push wakes you; delta on receipt |
| Returning to the foreground | One delta of each, using the stored cursor |

Persist the cursors, so relaunching after two days is one small request rather than a full download.

---

## 4. What is still missing, and it matters

**The token lasts 24 hours and there is no refresh endpoint** (`JWT_EXPIRES_IN=1d`). As it stands the
app will demand a new OTP every day. This needs deciding before the app ships; it is not a mobile-only
gap — it is the same for anyone who leaves a browser tab open.

A push does not carry an unread badge count. `GET /api/notifications/unread-count` is one small call
if the app wants one.

---

## 5. What the server needs, on the box

Set in the backend's environment, and read directly from it at the point of use — never from a
snapshot, so rotating a key takes effect without a mystery.

| Variable | What it is |
|---|---|
| `FCM_SERVICE_ACCOUNT_FILE` | Path to the service-account JSON from Firebase → Project settings → Service accounts. **Prefer this.** |
| `FCM_PROJECT_ID`, `FCM_CLIENT_EMAIL`, `FCM_PRIVATE_KEY` | The same three fields as loose variables, for hosts that offer nothing else. Escape newlines in the key as `\n`. Ignored when the file is set. |

Put the JSON outside the repo — `/etc/zunopilot/fcm.json`, owned by the service user, mode 600 — and
point at it. A PEM private key pasted into `.env` has embedded newlines that every shell, process
manager and CI secret store mangles differently, and the failure looks like an authentication error
rather than a formatting one.

The file is re-read when its modification time changes, so replacing the key in place does not need a
restart.

For iOS, upload the APNs auth key in the **Firebase** console (Project settings → Cloud Messaging →
APNs keys). Delivery then goes Firebase → APNs, so there is one credential here and one set of error
codes rather than two.

With none of these set, mobile push is off and nothing else is affected: registration answers 422,
`push.mobileAvailable` is false, and browser push carries on.
