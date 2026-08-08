-- Split the customer's name into two: WhatsApp's and the agent's.
--
-- `Customer.name` held both meanings, and the inbound upsert overwrote it from
-- `contacts[].profile.name` on every single message. So an agent who renamed a customer to
-- "Ravi — accounts, chases invoices" lost that the next time Ravi wrote anything. From here
-- `name` is the agent's label and `waProfileName` is Meta's, refreshed on every message.
--
-- Additive. The two hand-written partial unique indexes
-- (WorkflowInstance_one_active_per_conversation, Price_one_active_per_plan_interval) are
-- untouched.

ALTER TABLE "Customer" ADD COLUMN "waProfileName" TEXT;

-- **Copy, do not move.**
--
-- For every existing row `name` is almost certainly WhatsApp's profile name already — the old
-- upsert overwrote it whenever the customer messaged, so any agent edit had a lifetime of one
-- inbound message. Copying it means the profile name is known immediately, before the customer
-- writes again, and the Inbox reads exactly as it did before this migration.
--
-- `name` is deliberately **not** cleared. It cannot be told apart from an agent's label here,
-- and the one case where it genuinely is one — edited, then the customer never wrote again —
-- would be silently destroyed. The display suppresses the parenthetical while the two are
-- equal, so a duplicate reads as one name rather than "X (X)".
--
-- The bounded cost of that choice, stated so nobody rediscovers it as a bug: if such a customer
-- later changes their WhatsApp profile name, the old value stays in `name` and starts rendering
-- as though an agent had typed it. That produces a redundant-looking label, never a lost name
-- and never a wrong recipient, and clearing the field fixes it.
UPDATE "Customer" SET "waProfileName" = "name" WHERE "name" IS NOT NULL;
