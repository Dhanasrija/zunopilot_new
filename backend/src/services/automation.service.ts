import { prisma } from '../config/prisma.js';
import { sendTextMessage } from './whatsapp.service.js';
import { handleOrderingFlow, startOrderingFlow } from './ordering.service.js';
import { routeMessage, isRouterEnabled } from './router.service.js';
import { startRun } from './workflow-engine/index.js';
import { logger } from '../config/logger.js';
import { channelForTenant } from './whatsapp-account.service.js';
import { recordOutboundMessage } from '../modules/conversation-engine/providers/mirror.js';
import type {
  Cart, Conversation, Customer, InboundContext, InboundMessage, KeywordRule,
  ReplyTarget, Tenant, WhatsappAccount,
} from '../types/domain.js';

const HUMAN_KEYWORDS = ['agent', 'support', 'human'];
const MENU_KEYWORDS = ['menu', 'order'];

const DEFAULT_FALLBACK =
  "Sorry, I didn't catch that. Type 'Menu' to order, or 'Agent' to speak to our team.";

// Cart states where the customer's free text IS the payload — their name, their
// delivery address — not a command.
//
// Classifying text in these states is a category error. A real address like
// "1513, Tower 1, Swanlake Apartment" got matched to the tenant's
// address/location FAQ, so the bot replied with the restaurant's own address and
// never captured the delivery one, stranding the cart in COLLECTING_ADDRESS.
// Data goes to the state machine; only commands get routed.
// Every state added here must be one where free text is the ANSWER to a question
// the bot just asked. Forgetting to add one sends that answer to the LLM router,
// which is how a typed delivery address once got matched to the tenant's
// "address/location" FAQ and answered with the restaurant's own address.
const TEXT_INPUT_STATES = new Set([
  'COLLECTING_NAME',
  'COLLECTING_ADDRESS',
  'COLLECTING_ADDRESS_DETAIL',
]);

// Deterministic escape hatch for those states, so a customer is never trapped
// mid-checkout. Matched against the WHOLE trimmed message, never as a substring —
// that way a genuine address can't trip it, and placing an order needs no LLM
// call on its critical path.
const ESCAPE_TO_HUMAN = new Set(['agent', 'human', 'support', 'operator']);
const ESCAPE_ABANDON = new Set(['cancel', 'stop', 'exit', 'quit']);
const ESCAPE_RESTART = new Set(['menu', 'restart']);

// Returns true if msgText (lowercased) matches any keyword in rule.
// Substring matching — kept as the deterministic fallback when the LLM router is
// disabled or unavailable. Note it has no word boundaries, so "order" matches
// inside "cancel my order"; the router exists precisely to avoid that.
const matchesKeywords = (msgText: string, keywords: string[]): boolean =>
  keywords.some((k) => msgText.includes(String(k).toLowerCase()));

/** Everything a reply needs, including where to record it. */
type ReplyIn = ReplyTarget & { conversation: Conversation };

/**
 * Send a reply **and put it in the Inbox.**
 *
 * The mirror is the fix for a bug that shipped silently. Every reply in this file went
 * straight out through `sendTextMessage` and was never written to `Message`, so the customer
 * received an answer that no agent could see. Opening the thread showed their questions and
 * nothing else — which is exactly when a human replies to something the bot already handled.
 *
 * It stayed hidden because `degradeToNonAi` is this file's only caller, so the whole path
 * runs only when a workspace has switched the AI agent off or gone past its spend cap.
 * Neither is a state anybody tests in.
 *
 * A failed mirror is logged, not thrown. The message has already reached the customer by
 * then, and the inbound job is at-least-once — so letting it fail would retry the job and
 * send the reply a second time. A missing row is better than a duplicate message.
 */
const reply = async ({ waAccount, conversation, customer }: ReplyIn, body: string) => {
  const sent = await sendTextMessage({
    accessToken: waAccount.accessToken,
    phoneNumberId: waAccount.phoneNumberId,
    to: customer.waId,
    body,
  });

  try {
    await recordOutboundMessage(
      {
        tenantId: conversation.tenantId,
        conversationId: conversation.id,
        customerId: customer.id,
      },
      { type: 'TEXT', body, messageId: sent?.messages?.[0]?.id ?? null },
    );
  } catch (err) {
    logger.error('Sent a reply but could not record it in the Inbox', {
      conversationId: conversation.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};

const escalateToHuman = async ({ conversation, waAccount, customer }: ReplyIn) => {
  await prisma.conversation.update({
    where: { id: conversation.id },
    data: { status: 'HUMAN_TAKEOVER', automationPaused: true },
  });
  await reply(
    { waAccount, conversation, customer },
    'Connecting you to a team member. They will reply shortly.',
  );
};

const sendFallback = async ({ tenant, conversation, waAccount, customer }: ReplyIn & { tenant: Tenant }) => {
  const fallback = await prisma.fallbackRule.findUnique({ where: { tenantId: tenant.id } });
  await reply({ waAccount, conversation, customer }, fallback?.response || DEFAULT_FALLBACK);
};

const abandonFlow = async ({ cart, conversation, waAccount, customer }: ReplyIn & { cart: Cart }) => {
  await prisma.cartItemAddon.deleteMany({ where: { cartItem: { cartId: cart.id } } });
  await prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
  await prisma.cart.update({
    where: { id: cart.id },
    data: { state: 'IDLE', context: {}, customerName: null, deliveryAddr: null, deliveryLat: null, deliveryLng: null },
  });
  await reply(
    { waAccount, conversation, customer },
    "No problem, I've cancelled that. Type *Menu* whenever you'd like to start again.",
  );
};

const activeKeywordRules = (tenantId: string) =>
  prisma.keywordRule.findMany({
    where: { tenantId, isActive: true },
    orderBy: { priority: 'desc' },
  });

// ---------------------------------------------------------------------------
// LLM routing
// ---------------------------------------------------------------------------

// Maps a classified intent onto a handler. The model chooses the intent; this
// function decides what is actually allowed to happen — no intent is permitted
// to mutate an order, a price, or a status.
const dispatchIntent = async ({ intent, args, tenant, conversation, waAccount, customer, rules, activeCart, message }: InboundContext & {
  intent: string;
  args: Record<string, unknown>;
  rules: KeywordRule[];
  activeCart: Cart | null;
  message: InboundMessage;
}): Promise<boolean> => {
  switch (intent) {
    case 'request_human':
      await escalateToHuman({ conversation, waAccount, customer });
      return true;

    case 'start_ordering':
      // Restarting a flow that is already running is how a single mis-parsed
      // tap becomes an infinite loop: the customer taps a category, the tap is
      // not understood, the router says "they want to order", the menu is sent
      // again, and round it goes. Re-prompt for the step we are actually on
      // instead — the customer sees the same question once, not forever.
      if (activeCart) {
        logger.info('Ignoring start_ordering: a cart is already in progress', {
          cartState: activeCart.state,
        });
        await handleOrderingFlow({ tenant, waAccount, customer, cart: activeCart, message });
        return true;
      }
      await startOrderingFlow({ tenant, waAccount, customer });
      return true;

    case 'answer_faq': {
      const rule = rules.find((r) => r.id === args.faqId);
      if (!rule) {
        logger.warn('Router chose an unknown faqId', { faqId: args.faqId });
        return false; // fall through to the fallback rule
      }
      await reply({ waAccount, conversation, customer }, rule.response);
      return true;
    }

    case 'order_enquiry':
      // Deliberately routed to a human rather than acted on. Order state changes
      // stay behind the authenticated dashboard and its transition rules.
      logger.info('Order enquiry routed to human', { kind: args.kind, conversationId: conversation.id });
      await escalateToHuman({ conversation, waAccount, customer });
      return true;

    case 'fallback':
      return false;

    default:
      logger.warn('Router returned an unrecognized intent', { intent });
      return false;
  }
};

// ---------------------------------------------------------------------------
// Keyword routing (fallback when the router is off or errored)
// ---------------------------------------------------------------------------

const dispatchByKeyword = async ({ text, tenant, conversation, waAccount, customer, rules }: InboundContext & {
  text: string;
  rules: KeywordRule[];
}): Promise<boolean> => {
  if (matchesKeywords(text, HUMAN_KEYWORDS)) {
    await escalateToHuman({ conversation, waAccount, customer });
    return true;
  }
  if (matchesKeywords(text, MENU_KEYWORDS)) {
    await startOrderingFlow({ tenant, waAccount, customer });
    return true;
  }
  for (const rule of rules) {
    if (matchesKeywords(text, rule.keywords)) {
      await reply({ waAccount, conversation, customer }, rule.response);
      return true;
    }
  }
  return false;
};

// ---------------------------------------------------------------------------

export const handleInboundMessage = async ({
  tenant, conversation, customer, message, useAi = true,
}: {
  tenant: Tenant;
  conversation: Conversation;
  customer: Customer;
  message: InboundMessage;
  /**
   * Whether this workspace may use the model.
   *
   * **The caller decides, and the only caller that matters says no.** `degradeToNonAi` in the
   * conversation engine routes here precisely *because* the AI agent has been switched off or
   * the spend cap is reached — and this function then called the LLM router anyway, because
   * `isRouterEnabled()` only asks whether an API key is configured. A workspace that turned
   * the AI off got model-classified replies, and the usage was not even counted against the
   * quota, since only the engine's path calls `recordAiInteraction`.
   *
   * Defaults to true so the deterministic-first ordering of this file is unchanged for any
   * caller that has already decided the model is allowed.
   */
  useAi?: boolean;
}): Promise<void> => {
  if (conversation.automationPaused) {
    logger.info('Automation paused for conversation', { conversationId: conversation.id });
    return;
  }

  const waAccount = await channelForTenant(tenant.id);
  if (!waAccount) return;

  const text = (message.body || '').toLowerCase().trim();
  const interactivePayload = message.payload?.interactive;
  const isInteractiveReply = Boolean(
    interactivePayload?.list_reply?.id || interactivePayload?.button_reply?.id
  );
  const isLocation = Boolean(message.payload?.location);

  const cart = await prisma.cart.findUnique({ where: { customerId: customer.id } });
  // Narrowed to a value rather than a boolean so the branches below know the
  // cart is non-null — a `Boolean(...)` flag tells the compiler nothing.
  const activeCart = cart && cart.state !== 'IDLE' ? cart : null;

  // A tap on one of our own list rows or buttons is already unambiguous — send it
  // straight to the deterministic state machine rather than paying for a
  // classification of an enumerated ID.
  if (activeCart && isInteractiveReply) {
    await handleOrderingFlow({ tenant, waAccount, customer, cart: activeCart, message });
    return;
  }

  // A shared location pin mid-checkout is the answer to "where do we deliver?".
  // Route it to the state machine, which reads the coordinates off the payload —
  // never to the classifier, and regardless of whether a readable label came with
  // it (so a pin with no place name is still captured).
  if (activeCart && isLocation && TEXT_INPUT_STATES.has(activeCart.state)) {
    await handleOrderingFlow({ tenant, waAccount, customer, cart: activeCart, message });
    return;
  }

  // An interactive reply with no active flow has no meaningful context.
  if (!activeCart && isInteractiveReply && !text) return;

  if (!text) return;

  // Mid-checkout, while we are asking for a name or an address, the message is
  // the answer to that question. Hand it straight to the state machine; only an
  // exact escape word is treated as a command.
  if (activeCart && TEXT_INPUT_STATES.has(activeCart.state)) {
    if (ESCAPE_TO_HUMAN.has(text)) {
      await escalateToHuman({ conversation, waAccount, customer });
      return;
    }
    if (ESCAPE_ABANDON.has(text)) {
      await abandonFlow({ cart: activeCart, conversation, waAccount, customer });
      return;
    }
    if (ESCAPE_RESTART.has(text)) {
      await startOrderingFlow({ tenant, waAccount, customer });
      return;
    }
    await handleOrderingFlow({ tenant, waAccount, customer, cart: activeCart, message });
    return;
  }

  // ── Published workflows ─────────────────────────────────────────────────────
  // Precedence for an inbound message is:
  //   1. cart FSM        (handled above — in-flight checkout and money win)
  //   2. published workflows  <- here
  //   3. LLM intent router
  //   4. keyword rules / fallback
  //
  // A workflow is an explicit, operator-authored automation, so it pre-empts the
  // generic router. First workflow whose graph actually does something wins; the
  // rest are not run, so two published flows cannot both reply to one message.
  const workflows = await prisma.workflow.findMany({
    where: { tenantId: tenant.id, status: 'PUBLISHED', trigger: 'MESSAGE_RECEIVED' },
    orderBy: { updatedAt: 'desc' },
  });

  for (const workflow of workflows) {
    const run = await startRun({ workflow, tenant, customer, conversation, message, waAccount });
    // A run that produced no steps (empty or unroutable graph) should not swallow
    // the message — fall through to the router instead.
    if (run && run.status !== 'FAILED') {
      const steps = await prisma.workflowRunStep.count({ where: { runId: run.id } });
      if (steps > 0) {
        logger.info('Message handled by workflow', {
          workflowId: workflow.id, runId: run.id, status: run.status, steps,
        });
        return;
      }
    }
  }

  const rules = await activeKeywordRules(tenant.id);

  // Free text in a state that expects a button/list tap is genuinely ambiguous —
  // that is where classification belongs, so "talk to a human" or "cancel my
  // order" can escape the flow instead of hitting its in-flow re-prompt.
  const routed = useAi && isRouterEnabled()
    ? await routeMessage({ text: message.body, faqs: rules })
    : null;

  if (routed) {
    const handled = await dispatchIntent({
      intent: routed.intent,
      args: routed.args,
      tenant,
      conversation,
      waAccount,
      customer,
      rules,
      activeCart,
      message,
    });
    if (handled) return;
  } else {
    // Router disabled or failed — degrade to keyword matching.
    const handled = await dispatchByKeyword({
      text,
      tenant,
      conversation,
      waAccount,
      customer,
      rules,
    });
    if (handled) return;
  }

  // Nothing matched. Mid-order, let the state machine re-prompt for the selection
  // it is waiting on; otherwise send the tenant's fallback message.
  if (activeCart) {
    await handleOrderingFlow({ tenant, waAccount, customer, cart: activeCart, message });
    return;
  }
  await sendFallback({ tenant, conversation, waAccount, customer });
};
