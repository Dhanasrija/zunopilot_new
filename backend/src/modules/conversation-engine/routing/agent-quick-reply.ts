import { prisma } from '../../../config/prisma.js';
import { logger } from '../../../config/logger.js';
import { quickReplyButtonIdOf } from '../agent-reply-id.js';
// One-way: `routing/index.ts` does not import this module, so there is no cycle. The caller is
// `process-inbound`, which reaches this before it reaches the chain.
import { startWorkflow, type RouteArgs } from './index.js';

// A customer tapped a button a human agent sent them.
//
// ── Why this cannot go through the normal routing chain ──────────────────────
//
// Every one of the chain's steps would mishandle this message, and two of them would corrupt data
// rather than merely misfire:
//
//   • **An in-flight cart owns the message first** (`routing/index.ts` Step 0). In
//     `BROWSING_CATEGORY` and its siblings the id matches none of the ordering prefixes and the
//     customer is told "Sorry, I expected a selection" — the bot contradicting the human agent in
//     the same thread. In `COLLECTING_NAME` and `COLLECTING_ADDRESS` it is worse: the cart does not
//     look at the reply id at all, it takes the **title**, so a tap on "Delivery" writes `Delivery`
//     in as the delivery address on a real order.
//   • **A workflow waiting for input** accepts only ids it offered itself, so it rejects this one,
//     tries to match the title, and then either burns a retry or reroutes — damaging a flow the
//     customer was in the middle of, because they answered the agent.
//   • **A running-but-not-waiting instance** drops the message silently.
//   • **The AI router** never sees the id, only the title. "Delivery" reads as a fresh intent.
//
// So this is answered before the chain, not inside it. It is not a routing decision among several
// candidates — the customer told us exactly which button they pressed, and there is nothing to
// classify.
//
// ── Why it is answered above the human-takeover check ────────────────────────
//
// This is the placement worth arguing about. `process-inbound` returns early for a conversation
// with `automationPaused` or `HUMAN_TAKEOVER`, before any routing — and an agent who sends buttons
// is, almost by definition, in a thread they have taken over. Left below that check, a
// workflow-bound button would never fire in the one situation it exists for.
//
// Honouring it is respecting the agent's own instruction rather than overriding it: they chose to
// offer a button that starts something, and the customer accepted the offer. The consent check stays
// above this, because STOP outranks an outstanding question.

/** What happened, for the caller to decide whether to keep going. */
export type QuickReplyOutcome =
  /** Not one of ours. Carry on with the normal chain. */
  | 'not-ours'
  /** Ours, and nothing more to do — the tap is already in the thread as the customer's words. */
  | 'recorded'
  /** Ours, bound to a workflow, and that workflow is now running. */
  | 'started';

/**
 * Answer a tap on an agent-sent reply button, if that is what this is.
 *
 * Returns `not-ours` for every id belonging to the ordering flow, a workflow node or an operator's
 * payload rule — so the caller can try this first and fall through untouched.
 */
export const handleAgentQuickReply = async (args: RouteArgs): Promise<QuickReplyOutcome> => {
  const buttonId = quickReplyButtonIdOf(args.message.interactive?.replyId);
  if (!buttonId) return 'not-ours';

  const button = await prisma.quickReplyButton.findFirst({
    // Tenant-scoped through the parent. A reply id arrives from the outside world, and nothing else
    // proves the button belongs to the workspace this conversation is in.
    where: { id: buttonId, quickReply: { tenantId: args.tenant.id } },
    include: { workflow: { select: { id: true, name: true, status: true } } },
  });

  /*
   * A tap we cannot resolve is still handled, not passed on.
   *
   * The button was deleted, or the set was moved to another workspace, or this is an id from a
   * workspace that no longer exists. The prefix is proof enough that we sent it, and the one thing
   * that must not happen is the ordering flow or the router being handed it as a consolation.
   */
  if (!button) {
    logger.info('A tap arrived for a quick-reply button that no longer exists', { buttonId });
    return 'recorded';
  }

  /*
   * Unbound: the answer *is* the outcome.
   *
   * Nothing to start, and deliberately nothing sent. The tap has already been persisted as an
   * inbound INTERACTIVE message with the label as its body, the conversation's unread count is up
   * and the agent has been notified — all of that happens in `persistMessage`, above this. From the
   * agent's side it reads exactly like the customer having typed "Delivery", which is the point.
   */
  if (!button.workflowId || !button.workflow) return 'recorded';

  /*
   * A workflow that has since been unpublished is not started.
   *
   * The binding survives (`workflowId` is only cleared on delete), so a workspace that pauses a
   * workflow while leaving the button in an agent's list would otherwise be starting a draft on a
   * live customer. The tap still lands in the thread for the agent to answer.
   */
  if (button.workflow.status !== 'PUBLISHED') {
    logger.warn('A quick-reply button points at a workflow that is not published', {
      buttonId, workflowId: button.workflowId, status: button.workflow.status,
    });
    return 'recorded';
  }

  /*
   * Hand the conversation back to the bot, and only here.
   *
   * A workflow started into a paused conversation would be **deaf**: the customer's next message
   * hits the same early return in `process-inbound` and the instance waits for an answer that can
   * never reach it. So starting one has to end the takeover.
   *
   * This is the only state change in the feature, it happens on the *tap* rather than on the send,
   * and the composer says so in words before the agent presses Send. Doing it at send time instead
   * would kill the bot for a thread whose customer never taps anything.
   */
  if (args.conversation.automationPaused || args.conversation.status === 'HUMAN_TAKEOVER') {
    await prisma.conversation.update({
      where: { id: args.conversation.id },
      data: { automationPaused: false, status: 'OPEN' },
    });
    logger.info('A quick-reply button handed the conversation back to automation', {
      conversationId: args.conversation.id, workflowId: button.workflowId,
    });
  }

  const started = await startWorkflow(args, button.workflowId, {
    // The label, not the id: a workflow's own steps read this as what the customer said, and
    // `zp:qr:<uuid>` is not something any template or condition should have to know about.
    button_label: button.label,
  });

  await prisma.routingDecision.create({
    data: {
      tenantId: args.tenant.id,
      conversationId: args.conversation.id,
      assistantId: args.conversation.assistantId,
      inboundMessageId: args.message.id,
      /*
       * `DETERMINISTIC` rather than a new `RoutingSource` value.
       *
       * It is the honest classification — an exact id match with no model involved — and it avoids
       * `ALTER TYPE … ADD VALUE`, which Prisma cannot run inside a migration transaction. The
       * `reasonCode` is what tells an operator reading the timeline which mechanism it was.
       */
      source: 'DETERMINISTIC',
      decision: started ? 'START_WORKFLOW' : 'NO_MATCH',
      selectedWorkflowId: button.workflowId,
      confidence: 1,
      reasonCode: 'AGENT_QUICK_REPLY',
      summary: `Agent's button: ${button.label}`,
    },
  });

  return 'started';
};
