-- Which vendor answers a workspace's customers, chosen per workspace in the operator console.
--
-- Additive, and **nullable with no default on purpose**: null means "the platform default, whatever
-- LLM_VENDOR says today". A column default would write today's vendor into every row, so changing
-- the platform's default later would reach only workspaces created after the change — and nothing
-- would distinguish an operator's deliberate choice from an inherited one.
--
-- Both hand-written partial unique indexes (WorkflowInstance_one_active_per_conversation,
-- Price_one_active_per_plan_interval) are untouched.

CREATE TYPE "LlmVendor" AS ENUM ('OPENAI', 'GROQ');

ALTER TABLE "Tenant" ADD COLUMN "llmVendor" "LlmVendor";
