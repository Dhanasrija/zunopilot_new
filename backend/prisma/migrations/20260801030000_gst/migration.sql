-- GST: 18% charged on top of the listed price, split by place of supply.
--
-- Purely additive. Every column is nullable or defaulted, so the two
-- hand-written partial unique indexes
-- (`WorkflowInstance_one_active_per_conversation`,
-- `Price_one_active_per_plan_interval`) are untouched and no existing row needs
-- backfilling. Invoices already issued keep taxPaise = 0 and their
-- "billed separately" note, which is what was true when they were issued.

-- Where the buyer is, captured once at checkout and reused. The state decides
-- CGST+SGST vs IGST; the GSTIN is what lets them claim input credit.
ALTER TABLE "Tenant" ADD COLUMN "gstin" TEXT;
ALTER TABLE "Tenant" ADD COLUMN "gstStateCode" TEXT;

-- Frozen onto the invoice at issue, for the same reason every other buyer
-- detail is: an invoice must still be true after the workspace edits its
-- profile.
ALTER TABLE "Invoice" ADD COLUMN "billedToState" TEXT;
ALTER TABLE "Invoice" ADD COLUMN "placeOfSupply" TEXT;
ALTER TABLE "Invoice" ADD COLUMN "sellerGstin" TEXT;
ALTER TABLE "Invoice" ADD COLUMN "cgstPaise" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Invoice" ADD COLUMN "sgstPaise" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Invoice" ADD COLUMN "igstPaise" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Invoice" ADD COLUMN "taxRatePercent" DOUBLE PRECISION NOT NULL DEFAULT 0;
