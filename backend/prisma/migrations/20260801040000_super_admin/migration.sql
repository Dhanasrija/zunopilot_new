-- Super admin: the platform operator's surface.
--
-- Purely additive — two new tables, nothing altered. Both hand-written partial
-- unique indexes (`WorkflowInstance_one_active_per_conversation`,
-- `Price_one_active_per_plan_interval`) are untouched.

CREATE TABLE "SuperAdmin" (
  "id"           TEXT NOT NULL,
  "email"        TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "fullName"     TEXT NOT NULL,
  "isActive"     BOOLEAN NOT NULL DEFAULT true,
  "lastLoginAt"  TIMESTAMP(3),
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SuperAdmin_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SuperAdmin_email_key" ON "SuperAdmin"("email");

-- `tenantId` is a plain column, not a foreign key. A cascade would delete the
-- audit trail of what was done to a workspace at the moment it is most needed.
CREATE TABLE "AuditEvent" (
  "id"           TEXT NOT NULL,
  "superAdminId" TEXT,
  "action"       TEXT NOT NULL,
  "tenantId"     TEXT,
  "targetType"   TEXT,
  "targetId"     TEXT,
  "summary"      TEXT NOT NULL,
  "metadata"     JSONB NOT NULL DEFAULT '{}',
  "ip"           TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AuditEvent_tenantId_createdAt_idx" ON "AuditEvent"("tenantId", "createdAt");
CREATE INDEX "AuditEvent_createdAt_idx" ON "AuditEvent"("createdAt");
CREATE INDEX "AuditEvent_superAdminId_createdAt_idx" ON "AuditEvent"("superAdminId", "createdAt");

ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_superAdminId_fkey"
  FOREIGN KEY ("superAdminId") REFERENCES "SuperAdmin"("id") ON DELETE SET NULL ON UPDATE CASCADE;
