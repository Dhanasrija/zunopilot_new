import type { BillingInterval as PrismaInterval, PlanCode as PrismaPlan, Subscription } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import {
  FREE_OVERAGE, MONTHS_PER_INTERVAL, OVERAGE, PLANS, planByCode,
  type BillingInterval, type Entitlements, type OverageTerms, type PlanCode,
} from './catalogue.js';

// The billing service.
//
// Everything that decides what a workspace is allowed to do, and what it costs,
// lives behind these functions. The rule that matters most:
//
//   **A price is only ever read from the database, by plan and interval.**
//
// A checkout request names a plan and an interval — never an amount, never a
// price id, never a Razorpay plan id. Anything a client sends about money is
// treated as a suggestion about *what* to buy, and the server decides what that
// costs. Accepting a price from the browser is how a ₹76,799 plan gets sold
// for ₹1.

/**
 * The Razorpay plan id for a plan and interval, from the environment only.
 *
 * `process.env` first, then the `env` snapshot — the third place in this
 * codebase that has needed the distinction, so it is worth stating plainly:
 * `config/env.ts` reads the environment once at import, which is right for
 * anything fixed for the life of the process and wrong for anything that can be
 * set afterwards. A plan id can: the provisioning script writes it into `.env`
 * and then re-syncs in the same run, and a rotation changes it without a
 * redeploy. Reading the live value costs nothing and removes the trap.
 */
export const razorpayPlanIdFor = (plan: PlanCode, interval: BillingInterval): string =>
  process.env[`RAZORPAY_${plan}_${interval}_PLAN_ID`]
  || env.razorpay.planIds[plan]?.[interval]
  || '';

export class BillingError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = 'BillingError';
    this.code = code;
  }
}

/**
 * Seed or update the price catalogue.
 *
 * Idempotent and non-destructive. A price whose amount still matches is left
 * exactly as it is; a changed amount **archives** the old row and inserts a new
 * one. Nothing an invoice points at is ever mutated, so an old invoice keeps
 * resolving to the terms that actually applied.
 */
export const syncPriceCatalogue = async (): Promise<{ created: number; archived: number }> => {
  let created = 0;
  let archived = 0;

  for (const plan of PLANS) {
    for (const [interval, amountPaise] of Object.entries(plan.prices) as Array<[BillingInterval, number]>) {
      const active = await prisma.price.findFirst({
        where: { plan: plan.code as PrismaPlan, interval: interval as PrismaInterval, archivedAt: null },
      });

      const planId = razorpayPlanIdFor(plan.code, interval) || null;
      if (active?.amountPaise === amountPaise && active.razorpayPlanId === planId) continue;

      await prisma.$transaction(async (tx) => {
        if (active) {
          await tx.price.update({ where: { id: active.id }, data: { archivedAt: new Date() } });
          archived += 1;
        }
        await tx.price.create({
          data: {
            plan: plan.code as PrismaPlan,
            interval: interval as PrismaInterval,
            amountPaise,
            currency: 'INR',
            taxTreatment: 'EXCLUSIVE',
            // Copied from the environment at sync time. Recording it on the
            // price means an invoice can be traced to the exact Razorpay plan
            // that was charged, even after the env is changed.
            razorpayPlanId: razorpayPlanIdFor(plan.code, interval) || null,
          },
        });
        created += 1;
      });
    }
  }

  if (created || archived) logger.info('Price catalogue synced', { created, archived });
  return { created, archived };
};

/**
 * The live price for a plan and interval.
 *
 * The only way an amount enters a payment. Throws rather than defaulting: a
 * missing price must stop a checkout, not quietly charge something else.
 */
export const activePrice = async (plan: PlanCode, interval: BillingInterval) => {
  const definition = planByCode(plan);
  if (!definition) throw new BillingError(`Unknown plan "${plan}"`, 'UNKNOWN_PLAN');
  if (!definition.selfServe) {
    throw new BillingError(
      `${definition.name} is not available for self-service checkout. Contact sales.`,
      'NOT_SELF_SERVE',
    );
  }

  const price = await prisma.price.findFirst({
    where: { plan: plan as PrismaPlan, interval: interval as PrismaInterval, archivedAt: null },
  });
  if (!price) {
    throw new BillingError(`No active price for ${plan} ${interval}`, 'NO_ACTIVE_PRICE');
  }
  return price;
};

// ── Entitlements ─────────────────────────────────────────────────────────────

/**
 * What a workspace with no paid subscription gets.
 *
 * Deliberately usable rather than zero: a tenant that has not paid yet — or
 * whose payment lapsed — can still answer customers. Cutting off the inbox
 * because a card expired punishes the end customer for the business's billing
 * problem.
 */
export const FREE_ALLOWANCE: Entitlements = {
  whatsappNumbers: 1,
  teamMembers: 2,
  activeAutomations: 2,
  aiInteractionsPerMonth: 100,
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
};

/** A subscription counts as paid-up for these statuses. */
const ENTITLED_STATUSES = new Set(['ACTIVE', 'TRIALING', 'MANUAL']);

export interface ResolvedEntitlements extends Entitlements {
  plan: PlanCode | 'FREE';
  planName: string;
  status: string;
  periodStart: Date | null;
  periodEnd: Date | null;
}

/**
 * What this workspace may do right now.
 *
 * Administrator overrides win over the plan's own numbers — that is how an
 * Enterprise agreement, or any negotiated exception, is expressed without
 * inventing a plan per customer.
 */
export const entitlementsFor = async (tenantId: string): Promise<ResolvedEntitlements> => {
  const subscription = await prisma.subscription.findUnique({ where: { tenantId } });

  const lapsed = subscription
    && subscription.currentPeriodEnd
    && subscription.currentPeriodEnd < new Date();

  const paidUp = subscription
    && ENTITLED_STATUSES.has(subscription.status)
    // MANUAL has no period requirement — an assigned agreement is open-ended
    // until an administrator ends it.
    && (subscription.status === 'MANUAL' || !lapsed);

  if (!subscription || !paidUp) {
    return {
      ...FREE_ALLOWANCE,
      plan: 'FREE',
      planName: 'Free',
      status: subscription?.status ?? 'NONE',
      periodStart: subscription?.currentPeriodStart ?? null,
      periodEnd: subscription?.currentPeriodEnd ?? null,
    };
  }

  const definition = planByCode(subscription.plan);
  const base = definition?.entitlements ?? FREE_ALLOWANCE;

  return {
    ...base,
    whatsappNumbers: subscription.numberLimitOverride ?? base.whatsappNumbers,
    teamMembers: subscription.seatLimitOverride ?? base.teamMembers,
    activeAutomations: subscription.automationLimitOverride ?? base.activeAutomations,
    aiInteractionsPerMonth: subscription.aiQuotaOverride ?? base.aiInteractionsPerMonth,
    plan: subscription.plan as PlanCode,
    planName: definition?.name ?? subscription.plan,
    status: subscription.status,
    periodStart: subscription.currentPeriodStart,
    periodEnd: subscription.currentPeriodEnd,
  };
};

// ── Billing period ───────────────────────────────────────────────────────────

export const addInterval = (from: Date, interval: BillingInterval): Date => {
  const end = new Date(from);
  end.setMonth(end.getMonth() + MONTHS_PER_INTERVAL[interval]);
  return end;
};

/**
 * The window usage is counted against.
 *
 * "1,000 AI interactions per billing month" on a quarterly plan means per
 * month, not 3,000 up front — so the counter rolls monthly *within* the paid
 * period, anchored to the day the period started. A workspace that pays
 * quarterly and burns its whole allowance in week one would otherwise be
 * silent for eleven weeks.
 */
export const currentUsagePeriod = (subscription: Subscription | null): {
  start: Date;
  end: Date;
} => {
  const now = new Date();
  const anchor = subscription?.currentPeriodStart ?? null;

  if (!anchor) {
    // No subscription: calendar month.
    return {
      start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
      end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
    };
  }

  // Walk forward from the anchor in whole months until the window contains now.
  const start = new Date(anchor);
  while (addOneMonth(start) <= now) start.setMonth(start.getMonth() + 1);
  return { start, end: addOneMonth(start) };
};

const addOneMonth = (date: Date): Date => {
  const next = new Date(date);
  next.setMonth(next.getMonth() + 1);
  return next;
};

// ── AI usage ─────────────────────────────────────────────────────────────────

export interface UsageSnapshot {
  used: number;
  limit: number | null;
  remaining: number | null;
  periodStart: Date;
  periodEnd: Date;
  overQuota: boolean;
  /** Interactions past the quota, and what they have accrued. */
  overageInteractions: number;
  overagePaise: number;
  /** What each further interaction costs, and the ceiling on that spend. */
  overageRatePaise: number;
  overageCapPaise: number;
  /** True once the cap is reached — the assistant stops using the model. */
  capReached: boolean;
}

/** The overage terms in force for a workspace, including its own cap. */
export const overageTermsFor = async (tenantId: string): Promise<OverageTerms & { plan: string }> => {
  const [subscription, entitlements] = await Promise.all([
    prisma.subscription.findUnique({ where: { tenantId } }),
    entitlementsFor(tenantId),
  ]);

  // No paid plan means no overage. There is no committed spend to bill an
  // excess against, so the free allowance simply stops at its quota.
  if (entitlements.plan === 'FREE') return { ...FREE_OVERAGE, plan: 'FREE' };

  const base = OVERAGE[entitlements.plan as PlanCode] ?? FREE_OVERAGE;
  return {
    ratePaise: base.ratePaise,
    // A tenant-set cap wins, including a deliberate 0 — which is how a customer
    // says "never spend beyond my plan". `??` not `||`, so 0 is honoured
    // rather than falling through to the default.
    defaultCapPaise: subscription?.overageCapPaise ?? base.defaultCapPaise,
    plan: entitlements.plan,
  };
};

export const usageFor = async (tenantId: string): Promise<UsageSnapshot> => {
  const subscription = await prisma.subscription.findUnique({ where: { tenantId } });
  const period = currentUsagePeriod(subscription);
  const entitlements = await entitlementsFor(tenantId);

  const counter = await prisma.usageCounter.findUnique({
    where: { tenantId_periodStart: { tenantId, periodStart: period.start } },
  });

  const used = counter?.aiInteractions ?? 0;
  const limit = entitlements.aiInteractionsPerMonth;
  const terms = await overageTermsFor(tenantId);
  const accrued = counter?.overagePaise ?? 0;

  return {
    used,
    limit,
    remaining: limit === null ? null : Math.max(0, limit - used),
    periodStart: period.start,
    periodEnd: period.end,
    overQuota: limit !== null && used >= limit,
    overageInteractions: counter?.overageInteractions ?? 0,
    overagePaise: accrued,
    overageRatePaise: terms.ratePaise,
    overageCapPaise: terms.defaultCapPaise,
    capReached: terms.ratePaise > 0
      ? accrued + terms.ratePaise > terms.defaultCapPaise
      : (limit !== null && used >= limit),
  };
};

export interface AiAllowance {
  allowed: boolean;
  /** True when this one is being charged rather than drawn from the quota. */
  billable: boolean;
  ratePaise: number;
  reason: 'WITHIN_QUOTA' | 'OVERAGE' | 'CAP_REACHED' | 'NO_OVERAGE_ON_FREE';
}

/**
 * Whether this message may use the model, and at what cost.
 *
 * Called before the router spends anything. The three outcomes matter:
 *
 *   • within quota — free, as sold.
 *   • past quota, under the cap — allowed and charged. This is what the
 *     "AI usage above the included quota may incur additional charges"
 *     disclosure promises, and it only means anything if something charges.
 *   • past the cap — refused. The customer still gets an answer: the router
 *     falls back to keyword rules and the tenant's own fallback text. Silence
 *     would punish *their* customer for a spending limit they never saw.
 */
export const checkAiAllowance = async (tenantId: string): Promise<AiAllowance> => {
  const usage = await usageFor(tenantId);

  if (usage.limit === null || usage.used < usage.limit) {
    return { allowed: true, billable: false, ratePaise: 0, reason: 'WITHIN_QUOTA' };
  }
  if (usage.overageRatePaise <= 0) {
    return { allowed: false, billable: false, ratePaise: 0, reason: 'NO_OVERAGE_ON_FREE' };
  }
  if (usage.overagePaise + usage.overageRatePaise > usage.overageCapPaise) {
    return { allowed: false, billable: false, ratePaise: usage.overageRatePaise, reason: 'CAP_REACHED' };
  }
  return {
    allowed: true, billable: true, ratePaise: usage.overageRatePaise, reason: 'OVERAGE',
  };
};

/**
 * Count one AI interaction.
 *
 * Atomic upsert-and-increment, because two inbound messages are routed
 * concurrently all the time and a read-then-write would lose one. Never throws:
 * the caller has already done the work, and failing to record it must not fail
 * the customer's message.
 */
export const recordAiInteraction = async (
  tenantId: string,
  { count = 1, billableRatePaise = 0 }: { count?: number; billableRatePaise?: number } = {},
): Promise<void> => {
  try {
    const subscription = await prisma.subscription.findUnique({ where: { tenantId } });
    const period = currentUsagePeriod(subscription);
    // Accrued at the rate in force *now*. Recomputing the charge later from a
    // count would apply whatever the rate had become by then, which is not what
    // the customer used.
    const charge = billableRatePaise * count;

    await prisma.usageCounter.upsert({
      where: { tenantId_periodStart: { tenantId, periodStart: period.start } },
      create: {
        tenantId,
        periodStart: period.start,
        periodEnd: period.end,
        aiInteractions: count,
        overageInteractions: charge > 0 ? count : 0,
        overagePaise: charge,
      },
      update: {
        aiInteractions: { increment: count },
        ...(charge > 0
          ? { overageInteractions: { increment: count }, overagePaise: { increment: charge } }
          : {}),
      },
    });
  } catch (err) {
    logger.warn('Could not record AI usage', {
      tenantId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};
