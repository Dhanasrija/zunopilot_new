-- The header text, footer and buttons of an approved template, so the campaign screen can
-- show a customer's-eye preview rather than the body alone.
--
-- Additive. Every column is nullable or defaulted, so existing rows keep working and simply
-- preview without a footer or buttons until the next sync from Meta fills them in.
ALTER TABLE "CampaignTemplate" ADD COLUMN "headerText" TEXT;
ALTER TABLE "CampaignTemplate" ADD COLUMN "footerText" TEXT;
ALTER TABLE "CampaignTemplate" ADD COLUMN "buttons" JSONB NOT NULL DEFAULT '[]';
