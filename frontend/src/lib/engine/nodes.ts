import {
  Zap, MessageSquare, FileText, GitBranch, Variable, Clock, UserCheck, Bot,
  Crosshair, BookOpen, Globe, Database, Table, Repeat, HelpCircle, Square,
  MessageCircleQuestion, ListChecks, MousePointerClick, Shuffle, Webhook,
  ShoppingCart, Receipt, PackageCheck, PlugZap, Send,
  CalendarClock, CalendarCheck, Users2, Wand2, CornerDownRight,
  type LucideIcon,
} from 'lucide-react';

// The node vocabulary, mirroring the engine's registry.
//
// Source of truth is the backend: `domain/node-types.ts` for config shapes and
// `engine/executors/index.ts` for what actually has a runtime. This file is the
// editor's view of the same list — anything here marked `implemented: false` is
// a palette entry the engine will skip at runtime, and the publish validator
// warns about it. Showing them is deliberate: hiding unbuilt nodes makes the
// product look smaller than the roadmap, but shipping them unmarked would let
// someone publish a flow that silently does nothing.

export type NodeType =
  | 'ASSISTANT_ROUTE_ENTRY' | 'WEBHOOK_TRIGGER' | 'SCHEDULE_TRIGGER' | 'BUSINESS_EVENT_TRIGGER'
  | 'SEND_WHATSAPP_MESSAGE' | 'SEND_WHATSAPP_TEMPLATE' | 'ASK_USER_INPUT'
  | 'BUTTON_MESSAGE' | 'LIST_MESSAGE' | 'AI_AGENT' | 'KNOWLEDGE_SEARCH'
  | 'INTENT_DETECTION' | 'HUMAN_HANDOFF'
  | 'CONDITION' | 'SWITCH' | 'DELAY' | 'LOOP' | 'SET_VARIABLE'
  | 'START_ORDERING' | 'CART_ADD_ITEM' | 'CART_SUMMARY' | 'CREATE_ORDER'
  | 'CONNECTOR_QUERY' | 'CONNECTOR_ACTION'
  | 'TRANSFORM_DATA' | 'SUB_WORKFLOW' | 'END_WORKFLOW'
  | 'HTTP_REQUEST' | 'DATABASE_LOOKUP' | 'DATABASE_WRITE' | 'GOOGLE_SHEETS'
  | 'CRM_ACTION' | 'CALENDAR_AVAILABILITY' | 'CALENDAR_BOOKING' | 'WEBHOOK_RESPONSE';

export type NodeGroup = 'Entry' | 'Conversation' | 'Flow Control' | 'AI' | 'Actions' | 'Integrations';

export const GROUP_ORDER: NodeGroup[] = [
  'Entry', 'Conversation', 'Flow Control', 'AI', 'Actions', 'Integrations',
];

export type NodeConfig = Record<string, any>;

export interface NodeSpec {
  type: NodeType;
  label: string;
  blurb: string;
  icon: LucideIcon;
  group: NodeGroup;
  accent: string;
  /** Source handle ids. Undefined means one unlabelled output. */
  branches?: readonly string[];
  /** Ends the walk — no outgoing edge needed. */
  terminal?: boolean;
  /** Only one per graph. */
  once?: boolean;
  /** Hidden from the palette (entry nodes are placed automatically). */
  hidden?: boolean;
  implemented: boolean;
  defaults: () => NodeConfig;
  summary: (config: NodeConfig) => string;
}

export const OPERATORS = [
  { value: 'equals', label: 'equals' },
  { value: 'not_equals', label: 'does not equal' },
  { value: 'contains', label: 'contains' },
  { value: 'not_contains', label: 'does not contain' },
  { value: 'starts_with', label: 'starts with' },
  { value: 'ends_with', label: 'ends with' },
  { value: 'is_empty', label: 'is empty' },
  { value: 'is_not_empty', label: 'is not empty' },
  { value: 'gt', label: 'is greater than' },
  { value: 'gte', label: 'is at least' },
  { value: 'lt', label: 'is less than' },
  { value: 'lte', label: 'is at most' },
] as const;

const OP_LABEL = Object.fromEntries(OPERATORS.map((o) => [o.value, o.label]));

export const INPUT_TYPES = ['string', 'number', 'date', 'email', 'phone', 'choice'] as const;

/** Human labels for the closed set of readable resources. */
export const DB_RESOURCE_LABELS: Record<string, string> = {
  order: 'One order by number',
  recent_orders: "This customer's recent orders",
  menu_item: 'Catalogue search',
};

const truncate = (s: string, n = 80) => (s.length > n ? `${s.slice(0, n)}…` : s);

const duration = (seconds: unknown): string => {
  const n = Number(seconds);
  if (!Number.isFinite(n) || n < 0) return 'invalid';
  if (n < 60) return `${n}s`;
  if (n < 3600) return `${Math.round((n / 60) * 10) / 10}m`;
  if (n < 86400) return `${Math.round((n / 3600) * 10) / 10}h`;
  return `${Math.round((n / 86400) * 10) / 10}d`;
};

const soon = (
  type: NodeType, label: string, blurb: string, icon: LucideIcon,
  group: NodeGroup, accent: string,
): NodeSpec => ({
  type, label, blurb, icon, group, accent,
  implemented: false,
  defaults: () => ({}),
  summary: () => 'No runtime yet — the engine will skip this node.',
});

export const NODE_SPECS: Record<NodeType, NodeSpec> = {
  // ── Entry ──────────────────────────────────────────────────────────────────
  ASSISTANT_ROUTE_ENTRY: {
    type: 'ASSISTANT_ROUTE_ENTRY',
    label: 'Assistant Route Entry',
    blurb: 'Started by the Assistant Router.',
    icon: Zap,
    group: 'Entry',
    accent: 'bg-success/10 text-success',
    once: true,
    hidden: true,
    implemented: true,
    defaults: () => ({ acceptedIntents: [] }),
    summary: () => 'Started by the Assistant Router when it selects this workflow.',
  },
  WEBHOOK_TRIGGER: {
    ...soon('WEBHOOK_TRIGGER', 'Webhook Trigger', 'Started by an inbound webhook.', Webhook, 'Entry', 'bg-success/10 text-success'),
    once: true,
  },
  SCHEDULE_TRIGGER: {
    ...soon('SCHEDULE_TRIGGER', 'Schedule Trigger', 'Started on a schedule.', CalendarClock, 'Entry', 'bg-success/10 text-success'),
    once: true,
  },
  BUSINESS_EVENT_TRIGGER: {
    ...soon('BUSINESS_EVENT_TRIGGER', 'Business Event', 'Started by an internal event.', Zap, 'Entry', 'bg-success/10 text-success'),
    once: true,
  },

  // ── Conversation ───────────────────────────────────────────────────────────
  SEND_WHATSAPP_MESSAGE: {
    type: 'SEND_WHATSAPP_MESSAGE',
    label: 'Send WhatsApp',
    blurb: 'Send a free-text message.',
    icon: MessageSquare,
    group: 'Conversation',
    accent: 'bg-accent-100 text-accent-700',
    implemented: true,
    defaults: () => ({ body: '' }),
    summary: (c) => (String(c.body ?? '').trim() ? truncate(String(c.body)) : 'No message body yet.'),
  },
  ASK_USER_INPUT: {
    type: 'ASK_USER_INPUT',
    label: 'Ask User Input',
    blurb: 'Ask a question and wait for the reply.',
    icon: MessageCircleQuestion,
    group: 'Conversation',
    accent: 'bg-accent-100 text-accent-700',
    implemented: true,
    defaults: () => ({
      prompt: '', variableName: '', inputType: 'string',
      required: true, validation: {}, maxRetries: 3,
    }),
    summary: (c) => (String(c.prompt ?? '').trim()
      ? `${truncate(String(c.prompt), 60)} → ${c.variableName || '(no variable)'}`
      : 'No prompt yet.'),
  },
  SEND_WHATSAPP_TEMPLATE: {
    type: 'SEND_WHATSAPP_TEMPLATE',
    label: 'Template Message',
    blurb: 'Send an approved Meta template.',
    icon: FileText,
    group: 'Conversation',
    accent: 'bg-accent-100 text-accent-700',
    implemented: true,
    defaults: () => ({ templateName: '', language: 'en', params: [] }),
    summary: (c) => (String(c.templateName ?? '').trim()
      ? `${c.templateName} (${c.language || 'en'})`
      : 'No template selected.'),
  },
  HUMAN_HANDOFF: {
    type: 'HUMAN_HANDOFF',
    label: 'Human Handover',
    blurb: 'Pause automation and flag for an agent.',
    icon: UserCheck,
    group: 'Conversation',
    accent: 'bg-danger/10 text-danger',
    terminal: true,
    implemented: true,
    defaults: () => ({
      reason: 'Requested by workflow',
      message: 'Let me connect you with a team member. They will reply shortly.',
    }),
    summary: (c) => truncate(String(c.reason ?? 'Hands the conversation to a human.')),
  },
  LIST_MESSAGE: {
    type: 'LIST_MESSAGE',
    label: 'List Message',
    blurb: 'Show a tappable list and wait for a choice.',
    icon: ListChecks,
    group: 'Conversation',
    accent: 'bg-accent-100 text-accent-700',
    implemented: true,
    defaults: () => ({
      body: '', buttonLabel: 'View options', source: 'menu_categories',
      rows: [], variableName: '', maxRetries: 3,
    }),
    summary: (c) => {
      const source = c.source === 'menu_categories' ? 'menu categories'
        : c.source === 'menu_items' ? 'menu items'
          : c.source === 'variable' ? `rows from {{vars.${c.itemsVariable || '?'}}}`
            : `${(c.rows ?? []).length} fixed rows`;
      return `${source} → ${c.variableName || '(no variable)'}`;
    },
  },
  BUTTON_MESSAGE: {
    type: 'BUTTON_MESSAGE',
    label: 'Buttons',
    blurb: 'Up to three reply buttons, then wait.',
    icon: MousePointerClick,
    group: 'Conversation',
    accent: 'bg-accent-100 text-accent-700',
    implemented: true,
    defaults: () => ({ body: '', buttons: [], variableName: '', maxRetries: 3 }),
    summary: (c) => ((c.buttons ?? []).length
      ? (c.buttons as Array<{ title: string }>).map((b) => b.title).join(' · ')
      : 'No buttons yet.'),
  },

  // ── Flow Control ───────────────────────────────────────────────────────────
  CONDITION: {
    type: 'CONDITION',
    label: 'Condition',
    blurb: 'Split the flow on a Yes / No test.',
    icon: GitBranch,
    group: 'Flow Control',
    accent: 'bg-warning/15 text-ink-900',
    branches: ['yes', 'no'] as const,
    implemented: true,
    defaults: () => ({ left: '{{message.text}}', op: 'contains', right: '' }),
    summary: (c) => {
      const op = OP_LABEL[c.op as string] ?? c.op ?? 'equals';
      const unary = c.op === 'is_empty' || c.op === 'is_not_empty';
      return truncate(`${c.left || '—'} ${op}${unary ? '' : ` ${c.right || '—'}`}`);
    },
  },
  SET_VARIABLE: {
    type: 'SET_VARIABLE',
    label: 'Set Variable',
    blurb: 'Store a value for later nodes.',
    icon: Variable,
    group: 'Flow Control',
    accent: 'bg-surface-0 text-ink-700',
    implemented: true,
    defaults: () => ({ variableName: '', value: '' }),
    summary: (c) => (c.variableName ? `${c.variableName} = ${truncate(String(c.value ?? ''), 40)}` : 'No variable set.'),
  },
  DELAY: {
    type: 'DELAY',
    label: 'Delay',
    blurb: 'Wait before continuing.',
    icon: Clock,
    group: 'Flow Control',
    accent: 'bg-accent-100 text-accent-700',
    implemented: true,
    defaults: () => ({ seconds: 60 }),
    summary: (c) => `Wait ${duration(c.seconds)}.`,
  },
  END_WORKFLOW: {
    type: 'END_WORKFLOW',
    label: 'End',
    blurb: 'Finish the workflow.',
    icon: Square,
    group: 'Flow Control',
    accent: 'bg-surface-0 text-ink-700',
    terminal: true,
    implemented: true,
    defaults: () => ({ outcome: 'COMPLETED' }),
    summary: (c) => (c.message ? truncate(String(c.message)) : `Ends as ${c.outcome ?? 'COMPLETED'}.`),
  },
  START_ORDERING: {
    type: 'START_ORDERING',
    label: 'Hand to Ordering',
    blurb: 'Give the conversation to the built-in checkout flow.',
    icon: ShoppingCart,
    group: 'Actions',
    accent: 'bg-warning/15 text-ink-900',
    terminal: true,
    implemented: true,
    defaults: () => ({ introMessage: '' }),
    summary: () => 'The built-in checkout takes over from here.',
  },
  CART_ADD_ITEM: {
    type: 'CART_ADD_ITEM',
    label: 'Add to Basket',
    blurb: 'Add the chosen item to the running basket.',
    icon: ShoppingCart,
    group: 'Actions',
    accent: 'bg-warning/15 text-ink-900',
    implemented: true,
    defaults: () => ({ itemVariable: '', quantityVariable: '', cartVariable: 'cart' }),
    summary: (c) => (c.itemVariable
      ? `${c.itemVariable}${c.quantityVariable ? ` × ${c.quantityVariable}` : ''} → ${c.cartVariable || 'cart'}`
      : 'No item variable set.'),
  },
  CART_SUMMARY: {
    type: 'CART_SUMMARY',
    label: 'Basket Summary',
    blurb: 'Render the basket as text for a message.',
    icon: Receipt,
    group: 'Actions',
    accent: 'bg-warning/15 text-ink-900',
    implemented: true,
    defaults: () => ({ cartVariable: 'cart', outputVariable: 'cart_summary', emptyText: 'Your basket is empty.' }),
    summary: (c) => `${c.cartVariable || 'cart'} → {{vars.${c.outputVariable || 'cart_summary'}}}`,
  },
  CREATE_ORDER: {
    type: 'CREATE_ORDER',
    label: 'Place the Order',
    blurb: 'Create the order from the basket.',
    icon: PackageCheck,
    group: 'Actions',
    accent: 'bg-warning/15 text-ink-900',
    branches: ['success', 'error'] as const,
    implemented: true,
    defaults: () => ({
      cartVariable: 'cart', customerNameVariable: '', addressVariable: '', outputVariable: 'order',
    }),
    summary: (c) => `Places the order from ${c.cartVariable || 'cart'} → {{vars.${c.outputVariable || 'order'}}}`,
  },
  CONNECTOR_QUERY: {
    type: 'CONNECTOR_QUERY',
    label: 'Connector Query',
    blurb: 'Read from a connected system.',
    icon: PlugZap,
    group: 'Integrations',
    accent: 'bg-success/10 text-success',
    branches: ['success', 'error'] as const,
    implemented: true,
    defaults: () => ({
      connectorKey: '', operationKey: '', inputs: [],
      outputVariable: 'connector_result', itemsVariable: '',
    }),
    summary: (c) => (c.connectorKey && c.operationKey
      ? `${c.connectorKey}.${c.operationKey} → {{vars.${c.outputVariable || 'connector_result'}}}`
      : 'No operation chosen yet.'),
  },
  CONNECTOR_ACTION: {
    type: 'CONNECTOR_ACTION',
    label: 'Connector Action',
    blurb: 'Create or change something in a connected system.',
    icon: Send,
    group: 'Integrations',
    accent: 'bg-success/10 text-success',
    branches: ['success', 'error'] as const,
    implemented: true,
    defaults: () => ({
      connectorKey: '', operationKey: '', inputs: [],
      outputVariable: 'connector_result', itemsVariable: '',
    }),
    summary: (c) => (c.connectorKey && c.operationKey
      ? `${c.connectorKey}.${c.operationKey} (changes data)`
      : 'No operation chosen yet.'),
  },
  SWITCH: soon('SWITCH', 'Switch', 'Branch on many values.', Shuffle, 'Flow Control', 'bg-warning/15 text-ink-900'),
  LOOP: soon('LOOP', 'Loop', 'Repeat over a list.', Repeat, 'Flow Control', 'bg-warning/15 text-ink-900'),
  TRANSFORM_DATA: soon('TRANSFORM_DATA', 'Transform Data', 'Reshape a value.', Wand2, 'Flow Control', 'bg-surface-0 text-ink-700'),
  SUB_WORKFLOW: soon('SUB_WORKFLOW', 'Sub-workflow', 'Run another workflow inline.', CornerDownRight, 'Flow Control', 'bg-surface-0 text-ink-700'),

  // ── AI ─────────────────────────────────────────────────────────────────────
  AI_AGENT: {
    type: 'AI_AGENT',
    label: 'AI Agent',
    blurb: 'Let a model answer in your brand voice.',
    icon: Bot,
    group: 'AI',
    accent: 'bg-accent-100 text-accent-700',
    implemented: true,
    defaults: () => ({
      systemPrompt: '', userPrompt: '{{message.text}}',
      maxTokens: 512, temperature: 0.3,
      outputVariable: 'ai_reply', sendToCustomer: true,
    }),
    summary: (c) => (String(c.systemPrompt ?? '').trim()
      ? truncate(String(c.systemPrompt), 70)
      : 'No system prompt yet.'),
  },
  INTENT_DETECTION: soon('INTENT_DETECTION', 'Intent Detection', 'Classify what the customer wants.', Crosshair, 'AI', 'bg-accent-100 text-accent-700'),
  KNOWLEDGE_SEARCH: soon('KNOWLEDGE_SEARCH', 'Knowledge Search', 'Answer from your own content.', BookOpen, 'AI', 'bg-accent-100 text-accent-700'),

  // ── Actions / Integrations ─────────────────────────────────────────────────
  HTTP_REQUEST: {
    type: 'HTTP_REQUEST',
    label: 'API Request',
    blurb: 'Call an endpoint or a mock service.',
    icon: Globe,
    group: 'Integrations',
    accent: 'bg-success/10 text-success',
    branches: ['success', 'error'] as const,
    implemented: true,
    defaults: () => ({
      method: 'GET', url: '', headers: {}, query: {},
      timeoutMs: 8000, maxRetries: 1,
      outputVariable: 'http_response', mockService: '',
    }),
    summary: (c) => (c.mockService
      ? `${c.method ?? 'GET'} → mock: ${c.mockService}`
      : `${c.method ?? 'GET'} ${truncate(String(c.url ?? ''), 50) || '(no URL)'}`),
  },
  DATABASE_LOOKUP: {
    type: 'DATABASE_LOOKUP',
    label: 'Look Up Your Data',
    blurb: "Read this customer's orders, or the catalogue.",
    icon: Database,
    group: 'Integrations',
    accent: 'bg-success/10 text-success',
    branches: ['success', 'error'] as const,
    implemented: true,
    defaults: () => ({ resource: 'order', query: '', limit: 5, outputVariable: 'record', itemsVariable: '' }),
    summary: (c) => `${DB_RESOURCE_LABELS[c.resource as string] ?? c.resource} → {{vars.${c.outputVariable || 'record'}}}`,
  },
  DATABASE_WRITE: {
    type: 'DATABASE_WRITE',
    label: 'Change Your Data',
    blurb: "Cancel one of this customer's orders.",
    icon: Database,
    group: 'Integrations',
    accent: 'bg-success/10 text-success',
    branches: ['success', 'error'] as const,
    implemented: true,
    defaults: () => ({ operation: 'cancel_order', target: '', outputVariable: 'write_result' }),
    summary: (c) => (c.target ? `Cancel order ${c.target}` : 'No order to act on yet.'),
  },
  GOOGLE_SHEETS: soon('GOOGLE_SHEETS', 'Google Sheets', 'Append or look up a row.', Table, 'Integrations', 'bg-success/10 text-success'),
  CRM_ACTION: soon('CRM_ACTION', 'CRM Action', 'Update a CRM record.', Users2, 'Integrations', 'bg-success/10 text-success'),
  CALENDAR_AVAILABILITY: soon('CALENDAR_AVAILABILITY', 'Calendar Availability', 'Check free slots.', CalendarClock, 'Integrations', 'bg-success/10 text-success'),
  CALENDAR_BOOKING: soon('CALENDAR_BOOKING', 'Calendar Booking', 'Reserve a slot.', CalendarCheck, 'Integrations', 'bg-success/10 text-success'),
  WEBHOOK_RESPONSE: soon('WEBHOOK_RESPONSE', 'Webhook Response', 'Reply to the caller.', Webhook, 'Integrations', 'bg-success/10 text-success'),
};

export const specFor = (type: string): NodeSpec => NODE_SPECS[type as NodeType] ?? {
  type: type as NodeType,
  label: type,
  blurb: '',
  icon: HelpCircle,
  group: 'Flow Control',
  accent: 'bg-surface-0 text-ink-500',
  implemented: false,
  defaults: () => ({}),
  summary: () => `Unknown node type "${type}".`,
};

export const PALETTE = GROUP_ORDER
  .map((group) => ({
    group,
    items: Object.values(NODE_SPECS).filter((s) => s.group === group && !s.hidden),
  }))
  .filter((g) => g.items.length > 0);

/** Mock services the backend exposes, for the API Request node's picker. */
export const MOCK_SERVICES = [
  { value: 'doctorAvailability', label: 'Doctor availability (mock)' },
  { value: 'appointments', label: 'Appointments (mock)' },
  { value: 'billing', label: 'Billing (mock)' },
  { value: 'labReports', label: 'Lab reports (mock)' },
  { value: 'crm', label: 'CRM (mock)' },
];
