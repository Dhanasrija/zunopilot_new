import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

// The price catalogue, as the server serves it.
//
// Nothing here recomputes an amount. The effective monthly figure and the
// savings percentage arrive already derived from the approved prices, so the
// marketing page, the checkout summary and the invoice cannot disagree about
// what something costs.

export type PlanCode = 'STARTER' | 'GROWTH' | 'BUSINESS' | 'ENTERPRISE';
export type BillingInterval = 'MONTHLY' | 'QUARTERLY' | 'YEARLY';

export interface PriceView {
  /** The approved price, excluding GST. */
  amountPaise: number;
  effectiveMonthlyPaise: number;
  savingsPercent: number | null;
  /**
   * What the card is actually charged — the price plus GST. Served by the API
   * rather than computed here, so a quoted total and a charged total cannot
   * drift. Equals `amountPaise` while no GSTIN is configured.
   */
  payablePaise: number;
}

export interface PlanView {
  code: PlanCode;
  name: string;
  tagline: string;
  includes: string[];
  selfServe: boolean;
  badges: string[];
  recommended: boolean;
  entitlements: {
    whatsappNumbers: number | null;
    teamMembers: number | null;
    activeAutomations: number | null;
    aiInteractionsPerMonth: number | null;
    features: Record<string, boolean>;
    support: string;
  };
  prices: Partial<Record<BillingInterval, PriceView>>;
}

export interface Catalogue {
  currency: string;
  taxTreatment: string;
  defaultInterval: BillingInterval;
  intervals: Array<{
    code: BillingInterval;
    label: string;
    everyLabel: string;
    badge: string | null;
    isDefault: boolean;
  }>;
  disclosures: {
    tax: string;
    aiOverage: string;
    upfront: Record<BillingInterval, string>;
  };
  /** Null when the seller is not GST-registered, in which case no tax is charged. */
  gst: { ratePercent: number; note: string } | null;
  plans: PlanView[];
}

export const useCatalogue = () => useQuery({
  queryKey: ['pricing', 'catalogue'],
  queryFn: () => api.get<{ data: Catalogue }>('/pricing').then((r) => r.data.data),
  staleTime: 5 * 60_000,
});

/**
 * Paise to rupees for display.
 *
 * Whole rupees when the amount is whole, which every approved price is. Showing
 * "₹2,699" rather than "₹2,699.00" on a pricing card reads as a price rather
 * than as a line on a statement; invoices use the two-decimal form.
 */
export const formatRupees = (paise: number, opts: { decimals?: boolean } = {}): string => {
  const rupees = paise / 100;
  const wantsDecimals = opts.decimals ?? !Number.isInteger(rupees);
  return `₹${rupees.toLocaleString('en-IN', {
    minimumFractionDigits: wantsDecimals ? 2 : 0,
    maximumFractionDigits: wantsDecimals ? 2 : 0,
  })}`;
};

export const formatLimit = (value: number | null, noun: string): string =>
  (value === null ? `Unlimited ${noun}` : `${value.toLocaleString('en-IN')} ${noun}`);
