-- Run AFTER `prisma migrate deploy`, on the same database.
--
-- Two jobs: re-point any rescued tenants at real BusinessCategory rows, and assert the things
-- that must be true before traffic is allowed near this database.

-- ── 1. Re-point rescued tenants (no-op unless pre-migrate.sql had to flatten) ─
DO $$
BEGIN
  IF to_regclass('_category_rescue') IS NULL THEN
    RAISE NOTICE 'No _category_rescue table — nothing was flattened.';
    RETURN;
  END IF;

  -- Adjust these to match the decision recorded in pre-migrate.sql.
  UPDATE "Tenant" t
     SET "businessCategoryId" = c.id
    FROM _category_rescue r
    JOIN "BusinessCategory" c ON c.key = 'ECOMMERCE_GROCERY'
   WHERE t.id = r.id AND r.legacy = 'RETAIL';

  RAISE NOTICE 'Rescued tenants re-pointed. Review, then: DROP TABLE _category_rescue;';
END $$;

-- ── 2. Assertions. Any failure here stops the cutover. ───────────────────────
\echo '--- migrations applied (expect 36, and 0 unfinished) ---'
SELECT count(*) FILTER (WHERE finished_at IS NOT NULL) AS applied,
       count(*) FILTER (WHERE finished_at IS NULL)     AS unfinished
  FROM "_prisma_migrations";

DO $$
DECLARE unfinished int;
BEGIN
  SELECT count(*) INTO unfinished FROM "_prisma_migrations" WHERE finished_at IS NULL;
  IF unfinished > 0 THEN
    RAISE EXCEPTION 'A migration did not finish. Resolve with: prisma migrate resolve --rolled-back <name>';
  END IF;
END $$;

-- The two hand-written partial unique indexes. Prisma cannot express them, so they live in
-- raw SQL inside their migrations and have to be re-checked after every migrate run — a
-- silently missing one lets two live workflow instances share a conversation, or two active
-- prices share a plan+interval.
\echo '--- the two partial unique indexes (both must be present) ---'
SELECT indexname
  FROM pg_indexes
 WHERE schemaname = 'public'
   AND indexname IN ('WorkflowInstance_one_active_per_conversation',
                     'Price_one_active_per_plan_interval')
 ORDER BY indexname;

DO $$
DECLARE found int;
BEGIN
  SELECT count(*) INTO found FROM pg_indexes
   WHERE schemaname = 'public'
     AND indexname IN ('WorkflowInstance_one_active_per_conversation',
                       'Price_one_active_per_plan_interval');
  IF found <> 2 THEN
    RAISE EXCEPTION 'Expected both partial unique indexes, found %.', found;
  END IF;
END $$;

\echo '--- row counts: compare against the source database before proceeding ---'
SELECT 'Tenant' AS t, count(*) FROM "Tenant"
UNION ALL SELECT 'User',         count(*) FROM "User"
UNION ALL SELECT 'Customer',     count(*) FROM "Customer"
UNION ALL SELECT 'Conversation', count(*) FROM "Conversation"
UNION ALL SELECT 'Message',      count(*) FROM "Message"
UNION ALL SELECT 'Order',        count(*) FROM "Order"
ORDER BY 1;
