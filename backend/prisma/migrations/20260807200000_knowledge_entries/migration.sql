-- What a business has told its assistant about itself.
--
-- The AI agent's only knowledge until now was `KeywordRule`, which is keyword-to-canned-reply.
-- A workspace with no rules produced a prompt whose knowledge section read "(none configured)"
-- directly above an instruction never to guess — an assistant that can only say it will check
-- with the team, however good the model is.
--
-- This holds prose instead. `KeywordRule` still feeds the same prompt: an exact canned answer
-- is worth keeping for the questions where the exact wording matters.
--
-- **Shaped like a chunk deliberately.** Every active row is injected whole today, which is the
-- right call while the corpus is a few pages: the model always sees everything, and it cannot
-- retrieve the wrong passage because it never retrieves. When documents arrive, a long one is
-- split across several of these rows and an embedding column is added beside `body`; retrieval
-- then slots in without the page, the API or the prompt builder changing shape.
--
-- Purely additive: one table, one index, one nullable FK. Nothing existing is altered or
-- dropped, so the two hand-written partial unique indexes
-- (WorkflowInstance_one_active_per_conversation, Price_one_active_per_plan_interval) are
-- untouched.

-- CreateTable
CREATE TABLE "KnowledgeEntry" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KnowledgeEntry_tenantId_isActive_sortOrder_idx"
    ON "KnowledgeEntry"("tenantId", "isActive", "sortOrder");

-- AddForeignKey
ALTER TABLE "KnowledgeEntry" ADD CONSTRAINT "KnowledgeEntry_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeEntry" ADD CONSTRAINT "KnowledgeEntry_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
