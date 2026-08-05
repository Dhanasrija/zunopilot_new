import { Prisma, type WorkflowInstance, type WorkflowInstanceStatus } from '@prisma/client';
import { prisma } from '../../../config/prisma.js';
import { logger } from '../../../config/logger.js';
import { parseDefinition, type WorkflowDefinition } from '../domain/definition.js';
import { notifyHandoffRequested } from '../../notifications/notification.producers.js';

// Lifecycle of a workflow instance.
//
// Every state change that could let two workflows answer one message goes
// through here, and every one of them is a transaction. The reason is the
// partial unique index on WorkflowInstance(conversationId) WHERE status is
// live: Postgres will refuse a second live instance, but only if the write that
// creates it and the write that points the conversation at it commit together.
// A create here plus an "oh and also update the conversation" over there is
// exactly the drift that index cannot save you from.

/** Statuses the partial unique index treats as live. Keep in sync with the migration. */
export const LIVE_STATUSES: WorkflowInstanceStatus[] = [
  'PENDING', 'RUNNING', 'WAITING_FOR_USER', 'WAITING_FOR_APPROVAL', 'PAUSED',
];

export const TERMINAL_STATUSES: WorkflowInstanceStatus[] = ['COMPLETED', 'CANCELLED', 'FAILED'];

export const isLive = (status: WorkflowInstanceStatus): boolean => LIVE_STATUSES.includes(status);

/** Raised when another message already started a workflow for this conversation. */
export class ActiveInstanceExistsError extends Error {
  constructor(public readonly conversationId: string) {
    super(`Conversation ${conversationId} already has an active workflow instance`);
    this.name = 'ActiveInstanceExistsError';
  }
}

export class WorkflowNotPublishedError extends Error {
  constructor(workflowId: string) {
    super(`Workflow ${workflowId} has no published version`);
    this.name = 'WorkflowNotPublishedError';
  }
}

export interface StartedInstance {
  instance: WorkflowInstance;
  definition: WorkflowDefinition;
}

/**
 * Start a workflow for a conversation.
 *
 * Pins the published version, seeds the router's extracted inputs as variables,
 * and claims the conversation — all atomically. A concurrent second message
 * loses the race with a clean ActiveInstanceExistsError rather than producing a
 * second live instance.
 */
export const startInstance = async ({
  tenantId, workflowId, conversationId, extractedInputs = {}, dryRun = false,
}: {
  tenantId: string;
  workflowId: string;
  conversationId: string;
  extractedInputs?: Record<string, unknown>;
  dryRun?: boolean;
}): Promise<StartedInstance> => {
  const workflow = await prisma.workflow.findFirst({
    where: { id: workflowId, tenantId },
    include: { publishedVersion: true },
  });

  if (!workflow) throw new WorkflowNotPublishedError(workflowId);
  // A draft must never answer a customer. This is the check that makes "publish"
  // mean something.
  //
  // It stays exactly here, on the path routing uses. `startInstanceOnVersion`
  // below is the only way past it, and it is a separate exported name precisely
  // so that "who can run an unpublished graph" is a question `grep` answers.
  if (workflow.status !== 'PUBLISHED' || !workflow.publishedVersion) {
    throw new WorkflowNotPublishedError(workflowId);
  }

  return createInstance({
    tenantId,
    workflowId,
    conversationId,
    versionId: workflow.publishedVersion.id,
    definition: parseDefinition(workflow.publishedVersion.definition),
    extractedInputs,
    dryRun,
  });
};

/** Raised when a version does not belong to the workflow (or tenant) it was asked for. */
export class VersionNotFoundError extends Error {
  constructor(versionId: string) {
    super(`Workflow version ${versionId} was not found on that workflow`);
    this.name = 'VersionNotFoundError';
  }
}

/**
 * Start a workflow on **a named version, published or not**.
 *
 * **Why this exists, and why it is not a flag on `startInstance`.** The builder's
 * Test Flow and the generator's dry-run driver both need to run a draft — that is
 * the entire point of a draft. `startInstance` refuses one, correctly, because the
 * conversation it is starting belongs to a customer. The simulator's conversation
 * does not: `simulatorConversation` mints a synthetic contact per workflow.
 *
 * So the two callers want genuinely different things, and a `allowDraft: true`
 * parameter would have put the decision inside the function that exists to make
 * publishing mean something. A second exported name keeps the gate intact and
 * makes every bypass visible at the call site.
 *
 * **This was silently broken.** `testWorkflow` already resolved a latest-version
 * fallback for the unpublished case and then handed the *workflow* to
 * `startInstance`, which threw `WorkflowNotPublishedError` before the fallback
 * could ever be used — so pressing Test Flow on a generated draft failed with
 * "has no published version" and no way to act on it.
 *
 * The version is looked up **scoped to the workflow and tenant**, so a caller
 * holding a version id from somewhere else cannot run another tenant's graph.
 */
export const startInstanceOnVersion = async ({
  tenantId, workflowId, conversationId, versionId, extractedInputs = {}, dryRun = false,
}: {
  tenantId: string;
  workflowId: string;
  conversationId: string;
  versionId: string;
  extractedInputs?: Record<string, unknown>;
  dryRun?: boolean;
}): Promise<StartedInstance> => {
  // One query, joined on the workflow, rather than "find the version then check
  // its workflowId" — the tenant check has to be part of the lookup or it is a
  // check someone can forget to write.
  const version = await prisma.workflowVersion.findFirst({
    where: { id: versionId, workflowId, workflow: { tenantId } },
  });
  if (!version) throw new VersionNotFoundError(versionId);

  return createInstance({
    tenantId,
    workflowId,
    conversationId,
    versionId: version.id,
    definition: parseDefinition(version.definition),
    extractedInputs,
    dryRun,
  });
};

/**
 * The transaction both entry points share.
 *
 * Private on purpose: it takes an already-resolved version and therefore performs
 * no authorisation of its own. Everything that decides *whether* this run is
 * allowed lives in the two exported functions above.
 */
const createInstance = async ({
  tenantId, workflowId, conversationId, versionId, definition, extractedInputs, dryRun,
}: {
  tenantId: string;
  workflowId: string;
  conversationId: string;
  versionId: string;
  definition: WorkflowDefinition;
  extractedInputs: Record<string, unknown>;
  dryRun: boolean;
}): Promise<StartedInstance> => {
  try {
    const instance = await prisma.$transaction(async (tx) => {
      const created = await tx.workflowInstance.create({
        data: {
          tenantId,
          workflowId,
          workflowVersionId: versionId,
          conversationId,
          status: 'RUNNING',
          currentNodeId: definition.entryNodeId,
          variables: extractedInputs as Prisma.InputJsonValue,
          inputData: extractedInputs as Prisma.InputJsonValue,
        },
      });

      // Same transaction, deliberately: the pointer and the row that the index
      // guards must never disagree.
      if (!dryRun) {
        await tx.conversation.update({
          where: { id: conversationId },
          data: { activeWorkflowInstanceId: created.id },
        });
      }

      return created;
    });

    return { instance, definition };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      // Either the partial index or the conversation's unique pointer fired.
      // Both mean the same thing: someone else got there first.
      throw new ActiveInstanceExistsError(conversationId);
    }
    throw err;
  }
};

/** The live instance for a conversation, if any. At most one can exist. */
export const findActiveInstance = (conversationId: string) =>
  prisma.workflowInstance.findFirst({
    where: { conversationId, status: { in: LIVE_STATUSES } },
    include: { workflow: true, workflowVersion: true },
  });

/** Park an instance waiting on the customer's next message. */
export const parkForUser = async (
  instanceId: string,
  awaiting: { nodeId: string; variableName: string },
): Promise<void> => {
  await prisma.workflowInstance.update({
    where: { id: instanceId },
    data: {
      status: 'WAITING_FOR_USER',
      waitingNodeId: awaiting.nodeId,
      waitingVariableName: awaiting.variableName,
      // Where to continue from once the answer validates.
      currentNodeId: awaiting.nodeId,
      resumeAt: null,
    },
  });
};

/** Park an instance on a DELAY until a wall-clock time. */
export const parkUntil = async (
  instanceId: string,
  resumeAt: Date,
  resumeFromNodeId: string | null,
): Promise<void> => {
  await prisma.workflowInstance.update({
    where: { id: instanceId },
    data: {
      status: 'PAUSED',
      resumeAt,
      currentNodeId: resumeFromNodeId,
      waitingNodeId: null,
      waitingVariableName: null,
    },
  });
};

/** Persist accumulated variables and the cursor mid-walk. */
export const saveProgress = async (
  instanceId: string,
  variables: Record<string, unknown>,
  currentNodeId: string | null,
): Promise<void> => {
  await prisma.workflowInstance.update({
    where: { id: instanceId },
    data: { variables: variables as Prisma.InputJsonValue, currentNodeId },
  });
};

/**
 * Move an instance to a terminal state and release the conversation.
 *
 * Clearing `activeWorkflowInstanceId` in the same transaction is what lets the
 * next inbound message be routed afresh instead of being fed to a finished run.
 */
export const finishInstance = async ({
  instanceId, conversationId, status, variables, error, dryRun = false,
}: {
  instanceId: string;
  conversationId: string;
  status: Extract<WorkflowInstanceStatus, 'COMPLETED' | 'CANCELLED' | 'FAILED'>;
  variables?: Record<string, unknown>;
  error?: string | null;
  dryRun?: boolean;
}): Promise<void> => {
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.workflowInstance.update({
      where: { id: instanceId },
      data: {
        status,
        currentNodeId: null,
        waitingNodeId: null,
        waitingVariableName: null,
        resumeAt: null,
        error: error ?? null,
        outputData: (variables ?? {}) as Prisma.InputJsonValue,
        ...(variables ? { variables: variables as Prisma.InputJsonValue } : {}),
        completedAt: status === 'COMPLETED' ? now : null,
        failedAt: status === 'FAILED' ? now : null,
      },
    });

    if (!dryRun) {
      // Scoped to this instance: if something else already claimed the
      // conversation we must not clear its claim.
      await tx.conversation.updateMany({
        where: { id: conversationId, activeWorkflowInstanceId: instanceId },
        data: { activeWorkflowInstanceId: null },
      });
    }
  });
};

/**
 * Hand the conversation to a human.
 *
 * Pauses rather than completes: the instance keeps its variables so an agent
 * can resume automation later without the customer repeating themselves.
 */
export const handOffToHuman = async ({
  instanceId, conversationId, tenantId, reason, dryRun = false,
}: {
  instanceId: string | null;
  conversationId: string;
  tenantId: string;
  reason: string;
  dryRun?: boolean;
}): Promise<void> => {
  if (dryRun) return;

  await prisma.$transaction(async (tx) => {
    if (instanceId) {
      await tx.workflowInstance.update({
        where: { id: instanceId },
        data: { status: 'PAUSED', resumeAt: null },
      });
    }

    await tx.conversation.update({
      where: { id: conversationId },
      data: {
        status: 'HUMAN_TAKEOVER',
        // Both flags matter: `status` is what the inbox shows, `automationPaused`
        // is what the inbound path checks before running anything at all.
        automationPaused: true,
      },
    });

    await tx.humanHandoff.create({
      data: { tenantId, conversationId, workflowInstanceId: instanceId, reason, status: 'PENDING' },
    });
  });

  logger.info('Conversation handed to a human', { conversationId, instanceId, reason });

  // The urgent notification.
  //
  // **Outside the transaction, on purpose.** A handoff that committed must not be
  // rolled back because a notification could not be written — the customer has already
  // been told a person will help, and the conversation is already paused. Notifying is
  // the follow-up, not part of the state change.
  //
  // Loaded here rather than passed in because every caller has a conversationId and
  // none of them has the customer's name.
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { customer: { select: { name: true, waId: true } } },
  });
  await notifyHandoffRequested({
    tenantId,
    conversationId,
    customerName: conversation?.customer.name ?? null,
    waId: conversation?.customer.waId ?? '',
    reason,
  });
};

/** Cancel a live instance, e.g. the customer said "cancel" or switched topic. */
export const cancelInstance = async ({
  instanceId, conversationId, reason,
}: {
  instanceId: string;
  conversationId: string;
  reason: string;
}): Promise<void> => {
  await finishInstance({ instanceId, conversationId, status: 'CANCELLED', error: reason });
  logger.info('Workflow instance cancelled', { instanceId, reason });
};

/** Instances parked on a DELAY that are now due. Used by the resume worker. */
export const dueInstances = (limit = 25) =>
  prisma.workflowInstance.findMany({
    where: { status: 'PAUSED', resumeAt: { not: null, lte: new Date() } },
    orderBy: { resumeAt: 'asc' },
    take: limit,
    select: { id: true, tenantId: true, conversationId: true },
  });

/**
 * Abandon instances parked longer than the timeout.
 *
 * Without this a customer who never answers leaves a live instance forever, and
 * because of the partial unique index that conversation can never start another
 * workflow — the customer is silently stuck.
 */
export const expireStaleInstances = async (olderThanHours: number): Promise<number> => {
  const cutoff = new Date(Date.now() - olderThanHours * 60 * 60 * 1000);
  const stale = await prisma.workflowInstance.findMany({
    where: { status: { in: ['WAITING_FOR_USER', 'PAUSED'] }, updatedAt: { lt: cutoff } },
    select: { id: true, conversationId: true },
    take: 200,
  });

  for (const instance of stale) {
    await finishInstance({
      instanceId: instance.id,
      conversationId: instance.conversationId,
      status: 'CANCELLED',
      error: `Abandoned after ${olderThanHours}h with no reply`,
    });
  }

  if (stale.length) logger.info('Expired stale workflow instances', { count: stale.length });
  return stale.length;
};
