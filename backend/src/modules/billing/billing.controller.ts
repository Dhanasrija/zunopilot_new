import type { Request, Response } from 'express';
import type { BillingInterval as PrismaInterval, PlanCode as PrismaPlan } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../config/prisma.js';
import { logger } from '../../config/logger.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ApiError } from '../../utils/ApiError.js';
import { tenantIdOf, userOf } from '../../middleware/auth.js';
import {
  BILLING_INTERVALS, CURRENCY, DEFAULT_INTERVAL, DISCLOSURES, INTERVAL_META,
  PLANS, PLAN_CODES, TAX_TREATMENT, classifyPlanChange, creditAsDays, effectiveMonthlyPaise,
  planByCode, savingsPercent, unusedCreditPaise,
  type BillingInterval, type PlanCode,
} from './catalogue.js';
import {
  BillingError, activePrice, addInterval, entitlementsFor, razorpayPlanIdFor, usageFor,
} from './billing.service.js';
import {
  addSubscriptionAddon, cancelSubscription, createSubscription, publicKeyId,
  razorpayConfigured, updateSubscriptionPlan, verifyPaymentSignature,
} from './razorpay.js';
import { issueInvoiceForPayment } from './invoice.service.js';
import {
  GST_RATE_PERCENT, GST_STATES, grossPaise, isGstin, sellerTaxIdentity, stateCodeOfGstin,
} from './gst.js';

// Billing endpoints.
//
// The one rule to keep in mind reading this file: **a request never carries an
// amount, a limit or a Razorpay plan id.** Checkout takes a plan code and an
// interval — two enums — and everything else is resolved server-side from the
// price catalogue and the environment. There is nothing here for a browser to
// tamper with that would change what it is charged.

const planEnum = z.enum(PLAN_CODES);
const intervalEnum = z.enum(BILLING_INTERVALS);

const checkoutSchema = z.object({
  plan: planEnum,
  interval: intervalEnum,
  /**
   * Buyer tax details. Optional, because a customer without a GST registration
   * is a perfectly normal customer — but the state decides CGST+SGST vs IGST,
   * and a buyer who supplies neither is charged IGST, which is the safe default.
   *
   * Still nothing about money: these change how tax is *split*, never the rate
   * or the amount.
   */
  gstin: z.string().trim().max(20).optional(),
  gstStateCode: z.string().trim().regex(/^[0-9]{2}$/).optional(),
});

const verifySchema = z.object({
  razorpayPaymentId: z.string().min(1).max(120),
  razorpaySubscriptionId: z.string().min(1).max(120),
  razorpaySignature: z.string().min(1).max(200),
});

const assignSchema = z.object({
  // Shape, not RFC 4122. Zod's `.uuid()` enforces the version and variant
  // nibbles, and ids that Postgres accepts perfectly well — including the
  // readable ones the demo seeds use — do not satisfy it. The id is checked
  // against the database on the next line anyway, which is the check that
  // actually matters.
  tenantId: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'Not a workspace id'),
  plan: planEnum,
  interval: intervalEnum.default('YEARLY'),
  note: z.string().max(500).optional(),
  seatLimit: z.number().int().min(1).max(10_000).nullish(),
  numberLimit: z.number().int().min(1).max(1_000).nullish(),
  automationLimit: z.number().int().min(1).max(100_000).nullish(),
  aiQuota: z.number().int().min(0).max(100_000_000).nullish(),
  months: z.number().int().min(1).max(120).optional(),
});

/**
 * The public catalogue.
 *
 * Amounts in paise, plus the derived display values so every surface shows the
 * same numbers. `savingsPercent` and `effectiveMonthly` are computed *from* the
 * approved prices — nothing here produces a price from a percentage.
 */
export const getCatalogue = asyncHandler(async (_req: Request, res: Response) => {
  const prices = await prisma.price.findMany({ where: { archivedAt: null } });
  const amountOf = (plan: PlanCode, interval: BillingInterval) =>
    prices.find((p) => p.plan === plan && p.interval === interval)?.amountPaise ?? null;

  res.json({
    success: true,
    data: {
      currency: CURRENCY,
      taxTreatment: TAX_TREATMENT,
      defaultInterval: DEFAULT_INTERVAL,
      intervals: BILLING_INTERVALS.map((interval) => ({
        code: interval,
        ...INTERVAL_META[interval],
      })),
      disclosures: {
        // While no GSTIN is configured no tax is charged, so the page must keep
        // saying taxes are separate rather than promising a line nobody will see.
        tax: sellerTaxIdentity().registered
          ? DISCLOSURES.metaCharges
          : DISCLOSURES.tax,
        aiOverage: DISCLOSURES.aiOverage,
        upfront: Object.fromEntries(
          BILLING_INTERVALS.map((interval) => [interval, DISCLOSURES.upfront(interval)]),
        ),
      },
      /** Null when the seller is not GST-registered, so the page shows no tax. */
      gst: sellerTaxIdentity().registered
        ? { ratePercent: GST_RATE_PERCENT, note: DISCLOSURES.gstOnTop(GST_RATE_PERCENT) }
        : null,
      plans: PLANS.map((plan) => ({
        code: plan.code,
        name: plan.name,
        tagline: plan.tagline,
        includes: plan.includes,
        selfServe: plan.selfServe,
        badges: plan.badges,
        recommended: plan.recommended,
        entitlements: plan.entitlements,
        prices: BILLING_INTERVALS.reduce<Record<string, unknown>>((acc, interval) => {
          // Read from the database, not the catalogue constant — the DB is what
          // checkout will charge, and if the two ever disagree the page must
          // show the one that will be billed.
          const amountPaise = amountOf(plan.code, interval);
          if (amountPaise === null) return acc;
          acc[interval] = {
            amountPaise,
            effectiveMonthlyPaise: effectiveMonthlyPaise(amountPaise, interval),
            savingsPercent: savingsPercent(plan, interval),
            // What the card will actually charge. Served rather than computed in
            // the page, for the same reason the price is: one source, read at
            // runtime, so a quote and a charge cannot drift.
            payablePaise: grossPaise(amountPaise, null),
          };
          return acc;
        }, {}),
      })),
    },
  });
});

/** The workspace's plan, limits, usage and invoices. */
export const getSubscription = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = tenantIdOf(req);

  const [subscription, entitlements, usage, invoices, counts] = await Promise.all([
    prisma.subscription.findUnique({ where: { tenantId } }),
    entitlementsFor(tenantId),
    usageFor(tenantId),
    prisma.invoice.findMany({
      where: { tenantId },
      orderBy: { issuedAt: 'desc' },
      take: 50,
      select: {
        id: true, number: true, planName: true, intervalLabel: true,
        periodStart: true, periodEnd: true, totalPaise: true, currency: true, issuedAt: true,
      },
    }),
    Promise.all([
      prisma.user.count({ where: { tenantId, isActive: true } }),
      prisma.whatsappAccount.count({ where: { tenantId } }),
      prisma.workflow.count({ where: { tenantId, status: 'PUBLISHED' } }),
    ]),
  ]);

  const [teamMembers, whatsappNumbers, activeAutomations] = counts;

  res.json({
    success: true,
    data: {
      subscription: subscription && {
        plan: subscription.plan,
        interval: subscription.interval,
        status: subscription.status,
        currentPeriodStart: subscription.currentPeriodStart,
        currentPeriodEnd: subscription.currentPeriodEnd,
        cancelledAt: subscription.cancelledAt,
        assignedNote: subscription.assignedNote,
        // What the customer has asked for that has not happened yet, so the
        // page can say so rather than looking like the change was ignored.
        pendingChange: subscription.pendingPlan
          ? {
            plan: subscription.pendingPlan,
            interval: subscription.pendingInterval,
            effectiveAt: subscription.pendingEffectiveAt,
          }
          : null,
      },
      entitlements,
      usage,
      // Current consumption against each limit, so the billing page can show
      // what is nearly full rather than only what is allowed.
      consumption: { teamMembers, whatsappNumbers, activeAutomations },
      invoices,
      razorpayConfigured: razorpayConfigured(),
      disclosures: { tax: DISCLOSURES.tax, aiOverage: DISCLOSURES.aiOverage },
    },
  });
});

/**
 * Start a checkout.
 *
 * Takes two enums. The amount comes from the active price row, the Razorpay
 * plan id comes from the environment, and the browser is told only the public
 * key id and the subscription id it needs to open the modal.
 */
/**
 * Store the buyer's tax details and return the state code that applies.
 *
 * A supplied GSTIN wins over a supplied state code, because the registration
 * number encodes the state and is the authoritative one when they disagree. An
 * omitted field leaves whatever is already stored alone — someone re-subscribing
 * should not lose their GSTIN by not retyping it.
 */
const rememberBuyerTaxDetails = async (
  tenantId: string,
  body: { gstin?: string; gstStateCode?: string },
): Promise<string | null> => {
  const gstin = body.gstin?.toUpperCase() || undefined;
  if (gstin && !isGstin(gstin)) throw ApiError.badRequest('That does not look like a GSTIN');

  const fromGstin = stateCodeOfGstin(gstin ?? null);
  const stateCode = fromGstin
    ?? (body.gstStateCode && GST_STATES[body.gstStateCode] ? body.gstStateCode : undefined);

  if (gstin || stateCode) {
    await prisma.tenant.update({
      where: { id: tenantId },
      data: {
        ...(gstin ? { gstin } : {}),
        ...(stateCode ? { gstStateCode: stateCode } : {}),
      },
    });
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { gstStateCode: true },
  });
  return tenant?.gstStateCode ?? null;
};

/**
 * Refuse to take money without the details the invoice legally needs.
 *
 * A GST tax invoice must name a place of supply, and the buyer's state is what decides whether
 * the tax is CGST+SGST or IGST. Neither was ever required: `checkoutSchema` marked `gstin` and
 * `gstStateCode` optional, the Billing page collected no address at all, and so every invoice
 * would have been issued with `placeOfSupply: null` and the inter-state default — charging IGST
 * to a buyer in the seller's own state. The total would have been right and the tax heads wrong,
 * in the seller's GSTR-1 and in the buyer's input credit.
 *
 * That is not recoverable after the fact. Invoices here are deliberately immutable and cannot be
 * regenerated from anything else in the system, so the only place to catch it is before the
 * charge. Hence a refusal rather than a warning.
 *
 * **GSTIN stays optional.** A customer without a GST registration is an ordinary customer; only
 * the state is needed, because only the state changes the split. When a GSTIN *is* given its
 * first two digits win over the typed state — the registration is the authority on where a
 * business is.
 *
 * Called on both paths that can result in a charge. A gate on checkout alone would be bypassed
 * by anyone who signed up on the free allowance and then changed plan.
 */
const assertBillableIdentity = async (tenantId: string): Promise<void> => {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: {
      gstStateCode: true,
      billingAddressLine1: true,
      billingCity: true,
      billingPostalCode: true,
      billingCountry: true,
    },
  });
  if (!tenant) throw ApiError.badRequest('Workspace not found');

  /*
   * The state is required **only when we are actually charging tax**, and that condition is
   * load-bearing rather than a nicety.
   *
   * `getTaxDetails` returns `gst: null` when the seller has no GSTIN, and the Billing form hides
   * the state selector in exactly that case — correctly, since with no tax there is no place of
   * supply to record. Demanding the state unconditionally therefore asks for a value the UI never
   * offers, and checkout deadlocks: refused forever, with no field on the page that could satisfy
   * it. The first version of this function did precisely that.
   *
   * The address itself is always required. It appears on every invoice, taxable or not.
   */
  const taxable = sellerTaxIdentity().registered;

  const missing = [
    !tenant.billingAddressLine1 && 'address',
    !tenant.billingCity && 'city',
    !tenant.billingPostalCode && 'postal code',
    !tenant.billingCountry && 'country',
    taxable && !tenant.gstStateCode && 'state',
  ].filter(Boolean) as string[];

  if (missing.length) {
    // A specific code, not just a message: the Billing page opens its address step on this
    // rather than string-matching a sentence that will be reworded eventually.
    throw ApiError.unprocessable(
      `Add your billing ${missing.join(', ')} before paying — it goes on the GST invoice.`,
      { code: 'BILLING_ADDRESS_REQUIRED', missing },
    );
  }
};

const taxDetailsSchema = z.object({
  /** Empty string clears it — a workspace can stop being registered. */
  gstin: z.string().trim().max(20),
  gstStateCode: z.string().trim().regex(/^[0-9]{2}$/).optional(),

  /**
   * The billing address, collected here rather than at signup.
   *
   * Nobody signing up knows or cares about this; it is needed at the moment they
   * pay. All optional, because a workspace on the free allowance has no reason to
   * fill it in — the invoice simply omits what it does not have.
   */
  billingAddressLine1: z.string().trim().max(200).optional(),
  billingAddressLine2: z.string().trim().max(200).optional(),
  billingCity: z.string().trim().max(100).optional(),
  billingPostalCode: z.string().trim().max(20).optional(),
  billingCountry: z.string().trim().length(2).toUpperCase().optional(),
});

/** The workspace's own tax details, and the states it may choose from. */
export const getTaxDetails = asyncHandler(async (req: Request, res: Response) => {
  const tenant = await prisma.tenant.findUniqueOrThrow({
    where: { id: tenantIdOf(req) },
    select: {
      gstin: true, gstStateCode: true, billingAddressLine1: true, billingAddressLine2: true,
      billingCity: true, billingPostalCode: true, billingCountry: true,
      users: {
        where: { role: 'OWNER', isActive: true },
        take: 1,
        orderBy: { createdAt: 'asc' },
        select: { country: true },
      },
    },
  });
  const seller = sellerTaxIdentity();

  res.json({
    success: true,
    data: {
      gstin: tenant.gstin,
      gstStateCode: tenant.gstStateCode,
      stateName: tenant.gstStateCode ? GST_STATES[tenant.gstStateCode] ?? null : null,
      billingAddressLine1: tenant.billingAddressLine1,
      billingAddressLine2: tenant.billingAddressLine2,
      billingCity: tenant.billingCity,
      billingPostalCode: tenant.billingPostalCode,
      // Defaults to the owner's country, which was derived from their phone at
      // signup — so the field arrives filled in rather than blank.
      billingCountry: tenant.billingCountry ?? tenant.users[0]?.country ?? null,
      states: Object.entries(GST_STATES)
        .map(([code, name]) => ({ code, name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      // What the buyer needs to understand why this matters at all.
      gst: seller.registered
        ? { ratePercent: GST_RATE_PERCENT, sellerState: seller.stateName }
        : null,
    },
  });
});

/**
 * Save the workspace's GSTIN and state.
 *
 * Neither changes what they pay — the rate is the same in every state — only how
 * the tax is split on their invoice and whether they can claim it back. Saying
 * so on the form stops this looking like a price-affecting field.
 */
export const updateTaxDetails = asyncHandler(async (req: Request, res: Response) => {
  const body = taxDetailsSchema.parse(req.body);
  const tenantId = tenantIdOf(req);

  const gstin = body.gstin.toUpperCase();
  if (gstin && !isGstin(gstin)) throw ApiError.badRequest('That does not look like a GSTIN');

  const fromGstin = stateCodeOfGstin(gstin || null);
  const stateCode = fromGstin
    ?? (body.gstStateCode && GST_STATES[body.gstStateCode] ? body.gstStateCode : null);

  const tenant = await prisma.tenant.update({
    where: { id: tenantId },
    data: {
      gstin: gstin || null,
      gstStateCode: stateCode,
      ...(body.billingAddressLine1 === undefined ? {} : { billingAddressLine1: body.billingAddressLine1 || null }),
      ...(body.billingAddressLine2 === undefined ? {} : { billingAddressLine2: body.billingAddressLine2 || null }),
      ...(body.billingCity === undefined ? {} : { billingCity: body.billingCity || null }),
      ...(body.billingPostalCode === undefined ? {} : { billingPostalCode: body.billingPostalCode || null }),
      ...(body.billingCountry === undefined ? {} : { billingCountry: body.billingCountry || null }),
    },
    select: {
      gstin: true, gstStateCode: true, billingAddressLine1: true, billingAddressLine2: true,
      billingCity: true, billingPostalCode: true, billingCountry: true,
    },
  });

  logger.info('Tax details updated', { tenantId, stateCode: tenant.gstStateCode });

  res.json({
    success: true,
    data: {
      ...tenant,
      stateName: tenant.gstStateCode ? GST_STATES[tenant.gstStateCode] ?? null : null,
    },
  });
});

export const startCheckout = asyncHandler(async (req: Request, res: Response) => {
  const body = checkoutSchema.parse(req.body);
  const tenantId = tenantIdOf(req);

  let price;
  try {
    price = await activePrice(body.plan as PlanCode, body.interval as BillingInterval);
  } catch (err) {
    if (err instanceof BillingError) throw ApiError.badRequest(err.message);
    throw err;
  }

  // Remember who they are for tax before creating anything, so the state is
  // already stored when the invoice is issued — possibly by a webhook that
  // arrives while the browser is still on the Razorpay modal.
  const buyerStateCode = await rememberBuyerTaxDetails(tenantId, body);
  // After persisting whatever this request supplied, not before — the checkout step is
  // allowed to be the moment the address arrives.
  await assertBillableIdentity(tenantId);

  const planId = razorpayPlanIdFor(body.plan as PlanCode, body.interval as BillingInterval);

  let subscription;
  try {
    subscription = await createSubscription({
      planId,
      notes: { tenantId, plan: body.plan, interval: body.interval },
    });
  } catch (err) {
    if (err instanceof BillingError) throw ApiError.unprocessable(err.message);
    throw err;
  }

  // Recorded before the customer pays, so a webhook that arrives before the
  // browser callback has something to attach to.
  const payment = await prisma.payment.create({
    data: {
      tenantId,
      priceId: price.id,
      plan: body.plan as PrismaPlan,
      interval: body.interval as PrismaInterval,
      // What Razorpay will actually collect — the approved price plus GST. A
      // Payment records money that moved, so it is the gross; the taxable value
      // stays on the immutable `Price` row this points at.
      amountPaise: grossPaise(price.amountPaise, buyerStateCode),
      currency: price.currency,
      status: 'CREATED',
      razorpayOrderId: subscription.id,
    },
  });

  logger.info('Checkout started', {
    tenantId, plan: body.plan, interval: body.interval, amountPaise: price.amountPaise,
  });

  res.status(201).json({
    success: true,
    data: {
      keyId: publicKeyId(),
      subscriptionId: subscription.id,
      paymentRecordId: payment.id,
      // Both numbers, each named for what it is.
      //
      // This used to be one field called `amountPaise` holding the *taxable*
      // value, described as the summary the customer sees — while Razorpay's
      // modal collects the gross. Nothing rendered it, so nobody was quoted the
      // wrong total, but a field named like `Payment.amountPaise` (which is the
      // gross) and holding the other number is a mismatch waiting for its first
      // consumer.
      payablePaise: payment.amountPaise,
      taxablePaise: price.amountPaise,
      currency: price.currency,
      plan: body.plan,
      interval: body.interval,
      upfrontNote: DISCLOSURES.upfront(body.interval as BillingInterval),
    },
  });
});

/**
 * Confirm a checkout the browser says succeeded.
 *
 * The signature is what makes this believable. Without it the endpoint would
 * grant a plan to anyone who can POST a plausible payment id.
 */
export const verifyCheckout = asyncHandler(async (req: Request, res: Response) => {
  const body = verifySchema.parse(req.body);
  const tenantId = tenantIdOf(req);

  const ok = verifyPaymentSignature({
    paymentId: body.razorpayPaymentId,
    subscriptionId: body.razorpaySubscriptionId,
    signature: body.razorpaySignature,
  });

  if (!ok) {
    logger.warn('Rejected a payment confirmation with a bad signature', { tenantId });
    throw ApiError.badRequest('That payment could not be verified.');
  }

  const payment = await prisma.payment.findFirst({
    where: { tenantId, razorpayOrderId: body.razorpaySubscriptionId },
  });
  if (!payment) throw ApiError.notFound('No matching checkout for this workspace');

  const result = await activateFromPayment(payment.id, body.razorpayPaymentId);
  res.json({ success: true, data: result });
});

/**
 * Mark a payment paid, move the subscription on, and issue the invoice.
 *
 * Shared by the browser callback and the webhook, and idempotent — whichever
 * arrives first does the work and the second is a no-op. Both routinely arrive.
 */
export const activateFromPayment = async (paymentId: string, razorpayPaymentId: string) => {
  const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });

  if (payment.status === 'PAID') {
    const invoice = await prisma.invoice.findUnique({ where: { paymentId: payment.id } });
    return { alreadyProcessed: true, invoiceNumber: invoice?.number ?? null };
  }

  const start = new Date();
  const end = addInterval(start, payment.interval as BillingInterval);

  const subscription = await prisma.subscription.upsert({
    where: { tenantId: payment.tenantId },
    create: {
      tenantId: payment.tenantId,
      plan: payment.plan,
      interval: payment.interval,
      status: 'ACTIVE',
      priceId: payment.priceId,
      currentPeriodStart: start,
      currentPeriodEnd: end,
      razorpaySubscriptionId: payment.razorpayOrderId,
    },
    update: {
      plan: payment.plan,
      interval: payment.interval,
      status: 'ACTIVE',
      priceId: payment.priceId,
      currentPeriodStart: start,
      currentPeriodEnd: end,
      razorpaySubscriptionId: payment.razorpayOrderId,
      cancelledAt: null,
    },
  });

  const paid = await prisma.payment.update({
    where: { id: payment.id },
    data: {
      status: 'PAID',
      razorpayPaymentId,
      paidAt: new Date(),
      subscriptionId: subscription.id,
    },
  });

  const invoice = await issueInvoiceForPayment({ payment: paid, periodStart: start, periodEnd: end });

  logger.info('Subscription activated', {
    tenantId: payment.tenantId, plan: payment.plan, invoice: invoice.number,
  });

  return { alreadyProcessed: false, invoiceNumber: invoice.number, plan: payment.plan };
};

export const cancelPlan = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = tenantIdOf(req);
  const subscription = await prisma.subscription.findUnique({ where: { tenantId } });
  if (!subscription) throw ApiError.notFound('No subscription to cancel');

  if (subscription.razorpaySubscriptionId && razorpayConfigured()) {
    // At cycle end, not immediately — they paid for the period they are in.
    try {
      await cancelSubscription(subscription.razorpaySubscriptionId, true);
    } catch (err) {
      logger.error('Razorpay cancellation failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  await prisma.subscription.update({
    where: { tenantId },
    data: { status: 'CANCELLED', cancelledAt: new Date() },
  });

  res.json({
    success: true,
    data: { activeUntil: subscription.currentPeriodEnd },
  });
});

/**
 * Assign a plan without a payment.
 *
 * How Enterprise is delivered, and how any negotiated arrangement is recorded.
 * Deliberately requires the acting user's id and a note on the row, because an
 * unexplained free Business plan is the kind of thing someone has to be able to
 * ask about later.
 */
export const assignPlan = asyncHandler(async (req: Request, res: Response) => {
  const body = assignSchema.parse(req.body);
  const actor = userOf(req);

  const tenant = await prisma.tenant.findUnique({ where: { id: body.tenantId } });
  if (!tenant) throw ApiError.notFound('Workspace not found');

  const start = new Date();
  const end = new Date(start);
  end.setMonth(end.getMonth() + (body.months ?? 12));

  const subscription = await prisma.subscription.upsert({
    where: { tenantId: body.tenantId },
    create: {
      tenantId: body.tenantId,
      plan: body.plan as PrismaPlan,
      interval: body.interval as PrismaInterval,
      status: 'MANUAL',
      currentPeriodStart: start,
      currentPeriodEnd: end,
      seatLimitOverride: body.seatLimit ?? null,
      numberLimitOverride: body.numberLimit ?? null,
      automationLimitOverride: body.automationLimit ?? null,
      aiQuotaOverride: body.aiQuota ?? null,
      assignedByUserId: actor.id,
      assignedNote: body.note ?? null,
    },
    update: {
      plan: body.plan as PrismaPlan,
      interval: body.interval as PrismaInterval,
      status: 'MANUAL',
      currentPeriodStart: start,
      currentPeriodEnd: end,
      seatLimitOverride: body.seatLimit ?? null,
      numberLimitOverride: body.numberLimit ?? null,
      automationLimitOverride: body.automationLimit ?? null,
      aiQuotaOverride: body.aiQuota ?? null,
      assignedByUserId: actor.id,
      assignedNote: body.note ?? null,
      cancelledAt: null,
    },
  });

  logger.info('Plan assigned manually', {
    tenantId: body.tenantId, plan: body.plan, by: actor.id,
  });

  res.json({ success: true, data: subscription });
});

/** One invoice, for the printable view. */
export const getInvoice = asyncHandler(async (req: Request, res: Response) => {
  const invoice = await prisma.invoice.findFirst({
    where: { id: req.params.invoiceId, tenantId: tenantIdOf(req) },
  });
  if (!invoice) throw ApiError.notFound('Invoice not found');

  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: invoice.tenantId } });
  res.json({
    success: true,
    data: { invoice, seller: { name: tenant.businessName } },
  });
});

/**
 * Razorpay's webhook.
 *
 * The authority, because it does not depend on the customer's browser staying
 * open — a customer who pays and immediately closes the tab still gets their
 * plan. Signed over the raw body; see the route for why that has to be kept.
 */
export const razorpayWebhook = asyncHandler(async (req: Request, res: Response) => {
  const signature = String(req.headers['x-razorpay-signature'] ?? '');
  const raw = (req as Request & { rawBody?: Buffer }).rawBody;

  const { verifyWebhookSignature } = await import('./razorpay.js');
  if (!raw || !verifyWebhookSignature(raw, signature)) {
    logger.warn('Rejected an unsigned or mis-signed Razorpay webhook');
    throw ApiError.unauthorized('Invalid signature');
  }

  const event = req.body as {
    event?: string;
    payload?: {
      payment?: { entity?: { id?: string; order_id?: string } };
      subscription?: { entity?: { id?: string; status?: string } };
    };
  };

  // Acknowledge fast. Razorpay retries on anything but a 2xx, and a slow
  // handler turns one payment into a queue of duplicate deliveries.
  res.json({ success: true });

  try {
    const subscriptionId = event.payload?.subscription?.entity?.id;
    const razorpayPaymentId = event.payload?.payment?.entity?.id;

    if (event.event === 'subscription.charged' && subscriptionId && razorpayPaymentId) {
      const payment = await prisma.payment.findFirst({
        where: { razorpayOrderId: subscriptionId },
        orderBy: { createdAt: 'desc' },
      });
      if (payment) await activateFromPayment(payment.id, razorpayPaymentId);
      return;
    }

    if ((event.event === 'subscription.cancelled' || event.event === 'subscription.halted') && subscriptionId) {
      await prisma.subscription.updateMany({
        where: { razorpaySubscriptionId: subscriptionId },
        data: {
          status: event.event === 'subscription.cancelled' ? 'CANCELLED' : 'PAST_DUE',
          ...(event.event === 'subscription.cancelled' ? { cancelledAt: new Date() } : {}),
        },
      });
    }
  } catch (err) {
    logger.error('Razorpay webhook handling failed', {
      event: event.event,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

/**
 * Change plan mid-period.
 *
 * The policy, in one place:
 *
 *   • **An upgrade is immediate.** Someone who has hit a limit and wants to pay
 *     more should not wait for a renewal. The unused remainder of what they
 *     already paid is credited as extra days on the new plan — expressed as
 *     time rather than money because Razorpay subscriptions bill a fixed
 *     amount, so a discounted first charge would mean a refund or a stored
 *     balance to reconcile. Time needs neither and is exactly representable.
 *   • **A downgrade, and an interval switch, wait for period end.** They have
 *     paid for what they have; taking it away early is taking away something
 *     bought. Razorpay holds the same schedule (`cycle_end`), and the pending
 *     change is recorded here so the product can show it.
 *
 * The plan is changed **in place** on the existing Razorpay subscription. The
 * previous behaviour — create a second subscription and overwrite the id —
 * left the old one billing forever with nothing in our database pointing at it.
 */
export const changePlan = asyncHandler(async (req: Request, res: Response) => {
  const body = checkoutSchema.parse(req.body);
  const tenantId = tenantIdOf(req);

  const [subscription, entitlements] = await Promise.all([
    prisma.subscription.findUnique({ where: { tenantId } }),
    entitlementsFor(tenantId),
  ]);

  const kind = classifyPlanChange(
    { plan: entitlements.plan, interval: subscription?.interval as BillingInterval ?? null },
    { plan: body.plan as PlanCode, interval: body.interval as BillingInterval },
  );

  if (kind === 'NO_CHANGE') {
    throw ApiError.badRequest('That is already your current plan and billing period.');
  }

  // The same gate as checkout. Without it, anyone who started on the free allowance could reach
  // a charge through this route with no address on file.
  await assertBillableIdentity(tenantId);

  let price;
  try {
    price = await activePrice(body.plan as PlanCode, body.interval as BillingInterval);
  } catch (err) {
    if (err instanceof BillingError) throw ApiError.badRequest(err.message);
    throw err;
  }

  const live = subscription?.razorpaySubscriptionId
    && ['ACTIVE', 'PAST_DUE'].includes(subscription.status);

  // Nothing live to move: a free workspace, a manually assigned one, or a
  // checkout that was never completed. That is an ordinary first purchase.
  if (!live) {
    res.json({ success: true, data: { requiresCheckout: true, kind } });
    return;
  }

  const planId = razorpayPlanIdFor(body.plan as PlanCode, body.interval as BillingInterval);
  const when = kind === 'UPGRADE' ? 'now' : 'cycle_end';

  try {
    await updateSubscriptionPlan({
      subscriptionId: subscription!.razorpaySubscriptionId!,
      planId,
      when,
    });
  } catch (err) {
    if (err instanceof BillingError) {
      // A subscription Razorpay will not update — most often one that was never
      // authenticated. Fall back to a fresh checkout rather than leaving the
      // customer stuck on a screen that cannot do anything.
      logger.info('Falling back to checkout for a plan change', { tenantId, kind });
      res.json({ success: true, data: { requiresCheckout: true, kind, reason: err.message } });
      return;
    }
    throw err;
  }

  if (kind === 'UPGRADE') {
    const paidPaise = subscription!.priceId
      ? (await prisma.price.findUnique({ where: { id: subscription!.priceId } }))?.amountPaise ?? 0
      : 0;

    const credit = unusedCreditPaise({
      amountPaidPaise: paidPaise,
      periodStart: subscription!.currentPeriodStart,
      periodEnd: subscription!.currentPeriodEnd,
    });
    const bonusDays = creditAsDays(credit, price.amountPaise, body.interval as BillingInterval);

    const start = new Date();
    const end = addInterval(start, body.interval as BillingInterval);
    end.setDate(end.getDate() + bonusDays);

    const updated = await prisma.subscription.update({
      where: { tenantId },
      data: {
        plan: body.plan as PrismaPlan,
        interval: body.interval as PrismaInterval,
        priceId: price.id,
        status: 'ACTIVE',
        currentPeriodStart: start,
        currentPeriodEnd: end,
        // Applying an upgrade cancels anything that was scheduled — the
        // customer has changed their mind, and leaving a stale downgrade queued
        // would silently undo what they just paid for.
        pendingPlan: null,
        pendingInterval: null,
        pendingPriceId: null,
        pendingEffectiveAt: null,
      },
    });

    logger.info('Plan upgraded', { tenantId, plan: body.plan, creditPaise: credit, bonusDays });

    res.json({
      success: true,
      data: {
        kind,
        effective: 'IMMEDIATE',
        plan: updated.plan,
        interval: updated.interval,
        creditPaise: credit,
        bonusDays,
        currentPeriodEnd: updated.currentPeriodEnd,
      },
    });
    return;
  }

  const effectiveAt = subscription!.currentPeriodEnd ?? addInterval(new Date(), subscription!.interval as BillingInterval);

  const updated = await prisma.subscription.update({
    where: { tenantId },
    data: {
      pendingPlan: body.plan as PrismaPlan,
      pendingInterval: body.interval as PrismaInterval,
      pendingPriceId: price.id,
      pendingEffectiveAt: effectiveAt,
    },
  });

  logger.info('Plan change scheduled', { tenantId, plan: body.plan, kind, effectiveAt });

  res.json({
    success: true,
    data: {
      kind,
      effective: 'PERIOD_END',
      plan: updated.pendingPlan,
      interval: updated.pendingInterval,
      effectiveAt,
    },
  });
});

/** Call off a scheduled downgrade before it takes effect. */
export const cancelScheduledChange = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = tenantIdOf(req);
  const subscription = await prisma.subscription.findUnique({ where: { tenantId } });
  if (!subscription?.pendingPlan) throw ApiError.notFound('No scheduled change');

  if (subscription.razorpaySubscriptionId && razorpayConfigured()) {
    // Put Razorpay back on the current plan, or it will still switch at cycle
    // end and the two sides will disagree about what the customer is on.
    try {
      await updateSubscriptionPlan({
        subscriptionId: subscription.razorpaySubscriptionId,
        planId: razorpayPlanIdFor(subscription.plan as PlanCode, subscription.interval as BillingInterval),
        when: 'cycle_end',
      });
    } catch (err) {
      logger.error('Could not revert the scheduled change at Razorpay', {
        tenantId, error: err instanceof Error ? err.message : String(err),
      });
      throw ApiError.unprocessable(
        'Could not cancel the scheduled change with the payment provider. Try again shortly.',
      );
    }
  }

  await prisma.subscription.update({
    where: { tenantId },
    data: {
      pendingPlan: null, pendingInterval: null, pendingPriceId: null, pendingEffectiveAt: null,
    },
  });

  res.json({ success: true });
});

/**
 * Apply scheduled changes whose time has come.
 *
 * Razorpay switches the plan on its side at cycle end; this is what moves our
 * record and the customer's entitlements to match. Run on a schedule rather
 * than lazily on read, because a workspace nobody logs into still needs its
 * plan to be correct — the limits are enforced on the inbound message path,
 * which has no user in it.
 */
export const applyDueePlanChanges = async (): Promise<number> => {
  const due = await prisma.subscription.findMany({
    where: { pendingEffectiveAt: { not: null, lte: new Date() }, pendingPlan: { not: null } },
    take: 200,
  });

  for (const subscription of due) {
    const start = new Date();
    const end = addInterval(start, subscription.pendingInterval as BillingInterval);

    await prisma.subscription.update({
      where: { tenantId: subscription.tenantId },
      data: {
        plan: subscription.pendingPlan!,
        interval: subscription.pendingInterval!,
        priceId: subscription.pendingPriceId,
        currentPeriodStart: start,
        currentPeriodEnd: end,
        pendingPlan: null,
        pendingInterval: null,
        pendingPriceId: null,
        pendingEffectiveAt: null,
      },
    });

    logger.info('Scheduled plan change applied', {
      tenantId: subscription.tenantId, plan: subscription.pendingPlan,
    });
  }

  return due.length;
};

const capSchema = z.object({
  /** Paise. 0 means never spend beyond the plan; null restores the default. */
  overageCapPaise: z.number().int().min(0).max(50_000_000).nullable(),
});

/** Set how much this workspace is willing to spend on AI above its quota. */
export const setOverageCap = asyncHandler(async (req: Request, res: Response) => {
  const body = capSchema.parse(req.body);
  const tenantId = tenantIdOf(req);

  const subscription = await prisma.subscription.findUnique({ where: { tenantId } });
  if (!subscription) {
    throw ApiError.badRequest('A paid plan is needed before a spend cap means anything.');
  }

  await prisma.subscription.update({
    where: { tenantId },
    data: { overageCapPaise: body.overageCapPaise },
  });

  logger.info('Overage cap set', { tenantId, cap: body.overageCapPaise });
  res.json({ success: true, data: await usageFor(tenantId) });
});

/**
 * Bill accrued AI overage for periods that have ended.
 *
 * Pushed as an addon on the customer's own subscription, so it appears on their
 * next invoice against the mandate they already gave. Nothing is charged
 * mid-period: a running total that moves every hour is not something anyone can
 * reconcile, and it would turn one busy afternoon into a string of tiny
 * charges.
 *
 * Idempotent on `overageBilledAt` — a retry of this job must not bill twice.
 */
export const billDueOverage = async (): Promise<number> => {
  const due = await prisma.usageCounter.findMany({
    where: {
      periodEnd: { lte: new Date() },
      overagePaise: { gt: 0 },
      overageBilledAt: null,
    },
    take: 100,
  });

  let billed = 0;

  for (const counter of due) {
    const subscription = await prisma.subscription.findUnique({
      where: { tenantId: counter.tenantId },
    });

    // Nothing to attach a charge to. Marked as billed with no addon so it is
    // not retried forever; the accrual stays on the row for the record.
    if (!subscription?.razorpaySubscriptionId || !razorpayConfigured()) {
      await prisma.usageCounter.update({
        where: { id: counter.id },
        data: { overageBilledAt: new Date() },
      });
      logger.warn('Overage could not be billed — no live subscription', {
        tenantId: counter.tenantId, overagePaise: counter.overagePaise,
      });
      continue;
    }

    const buyer = await prisma.tenant.findUnique({
      where: { id: counter.tenantId },
      select: { gstStateCode: true },
    });
    const tenantStateCode = buyer?.gstStateCode ?? null;

    try {
      // The accrual is the *taxable* value — rate in force × interactions — so
      // the addon Razorpay charges must be its gross, exactly as the plan's own
      // amount is. Charging the bare accrual would collect no GST on overage
      // while the invoice showed some.
      const addon = await addSubscriptionAddon({
        subscriptionId: subscription.razorpaySubscriptionId,
        name: `AI usage above plan — ${counter.overageInteractions.toLocaleString('en-IN')} interactions`,
        amountPaise: grossPaise(counter.overagePaise, tenantStateCode),
      });

      await prisma.usageCounter.update({
        where: { id: counter.id },
        data: { overageBilledAt: new Date(), overageAddonId: addon.id },
      });
      billed += 1;

      logger.info('AI overage billed', {
        tenantId: counter.tenantId,
        interactions: counter.overageInteractions,
        paise: counter.overagePaise,
        addon: addon.id,
      });
    } catch (err) {
      // Left unbilled so the next sweep retries. Better a late charge than a
      // lost one or a duplicate.
      logger.error('Could not bill overage', {
        tenantId: counter.tenantId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return billed;
};
