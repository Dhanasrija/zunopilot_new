-- What each kind of business calls the things it sells.
--
-- "Menu" is a restaurant word, and the platform is not only restaurants: Restaurant, E-commerce
-- Grocery and IT Services are all live. Being told you have a Menu when you run a consultancy is
-- a small, constant signal that the product was built for somebody else.
--
-- Half of this already existed and was inconsistent: the Menu page adapted with a hardcoded
-- `grocery ? 'Products' : 'Menu'` while the sidebar said "Menu" unconditionally, so a grocery
-- workspace read one word in the nav and a different one on the page it opened. One source,
-- here, fixes that by construction.
--
-- Two nouns rather than one because the screen needs both: "Add Product" and "Product Category"
-- cannot be derived from "Products" without pluralisation rules nobody wants to maintain.
--
-- **Nullable, and unset means "Catalogue".** A category an operator adds tomorrow reads the
-- generic word until they give it a better one, rather than silently inheriting a restaurant's.
-- Seeded here for the three rows that exist tonight so nobody has to visit the console to get
-- today's behaviour back; everything after that is edited in the console, which is the reason
-- these rows are in the database rather than in an enum.
--
-- Purely additive: two nullable columns and an UPDATE of three existing rows by stable key.
-- Nothing altered or dropped, so the two hand-written partial unique indexes
-- (WorkflowInstance_one_active_per_conversation and Price_one_active_per_plan_interval) are
-- untouched.

-- AlterTable
ALTER TABLE "BusinessCategory" ADD COLUMN "catalogueNoun" TEXT;
ALTER TABLE "BusinessCategory" ADD COLUMN "catalogueItemNoun" TEXT;

-- Seed the categories that exist today. Matched on `key`, which is stable forever by contract.
UPDATE "BusinessCategory" SET "catalogueNoun" = 'Menu',     "catalogueItemNoun" = 'Item'
  WHERE "key" = 'RESTAURANT';
UPDATE "BusinessCategory" SET "catalogueNoun" = 'Products', "catalogueItemNoun" = 'Product'
  WHERE "key" = 'ECOMMERCE_GROCERY';
UPDATE "BusinessCategory" SET "catalogueNoun" = 'Services', "catalogueItemNoun" = 'Service'
  WHERE "key" = 'IT_SERVICES';
