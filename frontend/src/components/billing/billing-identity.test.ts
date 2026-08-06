import { describe, expect, it } from 'vitest';
import {
  BILLING_ADDRESS_REQUIRED, isBillable, isBillingAddressError, missingBillingFields,
  type BillingIdentity,
} from './billing-identity';

/*
 * The browser's copy of the server's "can this workspace be charged?" rule.
 *
 * A second copy of a rule is a liability — this codebase has been bitten by four of them — so
 * it is worth being explicit about why this one is allowed to exist and what keeps it honest.
 *
 * It exists so the address step can open *before* the payment window rather than after a 422,
 * and it is safe to be wrong because it is not the control: `assertBillableIdentity` on the
 * server refuses regardless, and `isBillingAddressError` opens the same dialog if this said
 * complete and the server disagreed. The cost of drift is one wasted round trip.
 *
 * The tests below pin the two halves that must match the server: the field list and its
 * wording, and the rule that the state is only required when tax is actually charged.
 */

const identity = (over: Partial<BillingIdentity> = {}): BillingIdentity => ({
  gstin: null,
  gstStateCode: '36',
  stateName: 'Telangana',
  states: [{ code: '36', name: 'Telangana' }, { code: '27', name: 'Maharashtra' }],
  gst: { ratePercent: 18, sellerState: 'Telangana' },
  billingAddressLine1: '12 Road No. 36, Jubilee Hills',
  billingAddressLine2: null,
  billingCity: 'Hyderabad',
  billingPostalCode: '500033',
  billingCountry: 'IN',
  ...over,
});

describe('what the invoice needs', () => {
  it('accepts a complete identity', () => {
    expect(missingBillingFields(identity())).toEqual([]);
    expect(isBillable(identity())).toBe(true);
  });

  it('**names each missing field in the server’s own words**', () => {
    // The wording is the contract: the dialog puts these straight into a sentence, and the
    // server produces the identical list. Divergence here reads as two different requirements.
    const cases: Array<[Partial<BillingIdentity>, string]> = [
      [{ billingAddressLine1: null }, 'address'],
      [{ billingCity: null }, 'city'],
      [{ billingPostalCode: null }, 'postal code'],
      [{ billingCountry: null }, 'country'],
      [{ gstStateCode: null }, 'state'],
    ];
    for (const [missing, label] of cases) {
      expect(missingBillingFields(identity(missing))).toEqual([label]);
      expect(isBillable(identity(missing))).toBe(false);
    }
  });

  it('lists everything at once on an empty workspace, so the form asks once', () => {
    const blank = identity({
      billingAddressLine1: null,
      billingCity: null,
      billingPostalCode: null,
      billingCountry: null,
      gstStateCode: null,
    });
    expect(missingBillingFields(blank)).toEqual(['address', 'city', 'postal code', 'country', 'state']);
  });

  it('**does not require the state when the seller charges no tax**', () => {
    /*
     * The deadlock this mirrors on the server side. With no seller GSTIN the API returns
     * `gst: null`, and the form hides the state selector — there is no place of supply to record
     * when no tax is charged. Requiring it anyway would block checkout on a field the page never
     * renders, with no way for the customer to clear it.
     */
    const untaxed = identity({ gst: null, gstStateCode: null });
    expect(missingBillingFields(untaxed)).toEqual([]);
    expect(isBillable(untaxed)).toBe(true);
  });

  it('still requires the address when no tax is charged', () => {
    // The address is on every invoice, taxable or not.
    const untaxed = identity({ gst: null, gstStateCode: null, billingCity: null });
    expect(missingBillingFields(untaxed)).toEqual(['city']);
  });

  it('never requires a GSTIN', () => {
    // An unregistered business is an ordinary customer. Only the state changes the tax split.
    expect(isBillable(identity({ gstin: null }))).toBe(true);
  });

  it('treats an empty string as missing, not as an answer', () => {
    // A saved-then-cleared field comes back as '' rather than null, and '' is not an address.
    expect(missingBillingFields(identity({ billingCity: '' }))).toEqual(['city']);
  });

  it('says nothing while the identity is still loading', () => {
    // `undefined` is "not known yet". Reporting five missing fields during the first fetch
    // would flash the address dialog at somebody who has already filled it in.
    expect(missingBillingFields(undefined)).toEqual([]);
    expect(isBillable(undefined)).toBe(false);
  });
});

describe('recognising the server’s refusal', () => {
  const refusal = (code: string) => ({ response: { data: { details: { code } } } });

  it('**matches on the code, not the message**', () => {
    // The sentence will be reworded; the code is the contract. Matching prose would turn this
    // check off silently the first time somebody improves the copy.
    expect(isBillingAddressError(refusal(BILLING_ADDRESS_REQUIRED))).toBe(true);
  });

  it('ignores every other failure', () => {
    // A card decline or a rate limit must not open an address form.
    expect(isBillingAddressError(refusal('PLAN_LIMIT'))).toBe(false);
    expect(isBillingAddressError(new Error('Payment cancelled'))).toBe(false);
    expect(isBillingAddressError({ response: { data: { message: 'Add your billing address' } } })).toBe(false);
  });

  it('survives an error with no response at all', () => {
    // A network failure has no `response`. This runs inside an error handler, so throwing here
    // would replace a useful message with a blank screen.
    for (const junk of [null, undefined, {}, 'a string', new Error('offline')]) {
      expect(isBillingAddressError(junk)).toBe(false);
    }
  });
});
