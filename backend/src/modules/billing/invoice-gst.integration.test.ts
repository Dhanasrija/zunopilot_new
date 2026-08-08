import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { seedMemberships } from '../../test-support/members.js';
import { prisma } from '../../config/prisma.js';
import { activePrice, syncPriceCatalogue } from './billing.service.js';
import { issueInvoiceForPayment } from './invoice.service.js';
import { DISCLOSURES } from './catalogue.js';

// Tax on a real invoice.
//
// The property under test is not the arithmetic — `gst.test.ts` covers that —
// but the one an accountant would check first: **the invoice total equals what
// was actually collected**. GST is added on top of the listed price, so a
// payment taken at the bare listed amount was charged on a pre-GST Razorpay
// plan and must show no tax, however registered we now are. Getting that wrong
// produces a document claiming tax that never changed hands.

const TENANT = 'aaaaaaaa-0000-0000-0000-00000000009c';
const TELANGANA_GSTIN = '36AABCU9603R1ZM';

let saved: { gstin?: string; stateCode?: string };

const register = (gstin?: string) => {
  if (gstin) process.env.COMPANY_GSTIN = gstin;
  else delete process.env.COMPANY_GSTIN;
  process.env.COMPANY_STATE_CODE = '36';
};

const wipe = async () => {
  await prisma.invoice.deleteMany({ where: { tenantId: TENANT } });
  await prisma.payment.deleteMany({ where: { tenantId: TENANT } });
  await prisma.tenant.deleteMany({ where: { id: TENANT } });
};

beforeEach(async () => {
  saved = { gstin: process.env.COMPANY_GSTIN, stateCode: process.env.COMPANY_STATE_CODE };
  await wipe();
  await syncPriceCatalogue();
  await prisma.tenant.create({
    data: {
      id: TENANT,
      businessName: 'GST Invoice Test Co',
      category: 'RESTAURANT',
      users: {
        create: {
          email: 'owner@gsttest.example',
          fullName: 'GST Owner',
          role: 'OWNER',
          passwordHash: 'x',
          emailVerified: true,
        },
      },
    },
  });
});

afterEach(() => {
  register(saved.gstin);
  if (saved.stateCode === undefined) delete process.env.COMPANY_STATE_CODE;
  else process.env.COMPANY_STATE_CODE = saved.stateCode;
});

afterAll(async () => {
  await wipe();
  await prisma.$disconnect();
});

/** A settled payment for Starter Monthly, collected at `amountPaise`. */
const paymentFor = async (amountPaise: number) => {
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

const buyerIn = (stateCode: string | null, gstin?: string) => prisma.tenant.update({
  where: { id: TENANT },
  data: { gstStateCode: stateCode, ...(gstin ? { gstin } : {}) },
});

describe('an invoice for a GST-era payment', () => {
  beforeEach(() => register(TELANGANA_GSTIN));

  it('shows ₹999 taxable, ₹179.82 tax and ₹1,178.82 collected', async () => {
    await buyerIn('27'); // Maharashtra — inter-state
    const invoice = await issue(await paymentFor(117_882));

    expect(invoice.subtotalPaise).toBe(99_900);
    expect(invoice.taxPaise).toBe(17_982);
    expect(invoice.totalPaise).toBe(117_882);
    expect(invoice.taxRatePercent).toBe(18);
    expect(invoice.sellerGstin).toBe(TELANGANA_GSTIN);
  });

  it('reconciles: subtotal + overage + tax is exactly what was charged', async () => {
    await buyerIn('27');
    const invoice = await issue(await paymentFor(117_882));

    expect(invoice.subtotalPaise + invoice.overagePaise + invoice.taxPaise)
      .toBe(invoice.totalPaise);
  });

  it('splits CGST and SGST for a buyer in Telangana', async () => {
    await buyerIn('36', TELANGANA_GSTIN);
    const invoice = await issue(await paymentFor(117_882));

    expect(invoice.cgstPaise).toBe(8_991);
    expect(invoice.sgstPaise).toBe(8_991);
    expect(invoice.igstPaise).toBe(0);
    expect(invoice.placeOfSupply).toBe('Telangana');
    expect(invoice.billedToState).toBe('Telangana');
    expect(invoice.billedToGstin).toBe(TELANGANA_GSTIN);
    expect(invoice.notes.some((n) => n.includes('CGST and SGST'))).toBe(true);
  });

  it('charges IGST for a buyer elsewhere', async () => {
    await buyerIn('29'); // Karnataka
    const invoice = await issue(await paymentFor(117_882));

    expect(invoice.igstPaise).toBe(17_982);
    expect(invoice.cgstPaise + invoice.sgstPaise).toBe(0);
    expect(invoice.placeOfSupply).toBe('Karnataka');
    expect(invoice.notes.some((n) => n.includes('IGST'))).toBe(true);
  });

  it('charges IGST when the buyer never told us where they are', async () => {
    await buyerIn(null);
    const invoice = await issue(await paymentFor(117_882));

    expect(invoice.igstPaise).toBe(17_982);
    expect(invoice.placeOfSupply).toBeNull();
  });

  it('stops saying taxes are billed separately once it shows a tax line', async () => {
    await buyerIn('27');
    const invoice = await issue(await paymentFor(117_882));

    expect(invoice.notes).not.toContain(DISCLOSURES.tax);
    expect(invoice.notes).toContain(DISCLOSURES.metaCharges);
  });
});

describe('an invoice for a payment taken before GST was switched on', () => {
  beforeEach(() => register(TELANGANA_GSTIN));

  it('shows no tax, because none was collected', async () => {
    await buyerIn('36');
    // Charged at the bare listed price — a pre-GST Razorpay plan id.
    const invoice = await issue(await paymentFor(99_900));

    expect(invoice.subtotalPaise).toBe(99_900);
    expect(invoice.taxPaise).toBe(0);
    expect(invoice.cgstPaise).toBe(0);
    expect(invoice.sgstPaise).toBe(0);
    expect(invoice.totalPaise).toBe(99_900);
    expect(invoice.taxRatePercent).toBe(0);
    expect(invoice.notes).toContain(DISCLOSURES.tax);
  });
});

describe('an invoice for an amount that matches no known price', () => {
  beforeEach(() => register(TELANGANA_GSTIN));

  it('extracts the tax so the total still equals the charge', async () => {
    await buyerIn('27');
    // A negotiated amount — neither the listed price nor its gross.
    const invoice = await issue(await paymentFor(500_000));

    expect(invoice.totalPaise).toBe(500_000);
    expect(invoice.subtotalPaise + invoice.taxPaise).toBe(500_000);
    expect(invoice.taxPaise).toBe(76_271);
    expect(invoice.subtotalPaise).toBe(423_729);
  });
});

describe('an invoice issued before a GSTIN is configured', () => {
  beforeEach(() => register(undefined));

  it('charges nothing and keeps the old disclosure', async () => {
    await buyerIn('36');
    const invoice = await issue(await paymentFor(99_900));

    expect(invoice.taxPaise).toBe(0);
    expect(invoice.sellerGstin).toBeNull();
    expect(invoice.totalPaise).toBe(99_900);
    expect(invoice.notes).toContain(DISCLOSURES.tax);
  });
});

/*
 * Memberships for the users this fixture inserts directly.
 *
 * In the product every path that creates a user writes a `Membership` too. Fixtures bypass those
 * paths, so without this they produce a login belonging to no workspace — which works while
 * `requireAuth` reads `User.tenantId` and 401s the moment it reads memberships.
 *
 * Registered last in the file so it runs after every fixture hook above, whichever of them created
 * the users. Idempotent. See `test-support/members.ts` for why this is an explicit call rather than
 * a global hook.
 */
beforeEach(async () => { await seedMemberships(); });
