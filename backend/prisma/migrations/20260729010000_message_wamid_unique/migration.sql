-- Make webhook message inserts idempotent.
--
-- Meta retries webhook deliveries (on timeout or any non-200), so the same
-- wamid can arrive multiple times. Without a constraint each retry inserted a
-- duplicate message AND re-ran the automation engine, which could double-add
-- cart items or place duplicate orders.

-- Collapse any duplicates created before this constraint existed, keeping the
-- earliest row of each (tenantId, waMessageId) set. Required first: the unique
-- index below would otherwise fail on existing data.
DELETE FROM "Message" m
USING "Message" keep
WHERE m."waMessageId" IS NOT NULL
  AND m."tenantId"    = keep."tenantId"
  AND m."waMessageId" = keep."waMessageId"
  AND (
        m."createdAt" > keep."createdAt"
     OR (m."createdAt" = keep."createdAt" AND m."id" > keep."id")
  );

-- CreateIndex
-- Nullable columns: Postgres permits multiple NULLs, so outbound rows that have
-- no wamid yet are unaffected.
CREATE UNIQUE INDEX "Message_tenantId_waMessageId_key" ON "Message"("tenantId", "waMessageId");
