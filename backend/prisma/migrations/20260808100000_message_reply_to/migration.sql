-- Quoting a message when you reply to it.
--
-- Meta calls this `context`: send `context.message_id` and WhatsApp draws the quoted bubble above
-- the reply on the customer's phone; when a customer replies to one of ours, Meta hands us
-- `context.id` on the way in. `replyToId` is our side of both directions.
--
-- **SetNull rather than Cascade.** Removing the quoted message must not take the reply with it —
-- the reply is its own thing somebody said, and losing it because the message above it was tidied
-- away would be a data loss nobody asked for. The quote block just stops rendering.
--
-- Indexed because rendering a thread resolves quotes for up to 500 rows, and because the reverse
-- question ("what replied to this?") is the obvious next one.
--
-- Purely additive: one nullable column, one self-referencing foreign key, one index. The two
-- hand-written partial unique indexes (WorkflowInstance_one_active_per_conversation and
-- Price_one_active_per_plan_interval) are untouched.

-- AlterTable
ALTER TABLE "Message" ADD COLUMN "replyToId" TEXT;

-- CreateIndex
CREATE INDEX "Message_replyToId_idx" ON "Message" ("replyToId");

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_replyToId_fkey"
  FOREIGN KEY ("replyToId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;
