-- Module 13: connectors.
-- Purely additive: four new tables and three enums. Nothing existing is
-- altered or dropped, so the hand-written partial unique index
-- "WorkflowInstance_one_active_per_conversation" — which Prisma does not
-- know about — is untouched.

-- CreateEnum
CREATE TYPE "ConnectorKind" AS ENUM ('HTTP', 'MOCK', 'GOOGLE_SHEETS', 'EMAIL');

-- CreateEnum
CREATE TYPE "ConnectorAuthType" AS ENUM ('NONE', 'API_KEY_HEADER', 'BEARER', 'BASIC');

-- CreateEnum
CREATE TYPE "ConnectorStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateTable
CREATE TABLE "Connector" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" "ConnectorKind" NOT NULL DEFAULT 'HTTP',
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "baseUrl" TEXT,
    "authType" "ConnectorAuthType" NOT NULL DEFAULT 'NONE',
    "authConfig" JSONB NOT NULL DEFAULT '{}',
    "status" "ConnectorStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Connector_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConnectorSecret" (
    "connectorId" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "hint" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConnectorSecret_pkey" PRIMARY KEY ("connectorId")
);

-- CreateTable
CREATE TABLE "ConnectorOperation" (
    "id" TEXT NOT NULL,
    "connectorId" TEXT NOT NULL,
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
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConnectorOperation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConnectorCall" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "connectorId" TEXT NOT NULL,
    "operationId" TEXT,
    "workflowInstanceId" TEXT,
    "nodeExecutionId" TEXT,
    "status" TEXT NOT NULL,
    "httpStatus" INTEGER,
    "durationMs" INTEGER,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConnectorCall_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Connector_tenantId_status_idx" ON "Connector"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Connector_tenantId_key_key" ON "Connector"("tenantId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "ConnectorOperation_connectorId_key_key" ON "ConnectorOperation"("connectorId", "key");

-- CreateIndex
CREATE INDEX "ConnectorCall_tenantId_createdAt_idx" ON "ConnectorCall"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "ConnectorCall_connectorId_createdAt_idx" ON "ConnectorCall"("connectorId", "createdAt");

-- AddForeignKey
ALTER TABLE "Connector" ADD CONSTRAINT "Connector_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConnectorSecret" ADD CONSTRAINT "ConnectorSecret_connectorId_fkey" FOREIGN KEY ("connectorId") REFERENCES "Connector"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConnectorOperation" ADD CONSTRAINT "ConnectorOperation_connectorId_fkey" FOREIGN KEY ("connectorId") REFERENCES "Connector"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConnectorCall" ADD CONSTRAINT "ConnectorCall_connectorId_fkey" FOREIGN KEY ("connectorId") REFERENCES "Connector"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConnectorCall" ADD CONSTRAINT "ConnectorCall_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "ConnectorOperation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

