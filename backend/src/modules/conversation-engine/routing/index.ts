import { Prisma, type Conversation, type Customer, type Tenant, type WhatsappAccount } from '@prisma/client';
import { prisma } from '../../../config/prisma.js';
import { withContext } from '../../../config/logger.js';
import { channelForTenant } from '../../../services/whatsapp-account.service.js';
import { whatsappProviderFor } from '../providers/whatsapp.js';
import { mirrorOutbound } from '../providers/mirror.js';
import { MOCK_INTEGRATIONS, MockLlmProvider, MockHttpCaller } from '../providers/mock.js';
import { findActiveInstance, startInstance, ActiveInstanceExistsError } from '../engine/instance-manager.js';
import { resumeWithUserInput } from '../engine/resume.js';
import { walk, type WalkDeps } from '../engine/walker.js';
import { parseDefinition } from '../domain/definition.js';
import { matchDeterministicRule } from './deterministic.js';
import { respondGenerally } from './general-response.js';
import { env } from '../../../config/env.js';
import { handleInboundMessage } from '../../../services/automation.service.js';
import { startOrderingFlow } from '../../../services/ordering.service.js';
import { routeWithAi } from './ai-router.js';
import { applyConfidenceGate } from './confidence.js';
import { checkAiAllowance, recordAiInteraction } from '../../billing/billing.service.js';
import { aiAgentGate } from '../../modules/module.service.js';
import { sendFallbackText } from './fallback.js';
import type { NodeServices } from '../engine/types.js';

// The routing chain — the thing that decides which single workflow, if any,
// answers an inbound message. The order is the spec's, and it is load-bearing:
//
//   1. active workflow      — an in-flight conversation owns the next message
//   2. deterministic rules  — a button payload is already unambiguous
//   3. AI workflow router   — only for genuinely open-ended text
//   4. fallback
//
// Every step writes a RoutingDecision, including the boring ones, so the debug
// view can explain any reply and routing quality is measurable rather than
// anecdotal.

export interface InboundEnvelope {
  id: string;
  body: string;
  type: string;
  payload: unknown;
  interactive: {
    replyId: string | null;
    replyTitle: string | null;
    kind: 'button' | 'list' | null;
  } | null;
}

export interface RouteArgs {
  tenant: Tenant;
  channel: WhatsappAccount;
  contact: Customer;
  conversation: Conversation;
  message: InboundEnvelope;
  dryRun?: boolean;
  /**
   * Set only on the second pass after an intent switch.
   *
   * Internal, and a one-shot guard: routing re-enters itself once the abandoned run's slot is
   * free, and without this a message the router keeps mis-reading could switch for ever.
   */
  afterIntentSwitch?: boolean;
}

export interface RouteOutcome {
  source: 'ACTIVE_WORKFLOW' | 'DETERMINISTIC' | 'AI_ROUTER' | 'FALLBACK';
  decision: 'START_WORKFLOW' | 'RESUME_WORKFLOW' | 'ASK_CLARIFICATION' | 'GENERAL_RESPONSE' | 'HUMAN_HANDOFF' | 'NO_MATCH';
  workflowId?: string | null;
  reasonCode: string;
  confidence?: number | null;
  handled: boolean;
}

/** Words that always mean "stop", checked as a whole message, never a substring. */
const CANCEL_COMMANDS = new Set(['cancel', 'stop', 'exit', 'quit', 'start over', 'restart', 'main menu']);
const HUMAN_COMMANDS = new Set(['agent', 'human', 'support', 'operator', 'representative']);

/**
 * The services a run gets.
 *
 * The sender is wrapped so everything the engine says is mirrored into the
 * Inbox — see providers/mirror.ts. A dry run is not mirrored: the simulator
 * must not write messages into a real conversation's history.
 */
const servicesFor = (args: RouteArgs, dryRun: boolean): NodeServices => {
  const sender = whatsappProviderFor(args.channel, dryRun ? 'mock' : undefined);
  return {
    whatsapp: dryRun ? sender : mirrorOutbound(sender, {
      tenantId: args.tenant.id,
      conversationId: args.conversation.id,
      customerId: args.contact.id,
    }),
    llm: new MockLlmProvider(),
    http: new MockHttpCaller(),
    integrations: MOCK_INTEGRATIONS,
  };
};

const recordDecision = async (
  args: RouteArgs,
  outcome: Omit<RouteOutcome, 'handled'> & { summary?: string; latencyMs?: number },
): Promise<void> => {
  await prisma.routingDecision.create({
    data: {
      tenantId: args.tenant.id,
      conversationId: args.conversation.id,
      assistantId: args.conversation.assistantId,
      inboundMessageId: args.message.id,
      source: outcome.source,
      decision: outcome.decision,
      selectedWorkflowId: outcome.workflowId ?? null,
      confidence: outcome.confidence ?? null,
      reasonCode: outcome.reasonCode,
      // Never the model's reasoning, and never the customer's message text —
      // only a short operator-readable note.
      summary: outcome.summary ?? null,
      latencyMs: outcome.latencyMs ?? null,
    },
  });
};

/**
 * The tenant's own fallback text — the last resort when even the assistant could
 * not answer. Silence is the one outcome a customer should never get.
 */
const sendConfiguredFallback = async (args: RouteArgs): Promise<void> => {
  if (args.dryRun) return;
  await sendFallbackText({
    tenantId: args.tenant.id,
    waId: args.contact.waId,
    whatsapp: servicesFor(args, false).whatsapp,
  });
};

/**
 * Answer without the model.
 *
 * Two different situations end up here — the workspace is over its spend cap, or the AI agent
 * has been switched off — and both want the same behaviour, so it lives in one function rather
 * than being written twice with a chance of drifting.
 *
 * It delegates to the legacy `handleInboundMessage`, which matches the tenant's own
 * `KeywordRule` FAQs and otherwise sends their `FallbackRule` text. That is deliberately not a
 * new customer-facing message: the workspace has already written what to say when the bot
 * cannot answer, and inventing a second voice for "the AI is off" would be a worse product than
 * using theirs. It also keeps the promise stated three times in this file — silence is the one
 * outcome a customer should never get.
 *
 * `reasonCode` is free text on `RoutingDecision`, so the distinct reasons show up in the
 * routing-decisions view without a migration, and "why did my bot stop using AI" is answerable
 * from the console instead of from the logs.
 */
const degradeToNonAi = async (args: RouteArgs, reasonCode: string): Promise<RouteOutcome> => {
  await handleInboundMessage({
    tenant: args.tenant,
    conversation: args.conversation,
    customer: args.contact,
    message: {
      ...(args.message as unknown as Record<string, unknown>),
      body: args.message.body,
      payload: args.message.payload,
    } as never,
  });
  await recordDecision(args, { source: 'FALLBACK', decision: 'NO_MATCH', reasonCode });
  return { source: 'FALLBACK', decision: 'NO_MATCH', reasonCode, handled: true };
};

const walkDepsFor = (args: RouteArgs): WalkDeps => ({
  tenant: args.tenant,
  contact: args.contact,
  conversation: args.conversation,
  channel: args.channel,
  assistantId: args.conversation.assistantId,
  services: servicesFor(args, args.dryRun ?? false),
  latestMessage: {
    id: args.message.id,
    body: args.message.body,
    type: args.message.type,
    payload: args.message.payload,
  },
  dryRun: args.dryRun ?? false,
});

/**
 * The assistant for a channel, created on first use.
 *
 * The Assistant used to be a gate: the engine only ran for a channel whose
 * assistant was ACTIVE *and* had published workflows. That gate is gone — the
 * LLM is now the front door for every channel, so this find-or-creates instead
 * of filtering.
 *
 * The row still exists because it is where the routing policy lives (the two
 * thresholds, the general system prompt, the handoff workflow) and because
 * Workflow, RoutingRule and Conversation all reference it. It is simply no
 * longer something an operator has to create or switch on.
 *
 * `upsert` on the unique channel id rather than find-then-create: two inbound
 * messages for a brand new channel arrive concurrently, and a find-then-create
 * would race and violate the unique constraint.
 */
export const assistantForChannel = async (channelId: string) => {
  const channel = await prisma.whatsappAccount.findUnique({
    where: { id: channelId },
    include: { tenant: true },
  });
  if (!channel) return null;

  return prisma.assistant.upsert({
    where: { whatsappChannelId: channelId },
    update: {},
    create: {
      tenantId: channel.tenantId,
      whatsappChannelId: channelId,
      name: `${channel.tenant.businessName} Assistant`,
      status: 'ACTIVE',
      generalResponseEnabled: true,
      highConfidenceThreshold: env.engine.highConfidence,
      mediumConfidenceThreshold: env.engine.mediumConfidence,
      maxRecentMessages: env.engine.maxRecentMessages,
    },
  });
};

/**
 * Node types that change something outside this conversation.
 *
 * A run that has passed one of these must not be silently abandoned: the class is already
 * cancelled, the order already placed. Switching intent there would leave the customer talking
 * about something else, unaware that the thing they asked for actually happened.
 */
const IRREVERSIBLE_NODES = ['CONNECTOR_ACTION', 'DATABASE_WRITE', 'CREATE_ORDER'];

const hasActedIrreversibly = async (workflowInstanceId: string): Promise<boolean> => {
  const done = await prisma.nodeExecution.count({
    where: {
      workflowInstanceId,
      nodeType: { in: IRREVERSIBLE_NODES as never },
      status: 'SUCCESS',
    },
  });
  return done > 0;
};

export const routeInboundMessage = async (args: RouteArgs): Promise<RouteOutcome> => {
  const logger = withContext({
    tenantId: args.tenant.id,
    conversationId: args.conversation.id,
    messageId: args.message.id,
  });

  const assistant = await assistantForChannel(args.channel.id);
  if (!assistant) {
    logger.warn('Channel disappeared while routing');
    return { source: 'FALLBACK', decision: 'NO_MATCH', reasonCode: 'NO_CHANNEL', handled: false };
  }

  const text = args.message.body.trim().toLowerCase();

  // ── Step 0: an in-flight cart owns the message ─────────────────────────────
  //
  // This runs before everything, including the active-workflow check, and it is
  // the single most important ordering rule in the system.
  //
  // Mid-checkout the customer's text is *data* — their name, their delivery
  // address — not a command. Routing it is a category error that has already
  // caused a live regression: a real address was semantically matched to the
  // tenant's "address/location" FAQ, so the bot replied with the restaurant's
  // own address, never stored the delivery one, and stranded the cart. Money and
  // in-flight checkout always win, and no LLM sits on that critical path.
  const cart = await prisma.cart.findUnique({ where: { customerId: args.contact.id } });
  if (cart && cart.state !== 'IDLE') {
    logger.debug('Cart is active, handing to the ordering state machine', { cartState: cart.state });
    await handleInboundMessage({
      tenant: args.tenant,
      conversation: args.conversation,
      customer: args.contact,
      message: {
        ...(args.message as unknown as Record<string, unknown>),
        body: args.message.body,
        payload: args.message.payload,
      } as never,
    });
    return { source: 'ACTIVE_WORKFLOW', decision: 'NO_MATCH', reasonCode: 'CART_IN_PROGRESS', handled: true };
  }

  // ── Step 1: an active workflow owns the next message ───────────────────────
  const active = await findActiveInstance(args.conversation.id);

  if (active) {
    // Explicit escape hatches, matched on the whole message so a real answer
    // containing the word "cancel" cannot trip them.
    if (HUMAN_COMMANDS.has(text)) {
      const { handOffToHuman } = await import('../engine/instance-manager.js');
      await handOffToHuman({
        instanceId: active.id,
        conversationId: args.conversation.id,
        tenantId: args.tenant.id,
        reason: 'Customer asked for a human',
        dryRun: args.dryRun ?? false,
      });
      await recordDecision(args, {
        source: 'ACTIVE_WORKFLOW', decision: 'HUMAN_HANDOFF',
        workflowId: active.workflowId, reasonCode: 'USER_REQUESTED_HUMAN',
      });
      return { source: 'ACTIVE_WORKFLOW', decision: 'HUMAN_HANDOFF', reasonCode: 'USER_REQUESTED_HUMAN', handled: true };
    }

    if (CANCEL_COMMANDS.has(text)) {
      const { cancelInstance } = await import('../engine/instance-manager.js');
      await cancelInstance({
        instanceId: active.id,
        conversationId: args.conversation.id,
        reason: 'Customer cancelled',
      });
      await servicesFor(args, args.dryRun ?? false).whatsapp.sendText({
        to: args.contact.waId,
        body: "No problem, I've cancelled that. What would you like to do instead?",
      });
      await recordDecision(args, {
        source: 'ACTIVE_WORKFLOW', decision: 'NO_MATCH',
        workflowId: active.workflowId, reasonCode: 'USER_CANCELLED',
      });
      return { source: 'ACTIVE_WORKFLOW', decision: 'NO_MATCH', reasonCode: 'USER_CANCELLED', handled: true };
    }

    // Otherwise the message belongs to the running workflow. Not routed, not
    // classified — a customer answering "Cardiology" must not be re-interpreted
    // as a new intent.
    if (active.status === 'WAITING_FOR_USER') {
      let switchedTo: RouteOutcome | null = null;

      const result = await resumeWithUserInput({
        instance: active,
        deps: walkDepsFor(args),
        answer: args.message.body,
        // A tap carries the row/button id. Without it an interactive node can
        // only match on the visible label, which is exactly the ambiguity the
        // ids exist to remove.
        replyId: args.message.interactive?.replyId ?? null,
        /**
         * The reply did not fit. Ask whether it is a different intent instead.
         *
         * Only reached on a rejection, so a conversation of valid answers costs nothing extra.
         * Refuses to switch once the run has done something irreversible, and refuses when the
         * router picks the workflow that is already running — re-prompting is right there.
         */
        onRejected: async (reason) => {
          if (args.afterIntentSwitch) return 'REPROMPT';
          if (await hasActedIrreversibly(active.id)) {
            logger.debug('Not switching intent: this run has already changed something', { reason });
            return 'REPROMPT';
          }

          const reroute = await routeWithAi({
            tenant: args.tenant,
            assistant,
            conversation: args.conversation,
            contact: args.contact,
            message: args.message.body,
          });
          if (!reroute) return 'REPROMPT';

          const gate = applyConfidenceGate({
            output: reroute.output,
            assistant,
            candidates: reroute.candidates,
          });
          const target = gate.action === 'START_WORKFLOW' ? gate.workflowId : null;
          if (!target || target === active.workflowId) return 'REPROMPT';

          const { cancelInstance } = await import('../engine/instance-manager.js');
          await cancelInstance({
            instanceId: active.id,
            conversationId: args.conversation.id,
            reason: `Customer changed the subject: ${args.message.body.slice(0, 80)}`,
          });

          // Re-enter routing with the slot free, so the new workflow starts through exactly
          // the same path a fresh message takes — thresholds, entitlement, audit and all.
          // `afterIntentSwitch` makes this a one-shot: the second pass cannot switch again.
          switchedTo = await routeInboundMessage({ ...args, afterIntentSwitch: true });
          return 'SWITCHED';
        },
      });

      if (result.outcome === 'SWITCHED_INTENT' && switchedTo) return switchedTo;
      await recordDecision(args, {
        source: 'ACTIVE_WORKFLOW', decision: 'RESUME_WORKFLOW',
        workflowId: active.workflowId, reasonCode: 'ACTIVE_WORKFLOW_AWAITING_INPUT',
        summary: result.outcome,
      });
      return {
        source: 'ACTIVE_WORKFLOW', decision: 'RESUME_WORKFLOW',
        workflowId: active.workflowId, reasonCode: 'ACTIVE_WORKFLOW_AWAITING_INPUT', handled: true,
      };
    }

    // Running or paused but not awaiting input: nothing to do with this message.
    await recordDecision(args, {
      source: 'ACTIVE_WORKFLOW', decision: 'NO_MATCH',
      workflowId: active.workflowId, reasonCode: 'ACTIVE_WORKFLOW_BUSY',
    });
    return { source: 'ACTIVE_WORKFLOW', decision: 'NO_MATCH', reasonCode: 'ACTIVE_WORKFLOW_BUSY', handled: true };
  }

  // ── Step 2: deterministic rules ────────────────────────────────────────────
  const deterministic = await matchDeterministicRule({
    assistantId: assistant.id,
    text: args.message.body,
    interactiveReplyId: args.message.interactive?.replyId ?? null,
    contact: args.contact,
  });

  if (deterministic?.workflowId) {
    const started = await startWorkflow(args, deterministic.workflowId, deterministic.extractedInputs ?? {});
    await recordDecision(args, {
      source: 'DETERMINISTIC', decision: started ? 'START_WORKFLOW' : 'NO_MATCH',
      workflowId: deterministic.workflowId, reasonCode: deterministic.reasonCode, confidence: 1,
    });
    return {
      source: 'DETERMINISTIC', decision: 'START_WORKFLOW',
      workflowId: deterministic.workflowId, reasonCode: deterministic.reasonCode,
      confidence: 1, handled: started,
    };
  }

  // ── Step 3: AI workflow router ─────────────────────────────────────────────
  //
  // One inbound message that reaches the model is one AI interaction, counted
  // whether it ends in a workflow, a clarification or a general answer —
  // charging for the routing decision and not the answer would be arbitrary.
  //
  // Over quota does **not** silence the customer. The message still gets
  // answered; the overage is recorded and surfaced on the billing page, which
  // is what the "AI usage above the included quota may incur additional
  // charges" disclosure promises. Cutting a real customer off mid-conversation
  // to enforce a soft quota would be a worse product than the overage.
  /*
   * The kill switch, checked before anything that could reach a model.
   *
   * Placed here rather than at the top of this function on purpose. Everything above — an
   * in-flight cart, an active workflow instance, the human/cancel escape hatches, a
   * deterministic keyword or button rule — is pure code and costs nothing, so switching the
   * agent off must not switch *those* off too. A workspace that turns the AI agent off still
   * wants its order flow to take orders.
   *
   * Two levels, both of which must be on: the `AI_AGENT` module is the operator's ceiling and
   * `Tenant.aiAgentEnabled` is the workspace's own preference. See `aiAgentGate`.
   */
  // `agentGate`, not `gate` — the confidence gate below already owns that name.
  const agentGate = await aiAgentGate(args.tenant.id);
  if (!agentGate.allowed) {
    logger.info('AI skipped: the agent is switched off', {
      tenantId: args.tenant.id,
      reason: agentGate.reason,
    });
    return degradeToNonAi(args, `AI_${agentGate.reason}`);
  }

  const allowance = await checkAiAllowance(args.tenant.id);

  if (!allowance.allowed) {
    // Out of quota and at the spend cap. The customer is still answered — the
    // deterministic rules and the tenant's own fallback text handle it — because
    // going quiet would punish *their* customer for a spending limit they never
    // agreed to and cannot see.
    logger.info('AI skipped: usage cap reached', { reason: allowance.reason });
    return degradeToNonAi(args, 'AI_CAP_REACHED');
  }

  void recordAiInteraction(args.tenant.id, {
    billableRatePaise: allowance.billable ? allowance.ratePaise : 0,
  });

  const routed = await routeWithAi({
    tenant: args.tenant,
    assistant,
    conversation: args.conversation,
    contact: args.contact,
    message: args.message.body,
  });

  if (!routed) {
    // Either there is nothing routable for this tenant yet, or the router call
    // failed. Both mean "no workflow fits", which is exactly the case the
    // assistant answers itself — so this is a normal path, not an error path.
    const general = await respondGenerally({
      tenant: args.tenant,
      assistant,
      conversation: args.conversation,
      contact: args.contact,
      message: args.message.body,
      whatsapp: servicesFor(args, args.dryRun ?? false).whatsapp,
      dryRun: args.dryRun ?? false,
    });

    if (general.reply === 'SHOW_MENU') {
      const ordering = await handleOrderingIntent(args, assistant.id, logger);
      await recordDecision(args, {
        source: 'FALLBACK',
        decision: ordering.workflowId ? 'START_WORKFLOW' : 'GENERAL_RESPONSE',
        reasonCode: 'ORDERING_INTENT',
        workflowId: ordering.workflowId,
      });
      return {
        source: 'FALLBACK',
        decision: ordering.workflowId ? 'START_WORKFLOW' : 'GENERAL_RESPONSE',
        reasonCode: 'ORDERING_INTENT',
        workflowId: ordering.workflowId,
        handled: true,
      };
    }

    await recordDecision(args, {
      source: 'FALLBACK',
      decision: general.handled ? 'GENERAL_RESPONSE' : 'NO_MATCH',
      reasonCode: general.handled ? 'GENERAL_QUESTION' : 'ROUTER_UNAVAILABLE',
      latencyMs: general.latencyMs,
    });

    if (!general.handled) await sendConfiguredFallback(args);
    return {
      source: 'FALLBACK',
      decision: general.handled ? 'GENERAL_RESPONSE' : 'NO_MATCH',
      reasonCode: general.handled ? 'GENERAL_QUESTION' : 'ROUTER_UNAVAILABLE',
      handled: true,
    };
  }

  // ── Step 4: confidence gate ────────────────────────────────────────────────
  const gate = applyConfidenceGate({
    output: routed.output,
    assistant,
    candidates: routed.candidates,
  });

  const decisionBase = {
    source: 'AI_ROUTER' as const,
    confidence: routed.output.confidence,
    latencyMs: routed.latencyMs,
  };

  const persistAi = (decision: RouteOutcome['decision'], reasonCode: string, workflowId?: string | null) =>
    prisma.routingDecision.create({
      data: {
        tenantId: args.tenant.id,
        conversationId: args.conversation.id,
        assistantId: assistant.id,
        inboundMessageId: args.message.id,
        source: 'AI_ROUTER',
        decision,
        selectedWorkflowId: workflowId ?? null,
        confidence: routed.output.confidence,
        reasonCode,
        extractedInputs: routed.output.inputs as Prisma.InputJsonValue,
        missingInputs: routed.output.missingInputs as Prisma.InputJsonValue,
        candidateWorkflowIds: routed.candidates.map((c) => c.workflowId) as Prisma.InputJsonValue,
        promptVersion: routed.promptVersion,
        model: routed.model,
        latencyMs: routed.latencyMs,
        tokenUsage: routed.tokenUsage as Prisma.InputJsonValue,
      },
    });

  const send = (body: string) => servicesFor(args, args.dryRun ?? false)
    .whatsapp.sendText({ to: args.contact.waId, body });

  switch (gate.action) {
    case 'START_WORKFLOW': {
      // The router returns a slug; the engine needs the row.
      const workflow = await prisma.workflow.findFirst({
        where: { tenantId: args.tenant.id, slug: gate.workflowId, status: 'PUBLISHED' },
        select: { id: true },
      });
      if (!workflow) {
        await persistAi('NO_MATCH', 'NO_SUITABLE_WORKFLOW');
        return { ...decisionBase, decision: 'NO_MATCH', reasonCode: 'NO_SUITABLE_WORKFLOW', handled: false };
      }

      const started = await startWorkflow(args, workflow.id, routed.output.inputs);
      await persistAi('START_WORKFLOW', gate.reasonCode, workflow.id);
      return {
        ...decisionBase, decision: 'START_WORKFLOW', workflowId: workflow.id,
        reasonCode: gate.reasonCode, handled: started,
      };
    }

    case 'ASK_CLARIFICATION': {
      await send(gate.question);
      await persistAi('ASK_CLARIFICATION', gate.reasonCode);
      logger.info('Asked for clarification', { reasonCode: gate.reasonCode });
      return { ...decisionBase, decision: 'ASK_CLARIFICATION', reasonCode: gate.reasonCode, handled: true };
    }

    case 'HUMAN_HANDOFF': {
      const { handOffToHuman } = await import('../engine/instance-manager.js');
      await send('Let me connect you with a team member. They will reply shortly.');
      await handOffToHuman({
        instanceId: null,
        conversationId: args.conversation.id,
        tenantId: args.tenant.id,
        reason: 'Customer asked for a human',
        dryRun: args.dryRun ?? false,
      });
      await persistAi('HUMAN_HANDOFF', gate.reasonCode);
      return { ...decisionBase, decision: 'HUMAN_HANDOFF', reasonCode: gate.reasonCode, handled: true };
    }

    case 'GENERAL_RESPONSE':
    default: {
      // No workflow fits, so the assistant answers for itself.
      const general = await respondGenerally({
        tenant: args.tenant,
        assistant,
        conversation: args.conversation,
        contact: args.contact,
        message: args.message.body,
        whatsapp: servicesFor(args, args.dryRun ?? false).whatsapp,
        dryRun: args.dryRun ?? false,
      });

      // The model can ask for the ordering flow rather than describing a menu it
      // cannot see. Recognised as an exact sentinel so a customer cannot trigger
      // it by typing it.
      if (general.reply === 'SHOW_MENU') {
        const ordering = await handleOrderingIntent(args, assistant.id, logger);
        const decision = ordering.workflowId ? 'START_WORKFLOW' : 'GENERAL_RESPONSE';
        await persistAi(decision, 'ORDERING_INTENT', ordering.workflowId);
        return {
          ...decisionBase,
          decision,
          reasonCode: 'ORDERING_INTENT',
          workflowId: ordering.workflowId,
          handled: true,
        };
      }

      await persistAi('GENERAL_RESPONSE', gate.reasonCode);

      if (general.handled) {
        return { ...decisionBase, decision: 'GENERAL_RESPONSE', reasonCode: gate.reasonCode, handled: true };
      }

      // The assistant could not answer either. Send the tenant's configured
      // fallback rather than leaving the customer with silence.
      await sendConfiguredFallback(args);
      return {
        ...decisionBase, decision: 'NO_MATCH',
        reasonCode: general.reason === 'PROVIDER_FAILED' ? 'ROUTER_UNAVAILABLE' : gate.reasonCode,
        handled: true,
      };
    }
  }
};

/**
 * Node types that mean "this graph is the ordering journey". Computed from the
 * published definition rather than declared, for the same reason
 * `templateReadiness()` is: a marker field goes stale the first time someone
 * edits a graph, and a slug convention breaks as soon as the template
 * auto-suffixes to `order_place_2` or an author renames it.
 */
const ORDERING_NODE_TYPES = new Set(['CREATE_ORDER', 'START_ORDERING']);

/**
 * The published workflow that can place an order, if this workspace has one.
 *
 * Highest priority wins when there is more than one, matching how the router
 * itself breaks ties. A workflow with no published version is skipped: the
 * draft an author is still building must not start answering customers.
 */
export const publishedOrderingWorkflow = async (assistantId: string): Promise<string | null> => {
  const workflows = await prisma.workflow.findMany({
    where: {
      assistantId,
      status: 'PUBLISHED',
      category: 'CONVERSATION',
      publishedVersionId: { not: null },
    },
    select: {
      id: true,
      publishedVersion: { select: { definition: true } },
    },
    orderBy: { priority: 'desc' },
  });

  for (const workflow of workflows) {
    const definition = workflow.publishedVersion?.definition as { nodes?: Array<{ type?: string }> } | null;
    const nodes = Array.isArray(definition?.nodes) ? definition.nodes : [];
    if (nodes.some((node) => node.type && ORDERING_NODE_TYPES.has(node.type))) return workflow.id;
  }

  return null;
};

/**
 * The customer wants to order.
 *
 * Reached from the `SHOW_MENU` sentinel, which `general-response.ts` returns
 * instead of describing a menu it cannot see. Both ways in — "show me the menu"
 * and "I want to place an order" — now end up in the *same* journey: the
 * published order workflow if the workspace has one, and the legacy cart FSM
 * only if it does not.
 *
 * That equivalence is the whole point. When these diverged, editing the order
 * workflow changed one of the two paths a customer could take to the same thing,
 * and which one they got depended on how they had phrased their first message.
 *
 * The workflow branch deliberately does **not** touch the `Cart` table: a
 * workflow basket lives in workflow variables, and step 0 of this chain hands
 * any live `Cart` row to the FSM before a workflow gets a look in. Writing both
 * would have the FSM hijack the conversation on the very next message.
 */
const handleOrderingIntent = async (
  args: RouteArgs,
  assistantId: string,
  logger: ReturnType<typeof withContext>,
): Promise<{ workflowId: string | null }> => {
  const workflowId = await publishedOrderingWorkflow(assistantId);

  if (workflowId) {
    const started = await startWorkflow(args, workflowId, {});
    if (started) {
      logger.info('Ordering intent routed to the published order workflow', { workflowId });
      return { workflowId };
    }
    // Another message won the race and owns the conversation now. Falling
    // through to the FSM here would start a second, competing journey.
    logger.info('Ordering intent skipped: another workflow already active', { workflowId });
    return { workflowId: null };
  }

  logger.info('Ordering intent handled by the legacy cart FSM: no published order workflow');
  await startOrderingFlow({
    tenant: args.tenant,
    waAccount: args.channel,
    customer: args.contact,
  });
  return { workflowId: null };
};

/** Start a workflow and walk it until it finishes or parks. */
export const startWorkflow = async (
  args: RouteArgs,
  workflowId: string,
  extractedInputs: Record<string, unknown>,
): Promise<boolean> => {
  try {
    const { instance, definition } = await startInstance({
      tenantId: args.tenant.id,
      workflowId,
      conversationId: args.conversation.id,
      extractedInputs,
      dryRun: args.dryRun ?? false,
    });
    await walk({ instance, definition, deps: walkDepsFor(args) });
    return true;
  } catch (err) {
    if (err instanceof ActiveInstanceExistsError) {
      // Another message won the race and started a workflow first. Correct
      // behaviour is to do nothing — that instance now owns the conversation.
      return false;
    }
    throw err;
  }
};

export { matchDeterministicRule };
