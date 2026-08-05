import type { Payment, Prisma } from '@prisma/client';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { prisma } from '../../config/prisma.js';
import { logger } from '../../config/logger.js';
import { DISCLOSURES, INTERVAL_META, planByCode, type BillingInterval } from './catalogue.js';
import { computeGst, grossPaise, sellerTaxIdentity, GST_RATE_BPS, GST_STATES } from './gst.js';

// Invoicing.
//
// Two properties an invoice has to have, both of which shape the code:
//
//   • **It is a frozen record, not a view.** Everything shown is copied onto
//     the row at issue time — the plan name, the amount, who it was billed to.
//     Reading through to the live plan would mean last year's invoice silently
//     changes when a price does, which is the one thing an invoice must never
//     do.
//   • **The numbers have no gaps.** A missing number in a sequence is a
//     question an accountant has to answer, so the counter is allocated in the
//     same transaction that writes the row, and only ever for a payment that
//     actually succeeded. A failed or retried payment never consumes one.

const PREFIX = 'ZP';

/** How many times to re-attempt an invoice number lost to a concurrent issue. */
const MAX_SEQUENCE_ATTEMPTS = 10;

/** Which unique index a P2002 landed on, or `null` if it was not a P2002 at all. */
const collidedOn = (err: unknown): string | null => {
  if (!(err instanceof PrismaClientKnownRequestError) || err.code !== 'P2002') return null;
  return String((err.meta as { target?: string | string[] } | undefined)?.target ?? '');
};

/**
 * Two issues for the **same payment** — the webhook and the browser callback, which
 * `billing.controller.ts` notes both routinely arrive. Recoverable: return the winner's
 * invoice.
 */
const isPaymentCollision = (err: unknown): boolean => collidedOn(err)?.includes('paymentId') ?? false;

/**
 * Two issues for **different payments of one tenant** that read the same `max(sequence)`.
 * Retryable: this payment still needs an invoice, just with the next number.
 *
 * Telling these two apart is the entire fix. The old code treated every P2002 as the first
 * case, looked for an invoice against its own `paymentId`, found none, and gave up.
 */
const isSequenceCollision = (err: unknown): boolean => collidedOn(err)?.includes('sequence') ?? false;

export interface IssueInvoiceArgs {
  payment: Payment;
  periodStart: Date;
  periodEnd: Date;
}

/**
 * Whether GST was actually collected on this payment, and how it splits.
 *
 * The rule this enforces is the only one that really matters on an invoice:
 * **the total must equal what was charged.** GST is added on top of the listed
 * price (Venky's decision — ₹999 taxable, ₹1,178.82 collected), so a payment
 * that came in at the bare listed amount was taken on a pre-GST Razorpay plan
 * and no tax was collected on it. Claiming tax on that invoice would be a
 * document saying money changed hands that did not.
 *
 * Hence three cases, in order of how much is known:
 *
 *   1. The collected amount is the listed price **plus** 18% → GST-era plan.
 *      Tax is computed per line, matching how Razorpay charges the plan and each
 *      addon separately, so the invoice reconciles line by line.
 *   2. The collected amount **is** the listed price → pre-GST plan id. No tax
 *      line, and the old "billed separately" note stands. Existing subscribers
 *      keep getting correct invoices until they are migrated.
 *   3. Anything else — a negotiated Enterprise amount, or a cycle whose addons
 *      Razorpay folded in. The breakdown is genuinely unknown, so the tax is
 *      extracted from the collected amount rather than added to it. That is the
 *      one place this file back-computes, and it is deliberate: reconciling to
 *      the charge is worth more than insisting on the exclusive reading when we
 *      cannot see the lines.
 */
const resolveTax = ({
  collectedPaise, listedPaise, overagePaise, buyerStateCode,
}: {
  collectedPaise: number;
  listedPaise: number | null;
  overagePaise: number;
  buyerStateCode: string | null;
}) => {
  const seller = sellerTaxIdentity();

  const none = {
    subtotalPaise: collectedPaise,
    overagePaise,
    cgstPaise: 0,
    sgstPaise: 0,
    igstPaise: 0,
    taxPaise: 0,
    totalPaise: collectedPaise + overagePaise,
    ratePercent: 0,
    intraState: false,
    placeOfSupply: buyerStateCode ? GST_STATES[buyerStateCode] ?? null : null,
    taxable: false,
    seller,
  };

  if (!seller.registered) return none;

  // Case 2 — charged at the listed price, so no GST was collected.
  if (listedPaise !== null && collectedPaise === listedPaise) return none;

  // The taxable value of the plan line.
  //
  // Case 1 — the collected amount is the listed price plus GST, so the taxable
  // value is the listed price and nothing needs deriving.
  //
  // Case 3 — some other amount (a negotiated Enterprise charge, or a cycle whose
  // lines Razorpay folded together). Treat what was collected as GST-inclusive
  // and take the tax out of it, so the invoice still adds up to the charge.
  const planTaxable = listedPaise !== null
    && collectedPaise === grossPaise(listedPaise, buyerStateCode)
    ? listedPaise
    : collectedPaise - Math.round((collectedPaise * GST_RATE_BPS) / (10_000 + GST_RATE_BPS));

  // Overage is always a taxable accrual — `rate in force × interactions` — and
  // the addon Razorpay charged for it was created at its gross. So it is a
  // second line, never folded into the plan's.
  const plan = computeGst({ taxablePaise: planTaxable, buyerStateCode });
  const overage = computeGst({ taxablePaise: overagePaise, buyerStateCode });

  return {
    subtotalPaise: planTaxable,
    overagePaise,
    cgstPaise: plan.cgstPaise + overage.cgstPaise,
    sgstPaise: plan.sgstPaise + overage.sgstPaise,
    igstPaise: plan.igstPaise + overage.igstPaise,
    taxPaise: plan.taxPaise + overage.taxPaise,
    totalPaise: plan.totalPaise + overage.totalPaise,
    ratePercent: plan.ratePercent,
    intraState: plan.intraState,
    placeOfSupply: plan.placeOfSupply,
    taxable: true,
    seller,
  };
};

/**
 * Issue the invoice for a successful payment.
 *
 * Idempotent on `paymentId`, which is unique — a webhook and the browser
 * callback both routinely report the same payment, and neither should produce a
 * second invoice.
 */
export const issueInvoiceForPayment = async ({
  payment, periodStart, periodEnd,
}: IssueInvoiceArgs) => {
  const existing = await prisma.invoice.findUnique({ where: { paymentId: payment.id } });
  if (existing) return existing;

  const tenant = await prisma.tenant.findUniqueOrThrow({
    where: { id: payment.tenantId },
    include: { users: { where: { role: 'OWNER', isActive: true }, take: 1, orderBy: { createdAt: 'asc' } } },
  });

  const plan = planByCode(payment.plan);
  const interval = payment.interval as BillingInterval;

  // Overage that has been pushed to Razorpay but not yet shown on one of our
  // own invoices. Razorpay puts the addon on this cycle's charge, so this is
  // the invoice it belongs on.
  const unbilledOverage = await prisma.usageCounter.findMany({
    where: {
      tenantId: payment.tenantId,
      overagePaise: { gt: 0 },
      overageBilledAt: { not: null },
      overageInvoiceId: null,
    },
  });
  const overagePaise = unbilledOverage.reduce((sum, row) => sum + row.overagePaise, 0);
  const overageInteractions = unbilledOverage.reduce((sum, row) => sum + row.overageInteractions, 0);

  // The exact price row this payment resolved against, which may since have been
  // archived. Reading the *current* price would make an old invoice's tax
  // arithmetic depend on a price change that happened after it was issued —
  // the one thing an invoice must never do.
  const price = payment.priceId
    ? await prisma.price.findUnique({ where: { id: payment.priceId }, select: { amountPaise: true } })
    : null;

  const tax = resolveTax({
    collectedPaise: payment.amountPaise,
    listedPaise: price?.amountPaise ?? null,
    overagePaise,
    buyerStateCode: tenant.gstStateCode,
  });

  async function issueOnce() {
    return prisma.$transaction(async (tx) => {
      // Allocate inside the transaction, so two concurrent issues cannot pick
      // the same number. The unique index on (tenantId, sequence) is the
      // backstop if they somehow do.
      const last = await tx.invoice.findFirst({
        where: { tenantId: payment.tenantId },
        orderBy: { sequence: 'desc' },
        select: { sequence: true },
      });
      const sequence = (last?.sequence ?? 0) + 1;
      const year = new Date().getUTCFullYear();

      const invoice = await tx.invoice.create({
        data: {
          tenantId: payment.tenantId,
          subscriptionId: payment.subscriptionId,
          paymentId: payment.id,
          number: `${PREFIX}-${year}-${String(sequence).padStart(6, '0')}`,
          sequence,

          planName: plan?.name ?? payment.plan,
          intervalLabel: INTERVAL_META[interval]?.label ?? payment.interval,
          periodStart,
          periodEnd,

          // GST is charged on top of the listed price, so the subtotal is the
          // taxable value and the total is what was actually collected. When no
          // tax was collected — an unregistered seller, or a payment taken on a
          // pre-GST plan — every tax field stays 0 and the old "billed
          // separately" note is the truthful one.
          subtotalPaise: tax.subtotalPaise,
          overagePaise: tax.overagePaise,
          taxPaise: tax.taxPaise,
          cgstPaise: tax.cgstPaise,
          sgstPaise: tax.sgstPaise,
          igstPaise: tax.igstPaise,
          taxRatePercent: tax.taxable ? tax.ratePercent : 0,
          placeOfSupply: tax.placeOfSupply,
          sellerGstin: tax.taxable ? tax.seller.gstin : null,
          totalPaise: tax.totalPaise,
          currency: payment.currency,
          taxTreatment: 'EXCLUSIVE',

          billedToName: tenant.businessName,
          billedToEmail: tenant.users[0]?.email ?? null,
          // The billing address, collected on the billing page. Falls back to the
          // legacy signup `address` for workspaces that predate the move.
          billedToAddress: [
            tenant.billingAddressLine1,
            tenant.billingAddressLine2,
            tenant.billingCity,
            tenant.billingPostalCode,
            tenant.billingCountry,
          ].filter(Boolean).join(', ') || tenant.address || null,
          billedToGstin: tenant.gstin,
          billedToState: tenant.gstStateCode ? GST_STATES[tenant.gstStateCode] ?? null : null,

          notes: [
            DISCLOSURES.upfront(interval),
            ...(overagePaise > 0
              ? [`Includes ${overageInteractions.toLocaleString('en-IN')} AI interactions above your included quota.`]
              : []),
            // Only one of these two can be true, and saying both would be worse
            // than saying neither.
            ...(tax.taxable
              ? [
                tax.intraState
                  ? `GST charged as CGST and SGST at ${tax.ratePercent / 2}% each. Place of supply: ${tax.placeOfSupply}.`
                  : `GST charged as IGST at ${tax.ratePercent}%.${tax.placeOfSupply ? ` Place of supply: ${tax.placeOfSupply}.` : ''}`,
                DISCLOSURES.metaCharges,
              ]
              : [DISCLOSURES.tax]),
            DISCLOSURES.aiOverage,
          ],
        },
      });

      // Claim the accrual rows, so the same overage cannot land on a second
      // invoice.
      if (unbilledOverage.length) {
        await tx.usageCounter.updateMany({
          where: { id: { in: unbilledOverage.map((row) => row.id) } },
          data: { overageInvoiceId: invoice.id },
        });
      }

      return invoice;
    });
  }

  /*
   * Allocate the number, and retry if someone else took it.
   *
   * The transaction below is necessary but not sufficient. `findFirst` takes no lock, so under
   * READ COMMITTED — Postgres's default, and what Prisma uses — two transactions can both read
   * the same `max(sequence)` and both try to insert it. The unique index on
   * `(tenantId, sequence)` correctly refuses the second one, and that is where this used to
   * end: the `catch` recovered only the case where the collision was on `paymentId`, so a
   * *different* payment losing the race found no invoice of its own and rethrew. A collected
   * payment with no GST invoice, which for Indian invoicing is a compliance problem and not
   * merely a failed request.
   *
   * Two payments for one tenant landing in the same instant is not exotic: a renewal and an
   * AI-overage charge, or two subscriptions activating together.
   *
   * A Postgres sequence would be the obvious fix and is the wrong one — it advances on
   * rollback and leaves gaps, and gapless is the requirement. So: retry, exactly as
   * `ticket.service.ts` does for ticket numbers, with the index still the backstop.
   */
  for (let attempt = 0; attempt < MAX_SEQUENCE_ATTEMPTS; attempt += 1) {
    try {
      return await issueOnce();
    } catch (err) {
      // The same payment, issued twice concurrently. Whoever won produced the invoice this
      // caller wanted, so return theirs rather than failing a paid transaction.
      if (isPaymentCollision(err)) {
        const raced = await prisma.invoice.findUnique({ where: { paymentId: payment.id } });
        if (raced) return raced;
      }
      if (!isSequenceCollision(err) || attempt === MAX_SEQUENCE_ATTEMPTS - 1) {
        logger.error('Could not issue invoice', {
          paymentId: payment.id,
          attempt,
          error: err instanceof Error ? err.message : String(err),
        });
        throw err;
      }
      // Jittered, so a burst of contenders does not re-collide in lockstep.
      await new Promise((resolve) => { setTimeout(resolve, 10 + Math.random() * 40); });
    }
  }

  // Unreachable: the loop either returns or rethrows on its last attempt.
  throw new Error('Could not allocate an invoice number');
};

/** Rupees, for display. Amounts are stored and compared in paise only. */
export const formatPaise = (paise: number): string =>
  `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
