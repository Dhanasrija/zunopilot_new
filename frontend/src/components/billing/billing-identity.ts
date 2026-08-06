import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

// What the invoice needs before anyone can be charged.
//
// The server refuses a checkout without these (`assertBillableIdentity`), and this is the
// browser's copy of the same rule — used to decide whether to show the address step before
// opening Razorpay, rather than letting the customer meet a 422 with their card out.
//
// **The server is the control; this is only about which screen to show.** The two conditions
// are deliberately written to match, and the one below is the copy that is allowed to be wrong:
// if it says complete and the server disagrees, the 422 handler opens the same form anyway.

export interface BillingIdentity {
  gstin: string | null;
  gstStateCode: string | null;
  stateName: string | null;
  states: Array<{ code: string; name: string }>;
  /** Null when the seller has no GSTIN — no tax is charged, so no place of supply is recorded. */
  gst: { ratePercent: number; sellerState: string } | null;
  billingAddressLine1: string | null;
  billingAddressLine2: string | null;
  billingCity: string | null;
  billingPostalCode: string | null;
  billingCountry: string | null;
}

/** The error code `assertBillableIdentity` refuses with. Matched on, never the message. */
export const BILLING_ADDRESS_REQUIRED = 'BILLING_ADDRESS_REQUIRED';

/**
 * Which fields are still missing, in the same order and wording the server uses.
 *
 * The state is only required when tax is actually charged. When the seller has no GSTIN,
 * `gst` is null, the form hides the state selector, and requiring it would ask for something
 * the page never offers.
 */
export const missingBillingFields = (identity: BillingIdentity | undefined): string[] => {
  if (!identity) return [];
  return [
    !identity.billingAddressLine1 && 'address',
    !identity.billingCity && 'city',
    !identity.billingPostalCode && 'postal code',
    !identity.billingCountry && 'country',
    identity.gst && !identity.gstStateCode && 'state',
  ].filter(Boolean) as string[];
};

export const isBillable = (identity: BillingIdentity | undefined): boolean =>
  !!identity && missingBillingFields(identity).length === 0;

/** One query key, so the settings card and the checkout step never hold different answers. */
export const BILLING_IDENTITY_KEY = ['billing', 'tax-details'] as const;

export const useBillingIdentity = () => useQuery({
  queryKey: BILLING_IDENTITY_KEY,
  queryFn: () => api.get<{ data: BillingIdentity }>('/billing/tax-details').then((r) => r.data.data),
});

/**
 * Did this failure mean "we need your billing address"?
 *
 * Reads the error code rather than the sentence. `api.ts` rejects with the raw AxiosError, so
 * the server's `details` survives — and matching on `BILLING_ADDRESS_REQUIRED` means the copy
 * can be reworded without silently turning this check off.
 *
 * Only a backstop. The normal path checks completeness before calling the server at all; this
 * catches a stale cache, or a second tab that saved something in between.
 */
export const isBillingAddressError = (error: unknown): boolean =>
  (error as { response?: { data?: { details?: { code?: string } } } })
    ?.response?.data?.details?.code === BILLING_ADDRESS_REQUIRED;
