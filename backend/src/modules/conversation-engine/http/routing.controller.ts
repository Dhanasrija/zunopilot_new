import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import { prisma } from '../../../config/prisma.js';
import { asyncHandler } from '../../../utils/asyncHandler.js';
import { ApiError } from '../../../utils/ApiError.js';
import { tenantIdOf } from '../../../middleware/auth.js';
import { candidateWorkflows, routeWithAi } from '../routing/ai-router.js';
import { applyConfidenceGate } from '../routing/confidence.js';
import { matchDeterministicRule } from '../routing/deterministic.js';

// Route testing: try a message against the router without touching a customer.
//
// This is a *routing* test, not an execution test — it reports what would be
// selected and why, and starts nothing. That separation matters: an operator
// tuning capability contracts should be able to iterate freely without every
// attempt creating a workflow instance.

const requireAssistant = async (req: Request) => {
  const assistant = await prisma.assistant.findFirst({
    where: { id: req.params.assistantId, tenantId: tenantIdOf(req) },
  });
  if (!assistant) throw ApiError.notFound('Assistant not found');
  return assistant;
};

/** Route one message and report the decision. Nothing is started or sent. */
const dryRoute = async (
  assistant: Awaited<ReturnType<typeof requireAssistant>>,
  message: string,
  /**
   * Tags to put on the stub contact.
   *
   * Worth being able to set: `CUSTOMER_TAG` rules match on these, and until `Customer`
   * gained a `tags` column they could not fire at all. Without this the route tester would
   * report "no match" for a rule that is now perfectly correct, and the tester would be
   * lying about the one rule type that just started working.
   */
  tags: string[] = [],
) => {
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: assistant.tenantId } });

  // Deterministic rules first, exactly as the live chain orders them — a route
  // test that skipped them would report the model's opinion on a message the
  // model never sees.
  const stubContact = {
    id: 'route-test', tenantId: tenant.id, waId: '15550000000', name: null, phone: null,
    lastSeenAt: null, lifetimeSpend: new Prisma.Decimal(0), createdAt: new Date(), updatedAt: new Date(),
    // Marketing consent. A route test never sends anything, so the values are
    // immaterial — but "opted out" is the honest default for a contact that does
    // not exist.
    marketingOptIn: false, optedOutAt: null, optInSource: null,
    // Lowercased to match how the customer controller stores them, so a rule written
    // against "vip" is not tested against "VIP".
    tags: tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean),
  };

  const deterministic = await matchDeterministicRule({
    assistantId: assistant.id,
    text: message,
    interactiveReplyId: null,
    contact: stubContact,
  });

  if (deterministic?.workflowId) {
    const workflow = await prisma.workflow.findUnique({
      where: { id: deterministic.workflowId },
      select: { id: true, name: true, slug: true },
    });
    return {
      source: 'DETERMINISTIC' as const,
      decision: 'START_WORKFLOW' as const,
      workflow,
      confidence: 1,
      reasonCode: deterministic.reasonCode,
      extractedInputs: deterministic.extractedInputs ?? {},
      missingInputs: [] as string[],
      clarificationQuestion: null as string | null,
      candidates: [] as string[],
      latencyMs: 0,
      model: null as string | null,
    };
  }

  const conversation = {
    id: 'route-test', summary: null, assistantId: assistant.id,
  } as unknown as Parameters<typeof routeWithAi>[0]['conversation'];

  const routed = await routeWithAi({
    tenant, assistant, conversation, contact: stubContact, message,
  });

  if (!routed) {
    return {
      source: 'FALLBACK' as const,
      decision: 'NO_MATCH' as const,
      workflow: null,
      confidence: 0,
      reasonCode: 'ROUTER_UNAVAILABLE',
      extractedInputs: {},
      missingInputs: [],
      clarificationQuestion: null,
      candidates: [],
      latencyMs: 0,
      model: null,
    };
  }

  const gate = applyConfidenceGate({
    output: routed.output, assistant, candidates: routed.candidates,
  });

  const workflow = routed.output.workflowId
    ? await prisma.workflow.findFirst({
      where: { tenantId: tenant.id, slug: routed.output.workflowId },
      select: { id: true, name: true, slug: true },
    })
    : null;

  return {
    source: 'AI_ROUTER' as const,
    // What the gate decided, not what the model said — the gate is what runs.
    decision: gate.action === 'START_WORKFLOW' ? ('START_WORKFLOW' as const)
      : gate.action === 'ASK_CLARIFICATION' ? ('ASK_CLARIFICATION' as const)
        : gate.action === 'HUMAN_HANDOFF' ? ('HUMAN_HANDOFF' as const)
          : gate.action === 'GENERAL_RESPONSE' ? ('GENERAL_RESPONSE' as const)
            : ('NO_MATCH' as const),
    workflow: gate.action === 'START_WORKFLOW' ? workflow : null,
    confidence: routed.output.confidence,
    reasonCode: gate.reasonCode,
    extractedInputs: routed.output.inputs,
    missingInputs: routed.output.missingInputs,
    clarificationQuestion: gate.action === 'ASK_CLARIFICATION' ? gate.question : null,
    candidates: routed.candidates.map((c) => c.workflowId),
    latencyMs: routed.latencyMs,
    model: routed.model,
  };
};

export const routeTest = asyncHandler(async (req: Request, res: Response) => {
  const assistant = await requireAssistant(req);
  const result = await dryRoute(
    assistant,
    req.body.message,
    Array.isArray(req.body.tags) ? req.body.tags.filter((t: unknown) => typeof t === 'string') : [],
  );
  res.json({ success: true, data: result });
});

// ── Saved routing test cases ─────────────────────────────────────────────────

export const listRoutingTests = asyncHandler(async (req: Request, res: Response) => {
  const assistant = await requireAssistant(req);
  const cases = await prisma.routingTestCase.findMany({
    where: { assistantId: assistant.id },
    include: { expectedWorkflow: { select: { id: true, name: true, slug: true } } },
    orderBy: { createdAt: 'asc' },
  });
  res.json({ success: true, data: cases });
});

export const createRoutingTest = asyncHandler(async (req: Request, res: Response) => {
  const assistant = await requireAssistant(req);

  if (req.body.expectedWorkflowId) {
    const owned = await prisma.workflow.findFirst({
      where: { id: req.body.expectedWorkflowId, tenantId: assistant.tenantId },
      select: { id: true },
    });
    if (!owned) throw ApiError.badRequest('expectedWorkflowId does not name a workflow in this workspace');
  }

  const created = await prisma.routingTestCase.create({
    data: { ...req.body, tenantId: assistant.tenantId, assistantId: assistant.id },
  });
  res.status(201).json({ success: true, data: created });
});

export const deleteRoutingTest = asyncHandler(async (req: Request, res: Response) => {
  const assistant = await requireAssistant(req);
  const existing = await prisma.routingTestCase.findFirst({
    where: { id: req.params.testId, assistantId: assistant.id },
  });
  if (!existing) throw ApiError.notFound('Test case not found');
  await prisma.routingTestCase.delete({ where: { id: existing.id } });
  res.json({ success: true });
});

/**
 * Run the whole saved suite.
 *
 * Sequential, not parallel: the suite hits the model once per case, and firing
 * twenty concurrent completions is a good way to get rate-limited mid-run and
 * report failures that are really throttling.
 */
export const runRoutingTests = asyncHandler(async (req: Request, res: Response) => {
  const assistant = await requireAssistant(req);
  const cases = await prisma.routingTestCase.findMany({
    where: { assistantId: assistant.id },
    include: { expectedWorkflow: { select: { id: true, slug: true, name: true } } },
    orderBy: { createdAt: 'asc' },
  });

  const results = [];
  for (const testCase of cases) {
    const startedAt = Date.now();
    const actual = await dryRoute(assistant, testCase.message);

    const decisionMatches = actual.decision === testCase.expectedDecision;
    const workflowMatches = !testCase.expectedWorkflowId
      || actual.workflow?.id === testCase.expectedWorkflowId;
    const passed = decisionMatches && workflowMatches;

    await prisma.routingTestCase.update({
      where: { id: testCase.id },
      data: {
        lastRunAt: new Date(),
        lastRunPassed: passed,
        lastRunActual: {
          decision: actual.decision,
          workflowSlug: actual.workflow?.slug ?? null,
          confidence: actual.confidence,
          reasonCode: actual.reasonCode,
        } as Prisma.InputJsonValue,
      },
    });

    results.push({
      id: testCase.id,
      message: testCase.message,
      passed,
      expected: {
        decision: testCase.expectedDecision,
        workflow: testCase.expectedWorkflow?.slug ?? null,
      },
      actual: {
        decision: actual.decision,
        workflow: actual.workflow?.slug ?? null,
        confidence: actual.confidence,
        reasonCode: actual.reasonCode,
      },
      latencyMs: Date.now() - startedAt,
    });
  }

  const passed = results.filter((r) => r.passed).length;
  res.json({
    success: true,
    data: {
      total: results.length,
      passed,
      failed: results.length - passed,
      results,
    },
  });
});

// ── Routing decisions (debug view) ───────────────────────────────────────────

export const listRoutingDecisions = asyncHandler(async (req: Request, res: Response) => {
  const decisions = await prisma.routingDecision.findMany({
    where: {
      tenantId: tenantIdOf(req),
      ...(req.params.conversationId ? { conversationId: req.params.conversationId } : {}),
    },
    include: { selectedWorkflow: { select: { name: true, slug: true } } },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  res.json({ success: true, data: decisions });
});

export const getCandidates = asyncHandler(async (req: Request, res: Response) => {
  const assistant = await requireAssistant(req);
  res.json({ success: true, data: await candidateWorkflows(assistant.id) });
});
