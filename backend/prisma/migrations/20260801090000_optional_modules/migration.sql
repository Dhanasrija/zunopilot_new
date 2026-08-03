-- Optional modules: Marketing, Leads and Customer Support, switched on per
-- workspace from the super admin console.
--
-- Purely additive: one enum and one table, no ALTER to anything that exists.
-- Both hand-written partial unique indexes
-- (`WorkflowInstance_one_active_per_conversation`, `Price_one_active_per_plan_interval`)
-- are untouched.
--
-- **No backfill, deliberately.** An absent row means the module is off, so every
-- existing workspace starts without these modules and an operator turns each one
-- on. Seeding rows here would hand every current customer three modules nobody
-- sold them, which is the one direction of this mistake that is not self-correcting.

CREATE TYPE "ModuleKey" AS ENUM ('MARKETING', 'LEADS', 'SUPPORT');

CREATE TABLE "TenantModule" (
  "id"               TEXT NOT NULL,
  "tenantId"         TEXT NOT NULL,
  "module"           "ModuleKey" NOT NULL,
  "enabled"          BOOLEAN NOT NULL DEFAULT false,
  "note"             TEXT,
  "updatedByAdminId" TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TenantModule_pkey" PRIMARY KEY ("id")
);

-- One row per workspace per module. Also the conflict target for the upsert the
-- toggle uses, so flipping a switch twice cannot produce two contradicting rows.
CREATE UNIQUE INDEX "TenantModule_tenantId_module_key" ON "TenantModule" ("tenantId", "module");
CREATE INDEX "TenantModule_tenantId_idx" ON "TenantModule" ("tenantId");

ALTER TABLE "TenantModule"
  ADD CONSTRAINT "TenantModule_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
