// The plan catalogue.
//
// Two rules shape everything in this file:
//
//   • **Amounts are integers in paise.** Never a float, never rupees. Money in
//     floating point is how ₹2,699.00 becomes ₹2,698.99 after a currency
//     round-trip, and how two systems disagree about what was charged.
//   • **Prices are approved values, not calculations.** The quarterly price is
//     ₹2,699 because that is the approved price — not because it is monthly
//     minus 10%. The discount percentages below are *derived from* the prices
//     for display; nothing computes a price from a percentage. A rounding rule
//     that drifts is a price nobody approved.
//
// This is the source the immutable `Price` rows are seeded from. Changing a
// number here and re-seeding writes a *new* price record and archives the old
// one — it never edits what someone was charged.

export const PLAN_CODES = ['STARTER', 'GROWTH', 'BUSINESS', 'ENTERPRISE'] as const;
export type PlanCode = (typeof PLAN_CODES)[number];

export const BILLING_INTERVALS = ['MONTHLY', 'QUARTERLY', 'YEARLY'] as const;
export type BillingInterval = (typeof BILLING_INTERVALS)[number];

export const MONTHS_PER_INTERVAL: Record<BillingInterval, number> = {
  MONTHLY: 1,
  QUARTERLY: 3,
  YEARLY: 12,
};

/**
 * What a plan actually allows.
 *
 * `null` means unlimited. "Unlimited active automations" in the marketing copy
 * is `null` here plus the fair-use note — an unbounded number with a documented
 * safeguard, rather than a limit we quietly enforce and never mention.
 */
export interface Entitlements {
  whatsappNumbers: number | null;
  teamMembers: number | null;
  activeAutomations: number | null;
  /** AI interactions included per billing month. */
  aiInteractionsPerMonth: number | null;
  features: {
    aiWorkflowGeneration: boolean;
    crmAndWebhooks: boolean;
    advancedAnalytics: boolean;
    advancedAiAgents: boolean;
    apiAccess: boolean;
    /**
     * **Advertising only — this flag gates nothing.**
     *
     * The 25-permission matrix in `config/permissions.ts` is enforced at the route
     * for every workspace, on every plan. Nothing reads this value, so setting it
     * false never withheld anything; it only made the pricing page claim something
     * untrue. True from Growth up as of 2026-08-01.
     *
     * If it should ever actually gate access, `requirePermission` has to consult
     * `entitlementsFor()` — and note the existing rule that a limit blocks the next
     * one and never removes what exists, so a workspace downgrading would keep the
     * roles it had already assigned.
     */
    roleBasedAccessControl: boolean;
    premiumIntegrations: boolean;
  };
  support: string;
}

export interface PlanDefinition {
  code: PlanCode;
  name: string;
  tagline: string;
  /** Bullets shown on the pricing card, in the order they should appear. */
  includes: string[];
  entitlements: Entitlements;
  /** Amounts in paise, keyed by interval. Absent for a plan with no self-serve price. */
  prices: Partial<Record<BillingInterval, number>>;
  /** Enterprise is sales-led: no checkout, a Contact Sales action instead. */
  selfServe: boolean;
  badges: string[];
  recommended: boolean;
}

const rupees = (amount: number): number => amount * 100;

export const PLANS: PlanDefinition[] = [
  {
    code: 'STARTER',
    name: 'Starter',
    tagline: 'Everything one number needs to start answering by itself.',
    includes: [
      '1 WhatsApp number',
      'Up to 2 team members',
      'Up to 5 active automations',
      '1,000 AI interactions per billing month',
      'Basic analytics',
      'Email support',
    ],
    entitlements: {
      whatsappNumbers: 1,
      teamMembers: 2,
      activeAutomations: 5,
      aiInteractionsPerMonth: 1_000,
      features: {
        aiWorkflowGeneration: false,
        crmAndWebhooks: false,
        advancedAnalytics: false,
        advancedAiAgents: false,
        apiAccess: false,
        roleBasedAccessControl: false,
        premiumIntegrations: false,
      },
      support: 'Email support',
    },
    prices: {
      MONTHLY: rupees(999),
      QUARTERLY: rupees(2_699),
      YEARLY: rupees(9_599),
    },
    selfServe: true,
    badges: [],
    recommended: false,
  },
  {
    code: 'GROWTH',
    name: 'Growth',
    tagline: 'For a team running the whole operation on WhatsApp.',
    includes: [
      '1 WhatsApp number',
      'Up to 5 team members',
      'Unlimited active automations, subject to fair-use safeguards',
      '5,000 AI interactions per billing month',
      'AI workflow generation',
      'CRM and webhook integrations',
      'Advanced analytics',
      'Role-based access control',
      'Priority email support',
    ],
    entitlements: {
      whatsappNumbers: 1,
      teamMembers: 5,
      activeAutomations: null,
      aiInteractionsPerMonth: 5_000,
      features: {
        aiWorkflowGeneration: true,
        crmAndWebhooks: true,
        advancedAnalytics: true,
        advancedAiAgents: false,
        apiAccess: false,
        // Included from Growth up (Venky, 2026-08-01). Also the truthful setting:
        // the permission matrix is enforced for every workspace regardless of plan,
        // so advertising it as absent was the inaccurate half. Starter is now the
        // only plan still claiming otherwise — see the note below.
        roleBasedAccessControl: true,
        premiumIntegrations: false,
      },
      support: 'Priority email support',
    },
    prices: {
      MONTHLY: rupees(2_999),
      QUARTERLY: rupees(8_099),
      YEARLY: rupees(28_799),
    },
    selfServe: true,
    badges: ['Most Popular'],
    recommended: true,
  },
  {
    code: 'BUSINESS',
    name: 'Business',
    tagline: 'A real team, advanced agents, and access to the API.',
    includes: [
      '1 WhatsApp number',
      'Up to 20 team members',
      'Unlimited active automations, subject to fair-use safeguards',
      '20,000 AI interactions per billing month',
      'Advanced AI agents',
      'API access',
      'Role-based access control',
      'Premium integrations',
      'Priority support',
    ],
    entitlements: {
      // One number on every plan. The product connects a single WhatsApp number
      // per workspace: inbound already resolves per number, but every outbound
      // path still goes through `channelForTenant()`, which picks an arbitrary
      // channel when a tenant has more than one. Selling a second number before
      // that is threaded through would sell replies going out from the wrong one.
      whatsappNumbers: 1,
      teamMembers: 20,
      activeAutomations: null,
      aiInteractionsPerMonth: 20_000,
      features: {
        aiWorkflowGeneration: true,
        crmAndWebhooks: true,
        advancedAnalytics: true,
        advancedAiAgents: true,
        apiAccess: true,
        roleBasedAccessControl: true,
        premiumIntegrations: true,
      },
      support: 'Priority support',
    },
    prices: {
      MONTHLY: rupees(7_999),
      QUARTERLY: rupees(21_599),
      YEARLY: rupees(76_799),
    },
    selfServe: true,
    badges: [],
    recommended: false,
  },
  {
    code: 'ENTERPRISE',
    name: 'Enterprise',
    tagline: 'Shaped around how your business already works.',
    includes: [
      'Custom team members',
      'Custom AI usage',
      'Onboarding and migration support',
      'SLA',
      'Custom integrations',
      'Dedicated support',
    ],
    entitlements: {
      // Everything unlimited by default. A real Enterprise agreement is entered
      // by an administrator with the agreed numbers; these are the fallbacks so
      // an assigned Enterprise account is never *more* restricted than Business.
      //
      // WhatsApp numbers is the one exception, and it is capped rather than
      // unlimited: the product connects one number per workspace (see the note
      // on the Business plan). An administrator can still raise it deliberately
      // with `numberLimitOverride` once outbound is channel-aware — which is the
      // right shape, because that is a decision someone makes knowingly rather
      // than a default nobody chose.
      whatsappNumbers: 1,
      teamMembers: null,
      activeAutomations: null,
      aiInteractionsPerMonth: null,
      features: {
        aiWorkflowGeneration: true,
        crmAndWebhooks: true,
        advancedAnalytics: true,
        advancedAiAgents: true,
        apiAccess: true,
        roleBasedAccessControl: true,
        premiumIntegrations: true,
      },
      support: 'Dedicated support',
    },
    prices: {},
    // No self-service checkout. An administrator assigns it.
    selfServe: false,
    badges: [],
    recommended: false,
  },
];

export const planByCode = (code: string): PlanDefinition | null =>
  PLANS.find((plan) => plan.code === code) ?? null;

/**
 * Capability ordering, for deciding whether a change is an upgrade.
 *
 * Deliberately about *capability*, not price. A yearly Starter costs more in
 * one payment than a monthly Growth, but it is still less product — so the
 * comparison is on the plan, and the interval is handled separately.
 */
const PLAN_RANK: Record<PlanCode, number> = {
  STARTER: 1,
  GROWTH: 2,
  BUSINESS: 3,
  ENTERPRISE: 4,
};

export type PlanChangeKind = 'UPGRADE' | 'DOWNGRADE' | 'INTERVAL_CHANGE' | 'NO_CHANGE';

/**
 * What kind of change this is, which decides when it takes effect.
 *
 * An upgrade is immediate: someone who has hit a limit and wants to pay more
 * should not have to wait. Everything else waits for the period end, because
 * they have already paid for what they have and taking it away early is taking
 * away something bought.
 *
 * An interval change at the same plan is not more or less product, so it waits
 * too — and waiting means no proration arithmetic and no money owed either way.
 */
export const classifyPlanChange = (
  current: { plan: PlanCode | 'FREE'; interval: BillingInterval | null },
  next: { plan: PlanCode; interval: BillingInterval },
): PlanChangeKind => {
  if (current.plan === 'FREE') return 'UPGRADE';
  if (current.plan === next.plan) {
    return current.interval === next.interval ? 'NO_CHANGE' : 'INTERVAL_CHANGE';
  }
  return PLAN_RANK[next.plan] > PLAN_RANK[current.plan] ? 'UPGRADE' : 'DOWNGRADE';
};

/**
 * The unused value of the current period, in paise.
 *
 * Time-based and rounded down, so a rounding error can only ever favour the
 * customer's existing plan rather than quietly shorten what they paid for.
 * Returns 0 when there is nothing to credit — no paid period, or it has already
 * ended.
 */
export const unusedCreditPaise = ({
  amountPaidPaise, periodStart, periodEnd, at = new Date(),
}: {
  amountPaidPaise: number;
  periodStart: Date | null;
  periodEnd: Date | null;
  at?: Date;
}): number => {
  if (!periodStart || !periodEnd || amountPaidPaise <= 0) return 0;

  const total = periodEnd.getTime() - periodStart.getTime();
  const remaining = periodEnd.getTime() - at.getTime();
  if (total <= 0 || remaining <= 0) return 0;

  return Math.min(amountPaidPaise, Math.floor(amountPaidPaise * (remaining / total)));
};

/**
 * Credit expressed as extra days on the new plan.
 *
 * Money-off is the obvious alternative and it is worse here: Razorpay
 * subscriptions bill a fixed plan amount, so a discounted first charge would
 * mean either a refund or a stored balance to reconcile. Converting the credit
 * into time needs neither, is exactly representable, and is easy to state on an
 * invoice — "includes N days carried over".
 */
export const creditAsDays = (
  creditPaise: number,
  newAmountPaise: number,
  interval: BillingInterval,
): number => {
  if (creditPaise <= 0 || newAmountPaise <= 0) return 0;
  const daysInPeriod = MONTHS_PER_INTERVAL[interval] * 30;
  const perDay = newAmountPaise / daysInPeriod;
  return Math.floor(creditPaise / perDay);
};

/** Interval presentation. Quarterly is the default and the highlighted option. */
export const INTERVAL_META: Record<BillingInterval, {
  label: string;
  everyLabel: string;
  badge: string | null;
  isDefault: boolean;
}> = {
  MONTHLY: { label: 'Monthly', everyLabel: 'every month', badge: null, isDefault: true },
  QUARTERLY: { label: 'Quarterly', everyLabel: 'every 3 months', badge: 'Save 10%', isDefault: false },
  YEARLY: { label: 'Yearly', everyLabel: 'every 12 months', badge: 'Save 20%', isDefault: false },
};

// Monthly. The badges are unchanged — quarterly is still the one most people pick, and
// saying so is useful. What the toggle should NOT do is start on a plan that bills three
// months up front before anyone has asked for it; the smallest commitment goes first and
// the badge does the persuading.
export const DEFAULT_INTERVAL: BillingInterval = 'MONTHLY';

/**
 * Effective monthly cost, for display only.
 *
 * Rounded to the nearest paisa and clearly labelled as *effective* in the UI.
 * The customer is charged the interval amount upfront — this number must never
 * be presented as what they pay each month.
 */
export const effectiveMonthlyPaise = (
  totalPaise: number,
  interval: BillingInterval,
): number => Math.round(totalPaise / MONTHS_PER_INTERVAL[interval]);

/**
 * How much cheaper an interval works out per month than paying monthly.
 *
 * Derived *from* the approved prices, never used to produce one. Returns null
 * when there is no monthly price to compare against.
 */
export const savingsPercent = (
  plan: PlanDefinition,
  interval: BillingInterval,
): number | null => {
  const monthly = plan.prices.MONTHLY;
  const total = plan.prices[interval];
  if (!monthly || !total || interval === 'MONTHLY') return null;
  const effective = effectiveMonthlyPaise(total, interval);
  return Math.round((1 - effective / monthly) * 100);
};

// ── Required disclosures ─────────────────────────────────────────────────────
//
// Held here rather than typed into a component, so the pricing page, the
// checkout summary and the invoice all say the same thing. These are commercial
// statements; they should not be able to drift between screens.

export const DISCLOSURES = {
  /** Used only while no GSTIN is configured, so no tax line can be shown. */
  tax: 'Meta WhatsApp message charges and applicable taxes are billed separately.',
  /**
   * The GST-charged variant. Once tax appears as a real line, saying taxes are
   * "billed separately" on the same document would contradict it — but Meta's
   * own per-message charges genuinely still are.
   */
  metaCharges: 'Meta WhatsApp message charges are billed separately.',
  /** Shown wherever a price is quoted, so nobody is surprised at checkout. */
  gstOnTop: (percent: number) => `GST at ${percent}% is added at checkout.`,
  aiOverage: 'AI usage above the included quota may incur additional charges.',
  /**
   * Shown wherever a non-monthly price appears. Rule 12: never imply the
   * customer is paying monthly when the charge is collected upfront.
   */
  upfront: (interval: BillingInterval) => (interval === 'MONTHLY'
    ? 'Billed monthly.'
    : `Charged as one payment ${INTERVAL_META[interval].everyLabel}.`),
} as const;

// ── AI overage ───────────────────────────────────────────────────────────────
//
// What an interaction past the included quota costs, and the most a workspace
// can spend on them before the assistant stops using the model.
//
// APPROVED by Venky on 2026-08-01, as-is. These are no longer placeholders.
// Change the numbers here and nowhere else.
//
// The shape: a descending ladder against each plan's effective included rate
// (Starter ₹999/1,000 ≈ ₹1.00, Growth ≈ ₹0.60, Business ≈ ₹0.40), so upgrading
// visibly lowers a customer's marginal rate. Every default cap is 2× the
// monthly plan price.
//
// One deliberate irregularity, raised at sign-off and accepted: Starter's
// ₹1.00 *equals* its included rate rather than sitting above it. It stays a
// round number because "₹1 per extra AI reply" is a disclosure an entry-plan
// customer understands at a glance, and there is no cost risk in it — every
// tier is 15–30× real model cost (~₹0.03/interaction on gpt-4o-mini).
//
// They are explicit constants for the same reason the plan prices are: a rate
// derived from a formula is a rate nobody approved.

export interface OverageTerms {
  /** Paise per interaction beyond the included quota. */
  ratePaise: number;
  /**
   * Default ceiling on overage spend per period, in paise.
   *
   * A tenant can set their own with `Subscription.overageCapPaise`. This is the
   * value that applies until they do — deliberately a modest multiple of the
   * plan price, so an unattended workspace cannot run up a bill out of
   * proportion to what they signed up for.
   */
  defaultCapPaise: number;
}

export const OVERAGE: Record<PlanCode, OverageTerms> = {
  STARTER: { ratePaise: 100, defaultCapPaise: 200_000 }, // ₹1.00 each, cap ₹2,000
  GROWTH: { ratePaise: 75, defaultCapPaise: 600_000 }, // ₹0.75 each, cap ₹6,000
  BUSINESS: { ratePaise: 50, defaultCapPaise: 1_600_000 }, // ₹0.50 each, cap ₹16,000
  // An Enterprise agreement sets its own terms; the cap is an administrator
  // field on the subscription, and the default here is deliberately generous
  // rather than zero so a negotiated account is never throttled by an oversight.
  ENTERPRISE: { ratePaise: 50, defaultCapPaise: 5_000_000 },
};

/** The free allowance has no overage: nothing to bill against. */
export const FREE_OVERAGE: OverageTerms = { ratePaise: 0, defaultCapPaise: 0 };

/** Prices are quoted excluding GST. Nothing in the product prices tax-inclusive. */
export const TAX_TREATMENT = 'EXCLUSIVE' as const;
export const CURRENCY = 'INR' as const;
