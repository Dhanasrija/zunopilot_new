import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  computeGst, grossPaise, gstLines, isGstin, sellerTaxIdentity, stateCodeOfGstin,
  GST_RATE_PERCENT,
} from './gst.js';
import { PLANS } from './catalogue.js';

// GST arithmetic.
//
// Everything here is about money, so the assertions are literal paise rather
// than recomputations of the same formula — a test that repeats the
// implementation's arithmetic proves only that it is self-consistent.

// A syntactically valid Telangana GSTIN. Not a real registration.
const TELANGANA_GSTIN = '36AABCU9603R1ZM';
const KARNATAKA_GSTIN = '29AABCU9603R1Z2';

const withSeller = (gstin: string | undefined, stateCode?: string) => {
  if (gstin === undefined) delete process.env.COMPANY_GSTIN;
  else process.env.COMPANY_GSTIN = gstin;
  if (stateCode === undefined) delete process.env.COMPANY_STATE_CODE;
  else process.env.COMPANY_STATE_CODE = stateCode;
};

let saved: { gstin?: string; stateCode?: string };

beforeEach(() => {
  saved = { gstin: process.env.COMPANY_GSTIN, stateCode: process.env.COMPANY_STATE_CODE };
});

afterEach(() => {
  withSeller(saved.gstin, saved.stateCode);
});

describe('GSTIN parsing', () => {
  it('accepts a well-formed GSTIN and rejects near-misses', () => {
    expect(isGstin(TELANGANA_GSTIN)).toBe(true);
    expect(isGstin('36aabcu9603r1zm')).toBe(true); // case is normalised
    expect(isGstin('36AABCU9603R1Z')).toBe(false); // too short
    expect(isGstin('AABCU9603R1ZM36')).toBe(false); // state digits not leading
    expect(isGstin('')).toBe(false);
  });

  it('reads the state out of the first two digits, and refuses an unassigned code', () => {
    expect(stateCodeOfGstin(TELANGANA_GSTIN)).toBe('36');
    expect(stateCodeOfGstin(KARNATAKA_GSTIN)).toBe('29');
    // 25 is not an assigned state code.
    expect(stateCodeOfGstin('25AABCU9603R1ZM')).toBeNull();
    expect(stateCodeOfGstin(null)).toBeNull();
  });
});

describe('who is issuing the invoice', () => {
  it('is unregistered until a GSTIN is configured', () => {
    withSeller(undefined);
    const seller = sellerTaxIdentity();
    expect(seller.registered).toBe(false);
    expect(seller.gstin).toBeNull();
  });

  it('takes the state from the GSTIN, which wins over a conflicting state code', () => {
    withSeller(KARNATAKA_GSTIN, '36');
    const seller = sellerTaxIdentity();
    expect(seller.stateCode).toBe('29');
    expect(seller.stateName).toBe('Karnataka');
  });

  it('reads process.env, not the import-time snapshot', () => {
    // The trap that has now bitten four times: env.ts snapshots at import, so a
    // value pasted in afterwards must still be picked up.
    withSeller(undefined);
    expect(sellerTaxIdentity().registered).toBe(false);
    process.env.COMPANY_GSTIN = TELANGANA_GSTIN;
    expect(sellerTaxIdentity().registered).toBe(true);
  });
});

describe('charging GST on top of the listed price', () => {
  beforeEach(() => withSeller(TELANGANA_GSTIN));

  it('adds 18% to ₹999 — the customer pays ₹1,178.82', () => {
    const gst = computeGst({ taxablePaise: 99_900, buyerStateCode: '29' });
    expect(gst.taxablePaise).toBe(99_900);
    expect(gst.taxPaise).toBe(17_982);
    expect(gst.totalPaise).toBe(117_882);
    expect(gst.ratePercent).toBe(18);
  });

  it('splits CGST and SGST for a buyer in the seller\'s own state', () => {
    const gst = computeGst({ taxablePaise: 99_900, buyerStateCode: '36' });
    expect(gst.intraState).toBe(true);
    expect(gst.cgstPaise).toBe(8_991);
    expect(gst.sgstPaise).toBe(8_991);
    expect(gst.igstPaise).toBe(0);
    expect(gst.placeOfSupply).toBe('Telangana');
  });

  it('charges IGST for a buyer in another state', () => {
    const gst = computeGst({ taxablePaise: 99_900, buyerStateCode: '27' });
    expect(gst.intraState).toBe(false);
    expect(gst.igstPaise).toBe(17_982);
    expect(gst.cgstPaise + gst.sgstPaise).toBe(0);
    expect(gst.placeOfSupply).toBe('Maharashtra');
  });

  it('treats an unknown buyer state as inter-state, the safe default', () => {
    for (const buyerStateCode of [null, undefined, '', '99']) {
      const gst = computeGst({ taxablePaise: 99_900, buyerStateCode });
      expect(gst.intraState).toBe(false);
      expect(gst.igstPaise).toBe(17_982);
      expect(gst.placeOfSupply).toBeNull();
    }
  });

  it('never loses a paisa in the split', () => {
    // An odd tax total is the case a naive "half each" gets wrong.
    const gst = computeGst({ taxablePaise: 101, buyerStateCode: '36' });
    expect(gst.taxPaise).toBe(18);
    expect(gst.cgstPaise + gst.sgstPaise).toBe(gst.taxPaise);

    const odd = computeGst({ taxablePaise: 105, buyerStateCode: '36' });
    expect(odd.taxPaise).toBe(19);
    expect(odd.cgstPaise + odd.sgstPaise).toBe(19);
    expect(odd.cgstPaise).toBe(10); // the odd paisa goes to CGST
    expect(odd.sgstPaise).toBe(9);
  });

  it('charges nothing on a zero amount, so a plan with no overage shows no tax line', () => {
    const gst = computeGst({ taxablePaise: 0, buyerStateCode: '36' });
    expect(gst.taxPaise).toBe(0);
    expect(gst.taxable).toBe(false);
    expect(gstLines(gst)).toEqual([]);
  });

  it('prints two lines intra-state and one inter-state', () => {
    expect(gstLines(computeGst({ taxablePaise: 99_900, buyerStateCode: '36' })))
      .toEqual([
        { label: 'CGST @ 9%', amountPaise: 8_991 },
        { label: 'SGST @ 9%', amountPaise: 8_991 },
      ]);
    expect(gstLines(computeGst({ taxablePaise: 99_900, buyerStateCode: '27' })))
      .toEqual([{ label: 'IGST @ 18%', amountPaise: 17_982 }]);
  });
});

describe('when the seller is not GST-registered', () => {
  beforeEach(() => withSeller(undefined));

  it('charges no tax at all, so the price is what is collected', () => {
    const gst = computeGst({ taxablePaise: 99_900, buyerStateCode: '36' });
    expect(gst.taxPaise).toBe(0);
    expect(gst.totalPaise).toBe(99_900);
    expect(gst.taxable).toBe(false);
    expect(grossPaise(99_900)).toBe(99_900);
  });
});

describe('what Razorpay will collect for every plan', () => {
  beforeEach(() => withSeller(TELANGANA_GSTIN));

  // Asserted as literals for the same reason the plan prices are: these are the
  // amounts nine Razorpay plans get created at, and a change to any of them is a
  // change to what a customer's card is charged.
  it('is the approved price plus 18%, to the paisa', () => {
    const expected: Record<string, Record<string, number>> = {
      STARTER: { MONTHLY: 117_882, QUARTERLY: 318_482, YEARLY: 1_132_682 },
      GROWTH: { MONTHLY: 353_882, QUARTERLY: 955_682, YEARLY: 3_398_282 },
      BUSINESS: { MONTHLY: 943_882, QUARTERLY: 2_548_682, YEARLY: 9_062_282 },
    };

    for (const plan of PLANS) {
      if (!plan.selfServe) continue;
      for (const [interval, taxable] of Object.entries(plan.prices)) {
        expect(grossPaise(taxable as number)).toBe(expected[plan.code]?.[interval]);
      }
    }
  });

  it('is one amount for every buyer, because only the split varies by state', () => {
    expect(grossPaise(99_900, '36')).toBe(grossPaise(99_900, '27'));
    expect(grossPaise(99_900, null)).toBe(117_882);
  });

  it('keeps the rate at 18 — a change here is a change to every price', () => {
    expect(GST_RATE_PERCENT).toBe(18);
  });
});
