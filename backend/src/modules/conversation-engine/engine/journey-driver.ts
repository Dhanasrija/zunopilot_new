import type { WorkflowInstance } from '@prisma/client';
import { prisma } from '../../../config/prisma.js';
import type { MockWhatsAppProvider } from '../providers/mock.js';
import { startInstanceOnVersion } from './instance-manager.js';
import { walk, type WalkDeps, type WalkOutcome } from './walker.js';
import { resumeWithUserInput, type ResumeResult } from './resume.js';

// Walking a workflow the way a customer would.
//
// **Why this is not `testWorkflow`.** One `walk` parks at the first interactive node
// and stops, so it reaches step 3 of a twelve-step flow and reports success. Every
// fault that mattered in the generated `cancel_child_class` lived *after* that park:
// the confirmation that cancelled either way, the condition that reported failure
// after a successful cancellation, the message that signed off errors as done. Seeing
// any of them requires answering and re-entering, repeatedly.
//
// **Why in-process and not over HTTP.** `simulatorReplySchema` accepts `{message,
// dryRun}` — there is no way to say *which row was tapped*, and a list flow cannot be
// driven without one. `resumeWithUserInput` takes `replyId` directly.
//
// These helpers were already written, as local functions inside
// `lms-workflow.integration.test.ts`. This file is that code lifted out so the
// generator can reuse it rather than a second driver being written beside it.

export interface JourneyDriver {
  /** Start the run and walk until it parks, finishes or fails. */
  begin(): Promise<WorkflowInstance>;
  /** Answer the parked node. `id` is the tapped row or button id. */
  reply(text: string, id?: string): Promise<ResumeResult>;
  /** The rows offered by the nth outbound message, or `[]` if it offered none. */
  rowsOf(index?: number): Array<{ id: string; title: string }>;
  /** The buttons offered by the nth outbound message. */
  buttonsOf(index?: number): Array<{ id: string; title: string }>;
  /** The newest instance for this conversation. */
  current(): Promise<WorkflowInstance>;
}

export interface JourneyDriverOptions {
  tenantId: string;
  workflowId: string;
  /**
   * The version to run, named explicitly.
   *
   * Required rather than defaulted to the published one, because the whole reason
   * this exists is driving a **draft** — see `startInstanceOnVersion`.
   */
  versionId: string;
  conversationId: string;
  deps: WalkDeps;
  whatsapp: MockWhatsAppProvider;
  /** Suppress real side effects. Defaults to true; a driver that books things is a bug. */
  dryRun?: boolean;
}

/** Rows and buttons both arrive on the outbound message's `meta`. */
interface InteractiveMeta {
  sections?: Array<{ rows: Array<{ id: string; title: string }> }>;
  buttons?: Array<{ id: string; title: string }>;
}

export const createJourneyDriver = (options: JourneyDriverOptions): JourneyDriver => {
  const {
    tenantId, workflowId, versionId, conversationId, deps, whatsapp, dryRun = true,
  } = options;

  const current = () => prisma.workflowInstance.findFirstOrThrow({
    where: { conversationId }, orderBy: { startedAt: 'desc' },
  });

  const metaOf = (index: number): InteractiveMeta =>
    (whatsapp.sent[index]?.meta as InteractiveMeta | undefined) ?? {};

  return {
    async begin() {
      const { instance, definition } = await startInstanceOnVersion({
        tenantId, workflowId, conversationId, versionId, dryRun,
      });
      await walk({ instance, definition, deps: { ...deps, dryRun } });
      return current();
    },

    async reply(text: string, id?: string) {
      const instance = await current();
      return resumeWithUserInput({
        instance,
        deps: { ...deps, dryRun },
        answer: text,
        replyId: id ?? null,
      });
    },

    rowsOf(index = 0) {
      return metaOf(index).sections?.[0]?.rows ?? [];
    },

    buttonsOf(index = 0) {
      return metaOf(index).buttons ?? [];
    },

    current,
  };
};

// ── Driving a draft automatically ─────────────────────────────────────────────

export interface JourneyFailure {
  nodeId: string;
  status: string;
  /**
   * Whatever the executor recorded.
   *
   * `NodeExecution.error` is a `Json` column, not a string — executors store a
   * structured cause when they have one. Kept as-is rather than stringified so the
   * report carries the same detail the execution log shows.
   */
  error: unknown;
}

export interface JourneyReport {
  /**
   * How the run ended.
   *
   * `STALLED` is the driver's own verdict — still asking after the turn budget.
   * `RUNNING` is the awkward real one: the walk returned with the instance neither
   * finished nor parked, which the first real generated draft did. It is in the union
   * because it happens; the earlier version cast `instance.status` straight into this
   * field, so a `RUNNING` run was reported under a type that claimed it could not be.
   */
  outcome:
    | 'COMPLETED' | 'CANCELLED' | 'FAILED' | 'HUMAN_HANDOFF' | 'PAUSED'
    | 'RUNNING' | 'PENDING' | 'WAITING_FOR_APPROVAL'
    | 'STALLED';
  /** Node ids in the order they executed. */
  reached: string[];
  /** Executions that did not reach SUCCESS. */
  failures: JourneyFailure[];
  /**
   * Interactive nodes that offered nothing to choose.
   *
   * Almost always the recorded-sample precondition rather than a graph fault: a dry
   * run returns the operation's `sampleResponse`, and an operation without one yields
   * `{dryRun: true}` and no rows. Reported separately so the answer is "record a
   * sample on that operation" rather than a confusing failure.
   */
  emptyChoices: string[];
  /** How many replies the driver had to send. */
  turns: number;
  /**
   * The node the run finished on — where it completed, failed or handed off.
   *
   * Worth having separately from `reached`: a flow that ends at a handoff node has a
   * very different meaning from one that ends at `END_WORKFLOW`, and the last
   * *executed* node is not always the one it came to rest on.
   */
  endedAt: string | null;
  /**
   * Every message the run sent.
   *
   * **Empty on a dry run, and that is not a bug to fix here.** Each interactive
   * executor guards its send with `if (!dryRun)`, so a dry run sends nothing at all.
   * Populated when the driver is pointed at a live run, which is how the LMS suite
   * uses it.
   */
  messages: string[];
}

/**
 * How many replies before calling it stalled.
 *
 * A flow that asks more than this is either looping or is longer than anything the
 * generator produces — `cancel_child_class`, the longest real one, needs three.
 */
const MAX_TURNS = 12;

/**
 * Walk a draft end to end, answering every question with the first thing offered.
 *
 * **What it can and cannot judge.** It can say every node succeeded, the run reached
 * a terminal state rather than failing or handing off, and no list came up empty. It
 * cannot say the flow did the *right* thing: a graph that branches the wrong way
 * still completes, it just tells the customer something false. That is why the
 * generator's own expected journeys stay advisory and why Layers 1 and 2 remain the
 * only things that block publishing.
 *
 * **And under `dryRun` it cannot see data at all.** A dry run returns each
 * operation's recorded `sampleResponse` rather than calling anything, so every
 * connector succeeds with the same canned answer every time. A lookup that would find
 * nobody finds the sample; a branch that depends on what came back always takes the
 * same side. So this checks that a draft is *wired* such that every node can run —
 * which is exactly the fault class the generator produces — and says nothing about
 * behaviour on real data. `journey-driver.integration.test.ts` pins that contrast
 * with the same journey run both ways.
 */
export const driveJourney = async (options: JourneyDriverOptions): Promise<JourneyReport> => {
  const driver = createJourneyDriver(options);
  const emptyChoices: string[] = [];
  const nodes = await nodesOf(options.versionId);

  let instance = await driver.begin();
  let turns = 0;

  while (instance.status === 'WAITING_FOR_USER' && turns < MAX_TURNS) {
    const waitingAt = instance.waitingNodeId ?? instance.currentNodeId ?? '';
    const node = nodes.get(waitingAt);
    const answer = await answerFor(instance.id, waitingAt, node);

    if (!answer) {
      // Nothing could be offered. For a list or a button set that is a real finding:
      // almost always an operation with no recorded `sampleResponse`, since a dry run
      // returns the sample and nothing else. Named rather than left as a stall.
      emptyChoices.push(waitingAt);
      break;
    }

    turns += 1;
    await driver.reply(answer.text, answer.replyId);
    const next = await driver.current();
    // A resume that leaves the run parked on the same node is a re-prompt, not
    // progress. One is fair — a validation rule the driver's guess did not satisfy —
    // but repeating it would burn every remaining turn to no effect.
    const reprompted = next.id === instance.id
      && next.status === 'WAITING_FOR_USER'
      && next.waitingNodeId === instance.waitingNodeId;
    instance = next;
    if (reprompted) break;
  }

  const executions = await prisma.nodeExecution.findMany({
    where: { workflowInstanceId: instance.id },
    orderBy: { startedAt: 'asc' },
    select: { nodeId: true, status: true, error: true },
  });

  return {
    // `WorkflowInstanceStatus` and the outcome union now line up member-for-member
    // apart from `STALLED`, so this maps rather than casts — a new status added to the
    // enum becomes a type error here instead of a value the report lies about.
    outcome: instance.status === 'WAITING_FOR_USER' ? 'STALLED' : instance.status,
    reached: executions.map((e) => e.nodeId),
    failures: executions
      .filter((e) => e.status === 'FAILED')
      .map((e) => ({ nodeId: e.nodeId, status: e.status, error: e.error })),
    emptyChoices,
    turns,
    endedAt: instance.currentNodeId ?? instance.waitingNodeId ?? null,
    messages: options.whatsapp.bodies(),
  };
};

interface DriverAnswer {
  text: string;
  replyId?: string;
}

/**
 * What to reply to the node the run is parked on.
 *
 * **Read from the execution log, not from the outbound message.** The obvious source
 * is `whatsapp.sent[].meta.sections[0].rows` — which is what the LMS suite uses — but
 * every interactive executor guards its send with `if (!dryRun)`, so in a dry run
 * nothing is sent and there is nothing to read. The ids are still recorded on the
 * `NodeExecution` output, which is also what `acceptReply` re-checks the answer
 * against, making it the more faithful source in both modes.
 */
const answerFor = async (
  instanceId: string,
  nodeId: string,
  node: { type: string; config?: Record<string, unknown> } | undefined,
): Promise<DriverAnswer | null> => {
  if (node?.type === 'LIST_MESSAGE' || node?.type === 'BUTTON_MESSAGE') {
    const execution = await prisma.nodeExecution.findFirst({
      where: { workflowInstanceId: instanceId, nodeId },
      orderBy: { startedAt: 'desc' },
      select: { output: true },
    });
    const offered = (execution?.output as { offeredIds?: string[] } | null)?.offeredIds ?? [];
    // The first thing offered, per the plan. Choosing at random would make a
    // failing run unreproducible.
    const [first] = offered;
    return first ? { text: first, replyId: first } : null;
  }

  if (node?.type === 'ASK_USER_INPUT') {
    // A plausible value for the declared type. Not trying to be clever: the point is
    // to get past the question so the nodes *after* it are exercised, and a value
    // that fails validation shows up as a re-prompt rather than as a wrong pass.
    const config = (node.config ?? {}) as {
      inputType?: string;
      validation?: { choices?: string[] };
    };
    const choices = config.validation?.choices;
    if (choices?.length) return { text: choices[0] };
    switch (config.inputType) {
      case 'number': return { text: '1' };
      case 'date': return { text: '2026-01-01' };
      case 'email': return { text: 'driver@example.test' };
      case 'phone': return { text: '15550001234' };
      default: return { text: 'Driver test answer' };
    }
  }

  // An unknown waiting node type. Answering blind is worse than reporting it.
  return null;
};

/** The version's nodes, by id. Read once rather than per turn. */
const nodesOf = async (versionId: string) => {
  const version = await prisma.workflowVersion.findUnique({
    where: { id: versionId },
    select: { definition: true },
  });
  const nodes = (version?.definition as {
    nodes?: Array<{ id: string; type: string; config?: Record<string, unknown> }>;
  } | null)?.nodes ?? [];
  return new Map(nodes.map((n) => [n.id, n]));
};
