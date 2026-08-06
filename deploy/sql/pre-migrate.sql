-- Run against the RESTORED copy of appdb, BEFORE `prisma migrate deploy`.
--
-- Kept as a file rather than typed at the prompt so the real maintenance window executes
-- byte-for-byte what the rehearsal proved. Idempotent: safe to run twice.
--
-- ── The enum narrowing, and why this is currently a no-op ────────────────────
--
-- Migration 20260729000000_sync_grocery_category_and_item_attributes replaces
-- BusinessCategory with ('RESTAURANT','ECOMMERCE_GROCERY') via a USING cast, which FAILS on
-- any Tenant row holding a value outside that set.
--
-- Checked on 2026-08-06 against the live appdb: the only values present are RESTAURANT (2)
-- and ECOMMERCE_GROCERY (1). Both survive. So this file changes nothing today.
--
-- It exists anyway because the check must be re-run at cutover — a tenant created between now
-- and then could reintroduce a dropped value, and the failure mode is a migration that dies
-- halfway through a maintenance window.

\echo '--- Tenant categories before migrating (must be only RESTAURANT / ECOMMERCE_GROCERY) ---'
SELECT category::text AS category, count(*) AS tenants
  FROM "Tenant"
 GROUP BY 1
 ORDER BY 1;

DO $$
DECLARE
  doomed text[];
BEGIN
  SELECT array_agg(DISTINCT category::text)
    INTO doomed
    FROM "Tenant"
   WHERE category::text NOT IN ('RESTAURANT', 'ECOMMERCE_GROCERY');

  IF doomed IS NOT NULL THEN
    -- Park the originals before flattening, so the post-migrate step can re-point them at
    -- real BusinessCategory rows. Migration 20260801060000 turns the enum into a table and
    -- backfills by joining on the text value — flatten first without recording, and the
    -- distinction is gone for good.
    CREATE TABLE IF NOT EXISTS _category_rescue AS
      SELECT id, category::text AS legacy FROM "Tenant";

    RAISE EXCEPTION
      'Tenant rows hold categories the migration will drop: %. Originals saved to _category_rescue. Decide the mapping, add the UPDATE below, and re-run.',
      doomed;
  END IF;

  RAISE NOTICE 'No doomed categories. Safe to migrate.';
END $$;

-- If the block above raises, uncomment and adjust, then re-run:
--
--   UPDATE "Tenant" SET category = 'RESTAURANT'
--    WHERE category::text IN ('SALON', 'CLINIC', 'OTHER');
--   UPDATE "Tenant" SET category = 'ECOMMERCE_GROCERY'
--    WHERE category::text = 'RETAIL';
