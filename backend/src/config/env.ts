import dotenv from 'dotenv';
dotenv.config();

const required = (key: string, fallback?: string): string => {
  const value = process.env[key] ?? fallback;
  if (value === undefined || value === '') {
    throw new Error(`Missing required env variable: ${key}`);
  }
  return value;
};

const int = (key: string, fallback: number): number => {
  const raw = process.env[key];
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const float = (key: string, fallback: number): number => {
  const raw = process.env[key];
  if (!raw) return fallback;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const bool = (key: string, fallback: boolean): boolean => {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return fallback;
  return raw === 'true' || raw === '1';
};

/**
 * Which vendor's block of LLM settings is live, e.g. `groq`.
 *
 * Empty means "no vendor named", which selects the unprefixed `LLM_*` / `OPENAI_*` pair and is
 * exactly the behaviour that existed before this was added.
 */
const llmVendor = (): string => (process.env.LLM_VENDOR || '').trim().toUpperCase();

/**
 * Resolve one LLM setting, honouring a vendor prefix.
 *
 * The problem this solves: keeping two vendors configured at once. Parking the inactive one's
 * values in comments means they rot, and duplicating them under both a prefixed and an
 * unprefixed name means two copies that can disagree — the failure mode that has appeared four
 * times elsewhere in this codebase. So each vendor gets its own block and `LLM_VENDOR` picks one:
 *
 *   LLM_VENDOR=groq
 *   GROQ_LLM_API_KEY=...        GROQ_LLM_MODEL=llama-3.3-70b-versatile
 *   GROQ_LLM_BASE_URL=...       GROQ_LLM_STRUCTURED_MODE=json_object
 *
 *   OPENAI_API_KEY=...          OPENAI_MODEL=gpt-4o-mini
 *
 * Adding a vendor is a new prefixed block and one line; switching is one line and a restart.
 *
 * Two lookup shapes per vendor, because both conventions are already in use: `GROQ_LLM_API_KEY`
 * and, for the one that predates this, `OPENAI_API_KEY`. So `LLM_VENDOR=openai` works against
 * the names that are already deployed rather than requiring a rename.
 *
 * **A named vendor never falls back to a different vendor's credentials, and that is the whole
 * point of the function.** Before this existed, putting a Groq key in `GROQ_LLM_API_KEY` left
 * `LLM_API_KEY` empty, so resolution fell through to `OPENAI_API_KEY` and the router quietly ran
 * on OpenAI — working, billable, and wrong. Falling back across vendors turns a typo into a
 * silent vendor switch, so when `LLM_VENDOR` is set only that vendor's names are consulted.
 * Unset it and the old unprefixed chain applies unchanged.
 */
const llmSetting = (suffix: string): string | undefined => {
  const vendor = llmVendor();

  if (vendor) {
    // `GROQ_LLM_API_KEY`, then `GROQ_API_KEY`. Nothing else — see the note above.
    const value = process.env[`${vendor}_LLM_${suffix}`] || process.env[`${vendor}_${suffix}`];
    return value?.trim() ? value : undefined;
  }

  const value = process.env[`LLM_${suffix}`] || process.env[`OPENAI_${suffix}`];
  return value?.trim() ? value : undefined;
};

/*
 * ── Every vendor, not only the selected one ──────────────────────────────────
 *
 * `llmSetting` above answers "what is *this box* configured to use", which was the whole question
 * while one process meant one model. It stopped being the whole question when the vendor became a
 * per-workspace choice an operator makes in the console: two workspaces can be answered by two
 * vendors inside the same process, so both blocks have to be resolved at boot.
 *
 * **Credentials stay here and are never stored per workspace.** The console picks a *vendor*, not a
 * key. A database column holding somebody's API key is a different and much worse feature: it would
 * put live credentials in every backup, in the operator console's responses, and in the blast radius
 * of any read-only SQL access.
 */

/** The vendors a workspace can be pinned to. Must match `enum LlmVendor` in the schema. */
export const LLM_VENDORS = ['OPENAI', 'GROQ'] as const;
export type LlmVendorKey = (typeof LLM_VENDORS)[number];

export interface VendorSettings {
  apiKey: string;
  model: string;
  baseUrl: string;
  structuredMode: 'json_schema' | 'json_object';
  timeoutMs: number;
  extraBody: Record<string, unknown>;
}

/**
 * One vendor's settings, read from its own prefix only.
 *
 * Same two lookup shapes as `llmSetting` — `GROQ_LLM_API_KEY` then `GROQ_API_KEY` — and the same
 * refusal to borrow across vendors. Deliberately no unprefixed fallback here either: the point of
 * naming a vendor is that its settings are its own.
 *
 * `OPENAI` is the one exception worth stating, and it is not a cross-vendor fallback: the plain
 * `OPENAI_API_KEY` / `OPENAI_MODEL` names *are* OpenAI's own, and they predate the prefixed
 * convention, so they are read as that vendor's second shape rather than as a generic default.
 */
const vendorSettings = (vendor: LlmVendorKey): VendorSettings | null => {
  const read = (suffix: string): string | undefined => {
    const value = process.env[`${vendor}_LLM_${suffix}`] || process.env[`${vendor}_${suffix}`];
    return value?.trim() ? value : undefined;
  };

  const apiKey = read('API_KEY');
  // No key, no vendor. A block with a model and no credential cannot answer anything, and
  // reporting it as available would let the console offer a workspace a model it cannot reach.
  if (!apiKey) return null;

  const defaults: Record<LlmVendorKey, { model: string; baseUrl: string }> = {
    OPENAI: { model: 'gpt-4o-mini', baseUrl: '' },
    // Groq has no default endpoint to fall back on, so its base URL is required in the same sense
    // its key is — but a missing one is a misconfiguration worth surfacing rather than guessing at.
    GROQ: { model: 'llama-3.3-70b-versatile', baseUrl: 'https://api.groq.com/openai/v1' },
  };

  let extraBody: Record<string, unknown> = {};
  const rawExtra = read('EXTRA_BODY');
  if (rawExtra?.trim()) {
    try {
      extraBody = JSON.parse(rawExtra) as Record<string, unknown>;
    } catch {
      // Loudly, at boot, for the same reason the unprefixed one does: a knob that quietly does
      // nothing is worse than one that is missing.
      throw new Error(`${vendor}_LLM_EXTRA_BODY is not valid JSON`);
    }
  }

  return {
    apiKey,
    model: read('MODEL') || defaults[vendor].model,
    baseUrl: read('BASE_URL') || defaults[vendor].baseUrl,
    /*
     * Groq defaults to `json_object`, OpenAI to `json_schema`.
     *
     * Not a preference — `json_schema` is OpenAI's strict constrained decoding and support
     * elsewhere is model-dependent. Getting this wrong for Groq does not error, it degrades: the
     * router asks for a schema nobody enforces and treats the malformed reply as no-match. Set
     * explicitly per vendor so nobody inherits the other one's assumption.
     */
    structuredMode: (read('STRUCTURED_MODE') ?? (vendor === 'GROQ' ? 'json_object' : 'json_schema')) === 'json_object'
      ? 'json_object'
      : 'json_schema',
    timeoutMs: Number(read('TIMEOUT_MS')) || 8000,
    extraBody,
  };
};

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  isTest: process.env.NODE_ENV === 'test',
  port: int('PORT', 4000),
  appUrl: process.env.APP_URL || 'http://localhost:4000',

  /**
   * The super admin surface, deliberately a separate process on a separate port.
   *
   * Separate so it can be firewalled, bound to a private interface or put behind
   * a VPN without touching the customer-facing API — an operator console reachable
   * from the public internet is a much larger target than the thing it manages.
   *
   * `jwtSecret` has **no default on purpose**, the same reasoning as
   * `ENCRYPTION_KEY`: falling back to the tenant JWT secret would make a stolen
   * customer token and an operator token interchangeable in one direction, and a
   * shared fallback secret looks like security while providing none. The app
   * refuses to start without it. Read from `process.env` at the point of use, for
   * the snapshot reason that has now bitten five times.
   */
  superAdmin: {
    port: int('SUPERADMIN_PORT', 4001),
    /** Where the super admin UI is served, for CORS. */
    origin: process.env.SUPERADMIN_ORIGIN || 'http://localhost:5174',
    jwtSecret: process.env.SUPERADMIN_JWT_SECRET || '',
    jwtExpiresIn: process.env.SUPERADMIN_JWT_EXPIRES_IN || '8h',
  },
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
  databaseUrl: required('DATABASE_URL'),
  /**
   * The tenant session secret. **No default, deliberately** — see `superAdmin.jwtSecret`
   * above for the full reasoning, which applies here with more force because this secret
   * guards every customer's workspace rather than one operator console.
   *
   * It used to read `required('JWT_SECRET', 'dev-secret-change-me')`. That cannot throw:
   * `required` only fails when the env var *and* the fallback are empty, so supplying a
   * fallback disables the check the function exists to perform. An unset `JWT_SECRET`
   * booted silently and signed every session with a string committed to this repository —
   * `jwt.sign({ userId }, 'dev-secret-change-me')` was any user of any tenant. The same
   * "unset must not read as configured" mistake, in its fifth incarnation.
   *
   * Length is enforced at boot in `server.ts`, not here, so importing this module for a
   * test does not depend on a production-grade secret being present.
   */
  jwt: {
    secret: required('JWT_SECRET'),
    expiresIn: process.env.JWT_EXPIRES_IN || '1d',
  },
  /**
   * 32-byte key (base64 or hex) sealing integration credentials at rest.
   *
   * Deliberately not defaulted. A fallback key is worse than none: every
   * install would share it, and the encryption would look real while
   * protecting nothing. Connector routes fail with a clear message when it is
   * absent, and nothing else in the app needs it.
   */
  encryptionKey: process.env.ENCRYPTION_KEY || '',
  /**
   * Budget for generating a workflow from a description.
   *
   * Much longer than `openai.timeoutMs`, which is sized for a customer waiting
   * on WhatsApp. This is an operator clicking "Generate" and expecting a whole
   * graph back.
   */
  generationTimeoutMs: int('GENERATION_TIMEOUT_MS', 90_000),
  egress: {
    /** Hard ceiling on an outbound connector call. A customer is waiting. */
    timeoutMs: int('EGRESS_TIMEOUT_MS', 8000),
    /** Refuse a response larger than this rather than buffering it. */
    maxResponseBytes: int('EGRESS_MAX_RESPONSE_BYTES', 512 * 1024),
    /**
     * Allow connectors to target private and loopback addresses.
     *
     * Off everywhere except a developer's own machine. Turning it on in a
     * deployed environment re-opens the SSRF hole the guard exists to close —
     * cloud metadata endpoints live on link-local addresses.
     */
    allowPrivateAddresses: bool('EGRESS_ALLOW_PRIVATE_ADDRESSES', false),
  },
  meta: {
    appId: process.env.META_APP_ID || '',
    appSecret: process.env.META_APP_SECRET || '',
    configId: process.env.META_CONFIG_ID || '',
    graphVersion: process.env.META_GRAPH_VERSION || 'v21.0',
    /**
     * The subscribe-handshake token, shared with Meta.
     *
     * Empty rather than `'verify-token'` when unset. A guessable default let anyone
     * complete the handshake, and — worse — made the "secret" in the mismatch diagnostic
     * that used to live in `webhook.controller.ts` not a secret at all.
     */
    webhookVerifyToken: process.env.META_WEBHOOK_VERIFY_TOKEN || '',
    // Six-digit two-step PIN used to register onboarded numbers for Cloud API.
    // Optional: when unset, phone registration is skipped and reported as a warning.
    defaultPhonePin: process.env.META_DEFAULT_PHONE_PIN || '',
    /**
     * Ceiling on any single Graph API call.
     *
     * Axios has no default timeout, so before this existed a stalled socket to
     * `graph.facebook.com` waited forever — and because sends happen inside the inbound job,
     * one of those stopped the whole inbound queue for every tenant. Generous relative to
     * Meta's normal sub-second response, because the cost of being wrong in the tight
     * direction is a dropped customer reply.
     */
    timeoutMs: int('META_TIMEOUT_MS', 10_000),
  },
  /**
   * Razorpay.
   *
   * Plan ids live here, not in the database and never in a request. Rule 13 of
   * the pricing spec — a client may not supply a plan id, a price or a limit —
   * is satisfied structurally: the server maps (plan, interval) to an id it
   * read from its own environment, so there is nothing for a browser to forge.
   *
   * All optional. With no keys, checkout refuses with a clear message rather
   * than half-working, and an administrator can still assign a plan manually.
   */
  /**
   * Who is issuing the invoice, for tax purposes.
   *
   * Identity only — the GST *rate* is a constant in `billing/gst.ts`, because a
   * rate an env var could change is a rate nobody approved. Both of these are
   * read from `process.env` first at the point of use (`sellerTaxIdentity()`),
   * since this snapshot is taken at import and a GSTIN is exactly the kind of
   * value that gets pasted in after the process is already running.
   */
  company: {
    gstin: process.env.COMPANY_GSTIN || '',
    /** Two-digit GST state code. Derived from the GSTIN when that is set. */
    stateCode: process.env.COMPANY_STATE_CODE || '',
  },

  razorpay: {
    keyId: process.env.RAZORPAY_KEY_ID || '',
    keySecret: process.env.RAZORPAY_KEY_SECRET || '',
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET || '',
    planIds: {
      STARTER: {
        MONTHLY: process.env.RAZORPAY_STARTER_MONTHLY_PLAN_ID || '',
        QUARTERLY: process.env.RAZORPAY_STARTER_QUARTERLY_PLAN_ID || '',
        YEARLY: process.env.RAZORPAY_STARTER_YEARLY_PLAN_ID || '',
      },
      GROWTH: {
        MONTHLY: process.env.RAZORPAY_GROWTH_MONTHLY_PLAN_ID || '',
        QUARTERLY: process.env.RAZORPAY_GROWTH_QUARTERLY_PLAN_ID || '',
        YEARLY: process.env.RAZORPAY_GROWTH_YEARLY_PLAN_ID || '',
      },
      BUSINESS: {
        MONTHLY: process.env.RAZORPAY_BUSINESS_MONTHLY_PLAN_ID || '',
        QUARTERLY: process.env.RAZORPAY_BUSINESS_QUARTERLY_PLAN_ID || '',
        YEARLY: process.env.RAZORPAY_BUSINESS_YEARLY_PLAN_ID || '',
      },
    } as Record<string, Record<string, string>>,
  },
  /**
   * The language model, whoever is serving it.
   *
   * **Named `llm` rather than `openai` because it is frequently not OpenAI.** Groq and Google
   * both expose OpenAI-compatible endpoints, so pointing this at either is a `baseUrl` and a
   * model name — no new adapter. A config block called `openai` that talks to Groq is the kind
   * of name that misleads whoever is reading it at 2am during an incident.
   *
   * The `OPENAI_*` variables are still honoured as aliases so no deployed `.env` breaks. New
   * deployments should use `LLM_*`.
   *
   * Why this matters: the AI router is the slowest thing a customer waits on — measured at p50
   * 1.5–2.0s and p95 3.1s against 2.65s end-to-end per message. The model dominates, so being
   * able to change it without changing code is the point of this block.
   */
  llm: {
    /** Which vendor block is live. Empty means the unprefixed `LLM_*`/`OPENAI_*` pair. */
    vendor: llmVendor(),
    // The router is enabled only when a key is present; without one, automation falls back to
    // the original keyword matching.
    apiKey: llmSetting('API_KEY') || '',
    model: llmSetting('MODEL') || 'gpt-4o-mini',
    /**
     * An OpenAI-compatible endpoint, or empty for OpenAI's own.
     *
     * e.g. `https://api.groq.com/openai/v1`, or Google's OpenAI-compatibility path. Note that
     * network distance usually matters more than raw inference speed here: from Mumbai, a US
     * endpoint costs ~200–250ms of round trip before a single token, which is why the fastest
     * model on paper is not automatically the fastest reply.
     */
    baseUrl: llmSetting('BASE_URL') || '',
    /**
     * How structured output is requested — the one genuinely non-portable thing here.
     *
     * `json_schema` is OpenAI's strict constrained decoding, and it is what the router's schema
     * in `routing/contract.ts` was shaped for. Support elsewhere is model-dependent, so
     * `json_object` asks for valid JSON and puts the schema in the prompt instead. That is
     * weaker, but the router already Zod-validates the reply and treats anything malformed as
     * "no match" rather than an error, so the failure mode is a duller router, not a broken one.
     */
    structuredMode: (llmSetting('STRUCTURED_MODE') === 'json_object'
      ? 'json_object'
      : 'json_schema') as 'json_schema' | 'json_object',
    // A customer is waiting on WhatsApp — fail fast rather than hang.
    timeoutMs: Number(llmSetting('TIMEOUT_MS')) || 8000,
    /**
     * Vendor-specific request fields, as JSON, merged into every completion.
     *
     * An escape hatch, because "OpenAI-compatible" stops at the common fields and each vendor's
     * most useful knob is its own. The one that prompted this: Gemini 2.5 Flash reasons before
     * answering by default — measured at 60 reasoning tokens for a six-token classification, and
     * 1049ms versus 598ms with it off. For a router doing classification that is latency spent
     * on nothing.
     *
     *   LLM_EXTRA_BODY={"extra_body":{"google":{"thinking_config":{"thinking_budget":0}}}}
     *
     * Deliberately opaque and unvalidated beyond being JSON: the alternative is teaching this
     * config every vendor's parameter set, which dates immediately. Malformed JSON fails loudly
     * at boot rather than silently dropping the setting, because a knob that quietly does
     * nothing is worse than one that is missing.
     */
    extraBody: (() => {
      const raw = llmSetting('EXTRA_BODY');
      if (!raw?.trim()) return {} as Record<string, unknown>;
      try {
        return JSON.parse(raw) as Record<string, unknown>;
      } catch {
        throw new Error('LLM_EXTRA_BODY is not valid JSON');
      }
    })(),

    /**
     * Each vendor, resolved independently — for when a workspace is pinned to one.
     *
     * Everything above describes **the platform default**, chosen by `LLM_VENDOR`, and it stays the
     * answer for every workspace nobody has pinned. This is beside it rather than replacing it:
     * one process now serves several vendors, and a workspace pinned to Groq must not silently get
     * OpenAI because that is what the box happens to default to.
     *
     * `null` for a vendor with no key on this box. The console reads that and refuses to pin a
     * workspace to it, so the unreachable state cannot be created from the UI.
     */
    byVendor: Object.fromEntries(
      LLM_VENDORS.map((vendor) => [vendor, vendorSettings(vendor)]),
    ) as Record<LlmVendorKey, VendorSettings | null>,
  },

  // ── Conversation engine (Module 12) ────────────────────────────────────────
  engine: {
    /**
     * Which WhatsApp adapter outbound sends go through. `meta` is the real
     * Cloud API; `mock` records sends in memory for tests and the simulator;
     * `console` just logs them. Defaults to mock under NODE_ENV=test so a test
     * run can never reach Meta.
     */
    whatsappProvider: process.env.WHATSAPP_PROVIDER
      || (process.env.NODE_ENV === 'test' ? 'mock' : 'meta'),
    /**
     * Which LLM adapter the workflow router uses. `mock` returns deterministic
     * decisions so the routing suite runs without a key or a bill.
     */
    llmProvider: process.env.LLM_PROVIDER
      || (process.env.NODE_ENV === 'test' || !llmSetting('API_KEY') ? 'mock' : 'openai'),
    /** Confidence at or above which the router starts the selected workflow. */
    highConfidence: float('ROUTER_HIGH_CONFIDENCE', 0.8),
    /** Confidence at or above which the router asks a clarifying question. */
    mediumConfidence: float('ROUTER_MEDIUM_CONFIDENCE', 0.55),
    /** How many recent messages are given to the router as context. */
    maxRecentMessages: int('ROUTER_MAX_RECENT_MESSAGES', 8),
    /** Hard ceiling on nodes executed in one workflow run — the loop guard. */
    maxNodeExecutions: int('ENGINE_MAX_NODE_EXECUTIONS', 60),
    /** Per-node visit cap, so a tight cycle cannot burn the whole budget. */
    maxVisitsPerNode: int('ENGINE_MAX_VISITS_PER_NODE', 8),
    /** Abandon a workflow instance that has been parked this long. */
    instanceTimeoutHours: int('ENGINE_INSTANCE_TIMEOUT_HOURS', 24),
    /** pg-boss connection; falls back to the app's own database. */
    queueDatabaseUrl: process.env.QUEUE_DATABASE_URL || required('DATABASE_URL'),
    /** Run job workers in the API process. Off for a separate worker dyno. */
    runWorkersInApi: bool('RUN_WORKERS_IN_API', true),
    /**
     * Poll loops for the inbound queue.
     *
     * pg-boss defaults this to 1, which capped the whole platform at roughly 65 messages a
     * minute regardless of `batchSize`. Raise it to raise throughput — but it must stay in
     * proportion to the Prisma connection pool, because each in-flight message is mostly
     * waiting on Postgres, OpenAI and Meta rather than on CPU. Four is a deliberately
     * conservative default for a small instance; `docs/production.md` covers sizing it with
     * `connection_limit`.
     */
    inboundConcurrency: int('INBOUND_CONCURRENCY', 4),
  },

  logLevel: process.env.LOG_LEVEL || 'info',
};

export type Env = typeof env;

/** 32 characters is roughly 192 bits from `openssl rand -base64 48`. */
const MIN_SECRET_LENGTH = 32;

/**
 * Why the tenant session secret is too weak to start with, or `null` when it is fine.
 *
 * A separate exported predicate rather than an inline `if` in `server.ts` so a test can
 * assert the rule without spawning a process. Absence is not checked here: `required()`
 * above already throws at import for that, which is the earliest possible failure.
 *
 * The mirror of `superAdminConfigured()`. Both surfaces now refuse to start on a weak
 * signing secret, which is the property that matters — a server that comes up and then
 * accepts forged tokens looks healthy right up until it isn't.
 */
export const jwtSecretWeakness = (): string | null => {
  const secret = process.env.JWT_SECRET ?? '';

  // Named first, before the length rule. The old fallback is 20 characters, so the length
  // check would catch it anyway and report "20 characters" — true, but it sends the operator
  // to count instead of telling them the actual problem: this exact string is public, and
  // lengthening it is not the fix. Checking it second made this branch unreachable.
  if (secret === 'dev-secret-change-me') {
    return 'JWT_SECRET is still the placeholder that used to be this app\'s fallback, which is '
      + 'published in the repository and therefore not a secret';
  }
  if (secret.length < MIN_SECRET_LENGTH) {
    return `JWT_SECRET is ${secret.length} characters; at least ${MIN_SECRET_LENGTH} are required`;
  }
  return null;
};
