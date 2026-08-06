import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../config/prisma.js';
import { activePrice, syncPriceCatalogue } from './billing.service.js';
import { issueInvoiceForPayment } from './invoice.service.js';

// Invoice numbering under concurrency.
//
// **The failure this exists to prevent is a collected payment with no invoice.** Not a slow
// request, not a duplicate — a customer charged, with no GST document, discovered later by
// someone reconciling. Under Indian GST that is a compliance problem, and because invoices
// here are deliberately immutable there is no repair path that does not involve a human.
//
// How it happened: the number is allocated by reading `max(sequence)` and inserting. That runs
// inside a transaction, which feels sufficient and is not — `findFirst` takes no lock, and
// under READ COMMITTED (Postgres's default, and Prisma's) two transactions read the same value
// and both try to use it. The unique index refuses the second, correctly. The old `catch` then
// looked for an invoice against *its own* `paymentId`, found none, and rethrew.
//
// The two racing shapes are genuinely different and the tests below separate them:
//
//   • **Same payment, twice** — the webhook and the browser callback, which both routinely
//     arrive. One invoice must exist and both callers must receive it.
//   • **Different payments, same tenant** — a renewal and an overage charge landing together.
//     Both must get an invoice, with different numbers.
//
// A Postgres sequence would fix the race and break the requirement: it advances on rollback
// and leaves gaps, and gapless is the point.

const TENANT = 'aaaaaaaa-0000-0000-0000-0000000000c1';

const wipe = async () => {
  await prisma.invoice.deleteMany({ where: { tenantId: TENANT } });
  await prisma.payment.deleteMany({ where: { tenantId: TENANT } });
  await prisma.tenant.deleteMany({ where: { id: TENANT } });
};

beforeEach(async () => {
  await wipe();
  await syncPriceCatalogue();
  await prisma.tenant.create({
    data: { id: TENANT, businessName: 'Concurrent Invoicing Co', category: 'RESTAURANT' },
  });
});

afterAll(async () => {
  await wipe();
  await prisma.$disconnect();
});

/** A settled payment, so `issueInvoiceForPayment` has something real to bill. */
const paymentFor = async (amountPaise = 99_900) => {
  const price = await activePrice('STARTER', 'MONTHLY');
  return prisma.payment.create({
    data: {
      tenantId: TENANT,
      priceId: price.id,
      plan: 'STARTER',
      interval: 'MONTHLY',
      amountPaise,
      status: 'PAID',
      paidAt: new Date(),
    },
  });
};

const issue = (payment: Awaited<ReturnType<typeof paymentFor>>) => issueInvoiceForPayment({
  payment,
  periodStart: new Date('2026-08-01'),
  periodEnd: new Date('2026-09-01'),
});

describe('two different payments for one tenant, issued at the same moment', () => {
  it('**both get an invoice, with distinct consecutive numbers**', async () => {
    // The load-bearing test. Before the retry, one of these rejected with a P2002 that no
    // caller could act on, and that payment never got an invoice at all.
    const [a, b] = await Promise.all([paymentFor(99_900), paymentFor(49_900)]);

    const results = await Promise.all([issue(a), issue(b)]);

    expect(results).toHaveLength(2);
    for (const invoice of results) expect(invoice).toBeTruthy();

    const sequences = results.map((i) => i.sequence).sort((x, y) => x - y);
    expect(sequences).toEqual([1, 2]);

    const numbers = new Set(results.map((i) => i.number));
    expect(numbers.size, 'two payments must not share an invoice number').toBe(2);

    // Each invoice belongs to the payment that asked for it — a retry must not hand back
    // someone else's document.
    const byPayment = new Map(results.map((i) => [i.paymentId, i]));
    expect(byPayment.get(a.id)).toBeTruthy();
    expect(byPayment.get(b.id)).toBeTruthy();
  });

  it('**stays gapless across a larger burst**', async () => {
    // Five at once, which is more contention than production is likely to produce and enough
    // that a single retry attempt would not be sufficient.
    const payments = await Promise.all(Array.from({ length: 5 }, () => paymentFor()));
    const invoices = await Promise.all(payments.map((p) => issue(p)));

    const sequences = invoices.map((i) => i.sequence).sort((x, y) => x - y);
    expect(sequences).toEqual([1, 2, 3, 4, 5]);
    expect(new Set(invoices.map((i) => i.number)).size).toBe(5);
  });
});

describe('the same payment, issued twice at once', () => {
  it('produces one invoice and gives it to both callers', async () => {
    // The webhook and the browser callback. This case already worked; it is here so a future
    // change to the retry cannot quietly turn one invoice into two.
    const payment = await paymentFor();

    const [first, second] = await Promise.all([issue(payment), issue(payment)]);

    expect(first.id).toBe(second.id);
    expect(await prisma.invoice.count({ where: { tenantId: TENANT } })).toBe(1);
  });

  it('is idempotent when called again later', async () => {
    const payment = await paymentFor();
    const first = await issue(payment);
    const again = await issue(payment);

    expect(again.id).toBe(first.id);
    expect(await prisma.invoice.count({ where: { tenantId: TENANT } })).toBe(1);
  });
});
