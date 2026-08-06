-- Curated customer lists.
--
-- Purely additive: two tables, no column altered and no data touched. Both hand-written
-- partial unique indexes (`WorkflowInstance_one_active_per_conversation`,
-- `Price_one_active_per_plan_interval`) are untouched.
--
-- Membership is **static** — a list changes only when somebody changes it — so what was
-- reviewed before a campaign is what the campaign sends to. See the model comments in
-- schema.prisma.

CREATE TABLE "CustomerList" (
  "id"              TEXT NOT NULL,
  "tenantId"        TEXT NOT NULL,
  "name"            TEXT NOT NULL,
  "description"     TEXT,
  -- Plain id, not a foreign key: who curated a list stays worth knowing after that
  -- person's account is gone.
  "createdByUserId" TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CustomerList_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CustomerListMember" (
  "id"            TEXT NOT NULL,
  "listId"        TEXT NOT NULL,
  "customerId"    TEXT NOT NULL,
  "addedByUserId" TEXT,
  "addedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CustomerListMember_pkey" PRIMARY KEY ("id")
);

-- One meaning per name in a workspace. Two lists called "VIPs" is how the wrong group
-- gets messaged.
CREATE UNIQUE INDEX "CustomerList_tenantId_name_key" ON "CustomerList" ("tenantId", "name");
CREATE INDEX "CustomerList_tenantId_name_idx" ON "CustomerList" ("tenantId", "name");

-- Makes adding somebody twice a no-op, so bulk add can use ON CONFLICT DO NOTHING
-- (Prisma's `skipDuplicates`) and be retried safely.
CREATE UNIQUE INDEX "CustomerListMember_listId_customerId_key"
  ON "CustomerListMember" ("listId", "customerId");

-- "Which lists is this person on", for the customer detail panel.
CREATE INDEX "CustomerListMember_customerId_idx" ON "CustomerListMember" ("customerId");

ALTER TABLE "CustomerList"
  ADD CONSTRAINT "CustomerList_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Both sides cascade: deleting a list or a customer must not leave orphan membership
-- rows. Note the direction — deleting a *list* removes memberships and never customers.
ALTER TABLE "CustomerListMember"
  ADD CONSTRAINT "CustomerListMember_listId_fkey"
  FOREIGN KEY ("listId") REFERENCES "CustomerList" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CustomerListMember"
  ADD CONSTRAINT "CustomerListMember_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
