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
  jwt: {
    secret: required('JWT_SECRET', 'dev-secret-change-me'),
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
    webhookVerifyToken: process.env.META_WEBHOOK_VERIFY_TOKEN || 'verify-token',
    // Six-digit two-step PIN used to register onboarded numbers for Cloud API.
    // Optional: when unset, phone registration is skipped and reported as a warning.
    defaultPhonePin: process.env.META_DEFAULT_PHONE_PIN || '',
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
  openai: {
    // The LLM intent router is enabled only when a key is present; without one
    // automation falls back to the original keyword matching.
    apiKey: process.env.OPENAI_API_KEY || '',
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    // A customer is waiting on WhatsApp — fail fast rather than hang.
    timeoutMs: int('OPENAI_TIMEOUT_MS', 8000),
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
      || (process.env.NODE_ENV === 'test' || !process.env.OPENAI_API_KEY ? 'mock' : 'openai'),
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
  },

  logLevel: process.env.LOG_LEVEL || 'info',
};

export type Env = typeof env;
