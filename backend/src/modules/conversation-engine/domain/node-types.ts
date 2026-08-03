import { z } from 'zod';

// The node vocabulary.
//
// One registry entry per node type, holding the Zod schema for its config and
// the facts the validator and the router need: whether it can start a graph,
// how many outgoing branches it has, and whether it performs a side effect the
// user must confirm first.
//
// A type listed here but not present in EXECUTORS (see ../engine/registry.ts)
// is a palette entry with no runtime — the engine skips it and the publish
// validator warns, rather than failing a whole flow over one unbuilt node.

export const NODE_TYPES = [
  // Entry
  'ASSISTANT_ROUTE_ENTRY',
  'WEBHOOK_TRIGGER',
  'SCHEDULE_TRIGGER',
  'BUSINESS_EVENT_TRIGGER',
  // Conversation
  'SEND_WHATSAPP_MESSAGE',
  'SEND_WHATSAPP_TEMPLATE',
  'ASK_USER_INPUT',
  'BUTTON_MESSAGE',
  'LIST_MESSAGE',
  'AI_AGENT',
  'KNOWLEDGE_SEARCH',
  'INTENT_DETECTION',
  'HUMAN_HANDOFF',
  // Logic
  'CONDITION',
  'SWITCH',
  'DELAY',
  'LOOP',
  'SET_VARIABLE',
  'START_ORDERING',
  'CART_ADD_ITEM',
  'CART_SUMMARY',
  'CREATE_ORDER',
  'CONNECTOR_QUERY',
  'CONNECTOR_ACTION',
  'TRANSFORM_DATA',
  'SUB_WORKFLOW',
  'END_WORKFLOW',
  // Integration
  'HTTP_REQUEST',
  'DATABASE_LOOKUP',
  'DATABASE_WRITE',
  'GOOGLE_SHEETS',
  'CRM_ACTION',
  'CALENDAR_AVAILABILITY',
  'CALENDAR_BOOKING',
  'WEBHOOK_RESPONSE',
] as const;

export type NodeType = (typeof NODE_TYPES)[number];

export const nodeTypeSchema = z.enum(NODE_TYPES);

/** Entry nodes for CONVERSATION workflows — router-started, never event-started. */
export const CONVERSATION_ENTRY_TYPES = ['ASSISTANT_ROUTE_ENTRY'] as const;

/** Entry nodes for EVENT workflows. */
export const EVENT_ENTRY_TYPES = [
  'WEBHOOK_TRIGGER',
  'SCHEDULE_TRIGGER',
  'BUSINESS_EVENT_TRIGGER',
] as const;

export const ENTRY_TYPES = [...CONVERSATION_ENTRY_TYPES, ...EVENT_ENTRY_TYPES] as const;

// ── Config schemas ────────────────────────────────────────────────────────────

const templateString = z.string();

export const COMPARISON_OPERATORS = [
  'equals', 'not_equals', 'contains', 'not_contains',
  'starts_with', 'ends_with', 'is_empty', 'is_not_empty',
  'gt', 'gte', 'lt', 'lte',
] as const;

export const comparisonOperatorSchema = z.enum(COMPARISON_OPERATORS);

/** A variable name templates can address as `{{vars.<name>}}`. */
export const variableNameSchema = z.string()
  .min(1)
  .max(64)
  .regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/, 'Must start with a letter or underscore and contain only letters, digits and underscores');

const assistantRouteEntryConfig = z.object({
  /** Optional narrowing: only these router intents may enter here. */
  acceptedIntents: z.array(z.string()).default([]),
});

const sendWhatsAppMessageConfig = z.object({
  body: templateString.min(1, 'Message body cannot be empty'),
});

const sendWhatsAppTemplateConfig = z.object({
  templateName: z.string().min(1, 'No template selected'),
  language: z.string().default('en'),
  params: z.array(templateString).default([]),
});

const askUserInputConfig = z.object({
  prompt: templateString.min(1, 'Ask User Input needs a prompt'),
  variableName: variableNameSchema,
  inputType: z.enum(['string', 'number', 'date', 'email', 'phone', 'choice']).default('string'),
  required: z.boolean().default(true),
  validation: z.object({
    minLength: z.number().int().min(0).optional(),
    maxLength: z.number().int().min(1).optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    pattern: z.string().optional(),
    choices: z.array(z.string()).optional(),
  }).default({}),
  retryMessage: templateString.optional(),
  /** After this many invalid answers the flow stops asking and hands off. */
  maxRetries: z.number().int().min(1).max(10).default(3),
});

/**
 * Rows can be fixed, or pulled from the tenant's own catalogue.
 *
 * The dynamic sources are the whole point: a menu changes daily, so a list of
 * hand-typed rows would be stale the moment it was saved. `menu_categories`
 * and `menu_items` read live from the catalogue at send time.
 */
const listSourceSchema = z.enum(['static', 'menu_categories', 'menu_items', 'variable']);

const listMessageConfig = z.object({
  header: templateString.max(60).optional(),
  body: templateString.min(1, 'List message needs a body'),
  buttonLabel: z.string().min(1).max(20).default('View options'),
  source: listSourceSchema.default('static'),
  /** Used when `source` is `static`. */
  rows: z.array(z.object({
    id: z.string().min(1).max(200),
    title: z.string().min(1).max(24),
    description: z.string().max(72).optional(),
  })).max(10).default([]),
  /**
   * For `menu_items`: the variable holding the chosen category id. Leave blank
   * to list every item the tenant has.
   */
  categoryVariable: z.string().max(64).optional(),
  /**
   * For `variable`: the variable holding rows to render, as produced by a
   * CONNECTOR_QUERY's `itemsVariable`.
   *
   * Fetching and showing are two nodes on purpose. Folding the connector call
   * into the list node would duplicate every field of the query config here,
   * and would stop an author from doing anything between the two — filtering,
   * branching on an empty result, or asking a question first.
   */
  itemsVariable: z.string().max(64).optional(),
  /** Where the tapped row's id is stored. */
  variableName: variableNameSchema,
  /** Where the tapped row's title is stored, for use in later messages. */
  labelVariable: variableNameSchema.optional(),
  retryMessage: templateString.optional(),
  maxRetries: z.number().int().min(1).max(10).default(3),
});

const buttonMessageConfig = z.object({
  body: templateString.min(1, 'Button message needs a body'),
  // WhatsApp allows at most three reply buttons; a fourth is silently dropped
  // by Meta, so it is rejected here instead.
  buttons: z.array(z.object({
    id: z.string().min(1).max(200),
    title: z.string().min(1).max(20),
  })).min(1).max(3),
  variableName: variableNameSchema,
  labelVariable: variableNameSchema.optional(),
  retryMessage: templateString.optional(),
  maxRetries: z.number().int().min(1).max(10).default(3),
});

const conditionConfig = z.object({
  left: templateString,
  op: comparisonOperatorSchema.default('equals'),
  right: templateString.default(''),
});

const aiAgentConfig = z.object({
  systemPrompt: templateString.min(1, 'AI Agent needs a system prompt'),
  userPrompt: templateString.default('{{message.text}}'),
  maxTokens: z.number().int().min(16).max(2048).default(512),
  temperature: z.number().min(0).max(2).default(0.3),
  /** Where the reply is stored. Sending it is a separate node, on purpose. */
  outputVariable: variableNameSchema.default('ai_reply'),
  /** Send the reply straight to the customer as well as storing it. */
  sendToCustomer: z.boolean().default(true),
});

const httpRequestConfig = z.object({
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).default('GET'),
  url: templateString.min(1, 'HTTP Request needs a URL'),
  headers: z.record(z.string(), templateString).default({}),
  query: z.record(z.string(), templateString).default({}),
  body: z.unknown().optional(),
  timeoutMs: z.number().int().min(100).max(30_000).default(8_000),
  /** Retries apply to timeouts and 5xx only — never to a 4xx. */
  maxRetries: z.number().int().min(0).max(3).default(1),
  outputVariable: variableNameSchema.default('http_response'),
  /**
   * Names a mock integration instead of making a real call. Everything the demo
   * seeds uses this, so no seeded workflow can reach the public internet.
   */
  mockService: z.string().optional(),
});

const setVariableConfig = z.object({
  variableName: variableNameSchema,
  value: templateString,
});

const delayConfig = z.object({
  seconds: z.number().int().min(0).max(30 * 24 * 60 * 60),
});

const humanHandoffConfig = z.object({
  reason: z.string().default('Requested by workflow'),
  message: templateString.default('Let me connect you with a team member. They will reply shortly.'),
  assignedTeamId: z.string().optional(),
});

/**
 * Hands the conversation to the cart state machine.
 *
 * Deliberately a hand-off rather than a re-implementation. The ordering flow is
 * the most battle-tested code in the product — interactive menu lists, quantity
 * and add-on selection, address capture with a location pin, order creation —
 * and rebuilding it out of workflow nodes would mean reproducing all of it with
 * node types that have no runtime yet, for a strictly worse result.
 *
 * So the workflow owns what it is good at (the greeting, a qualifying question,
 * what happens afterwards) and delegates the money-handling part.
 */
const startOrderingConfig = z.object({
  /** Optional message sent immediately before the menu. */
  introMessage: templateString.optional(),
});

// ── Cart and order ────────────────────────────────────────────────────────────
//
// These operate on a cart held in *workflow variables*, not the `Cart` table.
//
// That is deliberate. The routing chain gives an in-flight `Cart` row absolute
// priority and hands it to the legacy state machine, so a workflow that wrote
// to `Cart` would be hijacked by the FSM on the very next message. Keeping the
// basket in variables means the two order paths never contend for the same row.

const cartAddItemConfig = z.object({
  /** Variable holding the chosen item id, as `item:<uuid>` or a bare uuid. */
  itemVariable: variableNameSchema,
  /** Variable holding the quantity. Defaults to 1 when absent or unparseable. */
  quantityVariable: variableNameSchema.optional(),
  /** Where the running basket is kept. */
  cartVariable: variableNameSchema.default('cart'),
});

const cartSummaryConfig = z.object({
  cartVariable: variableNameSchema.default('cart'),
  /** Rendered summary, for a SEND_WHATSAPP_MESSAGE to interpolate. */
  outputVariable: variableNameSchema.default('cart_summary'),
  emptyText: templateString.default('Your basket is empty.'),
});

const createOrderConfig = z.object({
  cartVariable: variableNameSchema.default('cart'),
  customerNameVariable: variableNameSchema.optional(),
  addressVariable: variableNameSchema.optional(),
  outputVariable: variableNameSchema.default('order'),
});

// ── Connectors ────────────────────────────────────────────────────────────────
//
// A node names a connector and an operation; it never carries a URL, a method
// or a credential. Those live on the registered connector, which is why the
// egress guard only has to review a base URL once rather than review every
// node an operator ever writes.
//
// Inputs are an array of {key, value} pairs rather than an object map for the
// same reason `extractedInputs` is: OpenAI strict structured output compiles an
// open map to `propertyNames` and rejects it, and these node configs are what a
// workflow-generating model will eventually have to emit.

const connectorInputSchema = z.object({
  key: z.string().min(1).max(64),
  /** A template — `{{vars.student_id}}`, `{{customer.waId}}`, or a literal. */
  value: templateString,
});

const connectorCallConfig = z.object({
  connectorKey: z.string().min(1).max(64),
  operationKey: z.string().min(1).max(64),
  inputs: z.array(connectorInputSchema).max(25).default([]),
  /** Where the whole response body is stored. */
  outputVariable: variableNameSchema.default('connector_result'),
  /**
   * Where the normalised rows go, when the operation's response mapping points
   * at a list. A LIST_MESSAGE with `source: 'variable'` renders these directly,
   * which is what lets "fetch the students" and "show the students" stay two
   * separate, independently editable nodes.
   */
  itemsVariable: variableNameSchema.optional(),
});

// ── The tenant's own data ─────────────────────────────────────────────────────
//
// Not arbitrary SQL, and not a query builder. A closed set of named resources,
// each with one meaning, because a workflow is tenant-authored and "let the
// operator write a filter" is how one customer reads another's order.
//
// The scoping rule that matters: an order lookup is always constrained to the
// customer in *this conversation*, with no config to turn that off. Otherwise a
// customer who guesses an order number reads someone else's address.

export const DATABASE_RESOURCES = ['order', 'recent_orders', 'menu_item'] as const;

const databaseLookupConfig = z.object({
  resource: z.enum(DATABASE_RESOURCES).default('order'),
  /** Order number for `order`, a search term for `menu_item`, unused otherwise. */
  query: templateString.default(''),
  limit: z.number().int().min(1).max(10).default(5),
  outputVariable: variableNameSchema.default('record'),
  /** Rows for a LIST_MESSAGE with `source: 'variable'`. */
  itemsVariable: variableNameSchema.optional(),
});

export const DATABASE_WRITES = ['cancel_order'] as const;

const databaseWriteConfig = z.object({
  operation: z.enum(DATABASE_WRITES).default('cancel_order'),
  /** Template resolving to the order number to act on. */
  target: templateString,
  outputVariable: variableNameSchema.default('write_result'),
});

const endWorkflowConfig = z.object({
  outcome: z.enum(['COMPLETED', 'CANCELLED']).default('COMPLETED'),
  message: templateString.optional(),
});

/** Node types with no runtime yet: config is accepted but not interpreted. */
const passthroughConfig = z.record(z.string(), z.unknown()).default({});

export const NODE_CONFIG_SCHEMAS = {
  ASSISTANT_ROUTE_ENTRY: assistantRouteEntryConfig,
  SEND_WHATSAPP_MESSAGE: sendWhatsAppMessageConfig,
  SEND_WHATSAPP_TEMPLATE: sendWhatsAppTemplateConfig,
  ASK_USER_INPUT: askUserInputConfig,
  LIST_MESSAGE: listMessageConfig,
  BUTTON_MESSAGE: buttonMessageConfig,
  CONDITION: conditionConfig,
  AI_AGENT: aiAgentConfig,
  HTTP_REQUEST: httpRequestConfig,
  SET_VARIABLE: setVariableConfig,
  START_ORDERING: startOrderingConfig,
  CART_ADD_ITEM: cartAddItemConfig,
  CART_SUMMARY: cartSummaryConfig,
  CREATE_ORDER: createOrderConfig,
  CONNECTOR_QUERY: connectorCallConfig,
  CONNECTOR_ACTION: connectorCallConfig,
  DATABASE_LOOKUP: databaseLookupConfig,
  DATABASE_WRITE: databaseWriteConfig,
  DELAY: delayConfig,
  HUMAN_HANDOFF: humanHandoffConfig,
  END_WORKFLOW: endWorkflowConfig,
} as const satisfies Partial<Record<NodeType, z.ZodTypeAny>>;

export const configSchemaFor = (type: NodeType): z.ZodTypeAny =>
  (NODE_CONFIG_SCHEMAS as Record<string, z.ZodTypeAny>)[type] ?? passthroughConfig;

// ── Node metadata used by the validator ──────────────────────────────────────

export interface NodeMeta {
  /** Handle names on outgoing edges. `null` means one unlabelled output. */
  branches: readonly string[] | null;
  /** True for nodes that end the walk — no outgoing edge is required. */
  terminal?: boolean;
  /**
   * True for nodes that always change something outside this system.
   *
   * Some node types only sometimes do — an HTTP_REQUEST is a side effect when
   * it POSTs and a read when it GETs — so use `nodeHasSideEffect` rather than
   * this flag when a node's config is available.
   */
  sideEffect?: boolean;
}

const DEFAULT_META: NodeMeta = { branches: null };

export const NODE_META: Partial<Record<NodeType, NodeMeta>> = {
  ASSISTANT_ROUTE_ENTRY: { branches: null },
  WEBHOOK_TRIGGER: { branches: null },
  SCHEDULE_TRIGGER: { branches: null },
  BUSINESS_EVENT_TRIGGER: { branches: null },

  CONDITION: { branches: ['yes', 'no'] },
  SWITCH: { branches: ['default'] },

  HUMAN_HANDOFF: { branches: null, terminal: true },
  // Terminal: once the cart FSM has the conversation it owns every subsequent
  // message until checkout finishes, so there is nothing for the walker to do
  // after this. Continuing would mean two things replying to one customer.
  START_ORDERING: { branches: null, terminal: true, sideEffect: true },
  CREATE_ORDER: { branches: ['success', 'error'], sideEffect: true },
  END_WORKFLOW: { branches: null, terminal: true },

  HTTP_REQUEST: { branches: ['success', 'error'] },
  // A query reads; an action changes something on the far end and therefore
  // forces the publish rule that a side-effecting workflow must confirm first.
  CONNECTOR_QUERY: { branches: ['success', 'error'] },
  CONNECTOR_ACTION: { branches: ['success', 'error'], sideEffect: true },
  DATABASE_LOOKUP: { branches: ['success', 'error'] },
  DATABASE_WRITE: { branches: ['success', 'error'], sideEffect: true },
  GOOGLE_SHEETS: { branches: null, sideEffect: true },
  CRM_ACTION: { branches: null, sideEffect: true },
  CALENDAR_BOOKING: { branches: null, sideEffect: true },
};

export const metaFor = (type: NodeType): NodeMeta => NODE_META[type] ?? DEFAULT_META;

export const isEntryType = (type: string): boolean =>
  (ENTRY_TYPES as readonly string[]).includes(type);

/** HTTP methods that change state on the far end. */
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Whether this specific node — type *and* config — changes something outside
 * the system.
 *
 * Config matters: marking every HTTP_REQUEST as a side effect would force a
 * confirmation step onto a workflow that only reads, which trains operators to
 * tick the box without meaning it and devalues the check on the flows that
 * genuinely do write.
 */
export const nodeHasSideEffect = (type: NodeType, config: unknown): boolean => {
  if (type === 'HTTP_REQUEST') {
    const method = String((config as { method?: unknown } | null)?.method ?? 'GET').toUpperCase();
    return WRITE_METHODS.has(method);
  }
  return metaFor(type).sideEffect === true;
};
