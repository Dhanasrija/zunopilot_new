import type { Assistant, Conversation, Customer, Tenant } from '@prisma/client';
import { prisma } from '../../../config/prisma.js';
import { withContext } from '../../../config/logger.js';
import { toRouterView, type RouterCapabilityView } from '../domain/capability.js';
import { llmProvider } from '../providers/llm.js';
import {
  routerJsonSchema, validateRouterOutput, type ValidatedRouterOutput,
} from './contract.js';
import {
  PROMPT_VERSION, ROUTER_SYSTEM_PROMPT, buildRouterUserPrompt,
} from './prompt.js';

// The AI workflow router.
//
// Runs only when nothing deterministic matched. Its input is capability
// contracts, never node graphs; its output is a validated struct, never parsed
// prose; and its selection is constrained to the candidates it was given.

export interface AiRouteResult {
  output: ValidatedRouterOutput;
  candidates: RouterCapabilityView[];
  promptVersion: string;
  model: string;
  latencyMs: number;
  tokenUsage: Record<string, number>;
}

/**
 * How many capability contracts the router prompt may carry.
 *
 * Every candidate contributes its purpose, description, `useWhen`, `doNotUseWhen`, both example
 * lists, its inputs, preconditions and side effects — so this list *is* the prompt, and it used
 * to be unbounded. A workspace with thirty published workflows paid for all thirty on every
 * single message, which is latency and token cost that grows as a workspace gets more successful.
 *
 * Twelve is chosen to be comfortably above what any real workspace has today while still being a
 * ceiling. Taken in `priority` order, which is what an operator already uses to say which
 * workflow matters most, so the cut falls where they have already told us it should.
 */
const MAX_CANDIDATES = 12;

/**
 * The workflows this assistant may route to.
 *
 * Published conversation workflows with a capability contract and a slug. A
 * workflow missing any of those is invisible to the router rather than a
 * runtime surprise — the publish validator already refuses to let it get here.
 */
export const candidateWorkflows = async (assistantId: string): Promise<RouterCapabilityView[]> => {
  const workflows = await prisma.workflow.findMany({
    where: {
      assistantId,
      status: 'PUBLISHED',
      category: 'CONVERSATION',
      slug: { not: null },
      capability: { isNot: null },
    },
    include: { capability: true },
    orderBy: { priority: 'desc' },
  });

  const views = workflows.flatMap((workflow) => (workflow.capability
    ? [toRouterView(workflow, workflow.capability)]
    : []));

  // Say what was dropped. A silent truncation reads as "the router considered everything" — and
  // the symptom, a workflow that never gets chosen no matter what the customer types, is
  // otherwise almost impossible to attribute.
  if (views.length > MAX_CANDIDATES) {
    withContext({ assistantId }).warn(
      'Too many candidate workflows for one router prompt; keeping the highest priority',
      {
        total: views.length,
        kept: MAX_CANDIDATES,
        dropped: views.slice(MAX_CANDIDATES).map((v) => v.workflowId),
      },
    );
  }

  return views.slice(0, MAX_CANDIDATES);
};

/** Recent turns, oldest first, for the router's context window. */
const recentMessages = async (conversationId: string, limit: number) => {
  const rows = await prisma.message.findMany({
    /*
     * Removed messages are withheld from the model as well.
     *
     * Not obvious, and worth stating: an agent who deletes a message has said it should not
     * inform what happens next. Leaving it in the history means the assistant can quote it
     * straight back to the customer, which undoes the removal in the most public way available.
     * The customer still has their own copy — that is Meta's, not ours to take.
     */
    where: { conversationId, deletedAt: null },
    orderBy: { createdAt: 'desc' },
    take: Math.max(0, limit),
    select: { direction: true, body: true },
  });

  return rows
    .reverse()
    .filter((m) => (m.body ?? '').trim())
    .map((m) => ({
      role: m.direction === 'INBOUND' ? ('customer' as const) : ('business' as const),
      text: (m.body ?? '').slice(0, 500),
    }));
};

export const routeWithAi = async ({
  tenant, assistant, conversation, contact, message,
}: {
  tenant: Tenant;
  assistant: Assistant;
  conversation: Conversation;
  contact: Customer;
  message: string;
}): Promise<AiRouteResult | null> => {
  const logger = withContext({
    tenantId: tenant.id,
    assistantId: assistant.id,
    conversationId: conversation.id,
    routingSource: 'AI_ROUTER',
  });

  const candidates = await candidateWorkflows(assistant.id);
  if (!candidates.length) {
    logger.debug('No routable workflows for this assistant');
    return null;
  }

  const timezone = 'Asia/Kolkata';
  const now = new Date();

  // The router needs "today" in the workspace's timezone. Without it, "book me
  // in for tomorrow" resolves to the wrong date for part of every day.
  const userPrompt = buildRouterUserPrompt({
    latestMessage: message,
    conversationSummary: conversation.summary,
    recentMessages: await recentMessages(conversation.id, assistant.maxRecentMessages),
    contact: {
      name: contact.name,
      isReturning: Boolean(contact.lastSeenAt && contact.createdAt < contact.lastSeenAt),
      tags: [],
    },
    business: { name: tenant.businessName, category: tenant.category },
    channel: { displayPhone: null },
    now: {
      iso: now.toISOString(),
      date: now.toLocaleDateString('en-CA', { timeZone: timezone }),
      time: now.toLocaleTimeString('en-GB', { timeZone: timezone, hour12: false }),
      timezone,
      dayOfWeek: now.toLocaleDateString('en-GB', { timeZone: timezone, weekday: 'long' }),
    },
    workflows: candidates,
  });

  const provider = llmProvider();
  const slugs = candidates.map((c) => c.workflowId);

  try {
    const response = await provider.completeStructured({
      systemPrompt: ROUTER_SYSTEM_PROMPT,
      userPrompt,
      schemaName: 'workflow_routing_decision',
      jsonSchema: routerJsonSchema(),
      temperature: 0,
      /*
       * Bound the output on the hottest call in the product.
       *
       * This was unset, so generation time here was limited by nothing but the model's own
       * stopping decision — on the one call every open-ended customer message waits for, measured
       * at p50 1.5–2.0s. The output is a decision, a workflow id, a confidence and at most a
       * short clarifying question; 512 tokens is several times what that needs.
       *
       * Deliberately generous rather than tight. Truncating a structured reply produces invalid
       * JSON, which `validateRouterOutput` correctly treats as no-match — so a ceiling set too low
       * would show up as a router that mysteriously stops routing, not as an error.
       */
      maxTokens: 512,
    });

    const output = validateRouterOutput(response.data, slugs);
    if (!output) {
      logger.warn('Router returned a response that failed validation; treating as no match');
      return null;
    }

    if (output.rejectedWorkflowId) {
      // Either a hallucination or an injection attempt that got as far as the
      // model. Worth a warning: repeated hits mean the candidate list and the
      // prompt have drifted apart.
      logger.warn('Router named a workflow outside the candidate list; rejected', {
        rejected: output.rejectedWorkflowId,
      });
    }

    logger.info('Router decided', {
      decision: output.decision,
      workflowId: output.workflowId,
      confidence: output.confidence,
      reasonCode: output.reasonCode,
      latencyMs: response.latencyMs,
    });

    return {
      output,
      candidates,
      promptVersion: PROMPT_VERSION,
      model: response.model,
      latencyMs: response.latencyMs,
      tokenUsage: response.tokenUsage,
    };
  } catch (err) {
    // A router failure must never drop a customer's message. Returning null
    // sends it to the fallback, which is a reply rather than silence.
    logger.error('Router call failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
};
