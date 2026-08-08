-- Memberships: one login, many workspaces.
--
-- `User` becomes identity — a phone number, a name, notification preferences — and `Membership`
-- becomes the answer to "which workspaces may this login reach, and as what". The role is per
-- membership, because the same person is an owner in the workspace they founded and an agent in
-- the one that invited them.
--
-- **Additive.** `User.tenantId`, `User.role`, `User.roleId` and `User.isActive` all stay: dropping
-- a column is not an additive migration, the backfill below reads all four, and `tenantId` remains
-- a true record of which workspace created a login. Nothing reads `Membership` yet — this
-- migration and the model exist so the next commit can start writing to it, and the one after that
-- can start reading. Both hand-written partial unique indexes
-- (WorkflowInstance_one_active_per_conversation and Price_one_active_per_plan_interval) are
-- untouched.

-- CreateTable
CREATE TABLE "Membership" (
  "id"             TEXT NOT NULL,
  "userId"         TEXT NOT NULL,
  "tenantId"       TEXT NOT NULL,
  "roleId"         TEXT,
  "legacyRole"     "UserRole" NOT NULL DEFAULT 'AGENT',
  "isActive"       BOOLEAN NOT NULL DEFAULT true,
  "joinedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt"      TIMESTAMP(3),
  "lastSelectedAt" TIMESTAMP(3),
  "invitedById"    TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Membership_userId_tenantId_key" ON "Membership"("userId", "tenantId");

-- CreateIndex
CREATE INDEX "Membership_tenantId_isActive_idx" ON "Membership"("tenantId", "isActive");

-- CreateIndex
CREATE INDEX "Membership_userId_isActive_idx" ON "Membership"("userId", "isActive");

-- CreateIndex
CREATE INDEX "Membership_roleId_idx" ON "Membership"("roleId");

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
--
-- `SET NULL`, matching `User.roleId`: deleting a role must not delete the people who held it. They
-- fall back to `legacyRole` until somebody gives them a new one.
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_roleId_fkey"
  FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
--
-- `SET NULL`: losing the record of who invited somebody must not remove the person.
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_invitedById_fkey"
  FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── Backfill: one membership per existing user ───────────────────────────────
--
-- Cardinality is 1:1 today. `User.tenantId` is `NOT NULL`, so every user belongs to exactly one
-- workspace and this is a straight copy rather than a decision.
--
-- Written with literal column reads and no reference to any TypeScript constant, following
-- `20260801070000_custom_roles`: a migration has to keep producing the same result forever, even
-- after the code it was written alongside has changed.
--
-- `joinedAt` takes the user's own `createdAt` — the honest answer, and what the team screen should
-- order by from now on instead of "when this account was created", which under memberships may
-- have happened in a different workspace entirely.
--
-- `revokedAt` is derived from `isActive` rather than left null. A deactivated person needs a
-- revocation time or the team screen cannot say when they left; `updatedAt` is the closest thing
-- to the truth that exists, since the old deactivation path recorded nothing else.
INSERT INTO "Membership" (
  "id", "userId", "tenantId", "roleId", "legacyRole", "isActive",
  "joinedAt", "revokedAt", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid(),
  u."id",
  u."tenantId",
  u."roleId",
  u."role",
  u."isActive",
  u."createdAt",
  CASE WHEN u."isActive" THEN NULL ELSE u."updatedAt" END,
  u."createdAt",
  NOW()
FROM "User" u;
