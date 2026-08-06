import type { CapabilityContract } from './capability.js';
import type { WorkflowDefinition } from './definition.js';
import { EXECUTORS } from '../engine/executors/index.js';
import type { NodeType } from './node-types.js';

// Workflow templates.
//
// A starting point, not a black box: instantiating a template copies its graph
// and its capability contract into the tenant's workspace as a DRAFT they then
// edit. Nothing links back — once instantiated it is theirs, and a later change
// to the template does not reach in and alter a live workflow.
//
// Every template declares the node types it uses, and `templateReadiness()`
// checks those against the executor registry. A template that needs a node with
// no runtime is listed but marked unavailable rather than quietly shipped —
// offering a flow that looks complete and silently does nothing is worse than
// not offering it.

export type TemplateCategory =
  | 'Ecommerce'
  | 'Lead generation'
  | 'Healthcare'
  | 'Support'
  | 'Feedback';

export interface WorkflowTemplate {
  id: string;
  name: string;
  category: TemplateCategory;
  /** One line for the gallery card. */
  tagline: string;
  /** What it does and what the author will want to change. */
  description: string;
  /** Business categories this suits. Empty means any. */
  suitedTo: string[];
  suggestedSlug: string;
  priority: number;
  capability: CapabilityContract;
  definition: WorkflowDefinition;
}

const node = (
  id: string,
  type: NodeType,
  config: Record<string, unknown>,
  y: number,
  name: string,
  x = 360,
) => ({ id, type, config, position: { x, y }, name });

const edge = (source: string, target: string, sourceHandle?: string) => ({
  id: `${source}->${target}${sourceHandle ? `:${sourceHandle}` : ''}`,
  source,
  target,
  ...(sourceHandle ? { sourceHandle } : {}),
});

const entry = (y = 40) =>
  node('entry', 'ASSISTANT_ROUTE_ENTRY', { acceptedIntents: [] }, y, 'Assistant Route Entry');

// ── 1. Order Place ────────────────────────────────────────────────────────────

const orderPlace: WorkflowTemplate = {
  id: 'order_place',
  name: 'Place an Order',
  category: 'Ecommerce',
  tagline: 'The whole checkout, as nodes you can edit.',
  description:
    'The complete ordering journey on the canvas: browse categories, pick an item, choose a '
    + 'quantity, review the basket, add more or check out, then name, address, confirmation and '
    + 'the order itself. Every step is a node — change the wording, drop the name question, add '
    + 'a delivery-or-pickup choice, or ask for a coupon before checkout.',
  suitedTo: ['RESTAURANT', 'ECOMMERCE_GROCERY'],
  suggestedSlug: 'order_place',
  priority: 80,
  capability: {
    purpose: 'Take a new order from the customer',
    description: 'Browse the catalogue, build a basket, collect delivery details and place the order.',
    useWhen: [
      'The customer wants to place a new order',
      'The customer asks to see the menu or what is available',
      'The customer wants to buy or reorder something',
    ],
    doNotUseWhen: [
      'The customer is asking about an order they already placed',
      'The customer wants to cancel or change an existing order',
      'The customer only has a question about opening hours or delivery areas',
    ],
    positiveExamples: [
      'I want to place an order',
      'Can I see the menu?',
      'I would like to order two biryanis',
    ],
    negativeExamples: [
      'Where is my order?',
      'Please cancel my order',
      'What time do you close?',
    ],
    requiredInputs: [],
    optionalInputs: [],
    preconditions: ['The business has items available to order'],
    sideEffects: ['Creates an order'],
    // The `Confirm Order` node is what satisfies this: nothing is written until
    // the customer has seen the basket, the name and the address and tapped
    // Confirm. Removing that node should mean clearing this flag too.
    requiresConfirmation: true,
    minimumConfidence: 0.75,
    allowsInterruption: false,
  },
  // The basket lives in the `cart` workflow *variable*, never the `Cart` table.
  //
  // Step 0 of the routing chain hands any live `Cart` row to the legacy ordering
  // state machine before a workflow gets a look in, so a workflow that wrote to
  // `Cart` would be hijacked by the FSM on the very next message. Two order
  // paths, two stores, no contention.
  //
  // The loop back from "Add more items" to the category list is deliberate and
  // safe: it passes through Ask Quantity, which parks for the customer, so it
  // yields between iterations rather than spinning. Each inbound message starts
  // a fresh walk, so the per-node visit cap never bounds basket size.
  definition: {
    schemaVersion: '1.0',
    entryNodeId: 'entry',
    nodes: [
      entry(),

      // ── Browse ──────────────────────────────────────────────────────────
      node('pick_category', 'LIST_MESSAGE', {
        header: 'Our menu',
        body: 'Happy to help you order. What are you in the mood for?',
        buttonLabel: 'Browse menu',
        // Live from the catalogue. Hand-typed rows go stale the day the menu
        // changes, which for a restaurant is most days.
        source: 'menu_categories',
        rows: [],
        variableName: 'chosen_category',
        labelVariable: 'chosen_category_name',
        retryMessage: 'Please pick one of the categories from the list.',
        maxRetries: 3,
      }, 160, 'Pick a Category'),

      node('pick_item', 'LIST_MESSAGE', {
        header: 'Choose an item',
        body: '{{vars.chosen_category_name}} — here is what we have.',
        buttonLabel: 'View items',
        source: 'menu_items',
        categoryVariable: 'chosen_category',
        rows: [],
        variableName: 'chosen_item',
        labelVariable: 'chosen_item_name',
        retryMessage: 'Please pick one of the items from the list.',
        maxRetries: 3,
      }, 280, 'Pick an Item'),

      node('ask_quantity', 'ASK_USER_INPUT', {
        prompt: 'How many {{vars.chosen_item_name}} would you like?',
        variableName: 'quantity',
        inputType: 'number',
        required: true,
        validation: { min: 1, max: 20 },
        retryMessage: 'Please reply with a number between 1 and 20.',
        maxRetries: 3,
      }, 400, 'Ask Quantity'),

      // ── Basket ──────────────────────────────────────────────────────────
      // Price is read from the catalogue inside this node, never from a
      // variable — a price that travelled through the conversation is a price
      // the customer could influence.
      node('add_to_basket', 'CART_ADD_ITEM', {
        itemVariable: 'chosen_item',
        quantityVariable: 'quantity',
        cartVariable: 'cart',
      }, 520, 'Add to Basket'),

      node('basket_summary', 'CART_SUMMARY', {
        cartVariable: 'cart',
        outputVariable: 'cart_summary',
        emptyText: 'Your basket is empty.',
      }, 640, 'Render Basket'),

      node('ask_next', 'BUTTON_MESSAGE', {
        body: '{{vars.cart_summary}}\n\nWhat would you like to do next?',
        // Ids are what the conditions below branch on; titles are what the
        // customer sees. "Cancel order" rather than "Cancel" on purpose — a
        // whole message of exactly "cancel" is an engine-level escape hatch and
        // would tear the instance down before this node ever saw the tap.
        buttons: [
          { id: 'add_more', title: 'Add more items' },
          { id: 'checkout', title: 'Checkout' },
          { id: 'cancel_order', title: 'Cancel order' },
        ],
        variableName: 'basket_action',
        retryMessage: 'Please tap Add more items, Checkout, or Cancel order.',
        maxRetries: 3,
      }, 760, 'Add More or Checkout?'),

      node('wants_more', 'CONDITION', {
        left: '{{vars.basket_action}}', op: 'equals', right: 'add_more',
      }, 880, 'Add More?'),

      node('wants_checkout', 'CONDITION', {
        left: '{{vars.basket_action}}', op: 'equals', right: 'checkout',
      }, 1000, 'Checking Out?'),

      // ── Delivery details ────────────────────────────────────────────────
      node('ask_name', 'ASK_USER_INPUT', {
        prompt: 'Great. What name should we put on the order?',
        variableName: 'customer_name',
        inputType: 'string',
        required: true,
        validation: { minLength: 2, maxLength: 80 },
        retryMessage: 'Please send the name for the order.',
        maxRetries: 3,
      }, 1120, 'Ask Name'),

      node('ask_address', 'ASK_USER_INPUT', {
        prompt: 'Thanks {{vars.customer_name}}. What is the full delivery address?',
        variableName: 'delivery_address',
        inputType: 'string',
        required: true,
        validation: { minLength: 10, maxLength: 400 },
        retryMessage: 'Could you send the full address, including the door or flat number?',
        maxRetries: 3,
      }, 1240, 'Ask Address'),

      // ── Confirm and place ───────────────────────────────────────────────
      // The confirmation step. Everything the customer is about to be charged
      // for is restated here, and nothing is written until they tap Confirm.
      node('confirm_order', 'BUTTON_MESSAGE', {
        body: 'Please confirm your order:\n\n{{vars.cart_summary}}\n\n'
          + '*Name:* {{vars.customer_name}}\n*Deliver to:* {{vars.delivery_address}}',
        buttons: [
          { id: 'confirm_order', title: 'Confirm order' },
          { id: 'cancel_order', title: 'Cancel order' },
        ],
        variableName: 'order_confirmation',
        retryMessage: 'Please tap Confirm order or Cancel order.',
        maxRetries: 3,
      }, 1360, 'Confirm Order'),

      node('is_confirmed', 'CONDITION', {
        left: '{{vars.order_confirmation}}', op: 'equals', right: 'confirm_order',
      }, 1480, 'Confirmed?'),

      node('place_order', 'CREATE_ORDER', {
        cartVariable: 'cart',
        customerNameVariable: 'customer_name',
        addressVariable: 'delivery_address',
        outputVariable: 'order',
      }, 1600, 'Place the Order'),

      node('order_placed', 'SEND_WHATSAPP_MESSAGE', {
        body: 'Thank you {{vars.customer_name}}! Order #{{vars.order.orderNumber}} is confirmed '
          + 'and totals ₹{{vars.order.total}}. We will message you when it is on its way.',
      }, 1720, 'Send Confirmation'),

      node('done', 'END_WORKFLOW', { outcome: 'COMPLETED' }, 1840, 'End'),

      // ── Off-ramps ───────────────────────────────────────────────────────
      node('cancelled', 'END_WORKFLOW', {
        outcome: 'CANCELLED',
        message: "No problem — I've cleared that. Message me whenever you'd like to order.",
      }, 1480, 'Order Cancelled', 720),

      node('order_failed', 'HUMAN_HANDOFF', {
        reason: 'Order creation failed',
        message: "I couldn't place that order just now — let me get a colleague to finish it for you.",
      }, 1720, 'Could Not Place Order', 720),
    ],
    edges: [
      edge('entry', 'pick_category'),
      edge('pick_category', 'pick_item'),
      edge('pick_item', 'ask_quantity'),
      edge('ask_quantity', 'add_to_basket'),
      edge('add_to_basket', 'basket_summary'),
      edge('basket_summary', 'ask_next'),
      edge('ask_next', 'wants_more'),
      // The loop: another item goes back to the top of the catalogue.
      edge('wants_more', 'pick_category', 'yes'),
      edge('wants_more', 'wants_checkout', 'no'),
      edge('wants_checkout', 'ask_name', 'yes'),
      edge('wants_checkout', 'cancelled', 'no'),
      edge('ask_name', 'ask_address'),
      edge('ask_address', 'confirm_order'),
      edge('confirm_order', 'is_confirmed'),
      edge('is_confirmed', 'place_order', 'yes'),
      edge('is_confirmed', 'cancelled', 'no'),
      edge('place_order', 'order_placed', 'success'),
      edge('place_order', 'order_failed', 'error'),
      edge('order_placed', 'done'),
    ],
  },
};

// ── 2. Lead Capture ───────────────────────────────────────────────────────────

const leadCapture: WorkflowTemplate = {
  id: 'lead_capture',
  name: 'Lead Capture',
  category: 'Lead generation',
  tagline: 'Qualify an enquiry and record it for follow-up.',
  description:
    'Collects name, what they need and how to reach them, records the lead, and confirms someone '
    + 'will be in touch. Customise the qualifying question, and point the record step at your CRM.',
  suitedTo: [],
  suggestedSlug: 'lead_capture',
  priority: 60,
  capability: {
    purpose: 'Capture and qualify a new enquiry',
    description: 'Collects contact details and requirements, then records the lead.',
    useWhen: [
      'A new person is enquiring about products or services',
      'The customer asks for a quote or pricing information',
      'The customer wants someone to contact them',
    ],
    doNotUseWhen: [
      'The person is an existing customer asking about their order',
      'The customer wants to complain about something',
    ],
    positiveExamples: [
      'I am interested in your services, can someone call me?',
      'Can you send me a quote?',
      'I would like to know more about what you offer',
    ],
    negativeExamples: [
      'Where is my order?',
      'I want to speak to a manager about a problem',
    ],
    requiredInputs: [
      { key: 'lead_name', label: 'Name', type: 'string' },
      { key: 'requirement', label: 'What they need', type: 'string' },
    ],
    optionalInputs: [{ key: 'lead_email', label: 'Email', type: 'email' }],
    preconditions: [],
    sideEffects: ['Creates a lead record'],
    requiresConfirmation: true,
    minimumConfidence: 0.7,
    allowsInterruption: true,
  },
  definition: {
    schemaVersion: '1.0',
    entryNodeId: 'entry',
    nodes: [
      entry(),
      node('ask_name', 'ASK_USER_INPUT', {
        prompt: "Happy to help. What's your name?",
        variableName: 'lead_name',
        inputType: 'string',
        required: true,
        validation: { minLength: 2 },
        maxRetries: 3,
      }, 170, 'Ask Name'),
      node('ask_requirement', 'ASK_USER_INPUT', {
        prompt: 'Thanks {{vars.lead_name}}. What are you looking for?',
        variableName: 'requirement',
        inputType: 'string',
        required: true,
        validation: { minLength: 3 },
        maxRetries: 3,
      }, 300, 'Ask Requirement'),
      node('ask_email', 'ASK_USER_INPUT', {
        prompt: 'And the best email to reach you on?',
        variableName: 'lead_email',
        inputType: 'email',
        required: true,
        retryMessage: "That doesn't look like an email address — could you check it?",
        maxRetries: 3,
      }, 430, 'Ask Email'),
      node('confirm', 'ASK_USER_INPUT', {
        prompt: 'Just to confirm: {{vars.lead_name}}, {{vars.lead_email}}, interested in '
          + '{{vars.requirement}}. Shall I pass this to the team? Reply YES or NO.',
        variableName: 'confirmed',
        inputType: 'choice',
        required: true,
        validation: { choices: ['yes', 'no'] },
        maxRetries: 3,
      }, 560, 'Confirm Details'),
      node('is_confirmed', 'CONDITION', {
        left: '{{vars.confirmed}}', op: 'equals', right: 'yes',
      }, 690, 'Confirmed?'),
      node('record', 'HTTP_REQUEST', {
        method: 'POST',
        url: 'https://crm.example.com/leads',
        body: {
          name: '{{vars.lead_name}}',
          email: '{{vars.lead_email}}',
          requirement: '{{vars.requirement}}',
          source: 'whatsapp',
        },
        mockService: 'crm',
        outputVariable: 'lead',
      }, 820, 'Record Lead', 200),
      node('thanks', 'SEND_WHATSAPP_MESSAGE', {
        body: "Thanks {{vars.lead_name}} — someone from the team will be in touch shortly.",
      }, 950, 'Confirm to Customer', 200),
      node('done', 'END_WORKFLOW', { outcome: 'COMPLETED' }, 1080, 'End', 200),
      node('declined', 'END_WORKFLOW', {
        outcome: 'CANCELLED',
        message: "No problem — let me know if you'd like to pick this up later.",
      }, 820, 'Not Now', 620),
      node('record_failed', 'HUMAN_HANDOFF', {
        reason: 'Could not record the lead',
        message: "I've taken your details — let me get a colleague to follow up.",
      }, 950, 'Recording Failed', 620),
    ],
    edges: [
      edge('entry', 'ask_name'),
      edge('ask_name', 'ask_requirement'),
      edge('ask_requirement', 'ask_email'),
      edge('ask_email', 'confirm'),
      edge('confirm', 'is_confirmed'),
      edge('is_confirmed', 'record', 'yes'),
      edge('is_confirmed', 'declined', 'no'),
      edge('record', 'thanks', 'success'),
      edge('record', 'record_failed', 'error'),
      edge('thanks', 'done'),
    ],
  },
};

// ── 3. Order Status Enquiry ───────────────────────────────────────────────────

const orderStatus: WorkflowTemplate = {
  id: 'order_status',
  name: 'Order Status Enquiry',
  category: 'Ecommerce',
  tagline: 'Look up an order and tell the customer where it is.',
  description:
    'Asks for the order number, looks it up, and reports the status. Read-only — it never changes '
    + 'an order. Point the lookup at your own endpoint to go live.',
  suitedTo: ['RESTAURANT', 'ECOMMERCE_GROCERY'],
  suggestedSlug: 'order_status',
  priority: 55,
  capability: {
    purpose: 'Tell the customer the status of an existing order',
    description: 'Read-only lookup. Never modifies or cancels anything.',
    useWhen: [
      'The customer asks where their order is',
      'The customer asks whether an order has shipped',
      'The customer asks about a delivery they are expecting',
    ],
    doNotUseWhen: [
      'The customer wants to place a new order',
      'The customer wants to cancel or change an order',
    ],
    positiveExamples: [
      'Where is my order?',
      'Has my delivery been dispatched?',
      'Any update on order 1042?',
    ],
    negativeExamples: [
      'I want to place an order',
      'Please cancel my order',
    ],
    requiredInputs: [{ key: 'order_number', label: 'Order Number', type: 'string' }],
    optionalInputs: [],
    preconditions: [],
    sideEffects: [],
    requiresConfirmation: false,
    minimumConfidence: 0.7,
    allowsInterruption: true,
  },
  definition: {
    schemaVersion: '1.0',
    entryNodeId: 'entry',
    nodes: [
      entry(),
      node('ask_number', 'ASK_USER_INPUT', {
        prompt: 'Sure — what is your order number?',
        variableName: 'order_number',
        inputType: 'string',
        required: true,
        validation: { minLength: 2 },
        maxRetries: 3,
      }, 170, 'Ask Order Number'),
      node('lookup', 'HTTP_REQUEST', {
        method: 'GET',
        url: 'https://api.example.com/orders',
        query: { order_number: '{{vars.order_number}}' },
        mockService: 'crm',
        outputVariable: 'order',
      }, 300, 'Look Up Order'),
      node('reply', 'SEND_WHATSAPP_MESSAGE', {
        body: 'Order {{vars.order_number}}: I have it here. The team will confirm the latest status '
          + 'shortly.',
      }, 430, 'Send Status', 200),
      node('done', 'END_WORKFLOW', { outcome: 'COMPLETED' }, 560, 'End', 200),
      node('not_found', 'HUMAN_HANDOFF', {
        reason: 'Order lookup failed',
        message: "I couldn't find that order — let me get a colleague to check for you.",
      }, 430, 'Lookup Failed', 620),
    ],
    edges: [
      edge('entry', 'ask_number'),
      edge('ask_number', 'lookup'),
      edge('lookup', 'reply', 'success'),
      edge('lookup', 'not_found', 'error'),
      edge('reply', 'done'),
    ],
  },
};

// ── 4. FAQ + Escalation ───────────────────────────────────────────────────────

const faqEscalation: WorkflowTemplate = {
  id: 'faq_escalation',
  name: 'Answer a Question, Escalate if Needed',
  category: 'Support',
  tagline: 'Answer from your own content, hand over if it did not help.',
  description:
    'Answers using your configured content, then checks whether that resolved it and passes the '
    + 'customer to a person if not. Customise the assistant instructions on the AI node.',
  suitedTo: [],
  suggestedSlug: 'faq_escalation',
  priority: 40,
  capability: {
    purpose: 'Answer a general question and escalate if it is unresolved',
    description: 'Answers from configured content, then offers a human if it did not help.',
    useWhen: [
      'The customer asks a general question about the business',
      'The customer asks about policies, hours or locations',
    ],
    doNotUseWhen: [
      'The customer wants to place or change an order',
      'The customer is asking about a specific existing order',
    ],
    positiveExamples: [
      'What are your opening hours?',
      'Do you deliver to my area?',
      'What is your returns policy?',
    ],
    negativeExamples: [
      'I want to order two pizzas',
      'Where is my delivery?',
    ],
    requiredInputs: [],
    optionalInputs: [],
    preconditions: [],
    sideEffects: [],
    requiresConfirmation: false,
    minimumConfidence: 0.6,
    allowsInterruption: true,
  },
  definition: {
    schemaVersion: '1.0',
    entryNodeId: 'entry',
    nodes: [
      entry(),
      node('answer', 'AI_AGENT', {
        systemPrompt: 'You answer customer questions for this business. Be brief and factual. '
          + 'If you do not know the answer, say you will check rather than guessing. '
          + 'Never quote a price or a delivery time.',
        userPrompt: '{{message.text}}',
        maxTokens: 300,
        temperature: 0.3,
        outputVariable: 'answer',
        sendToCustomer: true,
      }, 170, 'Answer the Question'),
      node('ask_resolved', 'ASK_USER_INPUT', {
        prompt: 'Did that answer your question? Reply YES or NO.',
        variableName: 'resolved',
        inputType: 'choice',
        required: true,
        validation: { choices: ['yes', 'no'] },
        maxRetries: 2,
      }, 300, 'Did That Help?'),
      node('is_resolved', 'CONDITION', {
        left: '{{vars.resolved}}', op: 'equals', right: 'yes',
      }, 430, 'Resolved?'),
      node('done', 'END_WORKFLOW', {
        outcome: 'COMPLETED', message: 'Glad that helped. Anything else?',
      }, 560, 'End', 200),
      node('escalate', 'HUMAN_HANDOFF', {
        reason: 'Question not resolved by the assistant',
        message: 'Let me get a colleague to help with that.',
      }, 560, 'Human Handover', 620),
    ],
    edges: [
      edge('entry', 'answer'),
      edge('answer', 'ask_resolved'),
      edge('ask_resolved', 'is_resolved'),
      edge('is_resolved', 'done', 'yes'),
      edge('is_resolved', 'escalate', 'no'),
    ],
  },
};

// ── 5. Feedback ───────────────────────────────────────────────────────────────

const feedback: WorkflowTemplate = {
  id: 'collect_feedback',
  name: 'Collect Feedback',
  category: 'Feedback',
  tagline: 'Ask for a rating and follow up on anything low.',
  description:
    'Asks for a 1–5 rating and a comment, and routes anything poor straight to a person rather '
    + 'than thanking the customer for a complaint.',
  suitedTo: [],
  suggestedSlug: 'collect_feedback',
  priority: 30,
  capability: {
    purpose: 'Collect a rating and comments from the customer',
    description: 'Asks for a score and a comment; escalates low scores.',
    useWhen: [
      'The customer wants to give feedback',
      'The customer wants to leave a review or a complaint',
    ],
    doNotUseWhen: [
      'The customer wants to place an order',
      'The customer is asking a factual question',
    ],
    positiveExamples: [
      'I want to leave some feedback',
      'Can I give a review?',
      'I was not happy with my last order',
    ],
    negativeExamples: [
      'What are your opening hours?',
      'I want to order food',
    ],
    requiredInputs: [{ key: 'rating', label: 'Rating', type: 'number' }],
    optionalInputs: [{ key: 'comment', label: 'Comment', type: 'string' }],
    preconditions: [],
    sideEffects: [],
    requiresConfirmation: false,
    minimumConfidence: 0.7,
    allowsInterruption: true,
  },
  definition: {
    schemaVersion: '1.0',
    entryNodeId: 'entry',
    nodes: [
      entry(),
      node('ask_rating', 'ASK_USER_INPUT', {
        prompt: 'How would you rate us out of 5?',
        variableName: 'rating',
        inputType: 'number',
        required: true,
        validation: { min: 1, max: 5 },
        retryMessage: 'Please reply with a number from 1 to 5.',
        maxRetries: 3,
      }, 170, 'Ask Rating'),
      node('ask_comment', 'ASK_USER_INPUT', {
        prompt: 'Thanks. Anything you would like to add?',
        variableName: 'comment',
        inputType: 'string',
        required: false,
        maxRetries: 2,
      }, 300, 'Ask Comment'),
      node('is_low', 'CONDITION', {
        left: '{{vars.rating}}', op: 'lte', right: '3',
      }, 430, 'Low Score?'),
      node('escalate', 'HUMAN_HANDOFF', {
        reason: 'Low feedback score',
        message: "I'm sorry to hear that. Let me get someone to look into it.",
      }, 560, 'Follow Up', 200),
      node('thanks', 'SEND_WHATSAPP_MESSAGE', {
        body: 'Thank you — we really appreciate the feedback.',
      }, 560, 'Thank You', 620),
      node('done', 'END_WORKFLOW', { outcome: 'COMPLETED' }, 690, 'End', 620),
    ],
    edges: [
      edge('entry', 'ask_rating'),
      edge('ask_rating', 'ask_comment'),
      edge('ask_comment', 'is_low'),
      edge('is_low', 'escalate', 'yes'),
      edge('is_low', 'thanks', 'no'),
      edge('thanks', 'done'),
    ],
  },
};

export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  orderPlace,
  leadCapture,
  orderStatus,
  faqEscalation,
  feedback,
];

export const templateById = (id: string): WorkflowTemplate | null =>
  WORKFLOW_TEMPLATES.find((t) => t.id === id) ?? null;

export interface TemplateReadiness {
  available: boolean;
  /** Node types the template uses that have no runtime. */
  missingRuntimes: string[];
}

/**
 * Whether a template can actually run, checked against the executor registry
 * rather than a hand-maintained list — so adding a node runtime automatically
 * un-blocks any template that was waiting on it, and removing one surfaces
 * immediately instead of at someone's first live conversation.
 */
export const templateReadiness = (template: WorkflowTemplate): TemplateReadiness => {
  const missing = [...new Set(
    template.definition.nodes
      .map((n) => n.type)
      .filter((type) => !EXECUTORS.has(type as NodeType)),
  )];
  return { available: missing.length === 0, missingRuntimes: missing };
};

/** Gallery view: everything the UI needs, without the full graph. */
export const templateSummaries = () => WORKFLOW_TEMPLATES.map((template) => {
  const readiness = templateReadiness(template);
  return {
    id: template.id,
    name: template.name,
    category: template.category,
    tagline: template.tagline,
    description: template.description,
    suitedTo: template.suitedTo,
    suggestedSlug: template.suggestedSlug,
    nodeCount: template.definition.nodes.length,
    hasSideEffects: template.capability.sideEffects.length > 0,
    ...readiness,
  };
});
