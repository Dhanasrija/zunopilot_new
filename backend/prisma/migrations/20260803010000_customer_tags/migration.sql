-- Free-form tags on a customer.
--
-- Purely additive: one column with a default, so every existing row gets an empty array
-- and nothing is rewritten. Both hand-written partial unique indexes
-- (`WorkflowInstance_one_active_per_conversation`, `Price_one_active_per_plan_interval`)
-- are untouched.
--
-- **This column makes a shipped feature work for the first time.** `tagsOf` in
-- src/modules/conversation-engine/routing/deterministic.ts reads `contact.tags` as an
-- array and comments that the Customer table has no such column, so every routing rule of
-- type CUSTOMER_TAG has matched nothing since it was written. A text array is exactly the
-- shape that code already expects, so nothing in the engine changes.

ALTER TABLE "Customer" ADD COLUMN "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- A GIN index, because every read of this column is a containment test — `tags @> '{vip}'`,
-- which is what Prisma's `has` compiles to. A btree cannot serve that, so without this the
-- tag filter is a sequential scan of the whole workspace.
CREATE INDEX "Customer_tags_idx" ON "Customer" USING GIN ("tags");
