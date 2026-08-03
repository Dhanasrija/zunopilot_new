import { Prisma, type Conversation, type Customer, type Tenant, type WhatsappAccount, type WorkflowInstance } from '@prisma/client';
import { prisma } from '../../../config/prisma.js';
import { withContext } from '../../../config/logger.js';
import { env } from '../../../config/env.js';
import { resolveNextNodeId, type WorkflowDefinition, type WorkflowNode } from '../domain/definition.js';
import { metaFor, type NodeType } from '../domain/node-types.js';
import { executorFor } from './executors/index.js';
import { buildScope, interpolateDeep } from './scope.js';
import {
  finishInstance, handOffToHuman, parkForUser, parkUntil, saveProgress,
} from './instance-manager.js';
import {
  NodeConfigError, RetryableNodeError,
  type NodeExecutionContext, type NodeExecutionResult, type NodeServices,
} from './types.js';

// The walker: one node at a time, until the run finishes, fails or parks.
//
// Everything about control flow lives here rather than in executors, and every
// node writes a NodeExecution row before and after it runs — so the Execution
// Log is a record of what happened, not a reconstruction after the fact.

export interface WalkDeps {
  tenant: Tenant;
  contact: Customer;
  conversation: Conversation;
  channel: WhatsappAccount;
  assistantId: string | null;
  services: NodeServices;
  latestMessage: { id: string; body: string; type: string; payload: unknown } | null;
  dryRun?: boolean;
  timezone?: string;
}

export interface WalkOutcome {
  status: 'COMPLETED' | 'CANCELLED' | 'FAILED' | 'WAITING_FOR_USER' | 'PAUSED' | 'HUMAN_HANDOFF';
  variables: Record<string, unknown>;
  nodesExecuted: number;
  error?: string;
}

const asJson = (value: unknown): Prisma.InputJsonValue => (value ?? {}) as Prisma.InputJsonValue;

const sleep = (ms: number) => new Promise((resolve) => { setTimeout(resolve, ms); });

/**
 * Run one node, retrying only what is worth retrying.
 *
 * A NodeConfigError means the workflow is wrong and repeating it will be wrong
 * again. A RetryableNodeError means the world was briefly unavailable. Retrying
 * the first kind is how a misconfigured booking node creates three appointments.
 */
const executeWithRetry = async (
  context: NodeExecutionContext<unknown>,
  execute: (ctx: NodeExecutionContext<unknown>) => Promise<NodeExecutionResult>,
  maxAttempts: number,
  backoffMs: number,
): Promise<{ result: NodeExecutionResult; attempts: number }> => {
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return { result: await execute(context), attempts: attempt };
    } catch (err) {
      lastError = err;
      const retryable = err instanceof RetryableNodeError;
      if (!retryable || attempt === maxAttempts) break;
      context.logger.warn('Node failed, retrying', {
        attempt,
        error: err instanceof Error ? err.message : String(err),
      });
      await sleep(backoffMs * attempt);
    }
  }

  throw lastError;
};

export const walk = async ({
  instance, definition, deps,
}: {
  instance: WorkflowInstance;
  definition: WorkflowDefinition;
  deps: WalkDeps;
}): Promise<WalkOutcome> => {
  const dryRun = deps.dryRun ?? false;
  const timezone = deps.timezone ?? 'Asia/Kolkata';
  const nodes = new Map(definition.nodes.map((n) => [n.id, n]));

  let variables: Record<string, unknown> = { ...(instance.variables as Record<string, unknown> | null ?? {}) };
  let currentId: string | null = instance.currentNodeId ?? definition.entryNodeId;
  let executed = 0;

  const visits = new Map<string, number>();
  const controller = new AbortController();

  // How many times each node has already run *in earlier walks of this same
  // instance*.
  //
  // A run spans many walks — every customer reply starts a new one — so `visits`
  // alone is a per-walk counter that restarts at 1. That is right for the loop
  // guard below (a tight cycle is a within-walk problem) but wrong for
  // `attempt`, which is unique per (instance, node) in the database and is what
  // the idempotency key is built from. A graph that loops across a message
  // boundary — "add another item" — reaches the same node on a second walk and
  // would collide on both.
  const priorAttempts = new Map<string, number>(
    (await prisma.nodeExecution.groupBy({
      by: ['nodeId'],
      where: { workflowInstanceId: instance.id },
      _max: { attempt: true },
    })).map((row) => [row.nodeId, row._max.attempt ?? 0]),
  );

  const attemptFor = (nodeId: string, visitCount: number) =>
    (priorAttempts.get(nodeId) ?? 0) + visitCount;

  const baseLogger = withContext({
    tenantId: instance.tenantId,
    conversationId: instance.conversationId,
    workflowId: instance.workflowId,
    workflowInstanceId: instance.id,
  });

  const finish = async (
    status: 'COMPLETED' | 'CANCELLED' | 'FAILED',
    error?: string,
  ): Promise<WalkOutcome> => {
    await finishInstance({
      instanceId: instance.id,
      conversationId: instance.conversationId,
      status,
      variables,
      error: error ?? null,
      dryRun,
    });
    return { status, variables, nodesExecuted: executed, ...(error ? { error } : {}) };
  };

  while (currentId) {
    // Two independent caps. The step budget bounds the whole run; the per-node
    // cap stops a tight two-node cycle from consuming that budget before any
    // useful work happens.
    if (executed >= env.engine.maxNodeExecutions) {
      return finish('FAILED', `Exceeded ${env.engine.maxNodeExecutions} node executions — check for a loop`);
    }
    const visitCount = (visits.get(currentId) ?? 0) + 1;
    visits.set(currentId, visitCount);
    if (visitCount > env.engine.maxVisitsPerNode) {
      return finish('FAILED', `Node ${currentId} ran ${visitCount} times — check for a loop`);
    }

    const node: WorkflowNode | undefined = nodes.get(currentId);
    if (!node) {
      return finish('FAILED', `Graph references a node that does not exist: ${currentId}`);
    }

    const nodeLogger = baseLogger.child({ nodeId: node.id, nodeType: node.type });
    const executor = executorFor(node.type as NodeType);

    // An unimplemented node type is skipped, not fatal — one unbuilt node must
    // not break an otherwise valid published flow. The publish validator has
    // already warned about it.
    if (!executor) {
      nodeLogger.warn('Node type has no runtime, skipping');
      await prisma.nodeExecution.create({
        data: {
          workflowInstanceId: instance.id,
          nodeId: node.id,
          nodeType: node.type,
          status: 'SKIPPED',
          attempt: attemptFor(node.id, visitCount),
          output: asJson({ skipped: true, reason: `${node.type} has no runtime yet` }),
          completedAt: new Date(),
          durationMs: 0,
        },
      });
      executed += 1;
      currentId = resolveNextNodeId(definition, node.id, null);
      continue;
    }

    const scope = buildScope({
      tenant: deps.tenant,
      contact: deps.contact,
      conversation: deps.conversation,
      message: deps.latestMessage
        ? { body: deps.latestMessage.body, type: deps.latestMessage.type }
        : null,
      variables,
      timezone,
    });

    // Interpolate first, then validate: a template that resolves to an empty
    // required field should fail validation, not slip through as "{{...}}".
    const interpolated = interpolateDeep(node.config, scope);

    let config: unknown;
    try {
      config = executor.validateConfig(interpolated);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await prisma.nodeExecution.create({
        data: {
          workflowInstanceId: instance.id,
          nodeId: node.id,
          nodeType: node.type,
          status: 'FAILED',
          attempt: attemptFor(node.id, visitCount),
          input: asJson(interpolated),
          error: asJson({ message, kind: 'config' }),
          completedAt: new Date(),
        },
      });
      return finish('FAILED', `"${node.name ?? node.id}" is misconfigured: ${message}`);
    }

    const execution = await prisma.nodeExecution.create({
      data: {
        workflowInstanceId: instance.id,
        nodeId: node.id,
        nodeType: node.type,
        status: 'RUNNING',
        attempt: attemptFor(node.id, visitCount),
        input: asJson(config),
        // Stable across retries of the same node in the same run, so a replay
        // can recognise work that already succeeded.
        idempotencyKey: `${instance.id}:${node.id}:${attemptFor(node.id, visitCount)}`,
      },
    });

    const context: NodeExecutionContext<unknown> = {
      tenantId: instance.tenantId,
      assistantId: deps.assistantId,
      conversationId: instance.conversationId,
      workflowInstanceId: instance.id,
      nodeExecutionId: execution.id,
      node,
      config,
      variables,
      scope,
      tenant: deps.tenant,
      contact: deps.contact,
      conversation: deps.conversation,
      channel: deps.channel,
      latestMessage: deps.latestMessage,
      services: deps.services,
      logger: nodeLogger,
      abortSignal: controller.signal,
      idempotencyKey: execution.idempotencyKey!,
      dryRun,
    };

    const startedAt = Date.now();
    let result: NodeExecutionResult;
    try {
      const retry = node.retry ?? { maxAttempts: 0, backoffMs: 1000 };
      ({ result } = await executeWithRetry(
        context,
        (ctx) => executor.execute(ctx),
        retry.maxAttempts + 1,
        retry.backoffMs,
      ));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const retryable = err instanceof RetryableNodeError;
      await prisma.nodeExecution.update({
        where: { id: execution.id },
        data: {
          status: 'FAILED',
          error: asJson({ message, retryable, kind: err instanceof NodeConfigError ? 'config' : 'runtime' }),
          completedAt: new Date(),
          durationMs: Date.now() - startedAt,
        },
      });

      // A node may declare a handle to take on failure, which turns an error
      // into a branch instead of ending the run.
      if (node.onErrorHandle) {
        const fallback = resolveNextNodeId(definition, node.id, node.onErrorHandle);
        if (fallback) {
          nodeLogger.warn('Node failed, taking its error branch', { message });
          executed += 1;
          currentId = fallback;
          continue;
        }
      }

      return finish('FAILED', `"${node.name ?? node.id}" failed: ${message}`);
    }

    executed += 1;

    if (result.variablesPatch) variables = { ...variables, ...result.variablesPatch };
    if (node.outputVariable && result.output !== undefined) {
      variables = { ...variables, [node.outputVariable]: result.output };
    }

    await prisma.nodeExecution.update({
      where: { id: execution.id },
      data: {
        status: result.status === 'SUCCESS' ? 'SUCCESS'
          : result.status === 'FAILED' ? 'FAILED'
            : 'WAITING',
        output: asJson(result.output),
        completedAt: new Date(),
        durationMs: Date.now() - startedAt,
      },
    });

    // ── Non-continuing outcomes ────────────────────────────────────────────
    if (result.status === 'FAILED') {
      return finish('FAILED', result.error?.message ?? `"${node.name ?? node.id}" failed`);
    }

    if (result.status === 'HUMAN_HANDOFF') {
      await handOffToHuman({
        instanceId: instance.id,
        conversationId: instance.conversationId,
        tenantId: instance.tenantId,
        reason: (result.output as { reason?: string } | undefined)?.reason ?? 'Workflow requested handoff',
        dryRun,
      });
      await saveProgress(instance.id, variables, node.id);
      return { status: 'HUMAN_HANDOFF', variables, nodesExecuted: executed };
    }

    if (result.status === 'WAITING_FOR_USER' && result.awaiting) {
      // Persist before returning. An answer can arrive milliseconds later, and
      // if the awaiting node is not recorded yet it has nowhere to go.
      await saveProgress(instance.id, variables, node.id);
      await parkForUser(instance.id, result.awaiting);
      return { status: 'WAITING_FOR_USER', variables, nodesExecuted: executed };
    }

    if (result.status === 'WAITING' && result.waitUntil) {
      const resumeFrom = resolveNextNodeId(definition, node.id, result.nextHandle ?? null);
      await saveProgress(instance.id, variables, resumeFrom);
      await parkUntil(instance.id, result.waitUntil, resumeFrom);
      return { status: 'PAUSED', variables, nodesExecuted: executed };
    }

    if (result.terminal) {
      return finish(result.terminal);
    }

    // ── Continue ───────────────────────────────────────────────────────────
    const nextId = resolveNextNodeId(definition, node.id, result.nextHandle ?? null);
    const isTerminalNode = metaFor(node.type as NodeType).terminal;

    if (!nextId) {
      // Running out of edges is a normal end for a terminal node, and a
      // dead-end the validator already warned about for anything else.
      if (!isTerminalNode) {
        nodeLogger.info('Workflow ended at a node with no outgoing edge');
      }
      return finish('COMPLETED');
    }

    await saveProgress(instance.id, variables, nextId);
    currentId = nextId;
  }

  return finish('COMPLETED');
};
