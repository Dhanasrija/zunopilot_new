# Super admin console

The platform operator's surface: every workspace, its people, its history and its
money. Runs as **its own process on its own port** with **its own signing
secret**.

---

## 1. Setup

```bash
cd backend

# A signing secret. No default, minimum 32 characters — the API exits without one.
echo "SUPERADMIN_JWT_SECRET=$(openssl rand -base64 48)" >> .env

npx prisma migrate deploy
npm run seed:superadmin        # prints the password once
npm run dev:superadmin         # API on :4001

cd ../superadmin
npm install
npm run dev                    # console on :5174
```

| Command | What it does |
|---|---|
| `npm run dev:superadmin` | API + watch, port 4001 |
| `npm run start:superadmin` | API once |
| `npm run seed:superadmin` | Create the first operator (idempotent) |
| `npm run seed:superadmin -- --reset` | Rotate the password |

### Environment

| Variable | Default | Notes |
|---|---|---|
| `SUPERADMIN_JWT_SECRET` | — | **Required, ≥32 chars.** Must differ from `JWT_SECRET`. |
| `SUPERADMIN_PORT` | `4001` | |
| `SUPERADMIN_ORIGIN` | `http://localhost:5174` | The only allowed CORS origin |
| `SUPERADMIN_JWT_EXPIRES_IN` | `8h` | |
| `SUPERADMIN_EMAIL` | `superadmin@zunopilot.com` | Seed only |
| `SUPERADMIN_PASSWORD` | generated | Seed only; printed once if generated |

---

## 2. Why it is separate

Everything else in this codebase is `tenantId`-scoped and read through
`tenantIdOf(req)`, which **throws** rather than returning undefined — because
Prisma treats `where: { tenantId: undefined }` as *no filter*. Super admin
deliberately inverts that guarantee, so it shares none of the machinery.

**A separate table.** `SuperAdmin`, not a `User` with a special role. `User.tenantId`
is required and cascade-deletes with its tenant, so an operator modelled that way
would belong to a workspace and disappear with it.

**A separate secret and audience.** A tenant token presented here fails; an
operator token presented to `:4000` fails. The `zunopilot:super-admin` audience
claim is belt-and-braces in case the two secrets are ever set to the same value.

**A separate process.** So it can be bound to a private interface or put behind a
VPN without touching the API that Meta and every customer browser must reach; so
an operator's heavy report cannot exhaust the pool that inbound webhooks queue
through; and so no `app.use` ordering mistake on the public app can expose it.
It does **not** start the job workers — two processes sweeping
`expire-stale-instances` would double-sweep.

**Revocation is immediate.** A deactivated operator is refused on their next
request, not at token expiry. An 8-hour window after revoking platform-wide access
is not acceptable.

**It cannot leak what it reads.** No endpoint returns message bodies, access
tokens or connector credentials. `WhatsappAccount.accessToken` is *selected
around* rather than fetched and stripped — a field that never leaves the database
cannot be leaked by a later careless spread. A test asserts the token string never
appears anywhere in a serialised response.

---

## 3. The activity timeline

**Derived from existing rows, not newly instrumented.** A workspace's history is
already recorded: `Tenant.createdAt`, `User.createdAt`,
`WhatsappAccount.connectedAt`, `RoutingDecision`, `WorkflowVersion.publishedAt`,
`Payment`, `Invoice`, `HumanHandoff`.

Emitting fresh event rows from today onward would give every workspace that
already exists an empty timeline, and would stay subtly wrong wherever a code path
forgot to emit. Deriving cannot drift, because it *is* what happened.

Each source is capped independently, so one chatty category cannot crowd out the
signup entry. `dailyMessageCounts` groups in Postgres — a busy tenant has hundreds
of thousands of messages and the only thing wanted is one number per day.

`AuditEvent` covers the one category nothing else records: what an operator did.
Its `tenantId` is deliberately **not** a foreign key — a cascade would erase the
record of what was done to a workspace at the moment that record matters most.

---

## 4. What an operator can change

Read broadly, write narrowly. Every write is audited.

| Action | Notes |
|---|---|
| Suspend / restore a workspace | A flag, never a delete. Deleting a tenant cascades through every customer, conversation, order and invoice. |
| Assign a plan | `status: MANUAL`, open-ended (no period check) — this is how Enterprise is delivered. Optional seat / number / automation / AI-quota / overage-cap overrides. |
| Deactivate or reactivate a user | Refused for the last active owner. |
| Change a user's role | Also refused if it would strip the last owner. |
| Issue a temporary password | Returned once, never recorded. |

**Assigning a plan never touches Razorpay.** A hand-assigned plan is not a
mandate, and creating a subscription would start charging a card that never agreed
to it. It also clears `pendingPlan*`, or the hourly job would later apply a
downgrade against the plan just replaced.

### Plans are read-only here

`PLANS` in `billing/catalogue.ts` is the source, and `syncPriceCatalogue()` writes
it into `Price` rows. **An edit made only in the database is archived and replaced
by the code value** on the next `sync-prices` or `razorpay-plans` run — so a form
here would work until the next deploy and then silently undo itself. The screen
reports the live rows, flags any that disagree with the code (which means checkout
is charging what the pricing page is not showing), and prints the procedure:

```bash
# 1. Edit PLANS in backend/src/modules/billing/catalogue.ts and its test literals.
npx tsx scripts/sync-prices.ts

# 2. Razorpay plans. A bare run REPORTS ONLY and creates nothing.
npx tsx scripts/razorpay-plans.ts

# 3. Only if a plan+interval is genuinely absent from the Razorpay console:
npx tsx scripts/razorpay-plans.ts --create
```

**Every plan created is permanent** — Razorpay has no delete or deactivate API.
A plan+interval that already exists at a different amount is reported and
skipped; `--create --reprice` overrides that, mints a *new* id, and leaves
existing subscribers billing the old one until each is migrated.

---

## 5. Support access (impersonation)

Viewing a workspace as its owner sees it. The most invasive thing the product can
do, so four properties are enforced rather than documented.

**1. Consent-gated.** The console can only *request*. There is no endpoint,
flag or override that grants access — an OWNER of that workspace approves it in
their own dashboard, or it does not happen. A workspace with no active owner is
refused outright rather than falling back to self-approval. The reason is required
(15 chars minimum) and shown to the owner verbatim, because "debugging" is not
something a person can consent to.

**2. Time-boxed, three times over.** The unanswered request lapses in 24h;
the approval grants a window the owner chooses, capped at 8h; each minted token
lives 15 minutes inside that window. The narrowest clock always wins — a token is
never issued that outlives the approved window.

**3. Read-only.** The token cannot write. `requireAuth` refuses any non-GET
method, so an engineer can reproduce what a customer sees and can never take an
action attributed to them: no message sent as the business, no order changed, no
plan bought, and no approving their own extension. There is no writable variant to
opt into.

**4. Audited to the customer.** Every request, approval, denial, session start
and end is an `AuditEvent`, and every page opened is logged. All of it is served
on the **customer** API at `/api/support-access` — an audit trail only the watcher
can read is not accountability. The workspace sees a banner on every screen while
a session is live and can end it, which takes effect on the engineer's next
request because the grant is re-read from the database every time.

Two smaller decisions worth keeping: the engineer views the workspace as **the
approver themselves**, frozen onto the grant at approval time so a later role
change cannot widen a live session; and only the operator who asked may use the
grant, because the workspace consented to a named person rather than to the
company.

The session token is handed over in the URL **fragment** (`/support-session#token=…`),
never the query string — a fragment is not sent to the server, so it cannot land in
an access log or a `Referer` header, and it is stripped from the address bar before
anything renders.

```
GET    /sa/tenants/:id/impersonation                 where a request stands
POST   /sa/tenants/:id/impersonation                 ask (reason required)
POST   /sa/tenants/:id/impersonation/:grantId/token  exchange an approval
POST   /sa/tenants/:id/impersonation/:grantId/end    end it from this side

# On the customer API — the consent surface
GET    /api/support-access                  settings:read
GET    /api/support-access/:grantId/log     settings:read
POST   /api/support-access/:grantId/approve impersonation:manage (OWNER)
POST   /api/support-access/:grantId/deny    impersonation:manage
POST   /api/support-access/:grantId/revoke  impersonation:manage
```

`impersonation:manage` is deliberately **not** folded into `settings:write`:
consenting to someone outside the business reading your customers' conversations is
a different decision from changing a setting, and must not be granted as a side
effect of one.

The hourly sweep (`sweepImpersonationGrants`, folded into
`expire-stale-instances`) closes unanswered requests and spent windows, so a lapsed
request does not sit on a customer's dashboard forever.

---

## 6. API

Base `/sa` on port 4001. Everything except login requires an operator token.

```
POST   /sa/auth/login                     rate limited: 10 per 15 min per IP
GET    /sa/auth/me
GET    /sa/overview                       platform metrics
GET    /sa/tenants                        ?search &plan &status &take &skip
GET    /sa/tenants/:tenantId
GET    /sa/tenants/:tenantId/activity     timeline + daily message counts
PATCH  /sa/tenants/:tenantId/active       suspend / restore
POST   /sa/tenants/:tenantId/plan         assign, with overrides
PATCH  /sa/users/:userId                  isActive / role
POST   /sa/users/:userId/reset-password
GET    /sa/plans
GET    /sa/audit                          ?tenantId &action
GET    /health                            includes `configured`
```

---

## 7. Testing

```bash
npm test -- super-admin
```

49 tests, most of them about the boundary rather than the features: a valid tenant
token is refused, an operator token is refused by the customer API, a token signed
with the wrong secret or the wrong audience is refused, revocation is immediate,
the access token never appears in a response, the last owner cannot be stripped,
and an audit event survives the deletion of the workspace it refers to. Support
access adds 24 more: no path grants access without approval, a read-only session
cannot write or extend itself, a token never outlives its window, revocation bites
on the next request, and a lapsed request cannot be answered late.

The login limiter's threshold is raised under `NODE_ENV=test` rather than skipped,
so the middleware still runs in every environment and there is no `if (test)`
branch in the auth path.

---

## 8. Known limitations

- **One operator tier.** No read-only role, no 2FA, no session list, no way to
  revoke a single token before expiry other than deactivating the account.
- **No export.** Invoices and audit rows are visible but not downloadable as CSV.
- **Suspension blocks the dashboard and API, but not inbound WhatsApp
  automation.** `requireAuth` refuses a suspended workspace with 403, so nobody on
  the team can sign in — but the webhook path does not go through it, so the
  assistant keeps answering that workspace's customers. Whether non-payment should
  also silence a business's customer replies is a product decision, not an
  oversight: dropping a real customer's message is a heavier action than locking
  an owner out of a dashboard.
