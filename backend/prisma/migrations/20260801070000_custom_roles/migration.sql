-- Custom roles: a workspace defines its own, instead of three fixed ones.
--
-- Additive. The legacy `User.role` enum column stays, because dropping a column is
-- not an additive migration — it becomes the fallback for a user whose `roleId` is
-- somehow unset, and the record of what they were before anyone customised
-- anything. Both hand-written partial unique indexes are untouched.

CREATE TABLE "Role" (
  "id"          TEXT NOT NULL,
  "tenantId"    TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "description" TEXT,
  "permissions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "isOwner"     BOOLEAN NOT NULL DEFAULT false,
  "isSystem"    BOOLEAN NOT NULL DEFAULT false,
  "sortOrder"   INTEGER NOT NULL DEFAULT 100,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Role_tenantId_name_key" ON "Role"("tenantId", "name");
CREATE INDEX "Role_tenantId_sortOrder_idx" ON "Role"("tenantId", "sortOrder");

ALTER TABLE "Role" ADD CONSTRAINT "Role_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "User" ADD COLUMN "roleId" TEXT;
ALTER TABLE "User" ADD CONSTRAINT "User_roleId_fkey"
  FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── Seed the three starting roles for every existing workspace ───────────────
--
-- The permission lists mirror `ROLE_PERMISSIONS` in config/permissions.ts at the
-- time of this migration. They are literals rather than a reference because a
-- migration has to keep producing the same result forever, even after that table
-- changes — a workspace's roles are its own from this point on.
--
-- Owner's list is written for completeness, but `isOwner` means it is never read.

INSERT INTO "Role" ("id", "tenantId", "name", "description", "permissions", "isOwner", "isSystem", "sortOrder", "updatedAt")
SELECT
  gen_random_uuid(), t."id", 'Owner',
  'Full access, including the team, settings and the WhatsApp connection.',
  ARRAY[
    'inbox:read','inbox:reply','inbox:assign_self','inbox:assign_others','inbox:add_note',
    'inbox:toggle_automation','customers:read','customers:write','orders:read','orders:write',
    'catalogue:read','catalogue:write','workflows:read','workflows:author','workflows:publish',
    'workflows:delete','automation:write','templates:write','templates:delete','connectors:read',
    'connectors:author','connectors:delete','analytics:read','settings:read','settings:write',
    'channel:manage','channel:disconnect','team:read','team:manage','roles:manage',
    'impersonation:manage'
  ]::TEXT[],
  true, true, 10, NOW()
FROM "Tenant" t;

INSERT INTO "Role" ("id", "tenantId", "name", "description", "permissions", "isOwner", "isSystem", "sortOrder", "updatedAt")
SELECT
  gen_random_uuid(), t."id", 'Manager',
  'Runs the day to day: inbox, catalogue, orders, workflows and connectors.',
  ARRAY[
    'inbox:read','inbox:reply','inbox:assign_self','inbox:assign_others','inbox:add_note',
    'inbox:toggle_automation','customers:read','customers:write','orders:read','orders:write',
    'catalogue:read','catalogue:write','workflows:read','workflows:author','workflows:publish',
    'automation:write','templates:write','connectors:read','connectors:author','analytics:read',
    'settings:read','team:read'
  ]::TEXT[],
  false, true, 20, NOW()
FROM "Tenant" t;

INSERT INTO "Role" ("id", "tenantId", "name", "description", "permissions", "isOwner", "isSystem", "sortOrder", "updatedAt")
SELECT
  gen_random_uuid(), t."id", 'Agent',
  'Answers customers in the shared inbox. Read-only elsewhere.',
  ARRAY[
    'inbox:read','inbox:reply','inbox:assign_self','inbox:add_note','inbox:toggle_automation',
    'customers:read','orders:read','catalogue:read','workflows:read','connectors:read',
    'settings:read','team:read'
  ]::TEXT[],
  false, true, 30, NOW()
FROM "Tenant" t;

-- Point every existing user at the seeded role matching the enum they had, so
-- nobody's access changes on the day this ships.
UPDATE "User" u
SET "roleId" = r."id"
FROM "Role" r
WHERE r."tenantId" = u."tenantId"
  AND r."name" = CASE u."role"::text
    WHEN 'OWNER' THEN 'Owner'
    WHEN 'MANAGER' THEN 'Manager'
    ELSE 'Agent'
  END;
