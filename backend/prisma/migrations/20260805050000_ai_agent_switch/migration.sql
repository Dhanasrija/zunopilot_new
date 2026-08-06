-- A two-level switch for the AI agent: an operator ceiling and a workspace preference.
--
-- Nothing could stop a workspace's messages reaching OpenAI before this. Every open-ended
-- customer message costs two LLM calls, and the only brakes were a soft spend quota, a
-- per-assistant flag covering one of three call sites, and a per-conversation pause.
--
-- Two flags rather than one, because the two decisions are different:
--
--   * `ModuleKey.AI_AGENT` in TenantModule — the operator's. About cost, payment and abuse.
--     Only the super admin console writes it, so a workspace cannot restore its own access.
--   * `Tenant.aiAgentEnabled` — the workspace's. "I don't want a bot answering this week."
--
-- Both must be on for a single LLM call to be made. One shared field would have let a
-- workspace undo an operator's decision on its next visit, which is not a ceiling.
--
-- **Both default to ON**, which is the opposite of how modules normally work and is the whole
-- reason this needs a comment. MARKETING, LEADS and SUPPORT are add-ons nobody has until they
-- buy them, so off-by-default protects us. The AI agent is already answering customers in
-- every workspace on the platform, so off-by-default would silently mute all of them on
-- deploy. For the enum value that default lives in code — `defaultState()` in
-- modules/module.service.ts — rather than as backfilled rows here, because rows would only
-- cover the workspaces that exist tonight and leave every future signup with no agent.
--
-- Turning the agent off does not silence the bot. Carts, deterministic keyword rules and
-- published workflows all keep running; only the model is skipped, and the customer gets the
-- workspace's own FallbackRule text. See `degradeToNonAi` in conversation-engine/routing.
--
-- Purely additive: one enum value and one boolean with a default. Nothing is altered or
-- dropped, so the two hand-written partial unique indexes
-- (WorkflowInstance_one_active_per_conversation and Price_one_active_per_plan_interval)
-- are untouched.

-- AlterEnum
ALTER TYPE "ModuleKey" ADD VALUE 'AI_AGENT';

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN "aiAgentEnabled" BOOLEAN NOT NULL DEFAULT true;
