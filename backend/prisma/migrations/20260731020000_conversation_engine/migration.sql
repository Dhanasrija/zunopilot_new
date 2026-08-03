-- CreateEnum
CREATE TYPE "AssistantStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED');

-- CreateEnum
CREATE TYPE "WorkflowCategory" AS ENUM ('CONVERSATION', 'EVENT');

-- CreateEnum
CREATE TYPE "WorkflowInstanceStatus" AS ENUM ('PENDING', 'RUNNING', 'WAITING_FOR_USER', 'WAITING_FOR_APPROVAL', 'PAUSED', 'COMPLETED', 'CANCELLED', 'FAILED');

-- CreateEnum
CREATE TYPE "NodeExecutionStatus" AS ENUM ('PENDING', 'RUNNING', 'WAITING', 'SUCCESS', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "RoutingSource" AS ENUM ('ACTIVE_WORKFLOW', 'DETERMINISTIC', 'AI_ROUTER', 'FALLBACK');

-- CreateEnum
CREATE TYPE "RoutingDecisionType" AS ENUM ('START_WORKFLOW', 'RESUME_WORKFLOW', 'ASK_CLARIFICATION', 'GENERAL_RESPONSE', 'HUMAN_HANDOFF', 'NO_MATCH');

-- CreateEnum
CREATE TYPE "RoutingRuleType" AS ENUM ('BUTTON_PAYLOAD', 'LIST_PAYLOAD', 'KEYWORD', 'CUSTOMER_TAG', 'BUSINESS_HOURS', 'CRM_STATE', 'COMMAND');

-- CreateEnum
CREATE TYPE "HandoffStatus" AS ENUM ('PENDING', 'ACTIVE', 'RESOLVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "WebhookProcessingStatus" AS ENUM ('PENDING', 'PROCESSING', 'PROCESSED', 'FAILED', 'IGNORED');

-- DropIndex
DROP INDEX "WhatsappAccount_tenantId_key";

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "activeWorkflowInstanceId" TEXT,
ADD COLUMN     "assistantId" TEXT,
ADD COLUMN     "externalConversationKey" TEXT,
ADD COLUMN     "summary" TEXT;

-- AlterTable
ALTER TABLE "Workflow" ADD COLUMN     "assistantId" TEXT,
ADD COLUMN     "category" "WorkflowCategory" NOT NULL DEFAULT 'CONVERSATION',
ADD COLUMN     "priority" INTEGER NOT NULL DEFAULT 50,
ADD COLUMN     "publishedVersionId" TEXT,
ADD COLUMN     "slug" TEXT;

-- CreateTable
CREATE TABLE "Assistant" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "whatsappChannelId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "generalSystemPrompt" TEXT,
    "generalResponseEnabled" BOOLEAN NOT NULL DEFAULT true,
    "defaultFallbackWorkflowId" TEXT,
    "humanHandoffWorkflowId" TEXT,
    "highConfidenceThreshold" DOUBLE PRECISION NOT NULL DEFAULT 0.80,
    "mediumConfidenceThreshold" DOUBLE PRECISION NOT NULL DEFAULT 0.55,
    "maxRecentMessages" INTEGER NOT NULL DEFAULT 8,
    "status" "AssistantStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Assistant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowCapability" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "description" TEXT,
    "useWhen" JSONB NOT NULL DEFAULT '[]',
    "doNotUseWhen" JSONB NOT NULL DEFAULT '[]',
    "positiveExamples" JSONB NOT NULL DEFAULT '[]',
    "negativeExamples" JSONB NOT NULL DEFAULT '[]',
    "preconditions" JSONB NOT NULL DEFAULT '[]',
    "sideEffects" JSONB NOT NULL DEFAULT '[]',
    "requiredInputs" JSONB NOT NULL DEFAULT '[]',
    "optionalInputs" JSONB NOT NULL DEFAULT '[]',
    "requiresConfirmation" BOOLEAN NOT NULL DEFAULT false,
    "minimumConfidence" DOUBLE PRECISION NOT NULL DEFAULT 0.80,
    "allowsInterruption" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkflowCapability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowVersion" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "definition" JSONB NOT NULL,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),

    CONSTRAINT "WorkflowVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowInstance" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "workflowVersionId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "status" "WorkflowInstanceStatus" NOT NULL DEFAULT 'PENDING',
    "currentNodeId" TEXT,
    "variables" JSONB,
    "inputData" JSONB,
    "outputData" JSONB,
    "resumeAt" TIMESTAMP(3),
    "waitingNodeId" TEXT,
    "waitingVariableName" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkflowInstance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NodeExecution" (
    "id" TEXT NOT NULL,
    "workflowInstanceId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "nodeType" TEXT NOT NULL,
    "status" "NodeExecutionStatus" NOT NULL DEFAULT 'PENDING',
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "input" JSONB,
    "output" JSONB,
    "error" JSONB,
    "idempotencyKey" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NodeExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoutingDecision" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "assistantId" TEXT,
    "inboundMessageId" TEXT,
    "source" "RoutingSource" NOT NULL,
    "decision" "RoutingDecisionType" NOT NULL,
    "selectedWorkflowId" TEXT,
    "confidence" DOUBLE PRECISION,
    "reasonCode" TEXT NOT NULL,
    "summary" TEXT,
    "extractedInputs" JSONB,
    "missingInputs" JSONB,
    "candidateWorkflowIds" JSONB,
    "promptVersion" TEXT,
    "model" TEXT,
    "latencyMs" INTEGER,
    "tokenUsage" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoutingDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoutingRule" (
    "id" TEXT NOT NULL,
    "assistantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "RoutingRuleType" NOT NULL,
    "configuration" JSONB NOT NULL,
    "workflowId" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 50,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoutingRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HumanHandoff" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "workflowInstanceId" TEXT,
    "reason" TEXT NOT NULL,
    "status" "HandoffStatus" NOT NULL DEFAULT 'PENDING',
    "assignedTeamId" TEXT,
    "assignedUserId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "HumanHandoff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "source" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "externalEventId" TEXT,
    "payload" JSONB NOT NULL,
    "processingStatus" "WebhookProcessingStatus" NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoutingTestCase" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "assistantId" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "expectedDecision" "RoutingDecisionType" NOT NULL,
    "expectedWorkflowId" TEXT,
    "notes" TEXT,
    "lastRunAt" TIMESTAMP(3),
    "lastRunPassed" BOOLEAN,
    "lastRunActual" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoutingTestCase_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Assistant_tenantId_status_idx" ON "Assistant"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Assistant_whatsappChannelId_key" ON "Assistant"("whatsappChannelId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowCapability_workflowId_key" ON "WorkflowCapability"("workflowId");

-- CreateIndex
CREATE INDEX "WorkflowVersion_workflowId_createdAt_idx" ON "WorkflowVersion"("workflowId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowVersion_workflowId_version_key" ON "WorkflowVersion"("workflowId", "version");

-- CreateIndex
CREATE INDEX "WorkflowInstance_tenantId_status_idx" ON "WorkflowInstance"("tenantId", "status");

-- CreateIndex
CREATE INDEX "WorkflowInstance_conversationId_startedAt_idx" ON "WorkflowInstance"("conversationId", "startedAt");

-- CreateIndex
CREATE INDEX "WorkflowInstance_workflowId_startedAt_idx" ON "WorkflowInstance"("workflowId", "startedAt");

-- CreateIndex
CREATE INDEX "WorkflowInstance_status_resumeAt_idx" ON "WorkflowInstance"("status", "resumeAt");

-- CreateIndex
CREATE INDEX "NodeExecution_workflowInstanceId_startedAt_idx" ON "NodeExecution"("workflowInstanceId", "startedAt");

-- CreateIndex
CREATE INDEX "NodeExecution_idempotencyKey_idx" ON "NodeExecution"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "NodeExecution_workflowInstanceId_nodeId_attempt_key" ON "NodeExecution"("workflowInstanceId", "nodeId", "attempt");

-- CreateIndex
CREATE INDEX "RoutingDecision_conversationId_createdAt_idx" ON "RoutingDecision"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "RoutingDecision_tenantId_source_createdAt_idx" ON "RoutingDecision"("tenantId", "source", "createdAt");

-- CreateIndex
CREATE INDEX "RoutingRule_assistantId_enabled_priority_idx" ON "RoutingRule"("assistantId", "enabled", "priority");

-- CreateIndex
CREATE INDEX "HumanHandoff_tenantId_status_startedAt_idx" ON "HumanHandoff"("tenantId", "status", "startedAt");

-- CreateIndex
CREATE INDEX "HumanHandoff_conversationId_startedAt_idx" ON "HumanHandoff"("conversationId", "startedAt");

-- CreateIndex
CREATE INDEX "WebhookEvent_processingStatus_createdAt_idx" ON "WebhookEvent"("processingStatus", "createdAt");

-- CreateIndex
CREATE INDEX "WebhookEvent_tenantId_createdAt_idx" ON "WebhookEvent"("tenantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_source_externalEventId_key" ON "WebhookEvent"("source", "externalEventId");

-- CreateIndex
CREATE INDEX "RoutingTestCase_assistantId_createdAt_idx" ON "RoutingTestCase"("assistantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_activeWorkflowInstanceId_key" ON "Conversation"("activeWorkflowInstanceId");

-- CreateIndex
CREATE INDEX "Conversation_assistantId_idx" ON "Conversation"("assistantId");

-- CreateIndex
CREATE INDEX "Conversation_tenantId_externalConversationKey_idx" ON "Conversation"("tenantId", "externalConversationKey");

-- CreateIndex
CREATE INDEX "WhatsappAccount_tenantId_idx" ON "WhatsappAccount"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsappAccount_tenantId_phoneNumberId_key" ON "WhatsappAccount"("tenantId", "phoneNumberId");

-- CreateIndex
CREATE UNIQUE INDEX "Workflow_publishedVersionId_key" ON "Workflow"("publishedVersionId");

-- CreateIndex
CREATE INDEX "Workflow_assistantId_status_category_idx" ON "Workflow"("assistantId", "status", "category");

-- CreateIndex
CREATE UNIQUE INDEX "Workflow_tenantId_slug_key" ON "Workflow"("tenantId", "slug");

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_assistantId_fkey" FOREIGN KEY ("assistantId") REFERENCES "Assistant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_activeWorkflowInstanceId_fkey" FOREIGN KEY ("activeWorkflowInstanceId") REFERENCES "WorkflowInstance"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Workflow" ADD CONSTRAINT "Workflow_assistantId_fkey" FOREIGN KEY ("assistantId") REFERENCES "Assistant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Workflow" ADD CONSTRAINT "Workflow_publishedVersionId_fkey" FOREIGN KEY ("publishedVersionId") REFERENCES "WorkflowVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assistant" ADD CONSTRAINT "Assistant_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assistant" ADD CONSTRAINT "Assistant_whatsappChannelId_fkey" FOREIGN KEY ("whatsappChannelId") REFERENCES "WhatsappAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assistant" ADD CONSTRAINT "Assistant_defaultFallbackWorkflowId_fkey" FOREIGN KEY ("defaultFallbackWorkflowId") REFERENCES "Workflow"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assistant" ADD CONSTRAINT "Assistant_humanHandoffWorkflowId_fkey" FOREIGN KEY ("humanHandoffWorkflowId") REFERENCES "Workflow"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowCapability" ADD CONSTRAINT "WorkflowCapability_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowVersion" ADD CONSTRAINT "WorkflowVersion_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowInstance" ADD CONSTRAINT "WorkflowInstance_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowInstance" ADD CONSTRAINT "WorkflowInstance_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowInstance" ADD CONSTRAINT "WorkflowInstance_workflowVersionId_fkey" FOREIGN KEY ("workflowVersionId") REFERENCES "WorkflowVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowInstance" ADD CONSTRAINT "WorkflowInstance_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NodeExecution" ADD CONSTRAINT "NodeExecution_workflowInstanceId_fkey" FOREIGN KEY ("workflowInstanceId") REFERENCES "WorkflowInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoutingDecision" ADD CONSTRAINT "RoutingDecision_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoutingDecision" ADD CONSTRAINT "RoutingDecision_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoutingDecision" ADD CONSTRAINT "RoutingDecision_assistantId_fkey" FOREIGN KEY ("assistantId") REFERENCES "Assistant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoutingDecision" ADD CONSTRAINT "RoutingDecision_selectedWorkflowId_fkey" FOREIGN KEY ("selectedWorkflowId") REFERENCES "Workflow"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoutingRule" ADD CONSTRAINT "RoutingRule_assistantId_fkey" FOREIGN KEY ("assistantId") REFERENCES "Assistant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoutingRule" ADD CONSTRAINT "RoutingRule_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HumanHandoff" ADD CONSTRAINT "HumanHandoff_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HumanHandoff" ADD CONSTRAINT "HumanHandoff_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HumanHandoff" ADD CONSTRAINT "HumanHandoff_workflowInstanceId_fkey" FOREIGN KEY ("workflowInstanceId") REFERENCES "WorkflowInstance"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookEvent" ADD CONSTRAINT "WebhookEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoutingTestCase" ADD CONSTRAINT "RoutingTestCase_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoutingTestCase" ADD CONSTRAINT "RoutingTestCase_assistantId_fkey" FOREIGN KEY ("assistantId") REFERENCES "Assistant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoutingTestCase" ADD CONSTRAINT "RoutingTestCase_expectedWorkflowId_fkey" FOREIGN KEY ("expectedWorkflowId") REFERENCES "Workflow"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ─────────────────────────────────────────────────────────────────────────────
-- The core invariant: at most ONE live workflow instance per conversation.
--
-- This is the whole point of the router — "multiple workflows without allowing
-- multiple workflows to respond to the same incoming message". Application code
-- checks this too, but two webhook deliveries for the same customer can be
-- in-flight at once (Meta is acked before processing), so the check and the
-- insert are not atomic in application code alone. Postgres makes it atomic.
--
-- Prisma's schema language cannot express a partial index, so it is created
-- here and must be preserved by hand in future migrations.
--
-- Terminal states (COMPLETED / CANCELLED / FAILED) are excluded, so a
-- conversation can run many workflows over its lifetime — just never two at once.
CREATE UNIQUE INDEX "WorkflowInstance_one_active_per_conversation"
  ON "WorkflowInstance" ("conversationId")
  WHERE "status" IN ('PENDING', 'RUNNING', 'WAITING_FOR_USER', 'WAITING_FOR_APPROVAL', 'PAUSED');

-- Only one PUBLISHED conversation workflow may claim a given slug per tenant.
-- The @@unique([tenantId, slug]) above already covers this, but slug is
-- nullable, and Postgres treats NULLs as distinct — so drafts without a slug do
-- not collide, which is the behaviour we want.
