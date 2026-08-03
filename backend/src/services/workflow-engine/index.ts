import { prisma } from '../../config/prisma.js';
import { logger } from '../../config/logger.js';
import { buildContext, interpolateConfig } from './context.js';
import { channelForTenant } from '../whatsapp-account.service.js';
import { resolveHandler, type LegacyNode } from './nodes.js';
import { Prisma, type Workflow, type WorkflowRun } from '@prisma/client';
import type { InboundContext } from '../../types/domain.js';
import type { WorkflowVariables } from './context.js';

interface LegacyEdge { from: string; to: string; branch?: string | null }
interface LegacyGraph { nodes?: LegacyNode[]; edges?: LegacyEdge[] }

const graphOf = (workflow: { graph?: unknown }): LegacyGraph =>
  (workflow.graph && typeof workflow.graph === 'object' && !Array.isArray(workflow.graph)
    ? workflow.graph as LegacyGraph
    : { nodes: [], edges: [] });

/** Prisma rejects `undefined` for a Json column but accepts `Prisma.JsonNull`. */
const asJson = (value: unknown): Prisma.InputJsonValue =>
  (value ?? {}) as Prisma.InputJsonValue;

interface StepRecord {
  nodeId: string;
  nodeType: string;
  status: string;
  input?: unknown;
  output?: unknown;
  error?: string | null;
  startedAt: number;
}

// Workflow execution engine.
//
// Walks a published graph one node at a time, logging a WorkflowRunStep per node
// so the Execution Log has real data rather than a reconstruction. Control flow
// lives here, not in node handlers: a handler returns a branch label and the
// walker picks the matching edge.

// A single inbound message must never turn into an unbounded walk. This bounds
// both accidental cycles and a deliberately cyclic graph.
const MAX_STEPS = 50;
// Per-node visit cap, so a small cycle cannot burn the whole step budget.
const MAX_VISITS_PER_NODE = 5;

const nodeById = (graph: LegacyGraph): Map<string, LegacyNode> => new Map((graph?.nodes ?? []).map((n) => [n.id, n]));

const findStartNode = (graph: LegacyGraph | null | undefined): LegacyNode | null => {
  const nodes = graph?.nodes ?? [];
  const explicit = nodes.find((n) => n.type === 'trigger');
  if (explicit) return explicit;
  // Fall back to the only node with no inbound edge, so a graph without an
  // explicit trigger node still runs deterministically.
  const targets = new Set((graph?.edges ?? []).map((e) => e.to));
  const roots = nodes.filter((n) => !targets.has(n.id));
  return roots.length === 1 ? roots[0] : null;
};

/**
 * Pick the outgoing edge for a node given the branch a handler asked for.
 * An exact branch match wins; otherwise an unlabelled edge is the default path.
 */
const nextNodeId = (graph: LegacyGraph, fromId: string, branch?: string | null): string | null => {
  const out = (graph?.edges ?? []).filter((e) => e.from === fromId);
  if (!out.length) return null;
  if (branch) {
    const match = out.find((e) => String(e.branch ?? '').toLowerCase() === String(branch).toLowerCase());
    if (match) return match.to;
  }
  const unlabelled = out.find((e) => !e.branch);
  return (unlabelled ?? out[0]).to;
};

const recordStep = (runId: string, { nodeId, nodeType, status, input, output, error, startedAt }: StepRecord) =>
  prisma.workflowRunStep.create({
    data: {
      runId,
      nodeId,
      nodeType,
      status,
      input: input === undefined ? undefined : asJson(input),
      output: output === undefined ? undefined : asJson(output),
      error: error ?? null,
      durationMs: Date.now() - startedAt,
    },
  }).catch((err) => {
    // Never let a logging failure abort an execution that is otherwise fine.
    logger.error('Failed to record workflow step', { runId, nodeId, error: err.message });
  });

/**
 * Walk a run from its current node until it completes, fails, or parks.
 * Assumes the run row already exists and is RUNNING.
 */
const walk = async ({ run, workflow, deps }: {
  run: WorkflowRun;
  workflow: Workflow;
  deps: InboundContext & { message?: unknown };
}) => {
  const graph = graphOf(workflow);
  const nodes = nodeById(graph);
  const visits = new Map<string, number>();

  let currentId: string | null = run.currentNodeId;
  let variables: WorkflowVariables = { ...(run.variables as WorkflowVariables | null ?? {}) };
  let steps = 0;

  while (currentId) {
    if (++steps > MAX_STEPS) {
      throw new Error(`Workflow exceeded ${MAX_STEPS} steps — check for a cycle`);
    }
    const seen = (visits.get(currentId) ?? 0) + 1;
    visits.set(currentId, seen);
    if (seen > MAX_VISITS_PER_NODE) {
      throw new Error(`Node ${currentId} visited ${seen} times — check for a cycle`);
    }

    const node = nodes.get(currentId);
    if (!node) throw new Error(`Graph references a missing node: ${currentId}`);

    const handler = resolveHandler(node.type);
    if (!handler) throw new Error(`Unknown node type "${node.type}"`);

    const ctx = buildContext({
      tenant: deps.tenant,
      customer: deps.customer,
      conversation: deps.conversation,
      message: (deps.message ?? null) as never,
      variables,
    });
    const config = interpolateConfig(node.config ?? {}, ctx);
    const startedAt = Date.now();

    let result: Awaited<ReturnType<typeof handler>>;
    try {
      result = await handler({ node, config, ctx, run, deps });
    } catch (err: any) {
      await recordStep(run.id, {
        nodeId: node.id, nodeType: node.type, status: 'error',
        input: config, error: err.message, startedAt,
      });
      throw err;
    }

    await recordStep(run.id, {
      nodeId: node.id, nodeType: node.type,
      status: (result?.output as { skipped?: boolean } | null)?.skipped ? 'skipped' : 'ok',
      input: config, output: result?.output ?? null, startedAt,
    });

    // Store this node's output under its configured variable name.
    if (node.outputVariable && result?.output !== undefined) {
      variables = { ...variables, [node.outputVariable]: result.output };
    }

    // Delay: park the run and hand off to the resume worker.
    if (result?.wait?.untilMs) {
      const resumeFrom = nextNodeId(graph, node.id, result.branch);
      await prisma.workflowRun.update({
        where: { id: run.id },
        data: {
          status: 'WAITING',
          variables: asJson(variables),
          currentNodeId: resumeFrom,
          resumeAt: new Date(result.wait.untilMs),
        },
      });
      return { status: 'WAITING', variables };
    }

    currentId = nextNodeId(graph, node.id, result?.branch);
  }

  await prisma.workflowRun.update({
    where: { id: run.id },
    data: { status: 'COMPLETED', variables: asJson(variables), currentNodeId: null, finishedAt: new Date() },
  });
  return { status: 'COMPLETED', variables };
};

/**
 * Start a run for a workflow. Returns the finished/parked run, or null when the
 * graph has no usable entry point.
 */
export const startRun = async ({ workflow, tenant, customer, conversation, message, waAccount }: InboundContext & {
  workflow: Workflow;
  message?: unknown;
}) => {
  const start = findStartNode(graphOf(workflow));
  if (!start) {
    logger.warn('Workflow has no start node, skipping', { workflowId: workflow.id });
    return null;
  }

  const run = await prisma.workflowRun.create({
    data: {
      tenantId: tenant.id,
      workflowId: workflow.id,
      // Pinned: an edit mid-run must not change the graph under this execution.
      version: workflow.version,
      customerId: customer?.id ?? null,
      conversationId: conversation?.id ?? null,
      status: 'RUNNING',
      currentNodeId: start.id,
      variables: {},
    },
  });

  const deps = { tenant, customer, conversation, message, waAccount };

  try {
    const out = await walk({ run, workflow, deps });
    return { ...run, ...out };
  } catch (err: any) {
    logger.error('Workflow run failed', { runId: run.id, workflowId: workflow.id, error: err.message });
    await prisma.workflowRun.update({
      where: { id: run.id },
      data: { status: 'FAILED', error: err.message, finishedAt: new Date() },
    });
    return { ...run, status: 'FAILED', error: err.message };
  }
};

/** Resume a run parked on a Delay. Used by the resume worker. */
export const resumeRun = async (runId: string) => {
  const run = await prisma.workflowRun.findUnique({ where: { id: runId } });
  if (!run || run.status !== 'WAITING') return null;

  const workflow = await prisma.workflow.findUnique({ where: { id: run.workflowId } });
  if (!workflow) {
    await prisma.workflowRun.update({
      where: { id: run.id },
      data: { status: 'CANCELLED', error: 'Workflow was deleted', finishedAt: new Date() },
    });
    return null;
  }

  const [tenant, customer, conversation, waAccount] = await Promise.all([
    prisma.tenant.findUnique({ where: { id: run.tenantId } }),
    run.customerId ? prisma.customer.findUnique({ where: { id: run.customerId } }) : null,
    run.conversationId ? prisma.conversation.findUnique({ where: { id: run.conversationId } }) : null,
    channelForTenant(run.tenantId),
  ]);

  if (!waAccount) {
    await prisma.workflowRun.update({
      where: { id: run.id },
      data: { status: 'CANCELLED', error: 'WhatsApp account disconnected', finishedAt: new Date() },
    });
    return null;
  }

  await prisma.workflowRun.update({
    where: { id: run.id },
    data: { status: 'RUNNING', resumeAt: null },
  });

  const deps = { tenant: tenant!, customer: customer!, conversation: conversation!, message: null, waAccount };
  try {
    return await walk({ run: { ...run, status: 'RUNNING' }, workflow, deps });
  } catch (err: any) {
    logger.error('Resumed workflow run failed', { runId: run.id, error: err.message });
    await prisma.workflowRun.update({
      where: { id: run.id },
      data: { status: 'FAILED', error: err.message, finishedAt: new Date() },
    });
    return null;
  }
};

export { MAX_STEPS, findStartNode, nextNodeId };
