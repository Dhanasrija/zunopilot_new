-- Delivery status a tick can be trusted to show.
--
-- Four columns and one index. No enum change: MessageStatus already has SENT, DELIVERED, READ
-- and FAILED. What was missing was a rule about the order they may be applied in, and that
-- lives in webhook-intake.ts rather than here.
--
-- The timestamps exist because **Meta never replays a status webhook**. A delivery time not
-- captured when it arrives is gone for good, so these cannot be added later and backfilled —
-- which is the whole reason they are in this migration and not a follow-up.
--
-- No index is added on "Message"."waMessageId", deliberately. The lookup becomes
-- (tenantId, waMessageId) — two equality predicates covering the entire key of the existing
-- Message_tenantId_waMessageId_key — so that index already serves it as a single-row scan. The
-- full scan this replaces was caused by the missing tenant filter, not by a missing index.
-- Adding one here would be dead weight Postgres never chooses.
--
-- Purely additive: four nullable columns and one new index. Nothing is altered or dropped, so
-- the two hand-written partial unique indexes (WorkflowInstance_one_active_per_conversation and
-- Price_one_active_per_plan_interval) are untouched.

-- AlterTable
ALTER TABLE "Message" ADD COLUMN "deliveredAt" TIMESTAMP(3);
ALTER TABLE "Message" ADD COLUMN "readAt"      TIMESTAMP(3);
ALTER TABLE "Message" ADD COLUMN "failedAt"    TIMESTAMP(3);
ALTER TABLE "Message" ADD COLUMN "statusError" TEXT;

-- CreateIndex
-- CampaignRecipient has no index on waMessageId and the status webhook now looks rows up by it.
-- Plain CREATE INDEX rather than CONCURRENTLY: Prisma wraps each migration in a transaction,
-- which CONCURRENTLY cannot run inside.
CREATE INDEX "CampaignRecipient_waMessageId_idx" ON "CampaignRecipient" ("waMessageId");
