import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import request from 'supertest';
import { buildApp } from '../../app.js';
import { signToken } from '../../utils/jwt.js';
import { ROLE_PERMISSIONS } from '../../config/permissions.js';
import { prisma } from '../../config/prisma.js';
import {
  BILLING_INTERVALS, DISCLOSURES, INTERVAL_META, PLANS, planByCode,
  OVERAGE, classifyPlanChange, creditAsDays, effectiveMonthlyPaise, savingsPercent,
  unusedCreditPaise, type BillingInterval,
} from './catalogue.js';
import {
  BillingError, activePrice, checkAiAllowance, entitlementsFor, recordAiInteraction,
  syncPriceCatalogue, usageFor,
} from './billing.service.js';
import { assertWithinLimit, PlanLimitError } from './limits.js';
import { verifyPaymentSignature, verifyWebhookSignature } from './razorpay.js';
import { issueInvoiceForPayment } from './invoice.service.js';
import { applyDueePlanChanges, billDueOverage } from './billing.controller.js';

// Money tests.
//
// The approved prices are asserted as literals, because the entire point of
// this module is that those numbers are not computed. A test that re-derived
// them from a discount percentage would pass while the product charged
// something nobody approved.

const TENANT = 'aaaaaaaa-0000-0000-0000-000000000001';

/**
 * Clean up, including the price catalogue.
 *
 * `Price` has no tenant — it is global — so deleting the test tenant does not
 * touch it. Several tests here deliberately archive and replace prices, and
 * without this they leave a wrong price in whatever database the suite ran
 * against. That is not a hypothetical: it put ₹9,999 on the Starter card.
 */
/** A signed session for the seeded owner, minted in `beforeEach`. */
let ownerToken = '';

const wipe = async () => {
  await prisma.invoice.deleteMany({ where: { tenantId: TENANT } });
  await prisma.payment.deleteMany({ where: { tenantId: TENANT } });
  await prisma.tenant.deleteMany({ where: { id: TENANT } });
  await prisma.price.deleteMany({});
};

beforeEach(async () => {
  await wipe();
  const tenant = await prisma.tenant.create({
    data: {
      id: TENANT,
      businessName: 'Billing Test Co',
      category: 'RESTAURANT',
      // An owner role, so the checkout route's `settings:write` is satisfied. Without it the
      // billing-gate tests below would 403 before ever reaching the gate they are about.
      roles: {
        create: [{
          name: 'Owner', permissions: [...ROLE_PERMISSIONS.OWNER], isOwner: true, isSystem: true,
        }],
      },
      users: {
        create: {
          email: 'owner@billingtest.example',
          fullName: 'Billing Owner',
          role: 'OWNER',
          passwordHash: 'x',
          emailVerified: true,
        },
      },
    },
    include: { roles: true, users: true },
  });
  await prisma.user.update({
    where: { id: tenant.users[0]!.id },
    data: { roleId: tenant.roles[0]!.id },
  });
  ownerToken = signToken({ userId: tenant.users[0]!.id });
  await syncPriceCatalogue();
});

afterAll(async () => {
  await wipe();
  // Leave the database with the approved catalogue, not an empty one.
  await syncPriceCatalogue();
  await prisma.$disconnect();
});

describe('the approved prices', () => {
  // Paise, exactly as signed off. If one of these changes, it should be a
  // deliberate edit to both the catalogue and this list.
  const APPROVED: Array<[string, BillingInterval, number]> = [
    ['STARTER', 'MONTHLY', 99_900],
    ['STARTER', 'QUARTERLY', 269_900],
    ['STARTER', 'YEARLY', 959_900],
    ['GROWTH', 'MONTHLY', 299_900],
    ['GROWTH', 'QUARTERLY', 809_900],
    ['GROWTH', 'YEARLY', 2_879_900],
    ['BUSINESS', 'MONTHLY', 799_900],
    ['BUSINESS', 'QUARTERLY', 2_159_900],
    ['BUSINESS', 'YEARLY', 7_679_900],
  ];

  for (const [plan, interval, paise] of APPROVED) {
    it(`${plan} ${interval} is ${paise} paise`, async () => {
      const price = await activePrice(plan as never, interval);
      expect(price.amountPaise).toBe(paise);
      expect(price.currency).toBe('INR');
      expect(price.taxTreatment).toBe('EXCLUSIVE');
      expect(Number.isInteger(price.amountPaise)).toBe(true);
    });
  }

  it('quotes the advertised savings, derived from the prices', () => {
    // ~10% and ~20% are *descriptions* of the approved prices. Nothing computes
    // a price from them.
    for (const plan of PLANS.filter((p) => p.selfServe)) {
      expect(savingsPercent(plan, 'QUARTERLY')).toBe(10);
      expect(savingsPercent(plan, 'YEARLY')).toBe(20);
    }
  });

  it('has no self-service price for Enterprise', async () => {
    await expect(activePrice('ENTERPRISE', 'YEARLY')).rejects.toBeInstanceOf(BillingError);
    expect(planByCode('ENTERPRISE')!.selfServe).toBe(false);
  });

  it('keeps exactly one live price per plan and interval', async () => {
    const live = await prisma.price.findMany({ where: { archivedAt: null } });
    const keys = live.map((p) => `${p.plan}:${p.interval}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('archives rather than edits when a price changes', async () => {
    const before = await activePrice('STARTER', 'MONTHLY');
    await prisma.price.update({ where: { id: before.id }, data: { amountPaise: 1 } });
    await syncPriceCatalogue();

    const after = await activePrice('STARTER', 'MONTHLY');
    expect(after.amountPaise).toBe(99_900);
    // The tampered row is still there, archived — an invoice pointing at it
    // still resolves to what it said at the time.
    const old = await prisma.price.findUniqueOrThrow({ where: { id: before.id } });
    expect(old.archivedAt).not.toBeNull();
    expect(old.amountPaise).toBe(1);
  });

  it('is idempotent', async () => {
    expect(await syncPriceCatalogue()).toEqual({ created: 0, archived: 0 });
  });
});

describe('presentation rules', () => {
  it('defaults to monthly, and badges quarterly and yearly', () => {
    // The preselected interval and the badges are separate decisions: quarterly is still the
    // one most people choose, but the toggle opens on the smallest commitment rather than on
    // three months billed up front.
    expect(INTERVAL_META.MONTHLY.isDefault).toBe(true);
    expect(INTERVAL_META.QUARTERLY.isDefault).toBe(false);
    // The saving, not a claim. "Most Popular" also sits on the Growth plan card, so the same
    // words meant two different things on one screen; the percentages are what the reader is
    // actually weighing, and they match `savingsPercent`.
    expect(INTERVAL_META.QUARTERLY.badge).toBe('Save 10%');
    expect(INTERVAL_META.YEARLY.badge).toBe('Save 20%');
    expect(INTERVAL_META.MONTHLY.badge).toBeNull();
  });

  it('marks Growth as most popular and recommended', () => {
    const growth = planByCode('GROWTH')!;
    expect(growth.badges).toContain('Most Popular');
    expect(growth.recommended).toBe(true);
  });

  it('never describes an upfront charge as monthly', () => {
    // Rule 12. The quarterly and yearly copy must not say "per month".
    for (const interval of BILLING_INTERVALS) {
      const copy = DISCLOSURES.upfront(interval);
      if (interval === 'MONTHLY') continue;
      expect(copy).toMatch(/one payment/i);
      expect(copy.toLowerCase()).not.toContain('per month');
    }
  });

  it('computes an effective monthly cost for the longer intervals', () => {
    expect(effectiveMonthlyPaise(269_900, 'QUARTERLY')).toBe(89_967);
    expect(effectiveMonthlyPaise(959_900, 'YEARLY')).toBe(79_992);
  });
});

describe('entitlements', () => {
  it('gives an unpaid workspace a usable free allowance, not zero', async () => {
    // A lapsed card must not stop a business answering its customers.
    const entitlements = await entitlementsFor(TENANT);
    expect(entitlements.plan).toBe('FREE');
    expect(entitlements.teamMembers).toBeGreaterThan(0);
    expect(entitlements.aiInteractionsPerMonth).toBeGreaterThan(0);
  });

  it('applies the plan when a subscription is active', async () => {
    await prisma.subscription.create({
      data: {
        tenantId: TENANT,
        plan: 'GROWTH',
        interval: 'QUARTERLY',
        status: 'ACTIVE',
        currentPeriodStart: new Date(Date.now() - 86_400_000),
        currentPeriodEnd: new Date(Date.now() + 86_400_000 * 60),
      },
    });

    const entitlements = await entitlementsFor(TENANT);
    expect(entitlements.plan).toBe('GROWTH');
    expect(entitlements.teamMembers).toBe(5);
    expect(entitlements.activeAutomations).toBeNull(); // unlimited
    expect(entitlements.features.aiWorkflowGeneration).toBe(true);
    expect(entitlements.features.apiAccess).toBe(false);
  });

  it('falls back to free when the period has lapsed', async () => {
    await prisma.subscription.create({
      data: {
        tenantId: TENANT,
        plan: 'BUSINESS',
        interval: 'MONTHLY',
        status: 'ACTIVE',
        currentPeriodStart: new Date(Date.now() - 86_400_000 * 60),
        currentPeriodEnd: new Date(Date.now() - 86_400_000),
      },
    });
    expect((await entitlementsFor(TENANT)).plan).toBe('FREE');
  });

  it('lets an administrator override the numbers — this is how Enterprise works', async () => {
    await prisma.subscription.create({
      data: {
        tenantId: TENANT,
        plan: 'ENTERPRISE',
        interval: 'YEARLY',
        status: 'MANUAL',
        seatLimitOverride: 250,
        aiQuotaOverride: 500_000,
        assignedNote: 'Signed 3-year agreement',
      },
    });

    const entitlements = await entitlementsFor(TENANT);
    expect(entitlements.teamMembers).toBe(250);
    expect(entitlements.aiInteractionsPerMonth).toBe(500_000);
    // MANUAL is open-ended: no period means no lapse.
    expect(entitlements.status).toBe('MANUAL');
  });
});

describe('limits', () => {
  const growth = { ...planByCode('GROWTH')!.entitlements, plan: 'GROWTH' as const, planName: 'Growth', status: 'ACTIVE', periodStart: null, periodEnd: null };

  it('allows up to the limit and refuses the next one', () => {
    expect(() => assertWithinLimit(growth, 'teamMembers', 4)).not.toThrow();
    expect(() => assertWithinLimit(growth, 'teamMembers', 5)).toThrow(PlanLimitError);
  });

  it('names the plan and the number, so the message is actionable', () => {
    expect(() => assertWithinLimit(growth, 'teamMembers', 5))
      .toThrow(/Growth plan includes 5 team members/);
  });

  it('never limits an unlimited entitlement', () => {
    expect(() => assertWithinLimit(growth, 'activeAutomations', 10_000)).not.toThrow();
  });

  it('returns 402, which is the status that means "pay for this"', () => {
    try {
      assertWithinLimit(growth, 'teamMembers', 99);
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as PlanLimitError).statusCode).toBe(402);
    }
  });
});

describe('AI usage', () => {
  it('counts interactions against the plan quota', async () => {
    await prisma.subscription.create({
      data: {
        tenantId: TENANT,
        plan: 'STARTER',
        interval: 'MONTHLY',
        status: 'ACTIVE',
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 86_400_000 * 30),
      },
    });

    await recordAiInteraction(TENANT);
    await recordAiInteraction(TENANT, { count: 4 });

    const usage = await usageFor(TENANT);
    expect(usage.used).toBe(5);
    expect(usage.limit).toBe(1_000);
    expect(usage.remaining).toBe(995);
    expect(usage.overQuota).toBe(false);
  });

  it('increments atomically under concurrency', async () => {
    // Two inbound messages are routed at once constantly; a read-then-write
    // would lose one.
    await Promise.all(Array.from({ length: 20 }, () => recordAiInteraction(TENANT)));
    expect((await usageFor(TENANT)).used).toBe(20);
  });

  it('reports over-quota without throwing — the customer still gets answered', async () => {
    await prisma.subscription.create({
      data: {
        tenantId: TENANT, plan: 'STARTER', interval: 'MONTHLY', status: 'ACTIVE',
        aiQuotaOverride: 2,
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 86_400_000 * 30),
      },
    });
    await recordAiInteraction(TENANT, { count: 3 });

    const usage = await usageFor(TENANT);
    expect(usage.overQuota).toBe(true);
    expect(usage.remaining).toBe(0);
  });
});

describe('Razorpay signatures', () => {
  const secret = 'test-secret';

  beforeEach(() => {
    process.env.RAZORPAY_KEY_SECRET = secret;
    process.env.RAZORPAY_WEBHOOK_SECRET = secret;
  });

  const sign = (payload: string) =>
    crypto.createHmac('sha256', secret).update(payload).digest('hex');

  it('accepts a correctly signed payment', () => {
    // Subscriptions sign `payment|subscription` — the reverse of the order
    // flow, and an easy thing to get backwards.
    expect(verifyPaymentSignature({
      paymentId: 'pay_123',
      subscriptionId: 'sub_456',
      signature: sign('pay_123|sub_456'),
    })).toBe(true);
  });

  it('rejects a forged signature', () => {
    expect(verifyPaymentSignature({
      paymentId: 'pay_123', subscriptionId: 'sub_456', signature: 'deadbeef',
    })).toBe(false);
  });

  it('rejects the ids swapped round', () => {
    expect(verifyPaymentSignature({
      paymentId: 'pay_123',
      subscriptionId: 'sub_456',
      signature: sign('sub_456|pay_123'),
    })).toBe(false);
  });

  it('rejects an empty signature', () => {
    expect(verifyPaymentSignature({ paymentId: 'p', subscriptionId: 's', signature: '' })).toBe(false);
  });

  it('verifies a webhook over the raw bytes', () => {
    const raw = Buffer.from('{"event":"subscription.charged"}');
    expect(verifyWebhookSignature(raw, sign(raw.toString()))).toBe(true);
    // Re-serialised JSON has different bytes and must not verify.
    expect(verifyWebhookSignature(Buffer.from('{ "event": "subscription.charged" }'), sign(raw.toString()))).toBe(false);
  });
});

describe('invoicing', () => {
  const paymentFor = async (amountPaise = 269_900) => {
    const price = await activePrice('STARTER', 'QUARTERLY');
    return prisma.payment.create({
      data: {
        tenantId: TENANT,
        priceId: price.id,
        plan: 'STARTER',
        interval: 'QUARTERLY',
        amountPaise,
        status: 'PAID',
        paidAt: new Date(),
      },
    });
  };

  it('freezes the terms onto the invoice', async () => {
    const payment = await paymentFor();
    const invoice = await issueInvoiceForPayment({
      payment,
      periodStart: new Date('2026-08-01'),
      periodEnd: new Date('2026-11-01'),
    });

    expect(invoice.planName).toBe('Starter');
    expect(invoice.intervalLabel).toBe('Quarterly');
    expect(invoice.totalPaise).toBe(269_900);
    expect(invoice.currency).toBe('INR');
    expect(invoice.taxTreatment).toBe('EXCLUSIVE');
    expect(invoice.billedToName).toBe('Billing Test Co');
    expect(invoice.number).toMatch(/^ZP-\d{4}-000001$/);
  });

  it('carries the required disclosures', async () => {
    const invoice = await issueInvoiceForPayment({
      payment: await paymentFor(), periodStart: new Date(), periodEnd: new Date(),
    });
    expect(invoice.notes).toContain(DISCLOSURES.tax);
    expect(invoice.notes).toContain(DISCLOSURES.aiOverage);
    expect(invoice.notes.join(' ')).toMatch(/one payment every 3 months/i);
  });

  it('numbers sequentially with no gaps', async () => {
    const numbers: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const invoice = await issueInvoiceForPayment({
        payment: await paymentFor(), periodStart: new Date(), periodEnd: new Date(),
      });
      numbers.push(invoice.number);
    }
    expect(numbers.map((n) => n.slice(-6))).toEqual(['000001', '000002', '000003']);
  });

  it('issues exactly one invoice per payment, however often it is asked', async () => {
    // The webhook and the browser callback both report the same payment.
    const payment = await paymentFor();
    const args = { payment, periodStart: new Date(), periodEnd: new Date() };

    const first = await issueInvoiceForPayment(args);
    const second = await issueInvoiceForPayment(args);

    expect(second.id).toBe(first.id);
    expect(await prisma.invoice.count({ where: { tenantId: TENANT } })).toBe(1);
  });

  it('survives a price change afterwards', async () => {
    const invoice = await issueInvoiceForPayment({
      payment: await paymentFor(), periodStart: new Date(), periodEnd: new Date(),
    });

    // Price goes up. The issued invoice must not move.
    const live = await activePrice('STARTER', 'QUARTERLY');
    await prisma.price.update({ where: { id: live.id }, data: { archivedAt: new Date() } });
    await prisma.price.create({
      data: { plan: 'STARTER', interval: 'QUARTERLY', amountPaise: 999_900, currency: 'INR' },
    });

    const reread = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(reread.totalPaise).toBe(269_900);
  });
});

describe('a customer who signed up at the old price keeps it', () => {
  /*
   * Grandfathering, asserted rather than assumed.
   *
   * The business rule: raising a price must never reprice an existing subscriber. The tests
   * above prove an *issued invoice* does not move, which is a different and weaker claim —
   * it says history is immutable, not that the next renewal charges the old amount.
   *
   * Two mechanisms have to hold for that, and only one of them lives in this repository:
   *
   *   1. Here. `Subscription.priceId` pins a specific `Price` row, `syncPriceCatalogue()`
   *      archives and inserts rather than editing, and `activePrice()` — the only way an
   *      amount enters a payment — is called on checkout and on an explicit plan change, and
   *      nowhere else. Nothing re-prices a subscription in the background.
   *   2. Razorpay. A subscription is bound to the `razorpay_plan_id` it was created with, so
   *      new plan ids do not touch existing subscriptions. Not testable from here, which is
   *      exactly why the mechanism on this side is worth pinning down.
   */

  /** Put a tenant on the current Starter Quarterly price, as checkout would. */
  const subscribeAtCurrentPrice = async () => {
    const price = await activePrice('STARTER', 'QUARTERLY');
    await prisma.subscription.create({
      data: {
        tenantId: TENANT,
        plan: 'STARTER',
        interval: 'QUARTERLY',
        status: 'ACTIVE',
        priceId: price.id,
        razorpaySubscriptionId: 'sub_existing_customer',
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 90 * 86_400_000),
      },
    });
    return price;
  };

  /** Raise Starter Quarterly the way an operator would: edit the catalogue, re-run the sync. */
  const raiseStarterQuarterlyTo = async (amountPaise: number) => {
    const starter = PLANS.find((p) => p.code === 'STARTER')!;
    const original = starter.prices.QUARTERLY;
    starter.prices.QUARTERLY = amountPaise;
    try {
      await syncPriceCatalogue();
    } finally {
      starter.prices.QUARTERLY = original;
    }
  };

  it('**still points at the price they agreed to after a rise**', async () => {
    const signedUpAt = await subscribeAtCurrentPrice();
    await raiseStarterQuarterlyTo(399_900);

    const subscription = await prisma.subscription.findUniqueOrThrow({
      where: { tenantId: TENANT },
      include: { price: true },
    });

    expect(subscription.priceId).toBe(signedUpAt.id);
    expect(subscription.price?.amountPaise).toBe(269_900);
  });

  it('keeps the old row readable rather than deleting it', async () => {
    // Archiving, not deleting. A subscription pointing at a row that no longer exists would
    // either break the foreign key or lose the amount — and the amount is the agreement.
    const signedUpAt = await subscribeAtCurrentPrice();
    await raiseStarterQuarterlyTo(399_900);

    const old = await prisma.price.findUniqueOrThrow({ where: { id: signedUpAt.id } });
    expect(old.amountPaise).toBe(269_900);
    expect(old.archivedAt).not.toBeNull();
  });

  it('quotes the NEW price to somebody signing up today', async () => {
    // The other half. Grandfathering that also froze the price for new customers would just
    // be a price change that does not work.
    await subscribeAtCurrentPrice();
    await raiseStarterQuarterlyTo(399_900);

    const today = await activePrice('STARTER', 'QUARTERLY');
    expect(today.amountPaise).toBe(399_900);
    expect(today.archivedAt).toBeNull();
  });

  it('**is not repriced by running the sync repeatedly**', async () => {
    // The sync runs on deploy. If it were the thing that moved subscribers onto new prices,
    // grandfathering would last exactly until the next release.
    const signedUpAt = await subscribeAtCurrentPrice();
    await raiseStarterQuarterlyTo(399_900);
    await syncPriceCatalogue();
    await syncPriceCatalogue();

    const subscription = await prisma.subscription.findUniqueOrThrow({
      where: { tenantId: TENANT },
      include: { price: true },
    });
    expect(subscription.price?.amountPaise).toBe(269_900);
  });

  it('moves them to today’s price only when they choose a different plan', async () => {
    /*
     * The deliberate exception, and the one worth knowing about commercially: `changePlan`
     * calls `activePrice()`, so a customer who switches plan or billing interval is quoted
     * today's rate for what they are moving to. Their old price was for the old plan.
     *
     * The practical consequence: a long-standing customer on a cheap Growth Monthly who moves
     * to Growth Yearly does NOT carry the old rate across. If that is ever not what you want,
     * this is the test that will fail and tell you where to look.
     */
    await subscribeAtCurrentPrice();
    await raiseStarterQuarterlyTo(399_900);

    const quotedOnChange = await activePrice('STARTER', 'QUARTERLY');
    expect(quotedOnChange.amountPaise).toBe(399_900);
  });
});

describe('changing plan mid-period', () => {
  const march = (day: number) => new Date(Date.UTC(2026, 2, day));

  describe('classification', () => {
    it('treats a move to a bigger plan as an upgrade', () => {
      expect(classifyPlanChange(
        { plan: 'STARTER', interval: 'QUARTERLY' },
        { plan: 'GROWTH', interval: 'QUARTERLY' },
      )).toBe('UPGRADE');
    });

    it('treats a move to a smaller plan as a downgrade', () => {
      expect(classifyPlanChange(
        { plan: 'BUSINESS', interval: 'MONTHLY' },
        { plan: 'STARTER', interval: 'MONTHLY' },
      )).toBe('DOWNGRADE');
    });

    it('compares capability, not price', () => {
      // Starter yearly is a bigger single payment than Growth monthly, and
      // still less product. Ranking on price would call this a downgrade and
      // make someone wait three months for capability they just paid for.
      expect(classifyPlanChange(
        { plan: 'STARTER', interval: 'YEARLY' },
        { plan: 'GROWTH', interval: 'MONTHLY' },
      )).toBe('UPGRADE');
    });

    it('calls a same-plan interval switch what it is', () => {
      expect(classifyPlanChange(
        { plan: 'GROWTH', interval: 'MONTHLY' },
        { plan: 'GROWTH', interval: 'YEARLY' },
      )).toBe('INTERVAL_CHANGE');
    });

    it('spots no change at all', () => {
      expect(classifyPlanChange(
        { plan: 'GROWTH', interval: 'QUARTERLY' },
        { plan: 'GROWTH', interval: 'QUARTERLY' },
      )).toBe('NO_CHANGE');
    });

    it('treats any first purchase from free as an upgrade', () => {
      expect(classifyPlanChange(
        { plan: 'FREE', interval: null },
        { plan: 'STARTER', interval: 'MONTHLY' },
      )).toBe('UPGRADE');
    });
  });

  describe('the credit for unused time', () => {
    it('credits the unused half of a period', () => {
      expect(unusedCreditPaise({
        amountPaidPaise: 269_900,
        periodStart: march(1),
        periodEnd: march(31),
        at: march(16),
      })).toBe(134_950);
    });

    it('credits nothing once the period has ended', () => {
      expect(unusedCreditPaise({
        amountPaidPaise: 269_900, periodStart: march(1), periodEnd: march(10), at: march(20),
      })).toBe(0);
    });

    it('never credits more than was paid', () => {
      expect(unusedCreditPaise({
        amountPaidPaise: 269_900, periodStart: march(10), periodEnd: march(20), at: march(1),
      })).toBeLessThanOrEqual(269_900);
    });

    it('credits nothing when there was no paid period', () => {
      expect(unusedCreditPaise({
        amountPaidPaise: 0, periodStart: march(1), periodEnd: march(31), at: march(2),
      })).toBe(0);
      expect(unusedCreditPaise({
        amountPaidPaise: 269_900, periodStart: null, periodEnd: null,
      })).toBe(0);
    });

    it('rounds down, so a rounding error never shortens what was paid for', () => {
      const credit = unusedCreditPaise({
        amountPaidPaise: 99_999, periodStart: march(1), periodEnd: march(31), at: march(11),
      });
      expect(Number.isInteger(credit)).toBe(true);
      expect(credit).toBeLessThanOrEqual(Math.ceil(99_999 * (20 / 30)));
    });
  });

  describe('credit expressed as days on the new plan', () => {
    it('converts a credit into whole days', () => {
      // Half a Starter quarter (₹1,349.50) against Growth quarterly
      // (₹8,099 over ~90 days ≈ ₹89.99/day) is about 14 days.
      expect(creditAsDays(134_950, 809_900, 'QUARTERLY')).toBe(14);
    });

    it('is nothing when there is nothing to carry over', () => {
      expect(creditAsDays(0, 809_900, 'QUARTERLY')).toBe(0);
    });

    it('gives more days on a cheaper plan than an expensive one', () => {
      // The same money buys more time on Starter than on Business.
      expect(creditAsDays(269_900, 269_900, 'QUARTERLY'))
        .toBeGreaterThan(creditAsDays(269_900, 2_159_900, 'QUARTERLY'));
    });
  });

  describe('applying a scheduled change', () => {
    it('moves the workspace onto the pending plan once it is due', async () => {
      await prisma.subscription.create({
        data: {
          tenantId: TENANT,
          plan: 'BUSINESS',
          interval: 'MONTHLY',
          status: 'ACTIVE',
          currentPeriodStart: new Date(Date.now() - 86_400_000 * 30),
          currentPeriodEnd: new Date(Date.now() - 1_000),
          pendingPlan: 'STARTER',
          pendingInterval: 'MONTHLY',
          pendingEffectiveAt: new Date(Date.now() - 1_000),
        },
      });

      expect(await applyDueePlanChanges()).toBe(1);

      const after = await prisma.subscription.findUniqueOrThrow({ where: { tenantId: TENANT } });
      expect(after.plan).toBe('STARTER');
      expect(after.pendingPlan).toBeNull();
      expect(after.currentPeriodEnd!.getTime()).toBeGreaterThan(Date.now());
    });

    it('leaves a change that is not due yet alone', async () => {
      await prisma.subscription.create({
        data: {
          tenantId: TENANT,
          plan: 'BUSINESS',
          interval: 'MONTHLY',
          status: 'ACTIVE',
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 86_400_000 * 20),
          pendingPlan: 'STARTER',
          pendingInterval: 'MONTHLY',
          pendingEffectiveAt: new Date(Date.now() + 86_400_000 * 20),
        },
      });

      expect(await applyDueePlanChanges()).toBe(0);

      // Still on Business, and still entitled to it — they paid for it.
      const entitlements = await entitlementsFor(TENANT);
      expect(entitlements.plan).toBe('BUSINESS');
      expect(entitlements.teamMembers).toBe(20);
    });
  });
});

describe('AI overage', () => {
  const onStarter = (overrides: Record<string, unknown> = {}) => prisma.subscription.create({
    data: {
      tenantId: TENANT,
      plan: 'STARTER',
      interval: 'MONTHLY',
      status: 'ACTIVE',
      aiQuotaOverride: 3,
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 86_400_000 * 30),
      ...overrides,
    },
  });

  it('is free inside the quota', async () => {
    await onStarter();
    const allowance = await checkAiAllowance(TENANT);
    expect(allowance).toMatchObject({ allowed: true, billable: false, reason: 'WITHIN_QUOTA' });
  });

  it('charges past the quota at the plan rate', async () => {
    await onStarter();
    await recordAiInteraction(TENANT, { count: 3 });

    const allowance = await checkAiAllowance(TENANT);
    expect(allowance).toMatchObject({ allowed: true, billable: true, reason: 'OVERAGE' });
    expect(allowance.ratePaise).toBe(OVERAGE.STARTER.ratePaise);
  });

  it('accrues at the rate in force when the interaction happened', async () => {
    await onStarter();
    await recordAiInteraction(TENANT, { count: 3 });
    await recordAiInteraction(TENANT, { billableRatePaise: 100 });
    await recordAiInteraction(TENANT, { billableRatePaise: 100 });

    const usage = await usageFor(TENANT);
    expect(usage.used).toBe(5);
    expect(usage.overageInteractions).toBe(2);
    expect(usage.overagePaise).toBe(200);
  });

  it('stops at the cap rather than spending without limit', async () => {
    // ₹2 of headroom at ₹1 each: two chargeable interactions, then no more.
    await onStarter({ overageCapPaise: 200 });
    await recordAiInteraction(TENANT, { count: 3 });
    await recordAiInteraction(TENANT, { billableRatePaise: 100 });
    await recordAiInteraction(TENANT, { billableRatePaise: 100 });

    const allowance = await checkAiAllowance(TENANT);
    expect(allowance).toMatchObject({ allowed: false, reason: 'CAP_REACHED' });
    expect((await usageFor(TENANT)).capReached).toBe(true);
  });

  it('honours a cap of zero as "never spend beyond my plan"', async () => {
    // `??` not `||`: a deliberate 0 must not fall through to the plan default.
    await onStarter({ overageCapPaise: 0 });
    await recordAiInteraction(TENANT, { count: 3 });

    const allowance = await checkAiAllowance(TENANT);
    expect(allowance.allowed).toBe(false);
    expect((await usageFor(TENANT)).overageCapPaise).toBe(0);
  });

  it('never charges a free workspace', async () => {
    // No committed spend to bill an excess against.
    await recordAiInteraction(TENANT, { count: 200 });
    const allowance = await checkAiAllowance(TENANT);
    expect(allowance).toMatchObject({ allowed: false, billable: false, reason: 'NO_OVERAGE_ON_FREE' });
  });

  it('uses the plan default when the tenant has set no cap', async () => {
    await onStarter();
    expect((await usageFor(TENANT)).overageCapPaise).toBe(OVERAGE.STARTER.defaultCapPaise);
  });

  it('bills nothing while the period is still running', async () => {
    await onStarter();
    await recordAiInteraction(TENANT, { count: 3 });
    await recordAiInteraction(TENANT, { billableRatePaise: 100 });
    // A running total that moves every hour is not reconcilable.
    expect(await billDueOverage()).toBe(0);
  });

  it('marks a period billed exactly once, even if the sweep runs again', async () => {
    await onStarter();
    await prisma.usageCounter.create({
      data: {
        tenantId: TENANT,
        periodStart: new Date(Date.now() - 86_400_000 * 60),
        periodEnd: new Date(Date.now() - 86_400_000 * 30),
        aiInteractions: 1_500,
        overageInteractions: 500,
        overagePaise: 50_000,
      },
    });

    // No live Razorpay subscription here, so it is marked rather than charged —
    // what matters is that it is not retried forever.
    await billDueOverage();
    const first = await prisma.usageCounter.findFirstOrThrow({
      where: { tenantId: TENANT, overagePaise: 50_000 },
    });
    expect(first.overageBilledAt).not.toBeNull();

    await billDueOverage();
    const second = await prisma.usageCounter.findFirstOrThrow({ where: { id: first.id } });
    expect(second.overageBilledAt?.getTime()).toBe(first.overageBilledAt?.getTime());
  });

  it('puts billed overage on the next invoice, once', async () => {
    await onStarter();
    await prisma.usageCounter.create({
      data: {
        tenantId: TENANT,
        periodStart: new Date(Date.now() - 86_400_000 * 60),
        periodEnd: new Date(Date.now() - 86_400_000 * 30),
        aiInteractions: 1_200,
        overageInteractions: 200,
        overagePaise: 20_000,
        overageBilledAt: new Date(),
      },
    });

    const price = await activePrice('STARTER', 'MONTHLY');
    const payment = await prisma.payment.create({
      data: {
        tenantId: TENANT, priceId: price.id, plan: 'STARTER', interval: 'MONTHLY',
        amountPaise: price.amountPaise, status: 'PAID', paidAt: new Date(),
      },
    });

    const invoice = await issueInvoiceForPayment({
      payment, periodStart: new Date(), periodEnd: new Date(),
    });

    expect(invoice.overagePaise).toBe(20_000);
    expect(invoice.totalPaise).toBe(price.amountPaise + 20_000);
    expect(invoice.notes.join(' ')).toContain('200 AI interactions above your included quota');

    // A second invoice must not carry the same overage again.
    const next = await prisma.payment.create({
      data: {
        tenantId: TENANT, priceId: price.id, plan: 'STARTER', interval: 'MONTHLY',
        amountPaise: price.amountPaise, status: 'PAID', paidAt: new Date(),
      },
    });
    const second = await issueInvoiceForPayment({
      payment: next, periodStart: new Date(), periodEnd: new Date(),
    });
    expect(second.overagePaise).toBe(0);
    expect(second.totalPaise).toBe(price.amountPaise);
  });
});

describe('nobody pays without the details the invoice legally needs', () => {
  /*
   * A GST tax invoice must name a place of supply, and the buyer's state decides CGST+SGST
   * versus IGST. Neither was ever required: `checkoutSchema` marked both optional, the Billing
   * page collected no address at all, and the frontend sent only `{ plan, interval }`.
   *
   * So every invoice would have been issued with `placeOfSupply: null`, and a buyer in the
   * seller's own state charged IGST instead of CGST+SGST — right total, wrong tax heads, wrong
   * in the seller's GSTR-1 and in the buyer's input credit. Invoices here are deliberately
   * immutable and cannot be regenerated, so the only place to catch it is before the charge.
   */

  /*
   * Every assertion here is about a REGISTERED seller.
   *
   * `assertBillableIdentity` requires the buyer's state only when
   * `sellerTaxIdentity().registered` — an unregistered seller issues no tax invoice and so has
   * no place of supply to name. That gate is deliberate: requiring `gstStateCode`
   * unconditionally would deadlock checkout, because the state selector is only shown once the
   * seller is registered.
   *
   * So the seller identity has to be set here rather than inherited. `sellerTaxIdentity()`
   * reads `process.env` at the point of use precisely so it can be, and the same
   * save/set/restore appears in `gst.test.ts` and `invoice-gst.integration.test.ts`.
   *
   * Leaving it ambient is what broke the pipeline: a developer machine has `COMPANY_GSTIN` in
   * its `.env`, a fresh CI clone has no `.env` at all, so these two passed locally and failed
   * on the first real run.
   */
  const TELANGANA_GSTIN = '36AABCU9603R1ZM';
  let savedSeller: { gstin?: string; stateCode?: string };

  beforeAll(() => {
    savedSeller = { gstin: process.env.COMPANY_GSTIN, stateCode: process.env.COMPANY_STATE_CODE };
    process.env.COMPANY_GSTIN = TELANGANA_GSTIN;
    process.env.COMPANY_STATE_CODE = '36';
  });

  afterAll(() => {
    // `delete` rather than assigning undefined: the latter leaves the key present with the
    // string "undefined", which reads as configured.
    if (savedSeller.gstin === undefined) delete process.env.COMPANY_GSTIN;
    else process.env.COMPANY_GSTIN = savedSeller.gstin;
    if (savedSeller.stateCode === undefined) delete process.env.COMPANY_STATE_CODE;
    else process.env.COMPANY_STATE_CODE = savedSeller.stateCode;
  });

  const withAddress = (over: Record<string, string | null> = {}) => prisma.tenant.update({
    where: { id: TENANT },
    data: {
      billingAddressLine1: '12 Road No. 36, Jubilee Hills',
      billingCity: 'Hyderabad',
      billingPostalCode: '500033',
      billingCountry: 'IN',
      gstStateCode: '36',
      ...over,
    },
  });

  /**
   * Attempt a real checkout over HTTP.
   *
   * Through the Express app rather than by calling the handler with a fake `req`: `tenantIdOf`
   * reads `req.tenantId`, which the auth middleware sets, so a hand-rolled request object only
   * ever produces a 401 and proves nothing about the gate. This also exercises the permission
   * and the rate limiter that sit in front of it.
   */
  const attemptCheckout = () => request(buildApp())
    .post('/api/billing/checkout')
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({ plan: 'STARTER', interval: 'QUARTERLY' });

  it('**refuses checkout when no billing address has ever been given**', async () => {
    // The state this bug shipped in: a brand-new workspace, nothing captured, straight to pay.
    const res = await attemptCheckout();
    expect(res.status).toBe(422);
    expect(res.body.details.code).toBe('BILLING_ADDRESS_REQUIRED');
  });

  it('names every field that is missing, so the form can ask once', async () => {
    // Refusing five times in a row, one field at a time, is worse than not refusing at all.
    const res = await attemptCheckout();
    expect(res.body.details.missing).toEqual(['address', 'city', 'postal code', 'country', 'state']);
  });

  it('**refuses when the address is complete but the state is not**', async () => {
    /*
     * The case that makes this more than a form-validation nicety. A full postal address with
     * no `gstStateCode` looks complete to a human and is useless to the invoice: the state is
     * the only field that decides the tax split, and the address block has no state of its own.
     */
    await withAddress({ gstStateCode: null });
    const res = await attemptCheckout();
    expect(res.status).toBe(422);
    expect(res.body.details).toMatchObject({ code: 'BILLING_ADDRESS_REQUIRED', missing: ['state'] });
  });

  it('refuses on each individually missing field', async () => {
    const cases: Array<[string, Record<string, string | null>]> = [
      ['address', { billingAddressLine1: null }],
      ['city', { billingCity: null }],
      ['postal code', { billingPostalCode: null }],
      ['country', { billingCountry: null }],
    ];
    for (const [label, clear] of cases) {
      // eslint-disable-next-line no-await-in-loop
      await withAddress(clear);
      // eslint-disable-next-line no-await-in-loop
      const res = await attemptCheckout();
      expect(res.body.details?.missing, `missing ${label}`).toEqual([label]);
    }
  });

  it('**does not require a GSTIN** — an unregistered business is an ordinary customer', async () => {
    /*
     * Deliberate. Only the state changes the tax split; a GSTIN does not. Requiring one would
     * turn away every small business that is not registered, which is a real part of the market.
     * The address is set here and `gstin` left null, and the refusal must not fire.
     */
    await withAddress({ gstin: null });
    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: TENANT } });
    expect(tenant.gstin).toBeNull();
    // Gets past the identity gate. It still fails afterwards, on Razorpay not being configured
    // under test — a different error, which is exactly what proves the gate let it through.
    const res = await attemptCheckout();
    expect(res.body.details?.code).not.toBe('BILLING_ADDRESS_REQUIRED');
  });

  it('**does not demand a state when the seller charges no tax**', async () => {
    /*
     * The deadlock this nearly shipped with.
     *
     * `getTaxDetails` returns `gst: null` for a seller with no GSTIN, and the Billing form hides
     * the state selector in that case — there is no place of supply to record when no tax is
     * charged. An unconditional state requirement would then be unsatisfiable: refused forever,
     * with no field anywhere on the page that could clear it.
     *
     * Skipped rather than faked when the test environment *is* registered, because the seller
     * identity is read from the process environment and rewriting it here would make the rest of
     * the suite depend on the order tests ran in.
     */
    const { sellerTaxIdentity } = await import('./gst.js');
    if (sellerTaxIdentity().registered) {
      expect(sellerTaxIdentity().stateCode).toBeTruthy();
      return;
    }

    await withAddress({ gstStateCode: null });
    const res = await attemptCheckout();
    expect(res.body.details?.missing ?? []).not.toContain('state');
  });

  it('lets a complete address through', async () => {
    await withAddress();
    const res = await attemptCheckout();
    expect(res.body.details?.code).not.toBe('BILLING_ADDRESS_REQUIRED');
  });
});
