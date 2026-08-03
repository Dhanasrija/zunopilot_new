import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import { prisma } from '../../../config/prisma.js';
import { asyncHandler } from '../../../utils/asyncHandler.js';
import { ApiError } from '../../../utils/ApiError.js';
import { tenantIdOf } from '../../../middleware/auth.js';
import { parseDefinition } from '../domain/definition.js';
import { cancelInstance, handOffToHuman, startInstance } from '../engine/instance-manager.js';
import { resumeWithUserInput } from '../engine/resume.js';
import { walk, type WalkDeps } from '../engine/walker.js';
import { MOCK_INTEGRATIONS, MockHttpCaller, MockLlmProvider, MockWhatsAppProvider } from '../providers/mock.js';

// Workflow instances: inspection, control, and the test simulator.

const requireInstance = async (req: Request) => {
  const instance = await prisma.workflowInstance.findFirst({
    where: { id: req.params.instanceId, tenantId: tenantIdOf(req) },
    include: {
      workflow: { select: { id: true, name: true, slug: true } },
      workflowVersion: { select: { id: true, version: true } },
    },
  });
  if (!instance) throw ApiError.notFound('Workflow instance not found');
  return instance;
};

export const listInstances = asyncHandler(async (req: Request, res: Response) => {
  const { status, workflowId, conversationId, limit } = req.query as unknown as {
    status?: Prisma.WorkflowInstanceWhereInput['status'];
    workflowId?: string;
    conversationId?: string;
    limit: number;
  };

  const instances = await prisma.workflowInstance.findMany({
    where: {
      tenantId: tenantIdOf(req),
      ...(status ? { status } : {}),
      ...(workflowId ? { workflowId } : {}),
      ...(conversationId ? { conversationId } : {}),
    },
    include: {
      workflow: { select: { name: true, slug: true } },
      _count: { select: { executions: true } },
    },
    orderBy: { startedAt: 'desc' },
    take: limit,
  });

  res.json({ success: true, data: instances });
});

export const getInstance = asyncHandler(async (req: Request, res: Response) => {
  const instance = await requireInstance(req);
  res.json({ success: true, data: instance });
});

/** The Execution Log: what actually ran, in order, with inputs and outputs. */
export const getInstanceExecutions = asyncHandler(async (req: Request, res: Response) => {
  const instance = await requireInstance(req);
  const executions = await prisma.nodeExecution.findMany({
    where: { workflowInstanceId: instance.id },
    orderBy: { startedAt: 'asc' },
  });

  res.json({
    success: true,
    data: {
      instance: {
        id: instance.id,
        status: instance.status,
        workflow: instance.workflow,
        version: instance.workflowVersion.version,
        variables: instance.variables,
        currentNodeId: instance.currentNodeId,
        waitingNodeId: instance.waitingNodeId,
        waitingVariableName: instance.waitingVariableName,
        error: instance.error,
        startedAt: instance.startedAt,
        completedAt: instance.completedAt,
      },
      executions,
    },
  });
});

export const cancelInstanceHandler = asyncHandler(async (req: Request, res: Response) => {
  const instance = await requireInstance(req);
  if (!['PENDING', 'RUNNING', 'WAITING_FOR_USER', 'WAITING_FOR_APPROVAL', 'PAUSED'].includes(instance.status)) {
    throw ApiError.badRequest(`This run is already ${instance.status.toLowerCase()}`);
  }

  await cancelInstance({
    instanceId: instance.id,
    conversationId: instance.conversationId,
    reason: req.body.reason,
  });
  res.json({ success: true });
});

/**
 * Hand control back to the bot after a human took over.
 *
 * The handed-off instance is **cancelled**, not left parked.
 *
 * That is the whole point of this endpoint working at all. A handoff sets the
 * instance to PAUSED with no `resumeAt`, and PAUSED is inside the partial
 * unique index that means "this conversation already has a live workflow".
 * Nothing ever resumes such an instance — the delay worker only picks up
 * PAUSED rows that have a `resumeAt` — so clearing the conversation flags
 * without releasing the instance left the customer worse off than before the
 * handoff: every message they sent matched the active-instance branch, got
 * ACTIVE_WORKFLOW_BUSY, and was answered with silence until the 24-hour
 * expiry swept it.
 *
 * Cancelling means the next message routes from scratch. The customer may have
 * to restate what they wanted, which is a far smaller cost than not being
 * answered at all.
 */
export const resumeBot = asyncHandler(async (req: Request, res: Response) => {
  const conversation = await prisma.conversation.findFirst({
    where: { id: req.params.conversationId, tenantId: tenantIdOf(req) },
  });
  if (!conversation) throw ApiError.notFound('Conversation not found');

  const live = await prisma.workflowInstance.findFirst({
    where: {
      conversationId: conversation.id,
      status: { in: ['PENDING', 'RUNNING', 'WAITING_FOR_USER', 'WAITING_FOR_APPROVAL', 'PAUSED'] },
    },
    select: { id: true },
  });

  if (live) {
    await cancelInstance({
      instanceId: live.id,
      conversationId: conversation.id,
      reason: 'Released when control was handed back to the bot',
    });
  }

  await prisma.$transaction(async (tx) => {
    await tx.conversation.update({
      where: { id: conversation.id },
      data: { status: 'OPEN', automationPaused: false },
    });
    await tx.humanHandoff.updateMany({
      where: { conversationId: conversation.id, status: { in: ['PENDING', 'ACTIVE'] } },
      data: { status: 'RESOLVED', completedAt: new Date() },
    });
  });

  res.json({ success: true, data: { releasedInstanceId: live?.id ?? null } });
});

export const handoffConversation = asyncHandler(async (req: Request, res: Response) => {
  const conversation = await prisma.conversation.findFirst({
    where: { id: req.params.conversationId, tenantId: tenantIdOf(req) },
  });
  if (!conversation) throw ApiError.notFound('Conversation not found');

  await handOffToHuman({
    instanceId: conversation.activeWorkflowInstanceId,
    conversationId: conversation.id,
    tenantId: conversation.tenantId,
    reason: req.body.reason,
  });

  res.json({ success: true });
});

// ── Test simulator ────────────────────────────────────────────────────────────

/**
 * Build a throwaway conversation for a test run.
 *
 * A dedicated contact per operator keeps simulator traffic out of the real
 * inbox and stops a test conversation colliding with a live one for the same
 * person. The `waId` is in the +1 555 range, which is reserved for fiction and
 * never routable — so even a misconfigured provider cannot reach anyone.
 */
const simulatorConversation = async (tenantId: string, assistantId: string | null, key: string) => {
  const waId = `1555${key.replace(/\D/g, '').slice(0, 7).padStart(7, '0')}`;

  const contact = await prisma.customer.upsert({
    where: { tenantId_waId: { tenantId, waId } },
    update: { lastSeenAt: new Date() },
    create: { tenantId, waId, name: 'Simulator', lastSeenAt: new Date() },
  });

  const existing = await prisma.conversation.findFirst({
    where: { tenantId, customerId: contact.id, status: { in: ['OPEN', 'HUMAN_TAKEOVER'] } },
    orderBy: { lastMessageAt: 'desc' },
  });

  const conversation = existing ?? await prisma.conversation.create({
    data: {
      tenantId,
      customerId: contact.id,
      assistantId,
      status: 'OPEN',
      externalConversationKey: `simulator:${key}`,
      lastMessageAt: new Date(),
    },
  });

  return { contact, conversation };
};

const simulatorDeps = async (
  tenantId: string,
  conversation: { id: string },
  contact: { id: string },
  dryRun: boolean,
): Promise<{ deps: WalkDeps; whatsapp: MockWhatsAppProvider }> => {
  const [tenant, channel, fullContact, fullConversation] = await Promise.all([
    prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } }),
    prisma.whatsappAccount.findFirst({ where: { tenantId } }),
    prisma.customer.findUniqueOrThrow({ where: { id: contact.id } }),
    prisma.conversation.findUniqueOrThrow({ where: { id: conversation.id } }),
  ]);
  if (!channel) throw ApiError.badRequest('This workspace has no WhatsApp channel connected');

  // Always the mock, never the tenant's real provider — a Test Flow button that
  // messages a customer is the worst possible surprise.
  const whatsapp = new MockWhatsAppProvider();

  return {
    whatsapp,
    deps: {
      tenant,
      contact: fullContact,
      conversation: fullConversation,
      channel,
      assistantId: fullConversation.assistantId,
      services: {
        whatsapp,
        llm: new MockLlmProvider(),
        http: new MockHttpCaller(),
        integrations: MOCK_INTEGRATIONS,
      },
      latestMessage: null,
      dryRun,
    },
  };
};

/** Run one workflow directly, bypassing routing. The builder's Test Flow. */
export const testWorkflow = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = tenantIdOf(req);
  const workflow = await prisma.workflow.findFirst({
    where: { id: req.params.workflowId, tenantId },
    include: { publishedVersion: true },
  });
  if (!workflow) throw ApiError.notFound('Workflow not found');

  const version = workflow.publishedVersion ?? await prisma.workflowVersion.findFirst({
    where: { workflowId: workflow.id },
    orderBy: { version: 'desc' },
  });
  if (!version) throw ApiError.badRequest('This workflow has no version to run');

  const { contact, conversation } = await simulatorConversation(
    tenantId,
    workflow.assistantId,
    `wf${workflow.id.slice(0, 6)}`,
  );

  // Clear any previous test run so repeated Test Flow presses start clean
  // rather than tripping the one-active-instance index.
  await prisma.workflowInstance.updateMany({
    where: {
      conversationId: conversation.id,
      status: { in: ['PENDING', 'RUNNING', 'WAITING_FOR_USER', 'WAITING_FOR_APPROVAL', 'PAUSED'] },
    },
    data: { status: 'CANCELLED', error: 'Superseded by a new test run', completedAt: new Date() },
  });
  await prisma.conversation.update({
    where: { id: conversation.id },
    data: { activeWorkflowInstanceId: null },
  });

  const { deps, whatsapp } = await simulatorDeps(tenantId, conversation, contact, req.body.dryRun);

  const { instance } = await startInstance({
    tenantId,
    workflowId: workflow.id,
    conversationId: conversation.id,
    extractedInputs: req.body.inputs,
  });

  const outcome = await walk({
    instance,
    definition: parseDefinition(version.definition),
    deps: { ...deps, latestMessage: { id: 'sim', body: req.body.message, type: 'TEXT', payload: null } },
  });

  const executions = await prisma.nodeExecution.findMany({
    where: { workflowInstanceId: instance.id },
    orderBy: { startedAt: 'asc' },
  });

  res.json({
    success: true,
    data: {
      instanceId: instance.id,
      conversationId: conversation.id,
      status: outcome.status,
      variables: outcome.variables,
      error: outcome.error ?? null,
      dryRun: req.body.dryRun,
      outboundMessages: whatsapp.sent,
      executions,
    },
  });
});

/** Continue a simulator conversation — the next customer turn. */
export const simulatorReply = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = tenantIdOf(req);
  const conversation = await prisma.conversation.findFirst({
    where: { id: req.params.conversationId, tenantId },
  });
  if (!conversation) throw ApiError.notFound('Conversation not found');

  const instance = await prisma.workflowInstance.findFirst({
    where: { conversationId: conversation.id, status: 'WAITING_FOR_USER' },
  });
  if (!instance) throw ApiError.badRequest('This conversation is not waiting on a reply');

  const { deps, whatsapp } = await simulatorDeps(
    tenantId,
    conversation,
    { id: conversation.customerId },
    req.body.dryRun,
  );

  const result = await resumeWithUserInput({ instance, deps, answer: req.body.message });

  const executions = await prisma.nodeExecution.findMany({
    where: { workflowInstanceId: instance.id },
    orderBy: { startedAt: 'asc' },
  });

  const refreshed = await prisma.workflowInstance.findUniqueOrThrow({ where: { id: instance.id } });

  res.json({
    success: true,
    data: {
      outcome: result.outcome,
      validationError: result.validationError ?? null,
      status: refreshed.status,
      variables: refreshed.variables,
      outboundMessages: whatsapp.sent,
      executions,
    },
  });
});
