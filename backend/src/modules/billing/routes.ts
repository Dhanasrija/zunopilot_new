import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAuth, requirePermission } from '../../middleware/auth.js';
import * as billing from './billing.controller.js';

// Billing routes.
//
// Reading the plan and the invoices is `settings:read` — anyone in the
// workspace can see what plan they are on and why something is limited.
// Spending money, cancelling, and assigning a plan are `settings:write`, which
// is OWNER only.

/**
 * Checkout is rate limited per tenant.
 *
 * Each call creates a real subscription at Razorpay. A retry loop in a browser
 * would otherwise leave a trail of orphaned subscriptions on the account, and
 * they are a nuisance to reconcile.
 */
const checkoutLimiter = rateLimit({
  windowMs: 60_000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.tenantId ?? req.ip ?? 'anonymous',
  message: { success: false, message: 'Too many checkout attempts. Try again shortly.' },
});

export const billingRoutes = Router();
billingRoutes.use(requireAuth);

billingRoutes.get('/subscription', requirePermission('settings:read'), billing.getSubscription);
billingRoutes.get('/invoices/:invoiceId', requirePermission('settings:read'), billing.getInvoice);

billingRoutes.post('/checkout', requirePermission('settings:write'), checkoutLimiter, billing.startCheckout);
billingRoutes.post('/checkout/verify', requirePermission('settings:write'), billing.verifyCheckout);
billingRoutes.post('/cancel', requirePermission('settings:write'), billing.cancelPlan);

// Mid-period plan change. Rate limited with checkout, because an upgrade
// changes a live subscription at Razorpay.
billingRoutes.post('/change-plan', requirePermission('settings:write'), checkoutLimiter, billing.changePlan);
billingRoutes.delete('/scheduled-change', requirePermission('settings:write'), billing.cancelScheduledChange);

// How much this workspace will spend on AI above its included quota.
billingRoutes.put('/overage-cap', requirePermission('settings:write'), billing.setOverageCap);

// The workspace's own GSTIN and state. Readable by anyone who can see the plan;
// writing is `settings:write` because it changes what their tax invoice says.
billingRoutes.get('/tax-details', requirePermission('settings:read'), billing.getTaxDetails);
billingRoutes.put('/tax-details', requirePermission('settings:write'), billing.updateTaxDetails);

// Assigning a plan without payment. Enterprise, and any negotiated deal.
billingRoutes.post('/assign', requirePermission('settings:write'), billing.assignPlan);

/**
 * The public price list.
 *
 * Unauthenticated on purpose: the pricing page is a marketing page, and it must
 * show the same numbers checkout will charge. Serving it from the same price
 * records is what keeps those two honest.
 */
export const publicPricingRoutes = Router();
publicPricingRoutes.get('/', billing.getCatalogue);

/** Razorpay's webhook. Signed, so it needs no session. */
export const razorpayWebhookRoutes = Router();
razorpayWebhookRoutes.post('/razorpay', billing.razorpayWebhook);
