-- CreateEnum
CREATE TYPE "WorkflowRunStatus" AS ENUM ('RUNNING', 'WAITING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "WorkflowRun" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "customerId" TEXT,
    "conversationId" TEXT,
    "status" "WorkflowRunStatus" NOT NULL DEFAULT 'RUNNING',
    "version" INTEGER NOT NULL,
    "variables" JSONB,
    "currentNodeId" TEXT,
    "resumeAt" TIMESTAMP(3),
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "WorkflowRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowRunStep" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "nodeType" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "input" JSONB,
    "output" JSONB,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "durationMs" INTEGER,

    CONSTRAINT "WorkflowRunStep_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkflowRun_tenantId_status_idx" ON "WorkflowRun"("tenantId", "status");

-- CreateIndex
CREATE INDEX "WorkflowRun_status_resumeAt_idx" ON "WorkflowRun"("status", "resumeAt");

-- CreateIndex
CREATE INDEX "WorkflowRun_workflowId_startedAt_idx" ON "WorkflowRun"("workflowId", "startedAt");

-- CreateIndex
CREATE INDEX "WorkflowRunStep_runId_startedAt_idx" ON "WorkflowRunStep"("runId", "startedAt");

-- AddForeignKey
ALTER TABLE "WorkflowRun" ADD CONSTRAINT "WorkflowRun_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowRun" ADD CONSTRAINT "WorkflowRun_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowRunStep" ADD CONSTRAINT "WorkflowRunStep_runId_fkey" FOREIGN KEY ("runId") REFERENCES "WorkflowRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

