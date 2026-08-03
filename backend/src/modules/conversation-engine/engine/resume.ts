import { Prisma, type WorkflowInstance } from '@prisma/client';
import { prisma } from '../../../config/prisma.js';
import { withContext } from '../../../config/logger.js';
import { parseDefinition, resolveNextNodeId, type WorkflowDefinition } from '../domain/definition.js';
import type { NodeType } from '../domain/node-types.js';
import { executorFor } from './executors/index.js';
import { buildScope, interpolateDeep } from './scope.js';
import { handOffToHuman } from './instance-manager.js';
import { walk, type WalkDeps, type WalkOutcome } from './walker.js';

// Resuming a workflow that is waiting on the customer.
//
// This is the half of ASK_USER_INPUT that runs on the *next* message, and the
// reason a conversation workflow feels like a conversation rather than a form.
// The sequence the spec asks for, in order:
//
//   1. detect the active instance      (done by the caller, via the router)
//   2. load the node it is waiting on
//   3. validate the answer
//   4. store it in variables
//   5. mark the waiting node successful
//   6. continue from the next node
//
// Step 3 is where most of the care is. A rejected answer must not advance the
// flow, must not silently drop the customer's message, and must not re-ask
// forever — after `maxRetries` the run hands off to a human rather than looping.

export interface ResumeResult {
  outcome: 'CONTINUED' | 'REPROMPTED' | 'HANDED_OFF' | 'NOT_WAITING';
  walk?: WalkOutcome;
  validationError?: string;
}

export const resumeWithUserInput = async ({
  instance, deps, answer, replyId,
}: {
  instance: WorkflowInstance;
  deps: WalkDeps;
  answer: string;
  /** Set when the customer tapped a list row or reply button. */
  replyId?: string | null;
}): Promise<ResumeResult> => {
  const logger = withContext({
    tenantId: instance.tenantId,
    conversationId: instance.conversationId,
    workflowInstanceId: instance.id,
    nodeId: instance.waitingNodeId ?? undefined,
  });

  if (instance.status !== 'WAITING_FOR_USER' || !instance.waitingNodeId) {
    return { outcome: 'NOT_WAITING' };
  }

  const version = await prisma.workflowVersion.findUnique({
    where: { id: instance.workflowVersionId },
  });
  if (!version) return { outcome: 'NOT_WAITING' };

  // The pinned version, not the workflow's current draft — an edit published
  // mid-conversation must not change the graph under a running instance.
  const definition: WorkflowDefinition = parseDefinition(version.definition);
  const waitingNode = definition.nodes.find((n) => n.id === instance.waitingNodeId);
  if (!waitingNode) return { outcome: 'NOT_WAITING' };

  // Dispatch on the executor's capability rather than on a list of node types.
  // ASK_USER_INPUT, LIST_MESSAGE and BUTTON_MESSAGE all park the same way, and
  // a future interactive node will work here without touching this file.
  const executor = executorFor(waitingNode.type as NodeType);
  if (!executor?.acceptReply) return { outcome: 'NOT_WAITING' };

  const variables = (instance.variables as Record<string, unknown> | null) ?? {};
  const scope = buildScope({
    tenant: deps.tenant,
    contact: deps.contact,
    conversation: deps.conversation,
    message: { body: answer, type: replyId ? 'INTERACTIVE' : 'TEXT' },
    variables,
    timezone: deps.timezone ?? 'Asia/Kolkata',
  });

  const config = executor.validateConfig(interpolateDeep(waitingNode.config, scope)) as {
    variableName: string;
    maxRetries: number;
  };

  // ── 3. Validate ────────────────────────────────────────────────────────────
  //
  // A tap gives us a row/button id as well as its label; typing gives only
  // text. Both are handed over so each node type can decide what it accepts.
  const validated = await executor.acceptReply({
    config: config as never,
    reply: { text: answer, replyId: replyId ?? null },
    variables: { ...variables, __tenantId: instance.tenantId },
  });

  if (!validated.ok) {
    const attempts = instance.retryCount + 1;

    if (attempts >= config.maxRetries) {
      // Repeated failure is a signal the bot cannot help, not a reason to keep
      // asking. Handing off beats trapping the customer in a loop.
      logger.info('Handing off after repeated invalid answers', { attempts });
      if (!deps.dryRun) {
        await deps.services.whatsapp.sendText({
          to: deps.contact.waId,
          body: "I'm having trouble understanding that. Let me connect you with a team member.",
        });
      }
      await handOffToHuman({
        instanceId: instance.id,
        conversationId: instance.conversationId,
        tenantId: instance.tenantId,
        reason: `Could not validate "${config.variableName}" after ${attempts} attempts`,
        dryRun: deps.dryRun ?? false,
      });
      return { outcome: 'HANDED_OFF', validationError: validated.reason };
    }

    await prisma.workflowInstance.update({
      where: { id: instance.id },
      data: { retryCount: attempts },
    });

    if (!deps.dryRun) {
      const prompt = executor.retryPrompt?.(config as never);
      if (prompt) await deps.services.whatsapp.sendText({ to: deps.contact.waId, body: prompt });
    }

    logger.debug('Re-prompted after invalid answer', { attempts, reason: validated.reason });
    return { outcome: 'REPROMPTED', validationError: validated.reason };
  }

  // ── 4/5. Store the answer and close out the waiting node ───────────────────
  const nextVariables = {
    ...variables,
    [config.variableName]: validated.value,
    ...(validated.extraVariables ?? {}),
  };

  await prisma.$transaction(async (tx) => {
    // The ASK_USER_INPUT row was left WAITING when the run parked; closing it
    // here is what makes the Execution Log show the question and its answer as
    // one step rather than an open-ended wait.
    await tx.nodeExecution.updateMany({
      where: {
        workflowInstanceId: instance.id,
        nodeId: waitingNode.id,
        status: 'WAITING',
      },
      data: {
        status: 'SUCCESS',
        output: { answered: true, value: validated.value } as Prisma.InputJsonValue,
        completedAt: new Date(),
      },
    });

    await tx.workflowInstance.update({
      where: { id: instance.id },
      data: {
        status: 'RUNNING',
        variables: nextVariables as Prisma.InputJsonValue,
        waitingNodeId: null,
        waitingVariableName: null,
        retryCount: 0,
      },
    });
  });

  // ── 6. Continue from the node after the question ───────────────────────────
  const resumeFrom = resolveNextNodeId(definition, waitingNode.id, null);

  const outcome = await walk({
    instance: {
      ...instance,
      status: 'RUNNING',
      variables: nextVariables as Prisma.JsonValue,
      currentNodeId: resumeFrom,
    },
    definition,
    deps,
  });

  return { outcome: 'CONTINUED', walk: outcome };
};

/** Resume an instance parked on a DELAY whose time has come. */
export const resumeAfterDelay = async ({
  instance, deps,
}: {
  instance: WorkflowInstance;
  deps: WalkDeps;
}): Promise<WalkOutcome | null> => {
  if (instance.status !== 'PAUSED' || !instance.currentNodeId) return null;

  const version = await prisma.workflowVersion.findUnique({
    where: { id: instance.workflowVersionId },
  });
  if (!version) return null;

  await prisma.workflowInstance.update({
    where: { id: instance.id },
    data: { status: 'RUNNING', resumeAt: null },
  });

  return walk({
    instance: { ...instance, status: 'RUNNING', resumeAt: null },
    definition: parseDefinition(version.definition),
    deps,
  });
};
