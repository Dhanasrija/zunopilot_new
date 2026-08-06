-- Mid-period plan changes: a scheduled downgrade, and the id of a superseded
-- Razorpay subscription. Purely additive.

-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN     "pendingEffectiveAt" TIMESTAMP(3),
ADD COLUMN     "pendingInterval" "BillingInterval",
ADD COLUMN     "pendingPlan" "PlanCode",
ADD COLUMN     "pendingPriceId" TEXT,
ADD COLUMN     "previousRazorpaySubscriptionId" TEXT;

-- CreateIndex
CREATE INDEX "Subscription_pendingEffectiveAt_idx" ON "Subscription"("pendingEffectiveAt");

