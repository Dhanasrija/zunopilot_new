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

## Choosing the language model

The AI router is the slowest thing a customer waits on — measured from `RoutingDecision` rows,
**p50 1.5–2.0 s and p95 3.1 s**, against ~2.65 s end to end per message. The model dominates, so
it is worth choosing deliberately.

Switching vendor needs no code. Any OpenAI-compatible endpoint works via `LLM_BASE_URL` plus
`LLM_MODEL`; Groq and Google both provide one.

**Two things that are easy to get wrong.**

*Distance beats inference speed at this range.* Groq's raw inference is the fastest available, but
from Mumbai a US endpoint costs ~200–250 ms of round trip before the first token arrives. A
regionally closer model that generates more slowly can still reply sooner. Sub-250 ms total is not
reachable from India regardless of vendor; 400–700 ms for the router is a realistic target.

*Structured output is the portability catch.* The router asks for
`response_format: { type: 'json_schema', strict: true }` — OpenAI's constrained decoding, which
makes an invalid shape impossible. Support elsewhere is model-dependent, so set
`LLM_STRUCTURED_MODE=json_object` for vendors without it: the schema moves into the prompt and the
reply is Zod-validated instead. Weaker, and the failure mode is benign — malformed output becomes
"no match" and the customer gets a general answer, so a worse model routes more dully rather than
breaking.

### Measured, 2026-08-05

Same 30-message corpus, same workspace, back to back. End-to-end per message, so the figures
include the second general-response call where one fired.

| | OpenAI `gpt-4o-mini` | **Groq `llama-3.3-70b-versatile`** | Gemini 2.5 Flash (Vertex, Mumbai) |
|---|---|---|---|
| structured mode | `json_schema` (strict) | `json_object` | `json_object` |
| p50 | 1702 ms | **595 ms** | 1319 ms |
| p95 | 2624 ms | **848 ms** | 1987 ms |
| min / max | 1134 / 2866 ms | 373 / 878 ms | 758 / 2774 ms |
| `START_WORKFLOW` | 6 | 6 | 6 |
| `HUMAN_HANDOFF` | 3 | 3 | 3 |
| `NO_SUITABLE_WORKFLOW` | 2 | 1 | 15 |

**Groq wins, by roughly 2.9× over OpenAI and 2.2× over Gemini at p50.** All three started the
same six workflows and handed off the same three conversations, which is the comparison that
matters — they recognised the same actionable requests. Individual Groq router calls were logged
as low as 277 ms.

`json_object` mode returned valid, parseable JSON on all 30 for both Groq and Gemini. That was the
main portability risk and it did not materialise.

**The Mumbai hypothesis was wrong, and worth recording as such.** The reason to try Vertex was
that `asia-south1` removes the ~200–250 ms of transatlantic round trip Groq pays from India. It
does — but the model available there generates slowly enough to give it all back. Being close
did not beat being fast.

Two findings from that attempt, both non-obvious:

- **Only `gemini-2.5-flash` is served in `asia-south1`.** 2.0-flash, 2.0-flash-lite,
  2.5-flash-lite and 1.5-flash-002 all return `NOT_FOUND` there. The region picks the model, not
  the other way round.
- **Gemini 2.5 Flash reasons before answering by default, and it dominates the latency.** Measured
  on a single classification: 60 reasoning tokens to produce a 6-token answer, 1049 ms versus
  598 ms with thinking disabled. Across the corpus it was p50 3073 ms with thinking on versus
  1319 ms off — and thinking-on also produced the only hard failures. Anyone benchmarking a 2.5
  model without setting `thinking_budget: 0` is measuring the wrong thing:

  ```
  LLM_EXTRA_BODY={"extra_body":{"google":{"thinking_config":{"thinking_budget":0}}}}
  ```

**One honest limit on the quality column.** `NO_SUITABLE_WORKFLOW` is counted as "unrouted", but
for a genuinely off-topic message it is the *correct* answer — so Gemini's 15 overstates the gap.
What it really shows is a different vocabulary for the middle ground: Gemini says "nothing
matches" where OpenAI says `AMBIGUOUS_BETWEEN_WORKFLOWS` and Groq says `GENERAL_QUESTION`. All
three then send a general response, so the customer sees much the same thing. Retune the
per-assistant confidence thresholds after any switch; they were calibrated against OpenAI.

**Caveats worth respecting: n=30, one workspace, one run each.** Vendor latency moves with time of
day and load, and this says nothing about behaviour under concurrency or about rate limits at real
volume — which matters, since `INBOUND_CONCURRENCY` is going up at the same time. Re-run before
switching production, and re-run again after.

**Measure before switching**, and read both numbers:

```bash
npx tsx scripts/llm-bench.ts --tenant "<business name>" --provider groq --yes
```

Credentials for several vendors coexist under their own prefix — `GROQ_LLM_API_KEY`,
`GROQ_LLM_MODEL`, and so on — which is what makes a back-to-back comparison possible without
editing `.env` between runs. `--provider groq` copies them onto the plain `LLM_*` names for that
run only.

It replays a fixed corpus through the router and prints latency percentiles beside the decision
and reason-code distribution. Latency alone is a trap — the fastest possible router answers
`NO_MATCH` to everything instantly — so the number to compare across vendors is the **share of
unrouted messages**. A 2× latency win that routes 20% worse is not a win. The script makes live,
billable calls and refuses to run without `--yes`.

## Connection pool and worker concurrency

**Set `connection_limit` in `DATABASE_URL` explicitly.** Prisma's default is
`physical_cpus × 2 + 1`, which on a 2-vCPU instance — one core plus a hyperthread — is about 3.
That is not a number anyone chose, and it silently changes when you resize the instance.

```
DATABASE_URL="postgresql://…/zunopilot?schema=public&connection_limit=20&pool_timeout=15"
```

The two knobs interact and must be sized together:

| Setting | Where | Meaning |
|---|---|---|
| `connection_limit` | `DATABASE_URL` | Prisma pool per process |
| `INBOUND_CONCURRENCY` | env, default 4 | inbound poll loops per process |
| `RDS max_connections` | derived from instance memory | server-side ceiling |

Rule of thumb: keep `INBOUND_CONCURRENCY × 2` comfortably below `connection_limit`, and
`connection_limit × (number of processes)` below `max_connections` with room to spare — pg-boss
keeps its own separate pool of 10, and you want headroom for `psql`.

The inbound work is almost entirely *waiting* — on Postgres, on OpenAI, on Meta — so concurrency
is bounded by connections, not CPU. Raising `INBOUND_CONCURRENCY` past what the pool can feed
converts throughput into pool timeouts.

**Consider `QUEUE_DATABASE_URL`.** pg-boss currently shares the application database, and its
`job_common` table is already the largest in the system, ahead of every customer table. Pointing
the queue at its own database keeps its churn and vacuum load off customer queries and lets the
two be sized independently.

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
