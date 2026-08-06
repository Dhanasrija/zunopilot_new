-- AI overage: accrual, a per-tenant spend cap, and the link to the Razorpay
-- addon that bills it. Purely additive.

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "overagePaise" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN     "overageCapPaise" INTEGER;

-- AlterTable
ALTER TABLE "UsageCounter" ADD COLUMN     "overageAddonId" TEXT,
ADD COLUMN     "overageBilledAt" TIMESTAMP(3),
ADD COLUMN     "overageInteractions" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "overageInvoiceId" TEXT,
ADD COLUMN     "overagePaise" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "UsageCounter_overageBilledAt_idx" ON "UsageCounter"("overageBilledAt");

