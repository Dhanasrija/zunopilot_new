-- A catalog of connector types, curated by the operator.
--
-- Purely additive: two new tables and one new nullable column. Nothing existing is altered
-- or dropped, so the two hand-written partial unique indexes Prisma does not know about —
-- `WorkflowInstance_one_active_per_conversation` and `Price_one_active_per_plan_interval` —
-- are untouched.
--
-- `Connector.connectorTypeId` is nullable and `ON DELETE SET NULL` on purpose. Every
-- connector registered before the catalog keeps working with a null, and deleting a type can
-- never delete a tenant's connector.

CREATE TABLE "ConnectorType" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "kind" "ConnectorKind" NOT NULL DEFAULT 'HTTP',
    "allowedAuthTypes" "ConnectorAuthType"[] DEFAULT ARRAY[]::"ConnectorAuthType"[],
    "defaultBaseUrl" TEXT,
    "secretLabel" TEXT,
    "usernameLabel" TEXT,
    "defaultHeader" TEXT,
    "docsUrl" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConnectorType_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ConnectorType_key_key" ON "ConnectorType"("key");
CREATE INDEX "ConnectorType_isActive_sortOrder_idx" ON "ConnectorType"("isActive", "sortOrder");

CREATE TABLE "ConnectorTypeOperation" (
    "id" TEXT NOT NULL,
    "connectorTypeId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "method" TEXT NOT NULL DEFAULT 'GET',
    "path" TEXT NOT NULL DEFAULT '/',
    "inputs" JSONB NOT NULL DEFAULT '[]',
    "responseMapping" JSONB NOT NULL DEFAULT '{}',
    "sideEffecting" BOOLEAN NOT NULL DEFAULT false,
    "timeoutMs" INTEGER,
    "sampleResponse" JSONB,
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConnectorTypeOperation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ConnectorTypeOperation_connectorTypeId_key_key"
    ON "ConnectorTypeOperation"("connectorTypeId", "key");

ALTER TABLE "ConnectorTypeOperation" ADD CONSTRAINT "ConnectorTypeOperation_connectorTypeId_fkey"
    FOREIGN KEY ("connectorTypeId") REFERENCES "ConnectorType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Connector" ADD COLUMN "connectorTypeId" TEXT;

ALTER TABLE "Connector" ADD CONSTRAINT "Connector_connectorTypeId_fkey"
    FOREIGN KEY ("connectorTypeId") REFERENCES "ConnectorType"("id") ON DELETE SET NULL ON UPDATE CASCADE;
