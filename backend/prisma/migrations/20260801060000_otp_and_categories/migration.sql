-- OTP login, managed business categories, and the billing address move.
--
-- Additive throughout. The two NOT NULL drops (User.email, User.passwordHash)
-- only ever widen what a row may contain, so no existing row becomes invalid.
-- Nothing is dropped: the legacy `Tenant.category` enum column stays, because
-- removing a column is not an additive migration. It is never read again.
-- Both hand-written partial unique indexes are untouched.

-- ── Users: phone is the identifier, email is optional ────────────────────────
ALTER TABLE "User" ADD COLUMN "phone" TEXT;
ALTER TABLE "User" ADD COLUMN "country" TEXT;
ALTER TABLE "User" ALTER COLUMN "email" DROP NOT NULL;
ALTER TABLE "User" ALTER COLUMN "passwordHash" DROP NOT NULL;

-- Postgres allows many NULLs in a unique index, so existing rows without a phone
-- coexist without needing a placeholder value.
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");

-- ── Business categories, managed rather than compiled in ─────────────────────
--
-- The old Prisma enum occupies the type name `BusinessCategory` in Postgres, and
-- a table cannot share it. The enum is renamed rather than dropped: renaming a
-- type loses no data and the vestigial `Tenant.category` column keeps working
-- under the new name — which also makes it self-documenting as legacy.
ALTER TYPE "BusinessCategory" RENAME TO "BusinessCategoryLegacy";

CREATE TABLE "BusinessCategory" (
  "id"          TEXT NOT NULL,
  "key"         TEXT NOT NULL,
  "label"       TEXT NOT NULL,
  "description" TEXT,
  "sortOrder"   INTEGER NOT NULL DEFAULT 100,
  "isActive"    BOOLEAN NOT NULL DEFAULT true,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BusinessCategory_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BusinessCategory_key_key" ON "BusinessCategory"("key");

-- Seeded here rather than in a seed script so the backfill below can rely on
-- them existing, and so a fresh deploy is never briefly without a category to
-- pick.
INSERT INTO "BusinessCategory" ("id", "key", "label", "description", "sortOrder", "updatedAt")
VALUES
  (gen_random_uuid(), 'RESTAURANT', 'Restaurant', 'Menus, orders and table-side service over WhatsApp.', 10, NOW()),
  (gen_random_uuid(), 'ECOMMERCE_GROCERY', 'E-commerce (Grocery)', 'Catalogue, cart and delivery for grocery and retail.', 20, NOW());

ALTER TABLE "Tenant" ADD COLUMN "businessCategoryId" TEXT;
ALTER TABLE "Tenant" ADD COLUMN "onboardingCompletedAt" TIMESTAMP(3);

ALTER TABLE "Tenant" ADD CONSTRAINT "Tenant_businessCategoryId_fkey"
  FOREIGN KEY ("businessCategoryId") REFERENCES "BusinessCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill from the enum, so every existing workspace keeps the category it had.
UPDATE "Tenant" t
SET "businessCategoryId" = c."id"
FROM "BusinessCategory" c
WHERE c."key" = t."category"::text;

-- Every workspace that exists today has already been set up, whatever state its
-- profile is in. Treating them as needing onboarding would drop real customers
-- onto a setup form on their next login.
UPDATE "Tenant" SET "onboardingCompletedAt" = "createdAt" WHERE "onboardingCompletedAt" IS NULL;

-- ── Billing address, moved out of signup ─────────────────────────────────────
ALTER TABLE "Tenant" ADD COLUMN "billingAddressLine1" TEXT;
ALTER TABLE "Tenant" ADD COLUMN "billingAddressLine2" TEXT;
ALTER TABLE "Tenant" ADD COLUMN "billingCity" TEXT;
ALTER TABLE "Tenant" ADD COLUMN "billingPostalCode" TEXT;
ALTER TABLE "Tenant" ADD COLUMN "billingCountry" TEXT;

-- The address collected at signup, if any, is the best guess at a billing address
-- and would otherwise be stranded on a field nothing reads any more.
UPDATE "Tenant" SET "billingAddressLine1" = "address"
WHERE "address" IS NOT NULL AND "billingAddressLine1" IS NULL;

-- ── OTP challenges ───────────────────────────────────────────────────────────
CREATE TABLE "OtpChallenge" (
  "id"         TEXT NOT NULL,
  "phone"      TEXT NOT NULL,
  "codeHash"   TEXT NOT NULL,
  "attempts"   INTEGER NOT NULL DEFAULT 0,
  "consumedAt" TIMESTAMP(3),
  "expiresAt"  TIMESTAMP(3) NOT NULL,
  "ip"         TEXT,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OtpChallenge_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "OtpChallenge_phone_createdAt_idx" ON "OtpChallenge"("phone", "createdAt");
CREATE INDEX "OtpChallenge_expiresAt_idx" ON "OtpChallenge"("expiresAt");
