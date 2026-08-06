-- Marketing: campaigns to people who have opted in.
--
-- Additive. Three nullable/defaulted columns on `Customer`, three tables, four
-- enums. Both hand-written partial unique indexes are untouched.
--
-- Consent is built before any send path exists, because the failure mode here is
-- not a broken feature — it is a WhatsApp number reported enough times to be
-- suspended, which takes the whole product down for that workspace.

ALTER TABLE "Customer" ADD COLUMN "marketingOptIn" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Customer" ADD COLUMN "optedOutAt"     TIMESTAMP(3);
ALTER TABLE "Customer" ADD COLUMN "optInSource"    TEXT;

-- Backfill: anyone who has written to the business first.
--
-- Explicit and one-off, in the migration, rather than inferred at read time —
-- so the basis for someone's consent is a row that can be inspected, not a rule
-- that might change under it. Writing in first is the service relationship
-- Meta's own policy is built around; a customer who has never messaged is left
-- opted out.
UPDATE "Customer" c
SET "marketingOptIn" = true,
    "optInSource"    = 'backfill:inbound_message'
WHERE EXISTS (
  SELECT 1 FROM "Message" m
  WHERE m."customerId" = c."id" AND m."direction" = 'INBOUND'
);

CREATE TYPE "CampaignTemplateCategory" AS ENUM ('MARKETING', 'UTILITY');
CREATE TYPE "CampaignTemplateStatus" AS ENUM ('DRAFT', 'PENDING', 'APPROVED', 'REJECTED');
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'SENDING', 'SENT', 'PAUSED', 'FAILED', 'CANCELLED');
CREATE TYPE "RecipientStatus" AS ENUM ('PENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'SKIPPED_OPTED_OUT');

CREATE TABLE "CampaignTemplate" (
  "id"           TEXT NOT NULL,
  "tenantId"     TEXT NOT NULL,
  "name"         TEXT NOT NULL,
  "metaTemplate" TEXT NOT NULL,
  "language"     TEXT NOT NULL DEFAULT 'en',
  "category"     "CampaignTemplateCategory" NOT NULL DEFAULT 'MARKETING',
  "bodyPreview"  TEXT NOT NULL,
  "variables"    JSONB NOT NULL DEFAULT '[]',
  "status"       "CampaignTemplateStatus" NOT NULL DEFAULT 'DRAFT',
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CampaignTemplate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Campaign" (
  "id"             TEXT NOT NULL,
  "tenantId"       TEXT NOT NULL,
  "name"           TEXT NOT NULL,
  "templateId"     TEXT NOT NULL,
  "audienceFilter" JSONB NOT NULL DEFAULT '{}',
  "variableValues" JSONB NOT NULL DEFAULT '{}',
  "status"         "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
  "scheduledAt"    TIMESTAMP(3),
  "startedAt"      TIMESTAMP(3),
  "completedAt"    TIMESTAMP(3),
  "error"          TEXT,
  "createdById"    TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CampaignRecipient" (
  "id"          TEXT NOT NULL,
  "campaignId"  TEXT NOT NULL,
  "customerId"  TEXT NOT NULL,
  "status"      "RecipientStatus" NOT NULL DEFAULT 'PENDING',
  "messageId"   TEXT,
  "waMessageId" TEXT,
  "error"       TEXT,
  "sentAt"      TIMESTAMP(3),
  "deliveredAt" TIMESTAMP(3),
  "readAt"      TIMESTAMP(3),
  "failedAt"    TIMESTAMP(3),
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CampaignRecipient_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CampaignTemplate_tenantId_name_key" ON "CampaignTemplate" ("tenantId", "name");
CREATE INDEX "CampaignTemplate_tenantId_status_idx" ON "CampaignTemplate" ("tenantId", "status");

CREATE INDEX "Campaign_tenantId_status_createdAt_idx" ON "Campaign" ("tenantId", "status", "createdAt");
CREATE INDEX "Campaign_status_scheduledAt_idx" ON "Campaign" ("status", "scheduledAt");

-- The line that makes a resumed or retried campaign safe. The failure mode being
-- designed against is messaging the same person twice, which is what gets a
-- number reported.
CREATE UNIQUE INDEX "CampaignRecipient_campaignId_customerId_key"
  ON "CampaignRecipient" ("campaignId", "customerId");
CREATE INDEX "CampaignRecipient_campaignId_status_idx" ON "CampaignRecipient" ("campaignId", "status");

ALTER TABLE "CampaignTemplate" ADD CONSTRAINT "CampaignTemplate_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- Restrict, not Cascade: deleting a template must not silently erase the record
-- of campaigns already sent with it.
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_templateId_fkey"
  FOREIGN KEY ("templateId") REFERENCES "CampaignTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CampaignRecipient" ADD CONSTRAINT "CampaignRecipient_campaignId_fkey"
  FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CampaignRecipient" ADD CONSTRAINT "CampaignRecipient_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
