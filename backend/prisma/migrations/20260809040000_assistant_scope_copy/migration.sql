-- Assistant scope and tone: what it declines, how it says so, how long it answers.
--
-- Additive. Seven nullable columns and no defaults, because **null means inherit** — the
-- workspace's business category, then a house default in code. A column default would collapse
-- that into two states and freeze today's wording onto every row. Both hand-written partial
-- unique indexes (WorkflowInstance_one_active_per_conversation, Price_one_active_per_plan_interval)
-- are untouched.

ALTER TABLE "Assistant" ADD COLUMN "outOfScopeTopics"   TEXT;
ALTER TABLE "Assistant" ADD COLUMN "unknownAnswerReply" TEXT;
ALTER TABLE "Assistant" ADD COLUMN "outOfScopeReply"    TEXT;
ALTER TABLE "Assistant" ADD COLUMN "replyWordLimit"     INTEGER;
ALTER TABLE "Assistant" ADD COLUMN "replyLanguage"      TEXT;

ALTER TABLE "BusinessCategory" ADD COLUMN "defaultPersona"          TEXT;
ALTER TABLE "BusinessCategory" ADD COLUMN "defaultOutOfScopeTopics" TEXT;
