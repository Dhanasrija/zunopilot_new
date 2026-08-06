-- Uploaded media for template headers, and the header format a template declares.
--
-- Additive: one table, two enums, three nullable columns and one column with a default.
-- Nothing is rewritten. Both hand-written partial unique indexes
-- (`WorkflowInstance_one_active_per_conversation`, `Price_one_active_per_plan_interval`)
-- are untouched.

CREATE TYPE "MediaKind" AS ENUM ('IMAGE', 'VIDEO', 'DOCUMENT');
CREATE TYPE "TemplateHeaderFormat" AS ENUM ('NONE', 'TEXT', 'IMAGE', 'VIDEO', 'DOCUMENT');

CREATE TABLE "MediaAsset" (
  "id"               TEXT NOT NULL,
  "tenantId"         TEXT NOT NULL,
  "kind"             "MediaKind" NOT NULL,
  "mimeType"         TEXT NOT NULL,
  "sizeBytes"        INTEGER NOT NULL,
  "originalName"     TEXT NOT NULL,
  -- A uuid filename on disk, never anything derived from what the client called the file.
  "storageKey"       TEXT NOT NULL,
  "uploadedByUserId" TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "MediaAsset_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MediaAsset_storageKey_key" ON "MediaAsset" ("storageKey");
CREATE INDEX "MediaAsset_tenantId_kind_createdAt_idx"
  ON "MediaAsset" ("tenantId", "kind", "createdAt");

ALTER TABLE "MediaAsset"
  ADD CONSTRAINT "MediaAsset_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- What the template's HEADER component is. Existing rows default to NONE, which is the
-- honest answer for a template nobody has reconciled with Meta yet.
ALTER TABLE "CampaignTemplate"
  ADD COLUMN "headerFormat" "TemplateHeaderFormat" NOT NULL DEFAULT 'NONE',
  ADD COLUMN "metaId" TEXT,
  ADD COLUMN "syncedAt" TIMESTAMP(3);

-- The media filling that header, per campaign.
--
-- ON DELETE SET NULL, not CASCADE: deleting an asset must never delete the campaigns that
-- used it, because a sent campaign is a record of something that happened.
ALTER TABLE "Campaign" ADD COLUMN "headerMediaId" TEXT;

ALTER TABLE "Campaign"
  ADD CONSTRAINT "Campaign_headerMediaId_fkey"
  FOREIGN KEY ("headerMediaId") REFERENCES "MediaAsset" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
