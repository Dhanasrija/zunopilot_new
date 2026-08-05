# Running ZunoPilot in production

Deployment lives outside this repository — there is no Dockerfile, process manager or CI
config here, and nothing in version control starts or restarts the app. This document is the
contract between the code and whatever does: **what the environment must provide for the
application's own safety mechanisms to work.**

Written after a security and readiness audit. Where something is missing rather than wrong,
it says so.

## Required environment

Three secrets have **no default and no fallback**. Two of them will stop the process; the
third silently disables a feature, which is the intended failure.

| Variable | If absent | Generate with |
|---|---|---|
| `DATABASE_URL` | throws at import | — |
| `JWT_SECRET` | throws at import; **also refuses to boot if under 32 chars** | `openssl rand -base64 48` |
| `SUPERADMIN_JWT_SECRET` | super admin API refuses to boot (≥ 32 chars) | `openssl rand -base64 48` |
| `META_APP_SECRET` | **every inbound webhook is rejected** | Meta app dashboard |
| `META_WEBHOOK_VERIFY_TOKEN` | the subscribe handshake always fails | any long random string |
| `ENCRYPTION_KEY` | connector credential routes fail with a clear message | `openssl rand -base64 32` |

`JWT_SECRET` used to fall back to a placeholder committed in this repository, which meant a
missing variable booted normally and signed every customer session with a public string. It
now fails instead. This is the fifth time the "unset reads as configured" pattern has caused
a problem here, so if you add a secret, add it with no default.

**`ALLOW_UNSIGNED_WEBHOOKS` must not be set.** It exists so local development can run against
a mock without Meta's app secret. In a deployed environment it turns `POST /api/webhook` —
which is unauthenticated by design, because Meta cannot present a token — into an open write
API for every tenant.

## `NODE_ENV=production`

Set it explicitly. It is not set anywhere in this repository, and the audit found several
places that had been written as `NODE_ENV !== 'production'`, meaning an unset variable chose
the *more* revealing branch. Those have been inverted so that unset is the safe state, but
two things still genuinely depend on it:

- **Log format.** `config/logger.ts` emits structured JSON only in production; otherwise it
  emits human-readable text, which a log aggregator cannot parse.
- **`OTP_ECHO`** is refused outright when this is `production`, and logged as an error if
  someone tries. That is a complete authentication bypass, so the refusal matters.

## Storage

**`MEDIA_DIR` must point at persistent storage.** It defaults to `.media` under the process
working directory. In a container without a mounted volume, every uploaded template image is
lost on redeploy, and any campaign referencing it breaks at send time — the failure appears
later, in someone else's incident.

## Migrations

Use `npx prisma migrate deploy`. **Do not use `npm run prisma:migrate`** — that is
`prisma migrate dev`, which is interactive and can offer to reset the database on drift.

Two hand-written partial unique indexes must survive every migration:
`WorkflowInstance_one_active_per_conversation` and `Price_one_active_per_plan_interval`.
Migrations are additive only.

**One migration to check before a first deploy.**
`20260729000000_sync_grocery_category_and_item_attributes` narrows the `BusinessCategory`
enum, dropping `SALON`, `RETAIL`, `CLINIC` and `OTHER`. It fails loudly rather than corrupting
anything, but it will block `migrate deploy` if any `Tenant` row still holds a dropped value.
Check first:

```sql
SELECT category, count(*) FROM "Tenant" GROUP BY category;
```

## Backups — there are none

There is no backup script, no `pg_dump` anywhere, and no documented restore procedure in this
repository. This is the largest single operational risk in the system: right now a dropped
table or a lost volume is unrecoverable, and it takes the tenants, conversations, orders and
GST invoices with it.

Whatever you use, the acceptance test is a **restore**, not a backup. A dump that has never
been restored into a scratch database is an untested assumption.

Invoices deserve specific mention: they are legal records under Indian GST, they are
deliberately immutable, and they cannot be regenerated from anything else in the system.

## Health checks

`GET /health` runs `SELECT 1` and returns **503** when the database is unreachable. Point the
load balancer at it. It used to return 200 unconditionally, which meant an instance with a
dead connection pool kept receiving traffic.

pg-boss is deliberately *not* checked: workers are optional in this process
(`RUN_WORKERS_IN_API`), so a queue problem must not remove the API from rotation.

## Observability

Every response carries `X-Request-Id`, honouring an inbound one from the proxy if present.
It appears on every error log line, so a user's report can be traced to a specific request.

There is no error tracking (Sentry or similar) and no metrics endpoint. Winston JSON shipped
to an aggregator is the whole story.

## Proxy expectations

`app.ts` sets `trust proxy` to `1` — exactly one hop. It must be nginx or an equivalent
terminating TLS in front. Two consequences:

- With **no** proxy, `req.ip` still works, but the trust setting is a lie; harmless.
- With **two or more** hops, the rate limiter and `/api/contact`'s IP limiter will key on the
  wrong address. Adjust the number to match reality rather than setting `true`, which lets a
  client spoof `X-Forwarded-For` and walk through every limiter.

CORS is an allowlist of `FRONTEND_URL`, `SUPERADMIN_ORIGIN` and `APP_URL`. Set them, or the
browser app cannot call the API.

Requests with no `Origin` header are allowed — that is every server-to-server caller and
Meta's webhook. CORS is a browser control and refusing those would break the webhook while
stopping nothing.

## Staging

`frontend/public/robots.txt` ships an *allow* to wherever it is deployed, and the SEO tags in
`index.html` are absolute and hardcoded to `https://zunopilot.com`. A publicly reachable
staging host therefore needs `X-Robots-Tag: noindex` set at the host level. No file in
`public/` can distinguish environments.

## App Store / Play review login

`PRODOTPFORTEST` must be **6 to 8 digits**. A 4- or 5-digit value disables the bypass with an
error in the log rather than accepting a weak code — at 25 attempts an hour, a 4-digit code
falls to guessing in about eight days.

Point `PRODOTPTESTNUMBER` at a number that is not, and will never be, a real customer's. The
bypass logs into whatever account owns that number, and it is a standing credential for as
long as both variables are set.

## Seeding

Every script in `prisma/` calls `assertSeedable()` first, which refuses to run when
`NODE_ENV=production` or when the `DATABASE_URL` host is not local. Seeding production is
occasionally legitimate — the connector-type catalogue and the super admin account both have
to exist there — so the override is `I_KNOW_THIS_IS_PRODUCTION=true`, and it logs the host it
is about to write to.

## Known dependency advisories

Assessed rather than auto-fixed, because in both cases `npm audit fix` proposes a
semver-major framework upgrade that does not belong in a security patch.

- **`react-router` 6.30.4 — moderate, open redirect via backslash in `Link`/`useNavigate`.**
  No fix exists in the 6.x line; the patch is in 7.x. **Assessed as not reachable here:** the
  advisory needs navigation to an attacker-supplied path, and this app never builds a
  `navigate()` target or a `<Link to>` from user input. The four pages that read the query
  string take named parameters only, and `Settings.tsx` validates `tab` against a fixed list.
  Re-check this conclusion if a `?redirect=` or `?returnTo=` parameter is ever introduced.
- **`vite` 5.4.21 — high, dev-server file access.** A dev dependency: production serves
  static files built by `vite build` and never runs the dev server. It does affect a developer
  running `npm run dev` on an untrusted network. The fix is vite 8, a two-major upgrade.
- **`uuid` — moderate, missing bounds check when an explicit `buf` is passed.** No caller here
  passes `buf`. The fix is a major bump.

Both framework upgrades are worth scheduling on their own, with their own testing. None of
the three is a reason to hold a release.

`frontend/package-lock.json` is out of sync with the installed tree — `npm audit fix` refuses
to run at all because of it. Worth repairing separately with `npm install --package-lock-only`;
`superadmin` has no lockfile whatsoever, so its builds are not reproducible.
