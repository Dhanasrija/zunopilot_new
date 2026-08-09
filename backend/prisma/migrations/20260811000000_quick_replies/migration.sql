-- Saved reply-button sets an agent can send from the Inbox, and what tapping one starts.
--
-- Additive: two new tables, nothing existing is touched.
--
-- ── Why the button's own id is the identity on WhatsApp ──────────────────────
--
-- `QuickReplyButton.id` is what goes on the wire, as `zp:qr:<id>`, and what comes back when the
-- customer taps. It is therefore a stable, long-lived identifier rather than a per-send token: a
-- customer who scrolls back and taps a question from last week still resolves to the same row. That
-- is also why the row is worth keeping — deleting a button retires the answer, and a tap arriving
-- afterwards resolves to nothing and is simply recorded, which is the right outcome.
--
-- ── Why `workflowId` is SET NULL and not CASCADE ─────────────────────────────
--
-- Deleting a workflow must turn its buttons back into plain answers, not delete the sets an agent
-- uses every day. A CASCADE here would mean tidying up an unused workflow silently removed a
-- question the team asks a hundred times a week.
--
-- Both hand-written partial unique indexes (WorkflowInstance_one_active_per_conversation,
-- Price_one_active_per_plan_interval) are untouched.

CREATE TABLE "QuickReply" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuickReply_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "QuickReplyButton" (
    "id" TEXT NOT NULL,
    "quickReplyId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "workflowId" TEXT,

    CONSTRAINT "QuickReplyButton_pkey" PRIMARY KEY ("id")
);

-- One name per workspace: the name is how an agent picks a set out of a dropdown, so two of them
-- reading the same is a set nobody can choose deliberately.
CREATE UNIQUE INDEX "QuickReply_tenantId_name_key" ON "QuickReply"("tenantId", "name");
CREATE INDEX "QuickReply_tenantId_isActive_sortOrder_idx" ON "QuickReply"("tenantId", "isActive", "sortOrder");
CREATE INDEX "QuickReplyButton_quickReplyId_position_idx" ON "QuickReplyButton"("quickReplyId", "position");
-- So the SET NULL above does not have to scan the table when a workflow is deleted.
CREATE INDEX "QuickReplyButton_workflowId_idx" ON "QuickReplyButton"("workflowId");

ALTER TABLE "QuickReply" ADD CONSTRAINT "QuickReply_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "QuickReplyButton" ADD CONSTRAINT "QuickReplyButton_quickReplyId_fkey"
  FOREIGN KEY ("quickReplyId") REFERENCES "QuickReply"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "QuickReplyButton" ADD CONSTRAINT "QuickReplyButton_workflowId_fkey"
  FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id") ON DELETE SET NULL ON UPDATE CASCADE;
