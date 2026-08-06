

// GST.
//
// Approved by Venky on 2026-08-01: **18%, charged on top of the listed price.**
// So ₹999 remains the approved taxable value and the customer pays ₹1,178.82.
// That choice is why nothing here ever back-computes tax out of a total — an
// inclusive reading would silently reduce the realised price of every plan.
//
// Three rules run through this file:
//
//   • **Paise integers, like every other amount.** Tax is rounded once, to the
//     nearest paisa, and the split is derived by subtraction so CGST + SGST can
//     never fail to equal the total by a rounding paisa.
//   • **The rate is a constant, not a setting.** A tax rate that a tenant or an
//     env var could change is a rate nobody approved. Only the *identity* of the
//     seller (GSTIN, state) comes from configuration, because that is a fact
//     about the business rather than a commercial decision.
//   • **Place of supply decides the split, never the amount.** Intra-state is
//     CGST 9% + SGST 9%; inter-state is IGST 18%. The customer pays the same
//     either way — getting it wrong costs the buyer their input credit, not
//     money.
//
// `COMPANY_GSTIN` and `COMPANY_STATE_CODE` are read from `process.env` and
// **never** from the `env` snapshot — the same trap that has now bitten
// `ENCRYPTION_KEY`, the Razorpay secrets and the plan ids. The snapshot is taken
// at import and reads the same `process.env`, so it can never be fresher and can
// easily be staler. Here that matters in the dangerous direction: a fallback
// would let an *unset* GSTIN still read as configured, and an invoice would
// charge a tax it can no longer print a number for.

/**
 * 18%, in basis points so the arithmetic stays in integers.
 *
 * Deliberately not configurable — see the note at the top of the file.
 */
export const GST_RATE_BPS = 1_800;

/** Human-facing rate, for invoice lines and disclosures. */
export const GST_RATE_PERCENT = GST_RATE_BPS / 100;

/**
 * State codes, keyed by the first two digits of a GSTIN.
 *
 * Only what an invoice needs: a name to print and a code to compare. Kept as a
 * lookup rather than an enum because a state list is data that changes by
 * notification, not a type.
 */
export const GST_STATES: Record<string, string> = {
  '01': 'Jammu and Kashmir',
  '02': 'Himachal Pradesh',
  '03': 'Punjab',
  '04': 'Chandigarh',
  '05': 'Uttarakhand',
  '06': 'Haryana',
  '07': 'Delhi',
  '08': 'Rajasthan',
  '09': 'Uttar Pradesh',
  10: 'Bihar',
  11: 'Sikkim',
  12: 'Arunachal Pradesh',
  13: 'Nagaland',
  14: 'Manipur',
  15: 'Mizoram',
  16: 'Tripura',
  17: 'Meghalaya',
  18: 'Assam',
  19: 'West Bengal',
  20: 'Jharkhand',
  21: 'Odisha',
  22: 'Chhattisgarh',
  23: 'Madhya Pradesh',
  24: 'Gujarat',
  26: 'Dadra and Nagar Haveli and Daman and Diu',
  27: 'Maharashtra',
  29: 'Karnataka',
  30: 'Goa',
  31: 'Lakshadweep',
  32: 'Kerala',
  33: 'Tamil Nadu',
  34: 'Puducherry',
  35: 'Andaman and Nicobar Islands',
  36: 'Telangana',
  37: 'Andhra Pradesh',
  38: 'Ladakh',
  97: 'Other Territory',
};

/** Telangana — MTouch Labs' place of business, confirmed at sign-off. */
const DEFAULT_SELLER_STATE_CODE = '36';

const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z][Z][0-9A-Z]$/;

/** Whether a string is shaped like a GSTIN. Shape only — no checksum. */
export const isGstin = (value: string): boolean => GSTIN_RE.test(value.trim().toUpperCase());

/** The state code a GSTIN belongs to, or null if it is not one. */
export const stateCodeOfGstin = (gstin: string | null | undefined): string | null => {
  if (!gstin || !isGstin(gstin)) return null;
  const code = gstin.trim().slice(0, 2);
  return GST_STATES[code] ? code : null;
};

export interface SellerTaxIdentity {
  gstin: string | null;
  stateCode: string;
  stateName: string;
  /** False until a GSTIN is configured — the invoice then says tax is separate. */
  registered: boolean;
}

/**
 * Who is issuing the invoice, for tax purposes.
 *
 * Unregistered is a first-class state, not an error: until `COMPANY_GSTIN` is
 * set the invoice keeps saying "taxes are billed separately" rather than
 * charging a tax it cannot legally show a number for.
 */
export const sellerTaxIdentity = (): SellerTaxIdentity => {
  // `process.env` only — deliberately *not* falling back to the `env` snapshot.
  //
  // The snapshot is taken at import and reads the same `process.env`, so it can
  // never be fresher and can easily be staler. Consulting it as a fallback means
  // a GSTIN that has been *unset* still reads as configured, and the invoice
  // charges a tax it can no longer show a number for. `env.company` stays in
  // `config/env.ts` as the documented home of these variables.
  const gstin = (process.env.COMPANY_GSTIN ?? '').trim().toUpperCase() || null;
  const configured = (process.env.COMPANY_STATE_CODE ?? '').trim();

  // The GSTIN already encodes the state, so it wins over a separately-set code:
  // if the two disagree, the registration number is the one that is true.
  const stateCode = stateCodeOfGstin(gstin)
    ?? (GST_STATES[configured] ? configured : DEFAULT_SELLER_STATE_CODE);

  return {
    gstin: gstin && isGstin(gstin) ? gstin : null,
    stateCode,
    stateName: GST_STATES[stateCode] ?? 'Telangana',
    registered: Boolean(gstin && isGstin(gstin)),
  };
};

export interface GstBreakdown {
  /** The approved price. Tax is added to this, never extracted from it. */
  taxablePaise: number;
  ratePercent: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  taxPaise: number;
  totalPaise: number;
  /** True when buyer and seller are in the same state, so CGST + SGST applies. */
  intraState: boolean;
  placeOfSupply: string | null;
  /** False when the seller has no GSTIN: no tax is charged and none is shown. */
  taxable: boolean;
}

/**
 * What tax applies to a taxable amount.
 *
 * `buyerStateCode` unknown is treated as **inter-state IGST**, which is the safe
 * default: charging IGST to someone who should have paid CGST+SGST is a
 * correctable filing, whereas splitting a supply that was actually inter-state
 * misreports two states' revenue. It is also what the buyer gets when they have
 * not told us where they are, which is exactly when we should not guess.
 */
export const computeGst = ({
  taxablePaise, buyerStateCode,
}: {
  taxablePaise: number;
  buyerStateCode?: string | null;
}): GstBreakdown => {
  const seller = sellerTaxIdentity();

  if (!seller.registered || taxablePaise <= 0) {
    return {
      taxablePaise,
      ratePercent: GST_RATE_PERCENT,
      cgstPaise: 0,
      sgstPaise: 0,
      igstPaise: 0,
      taxPaise: 0,
      totalPaise: taxablePaise,
      intraState: false,
      placeOfSupply: buyerStateCode && GST_STATES[buyerStateCode] ? GST_STATES[buyerStateCode] : null,
      taxable: false,
    };
  }

  const buyer = buyerStateCode && GST_STATES[buyerStateCode] ? buyerStateCode : null;
  const intraState = buyer !== null && buyer === seller.stateCode;

  // One rounding, on the total tax. Halving afterwards and giving the odd paisa
  // to CGST keeps cgst + sgst === taxPaise exactly, which a split computed
  // twice from the rate cannot guarantee.
  const taxPaise = Math.round((taxablePaise * GST_RATE_BPS) / 10_000);
  const half = Math.floor(taxPaise / 2);

  return {
    taxablePaise,
    ratePercent: GST_RATE_PERCENT,
    cgstPaise: intraState ? taxPaise - half : 0,
    sgstPaise: intraState ? half : 0,
    igstPaise: intraState ? 0 : taxPaise,
    taxPaise,
    totalPaise: taxablePaise + taxPaise,
    intraState,
    placeOfSupply: buyer ? GST_STATES[buyer] : null,
    taxable: true,
  };
};

/**
 * The amount to actually collect for a listed price.
 *
 * This is what a Razorpay plan is created at and what the checkout summary
 * shows, because GST is charged on top of the approved price. Every place that
 * needs a payable figure must go through here rather than adding 18% itself —
 * one source, read at runtime.
 */
export const grossPaise = (taxablePaise: number, buyerStateCode?: string | null): number =>
  computeGst({ taxablePaise, buyerStateCode }).totalPaise;

/** The tax lines an invoice or checkout summary prints. */
export const gstLines = (breakdown: GstBreakdown): Array<{ label: string; amountPaise: number }> => {
  if (!breakdown.taxable || breakdown.taxPaise === 0) return [];
  const half = breakdown.ratePercent / 2;
  return breakdown.intraState
    ? [
      { label: `CGST @ ${half}%`, amountPaise: breakdown.cgstPaise },
      { label: `SGST @ ${half}%`, amountPaise: breakdown.sgstPaise },
    ]
    : [{ label: `IGST @ ${breakdown.ratePercent}%`, amountPaise: breakdown.igstPaise }];
};
