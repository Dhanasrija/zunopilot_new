# AI Workflow Router & Conversation Workflow Engine

Multiple conversational workflows on one WhatsApp number, with a hard guarantee
that **exactly one of them answers any given message**.

Lives in `backend/src/modules/conversation-engine/`. Additive: a tenant without
an active Assistant keeps the original keyword/cart automation untouched.

---

## 1. Setup

```bash
cd backend
npm install
npx prisma migrate deploy
npx prisma generate
npx tsx prisma/seed-hospital.ts     # the demo workspace
npm run dev                          # API + job workers on :4000
```

There is **no build step**. `npm start` runs `tsx src/server.ts` directly, so a
deploy is `npm install && npm start`.

| Command | What it does |
|---|---|
| `npm run dev` | API + workers, watch mode |
| `npm start` | API + workers, once |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest (unit + integration against Postgres) |
| `npx prisma migrate deploy` | Apply migrations |
| `npx tsx prisma/seed.js` | Original restaurant demo |
| `npx tsx prisma/seed-hospital.ts` | Acme Hospital engine demo (idempotent) |

### Environment

Only `DATABASE_URL` and `JWT_SECRET` are required. Everything below has a
working default.

| Variable | Default | Notes |
|---|---|---|
| `WHATSAPP_PROVIDER` | `meta` (`mock` under test) | `meta` \| `mock` \| `console` |
| `LLM_PROVIDER` | `openai` if a key is set, else `mock` | `openai` \| `mock` |
| `OPENAI_API_KEY` | — | Without it the router uses the deterministic mock |
| `OPENAI_MODEL` | `gpt-4o-mini` | |
| `ROUTER_HIGH_CONFIDENCE` | `0.80` | At or above: start the workflow |
| `ROUTER_MEDIUM_CONFIDENCE` | `0.55` | At or above: ask a clarifying question |
| `ROUTER_MAX_RECENT_MESSAGES` | `8` | Context window given to the router |
| `ENGINE_MAX_NODE_EXECUTIONS` | `60` | Loop guard per run |
| `ENGINE_MAX_VISITS_PER_NODE` | `8` | Tight-cycle guard |
| `ENGINE_INSTANCE_TIMEOUT_HOURS` | `24` | Abandon unanswered runs |
| `RUN_WORKERS_IN_API` | `true` | Set `false` for a separate worker process |
| `QUEUE_DATABASE_URL` | `DATABASE_URL` | pg-boss uses its own `pgboss` schema |

A channel whose `accessToken` starts with `mock-token-` is **always** served by
the mock provider regardless of `WHATSAPP_PROVIDER`. That is per-channel on
purpose: the demo and a live tenant can share one server without the demo
silencing real sends.

---

## 2. Inbound message lifecycle

```
Meta → POST /api/webhook
  ├─ verify X-Hub-Signature-256          reject forged payloads
  ├─ persist WebhookEvent                unique (source, externalEventId) = dedupe
  ├─ 200 OK                              Meta needs a fast ack
  └─ enqueue process-inbound-whatsapp-message
        ↓  pg-boss worker
  advisory lock on (channel, waId)       serialise per customer
  drain that customer's pending events oldest-first
        ↓  per event
  resolve channel → contact → conversation → persist Message
  human takeover?  → stop, no automation
        ↓
  routeInboundMessage()
```

**Ordering.** pg-boss v12 exposes no `groupId` on send, so ordering is not
delegated to the queue. The handler takes a per-customer advisory lock and then
drains *all* that customer's pending events in timestamp order — so out-of-order
job execution cannot produce out-of-order processing.

---

## 3. Routing

Four steps, first match wins.

**1 — Active workflow.** A conversation with a live instance hands the message
straight to it. No routing, no model: a customer answering "Cardiology" must not
be reinterpreted as a new intent. Escape hatches (`cancel`, `agent`) are matched
against the *whole* trimmed message, never as substrings.

**2 — Deterministic rules.** Button/list payload, command, keyword, customer
tag, business hours, CRM state — by descending priority. A tap on our own button
already carries an id we chose; classifying it would be slower and less reliable.

**3 — AI router.** Only for genuinely open-ended text. Sees capability contracts
only — never node graphs, URLs or credentials.

**4 — Confidence gate.** `≥ max(assistant.high, workflow.minimum)` starts it;
`≥ medium` asks a clarifying question; below that falls back.

Every step writes a `RoutingDecision`, including the boring ones.

### Why the router cannot go wrong in the expensive direction

- **It cannot name a workflow it was not offered.** The returned `workflowId` is
  checked against the candidate slugs actually sent; anything else becomes
  `NO_MATCH`. This holds even if the prompt is defeated.
- **Constrained decoding**, not "please return JSON": `response_format:
  json_schema` with `strict: true`, and the schema is derived from the Zod
  schema so the two cannot drift. Free-form text is never parsed.
- **One workflow is a type property** — a single nullable `workflowId`, not an
  array.
- **The prompt is versioned in code** (`router.v1`) and is not tenant-editable.
  Tenants shape routing through capability contracts, which the prompt reasons
  *about*.
- **A side-effecting workflow cannot be published without a confirmation step.**
  This is the rule that stops "Is Dr Rao available tomorrow?" from booking.

> OpenAI strict mode cannot express `z.record` — it compiles to `propertyNames`,
> which is rejected. `extractedInputs` is therefore an array of `{key, value}`
> pairs, exposed as a derived `inputs` record.

---

## 4. Execution and resume

An executor returns a **handle**, never a next node — the graph decides where
that goes. It returns a `variablesPatch`, never writing to the instance — so a
node crashing mid-execution cannot leave an instance half-updated.

`ASK_USER_INPUT` is what makes a workflow conversational: it sends the prompt,
parks the instance in `WAITING_FOR_USER`, records the node and variable it is
waiting on, and stops. On the next message the engine validates the answer,
stores it, closes out the waiting node, and continues from the next node.

An invalid answer re-prompts without advancing. After `maxRetries` it hands off
to a human rather than looping.

**Version pinning.** A run pins `workflowVersionId` at start, so publishing an
edit mid-conversation cannot change the graph under someone who is halfway
through it.

**Retries discriminate.** `RetryableNodeError` (timeout, 5xx) retries;
`NodeConfigError` does not — retrying a misconfiguration is how one booking
becomes three.

### The one-active-workflow guarantee

```sql
CREATE UNIQUE INDEX "WorkflowInstance_one_active_per_conversation"
  ON "WorkflowInstance" ("conversationId")
  WHERE "status" IN ('PENDING','RUNNING','WAITING_FOR_USER',
                     'WAITING_FOR_APPROVAL','PAUSED');
```

In Postgres, not application code — two webhook deliveries can be in flight at
once, so a check-then-insert in JS is not atomic. Prisma cannot express a
partial index, so it is hand-written in the migration and **must be preserved by
hand in future migrations**.

`Conversation.activeWorkflowInstanceId` is a denormalised cache of the same
fact, written in the same transaction. The index is the guarantee; the column is
the fast path.

---

## 5. API

Base `/api`. All routes require a bearer token; everything is scoped by the
tenant on the token, never from the body or path.

Read = any member · author = OWNER/MANAGER · publish & delete = OWNER.

### Assistants
```
GET    /assistants
GET    /assistants/:assistantId
PATCH  /assistants/:assistantId
GET    /assistants/:assistantId/routing            thresholds + workflows + rules
PATCH  /assistants/:assistantId/routing
GET    /assistants/:assistantId/candidates         what the router may pick
GET    /assistants/:assistantId/routing-conflicts
```

### Routing rules
```
GET    /assistants/:assistantId/rules
POST   /assistants/:assistantId/rules
PATCH  /assistants/:assistantId/rules/:ruleId
DELETE /assistants/:assistantId/rules/:ruleId
```

### Route testing
```
POST   /assistants/:assistantId/route-test         decide only; starts nothing
GET    /assistants/:assistantId/routing-tests
POST   /assistants/:assistantId/routing-tests
DELETE /assistants/:assistantId/routing-tests/:testId
POST   /assistants/:assistantId/routing-tests/run  run the saved suite
```

### Workflows
```
GET    /assistants/:assistantId/workflows
POST   /assistants/:assistantId/workflows
GET    /workflows/:workflowId
PATCH  /workflows/:workflowId
DELETE /workflows/:workflowId                      refuses if runs are live
GET    /workflows/:workflowId/capability
PUT    /workflows/:workflowId/capability
GET    /workflows/:workflowId/versions
POST   /workflows/:workflowId/versions
POST   /workflows/:workflowId/validate
POST   /workflows/:workflowId/publish
POST   /workflows/:workflowId/unpublish
POST   /workflows/:workflowId/test                 dry run by default
```

### Instances & conversations
```
GET    /workflow-instances
GET    /workflow-instances/:instanceId
GET    /workflow-instances/:instanceId/executions  the Execution Log
POST   /workflow-instances/:instanceId/cancel
POST   /conversations/:conversationId/handoff
POST   /conversations/:conversationId/resume-bot
POST   /conversations/:conversationId/simulate     next simulator turn
GET    /conversations/:conversationId/routing-decisions
```

### Webhook
```
GET    /api/webhook      Meta verification handshake
POST   /api/webhook      signed events
```

---

## 6. Jobs

pg-boss in a `pgboss` schema — invisible to `prisma migrate status`.

| Queue | Trigger | Retries |
|---|---|---|
| `process-inbound-whatsapp-message` | webhook | 5, backoff |
| `execute-workflow-instance` | router / resume | 3, backoff |
| `resume-delayed-workflow` | cron `*/5 * * * *` | 3 |
| `send-whatsapp-message` | engine | 2 |
| `expire-stale-instances` | cron `0 * * * *` | 1 |

Inbound gets the most retries — a dropped message is a customer lost. Sends get
the fewest: a retry landing after the customer already read it is worse than not
retrying.

`expire-stale-instances` matters more than it looks. With the partial unique
index in place, a customer who never replies would otherwise hold a live
instance forever and be permanently unable to start another workflow.

---

## 7. Testing

```bash
npm test                                   # 100 tests
LOG_LEVEL=debug npx vitest run <file>      # one file, verbose
```

Integration tests run against real Postgres, because the properties that matter
are database properties. `NODE_ENV=test` forces the mock WhatsApp and LLM
providers, so a test run can never reach a real phone or spend money.

### Driving it by hand

`POST /api/webhook` verifies Meta's signature, so raw `curl` returns 401. Use
the signing helper:

```bash
npx tsx scripts/send-webhook.ts --phone-id acme-hospital-mock-channel \
  "I want to book a cardiologist"
npx tsx scripts/send-webhook.ts --phone-id acme-hospital-mock-channel --button CONFIRM_BOOKING
```

Senders default to the `+1 555` range — reserved for fiction, never assigned,
and not on any allowlist.

### Demo workspace

Sign in as `owner@acmehospital.test` with phone **`15550002001`** — the same
reserved `+1 555` range, so the seed can never text a real person. Set
`OTP_ECHO=true` to read the code back. Five published workflows, three
deterministic rules, twelve routing test cases. Every integration is a mock;
nothing seeded can reach the internet. Re-running the seed wipes and rebuilds
only that tenant.

A full booking:

```
"I want to book a cardiologist appointment"   → routed, asks speciality
"Cardiology"                                  → asks date
"2026-08-05"                                  → mock lookup, offers slots
"10:00" → "Asha Kumar" → "yes"                → COMPLETED
```

---

## 8. Known limitations

- **`HTTP_REQUEST` refuses any node without a `mockService`.** Arbitrary
  tenant-authored URLs are an SSRF surface and the egress allowlist is not
  built. It fails closed by design.
- **`GENERAL_RESPONSE` is decided but not answered.** The gate reaches it; the
  assistant's general-answer path is not wired, so the message is reported as
  unhandled rather than answered emptily.
- **17 node types have no runtime** (`SWITCH`, `LOOP`, `SUB_WORKFLOW`,
  `GOOGLE_SHEETS`, `CALENDAR_*`, …). The engine skips them and the publish
  validator warns.
- **No UI yet.** Everything here is API- and test-driven.
- **Interruption policy is partly implemented.** Explicit `cancel` / `agent`
  work; the `CONTINUE_CURRENT_WORKFLOW` / `CANCEL_AND_SWITCH` button flow for
  soft topic changes is not built, so a mid-workflow topic change is currently
  treated as an answer to the pending question.
- **Access tokens are stored in plaintext** (`WhatsappAccount.accessToken`),
  inherited from the existing schema.
- **Single-instance assumptions.** Workers are safe to run in several processes
  — the advisory lock and partial index hold — but `resume-delayed-workflow`
  sweeps a shared queue and would benefit from a leader lock at scale.

## 9. Recommended next steps

1. Egress allowlist for `HTTP_REQUEST`, then enable real outbound HTTP.
2. Wire `GENERAL_RESPONSE` to the assistant's general system prompt.
3. Encrypt integration credentials at rest.
4. Build the UI: routing page, workflow list, builder, capability editor,
   simulator, execution log.
5. Metrics: routing latency, clarification rate, handoff rate, cost per routed
   conversation — the interfaces exist, nothing exports them yet.
6. Audit log for publish / capability edits / handoffs.
7. Per-customer rate limiting on the webhook — currently only a global 300/min.
