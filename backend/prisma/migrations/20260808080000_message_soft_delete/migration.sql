-- Removing a message from the Inbox.
--
-- A soft delete, not a DELETE. A message is the evidence in a payment dispute and the context of
-- a support ticket, so an agent tidying a thread must not be able to destroy what a customer was
-- promised. `deletedAt` hides it; `deletedByUserId` answers "who removed this", which is the
-- first question asked in a shared inbox.
--
-- **This is also not an unsend.** The WhatsApp Cloud API has no endpoint to delete a message the
-- business already sent, so the customer keeps their copy either way — which is why the UI says
-- "Remove from inbox" rather than "Delete".
--
-- A partial index is deliberately not added. Every message read is already keyed on
-- `Message_conversationId_createdAt_idx`, whose leading column narrows to one conversation
-- before `deletedAt` is considered, and a thread is capped at 500 rows.
--
-- Purely additive: two nullable columns and one self-evident foreign key. The two hand-written
-- partial unique indexes (WorkflowInstance_one_active_per_conversation and
-- Price_one_active_per_plan_interval) are untouched.

-- AlterTable
ALTER TABLE "Message" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "Message" ADD COLUMN "deletedByUserId" TEXT;

-- AddForeignKey
-- SetNull, matching `sentByUserId`: a member leaving must not resurrect the messages they hid.
ALTER TABLE "Message" ADD CONSTRAINT "Message_deletedByUserId_fkey"
  FOREIGN KEY ("deletedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
