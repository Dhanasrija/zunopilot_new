-- Contact enquiries from the marketing site.
--
-- Purely additive: one enum, one table, nothing altered. Both hand-written partial
-- unique indexes (`WorkflowInstance_one_active_per_conversation`,
-- `Price_one_active_per_plan_interval`) are untouched.
--
-- **No `tenantId`, deliberately.** Every other table here is workspace-scoped;
-- someone enquiring on the marketing site has no workspace, and these are read
-- only from the super admin console. See the model comment in schema.prisma.

CREATE TYPE "EnquiryStatus" AS ENUM ('NEW', 'CONTACTED', 'CLOSED', 'SPAM');

CREATE TABLE "Enquiry" (
  "id"               TEXT NOT NULL,
  "fullName"         TEXT NOT NULL,
  "email"            TEXT NOT NULL,
  "phone"            TEXT NOT NULL,
  "interest"         TEXT NOT NULL,
  "message"          TEXT NOT NULL,
  "status"           "EnquiryStatus" NOT NULL DEFAULT 'NEW',
  "ip"               TEXT,
  "userAgent"        TEXT,
  "handledByAdminId" TEXT,
  "handledAt"        TIMESTAMP(3),
  "internalNote"     TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Enquiry_pkey" PRIMARY KEY ("id")
);

-- The console's two views: the open queue, and everything newest-first.
CREATE INDEX "Enquiry_status_createdAt_idx" ON "Enquiry" ("status", "createdAt");
CREATE INDEX "Enquiry_createdAt_idx" ON "Enquiry" ("createdAt");
