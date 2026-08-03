import crypto from 'node:crypto';
import axios from 'axios';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { BillingError } from './billing.service.js';

// Razorpay.
//
// A thin client rather than the SDK: three endpoints and two signature checks
// is not worth a dependency, and doing the HMACs here means the verification
// logic is visible and testable rather than buried.
//
// Two properties matter more than anything else in this file:
//
//   1. **The key secret never leaves the server.** The browser is given the
//      key *id* and a subscription id, which are public by design.
//   2. **A payment is only believed after its signature verifies.** The
//      browser's "payment succeeded" callback is a claim, not evidence — it can
//      be replayed or fabricated. `verifyPaymentSignature` is what turns it
//      into a fact, and the webhook is the authority that does not depend on
//      the customer's browser staying open at all.

const API = 'https://api.razorpay.com/v1';

/**
 * Secrets read at call time, not at import, and from `process.env` **only**.
 *
 * The `env` module snapshots values when it loads, which is right for
 * everything that cannot change while the process runs. A signing secret can:
 * a key rotation replaces it, and every test that exercises verification sets
 * it after the module was already imported.
 *
 * There is deliberately **no `|| env.razorpay.*` fallback.** The snapshot holds
 * whatever was set at startup, so falling back to it means clearing or rotating
 * a secret leaves the retired one still verifying signatures — the credential
 * you thought you revoked keeps working. `env.ts` applies no transformation
 * here (each field is a bare `process.env.X || ''`), so the fallback could never
 * supply anything the direct read could not, except a stale value.
 *
 * Same reasoning as `sellerTaxIdentity()` in `gst.ts`. Do not re-add it.
 */
const keySecret = (): string => process.env.RAZORPAY_KEY_SECRET ?? '';
const webhookSecret = (): string => process.env.RAZORPAY_WEBHOOK_SECRET ?? '';
const keyId = (): string => process.env.RAZORPAY_KEY_ID ?? '';

export const razorpayConfigured = (): boolean => !!keyId() && !!keySecret();

const client = () => {
  if (!razorpayConfigured()) {
    throw new BillingError(
      'Payments are not configured on this server. An administrator can assign a plan manually in the meantime.',
      'RAZORPAY_NOT_CONFIGURED',
    );
  }
  return axios.create({
    baseURL: API,
    auth: { username: keyId(), password: keySecret() },
    timeout: 15_000,
    headers: { 'Content-Type': 'application/json' },
  });
};

export interface RazorpaySubscription {
  id: string;
  status: string;
  plan_id: string;
  customer_id?: string;
  short_url?: string;
  current_start?: number | null;
  current_end?: number | null;
}

/**
 * Create a subscription against a plan id the *server* chose.
 *
 * `planId` comes from the environment via `razorpayPlanIdFor`, never from the
 * request. `totalCount` is how many cycles to bill before the subscription
 * completes — high enough to be effectively open-ended, since a customer
 * cancels rather than reaching the end.
 */
export const createSubscription = async ({
  planId, customerNotify = 1, totalCount = 120, notes,
}: {
  planId: string;
  customerNotify?: 0 | 1;
  totalCount?: number;
  notes?: Record<string, string>;
}): Promise<RazorpaySubscription> => {
  if (!planId) {
    throw new BillingError(
      'No Razorpay plan is configured for that plan and billing period.',
      'MISSING_RAZORPAY_PLAN',
    );
  }

  try {
    const { data } = await client().post<RazorpaySubscription>('/subscriptions', {
      plan_id: planId,
      customer_notify: customerNotify,
      total_count: totalCount,
      ...(notes ? { notes } : {}),
    });
    return data;
  } catch (err) {
    const detail = axios.isAxiosError(err)
      ? (err.response?.data as { error?: { description?: string } })?.error?.description ?? err.message
      : String(err);
    logger.error('Razorpay subscription creation failed', { detail });
    throw new BillingError(`Could not start the subscription: ${detail}`, 'RAZORPAY_ERROR');
  }
};

export const fetchSubscription = async (id: string): Promise<RazorpaySubscription> => {
  const { data } = await client().get<RazorpaySubscription>(`/subscriptions/${id}`);
  return data;
};

/**
 * Move a live subscription onto a different plan, in place.
 *
 * This is why an upgrade does not create a second subscription. Razorpay keeps
 * the same mandate, so the customer does not re-authorise, nothing is
 * double-billed, and there is no superseded subscription quietly charging in
 * the background.
 *
 * `when` is the whole policy in one parameter: `now` for an upgrade, `cycle_end`
 * for a downgrade — they have paid for the current period at the higher tier.
 *
 * Only works on an authenticated or active subscription. One that was created
 * but never paid has no mandate to carry over, and the caller falls back to a
 * fresh checkout.
 */
export const updateSubscriptionPlan = async ({
  subscriptionId, planId, when, customerNotify = 1,
}: {
  subscriptionId: string;
  planId: string;
  when: 'now' | 'cycle_end';
  customerNotify?: 0 | 1;
}): Promise<RazorpaySubscription> => {
  try {
    const { data } = await client().patch<RazorpaySubscription>(`/subscriptions/${subscriptionId}`, {
      plan_id: planId,
      schedule_change_at: when,
      customer_notify: customerNotify,
    });
    return data;
  } catch (err) {
    const detail = axios.isAxiosError(err)
      ? (err.response?.data as { error?: { description?: string } })?.error?.description ?? err.message
      : String(err);
    logger.warn('Razorpay subscription update failed', { subscriptionId, when, detail });
    throw new BillingError(detail, 'RAZORPAY_UPDATE_FAILED');
  }
};

/**
 * Add a one-off charge to a live subscription.
 *
 * How accrued AI overage is billed: it rides the existing mandate onto the
 * subscription's next invoice. The alternative — charging a card directly —
 * would mean storing a payment method and building a second payment flow, for
 * a charge that is by definition attached to an active subscription anyway.
 */
export const addSubscriptionAddon = async ({
  subscriptionId, name, amountPaise,
}: {
  subscriptionId: string;
  name: string;
  amountPaise: number;
}): Promise<{ id: string }> => {
  try {
    const { data } = await client().post<{ id: string }>(`/subscriptions/${subscriptionId}/addons`, {
      item: { name, amount: amountPaise, currency: 'INR' },
      quantity: 1,
    });
    return data;
  } catch (err) {
    const detail = axios.isAxiosError(err)
      ? (err.response?.data as { error?: { description?: string } })?.error?.description ?? err.message
      : String(err);
    logger.error('Razorpay addon failed', { subscriptionId, amountPaise, detail });
    throw new BillingError(detail, 'RAZORPAY_ADDON_FAILED');
  }
};

export const cancelSubscription = async (id: string, atCycleEnd = true): Promise<void> => {
  await client().post(`/subscriptions/${id}/cancel`, { cancel_at_cycle_end: atCycleEnd ? 1 : 0 });
};

/**
 * Verify the signature the browser hands back after checkout.
 *
 * For a subscription Razorpay signs `payment_id|subscription_id` — note the
 * order, which is the reverse of the one-off order flow and an easy thing to
 * get backwards. A mismatch means the callback is not from Razorpay, and the
 * only safe response is to ignore it entirely.
 *
 * Compared with `timingSafeEqual`, because a byte-by-byte early return leaks
 * how much of a forged signature was correct.
 */
export const verifyPaymentSignature = ({
  paymentId, subscriptionId, signature,
}: {
  paymentId: string;
  subscriptionId: string;
  signature: string;
}): boolean => {
  const secret = keySecret();
  if (!secret || !signature) return false;

  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${paymentId}|${subscriptionId}`)
    .digest('hex');

  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signature, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

/**
 * Verify a webhook body.
 *
 * Signed over the **raw bytes**, so the route must keep the unparsed body —
 * re-serialising the parsed JSON changes key order and whitespace and the
 * signature will never match.
 */
export const verifyWebhookSignature = (rawBody: Buffer | string, signature: string): boolean => {
  const secret = webhookSecret();
  if (!secret || !signature) return false;

  const expected = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');

  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signature, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

/** The public key id, safe to hand to the browser. The secret never is. */
export const publicKeyId = (): string => keyId();
