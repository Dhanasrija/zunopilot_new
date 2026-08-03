import { prisma } from '../../config/prisma.js';
import { sendTextMessage, sendTemplate } from '../whatsapp.service.js';
import { logger } from '../../config/logger.js';
import type { WorkflowRun } from '@prisma/client';
import type { TemplateContext, WorkflowVariables } from './context.js';
import type { InboundContext } from '../../types/domain.js';

export interface LegacyNode {
  id: string;
  type: string;
  config?: Record<string, any>;
  outputVariable?: string | null;
}

export interface NodeResult {
  branch?: string;
  output?: unknown;
  wait?: { untilMs: number };
}

export interface HandlerArgs {
  node: LegacyNode;
  config: Record<string, any>;
  ctx: TemplateContext;
  run: WorkflowRun;
  deps: InboundContext & { message?: unknown };
}

export type NodeHandler = (args: HandlerArgs) => Promise<NodeResult>;

// Node handlers.
//
// Contract: each handler receives ({ node, config, ctx, run, deps }) where
// `config` is already interpolated, and returns:
//   { branch?: string, output?: any, wait?: { untilMs } }
// The walker uses `branch` to pick an outgoing edge (defaulting to the
// unlabelled one), stores `output` under the node's outputVariable, and parks the
// run when `wait` is returned.
//
// Handlers never choose the next node id themselves — routing stays in the
// walker so the graph, not a handler, defines control flow.

const asNumber = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// ── Comparison used by condition / branch ─────────────────────────────────────
const compare = (left: unknown, op: string, right: unknown): boolean => {
  const l = left ?? '';
  const r = right ?? '';
  const ls = String(l).toLowerCase();
  const rs = String(r).toLowerCase();
  switch (op) {
    case 'equals': return ls === rs;
    case 'not_equals': return ls !== rs;
    case 'contains': return ls.includes(rs);
    case 'not_contains': return !ls.includes(rs);
    case 'starts_with': return ls.startsWith(rs);
    case 'ends_with': return ls.endsWith(rs);
    case 'is_empty': return ls.trim() === '';
    case 'is_not_empty': return ls.trim() !== '';
    case 'gt': { const a = asNumber(l), b = asNumber(r); return a !== null && b !== null && a > b; }
    case 'gte': { const a = asNumber(l), b = asNumber(r); return a !== null && b !== null && a >= b; }
    case 'lt': { const a = asNumber(l), b = asNumber(r); return a !== null && b !== null && a < b; }
    case 'lte': { const a = asNumber(l), b = asNumber(r); return a !== null && b !== null && a <= b; }
    default:
      // An unknown operator is an authoring bug; failing the run surfaces it
      // rather than silently taking the "no" branch forever.
      throw new Error(`Unknown condition operator "${op}"`);
  }
};

// ── Handlers ──────────────────────────────────────────────────────────────────

const trigger: NodeHandler = async () => ({ output: null });

const condition: NodeHandler = async ({ config }) => {
  const result = compare(config.left, config.op || 'equals', config.right);
  return { branch: result ? 'yes' : 'no', output: result };
};

const sendMessage: NodeHandler = async ({ config, run, deps }) => {
  const body = String(config.body ?? '').trim();
  if (!body) throw new Error('Send WhatsApp node has an empty message body');
  const sent = await sendTextMessage({
    accessToken: deps.waAccount.accessToken,
    phoneNumberId: deps.waAccount.phoneNumberId,
    to: deps.customer.waId,
    body,
  });
  const waMessageId: string | null = sent?.messages?.[0]?.id ?? null;

  // Mirror into the inbox so an operator sees what the workflow said, exactly as
  // sendAgentMessage does for a human reply.
  // A run can exist without a customer (a manual test run), and Message
  // requires one — so mirror into the inbox only when both are present.
  if (run.conversationId && run.customerId) {
    await prisma.message.create({
      data: {
        tenantId: run.tenantId,
        conversationId: run.conversationId,
        customerId: run.customerId,
        direction: 'OUTBOUND',
        type: 'TEXT',
        status: 'SENT',
        waMessageId,
        body,
      },
    });
  }
  return { output: { waMessageId } };
};

const sendTemplateNode: NodeHandler = async ({ config, deps }) => {
  const name = String(config.templateName ?? '').trim();
  if (!name) throw new Error('Template Message node has no template selected');
  const params = Array.isArray(config.params) ? config.params : [];
  const sent = await sendTemplate({
    accessToken: deps.waAccount.accessToken,
    phoneNumberId: deps.waAccount.phoneNumberId,
    to: deps.customer.waId,
    templateName: name,
    language: config.language || 'en',
    components: params.length
      ? [{ type: 'body', parameters: params.map((p) => ({ type: 'text', text: String(p) })) }]
      : [],
  });
  return { output: { waMessageId: sent?.messages?.[0]?.id ?? null } };
};

const setVariable: NodeHandler = async ({ config }) => ({ output: config.value ?? null });

const delay: NodeHandler = async ({ config }) => {
  const seconds = asNumber(config.seconds);
  if (seconds === null || seconds < 0) throw new Error('Delay node needs a non-negative duration');
  // Cap at 30 days: beyond that the WhatsApp 24h window is long gone and the run
  // is almost certainly abandoned, so an unbounded park would leak rows forever.
  const capped = Math.min(seconds, 30 * 24 * 60 * 60);
  return { wait: { untilMs: Date.now() + capped * 1000 }, output: { seconds: capped } };
};

const humanHandover: NodeHandler = async ({ run }) => {
  if (run.conversationId) {
    await prisma.conversation.update({
      where: { id: run.conversationId },
      data: { status: 'HUMAN_TAKEOVER', automationPaused: true },
    });
  }
  return { output: { handedOver: true } };
};

const noop: NodeHandler = async ({ node }) => {
  // Reached when a graph references a node type this build does not implement.
  // Skipped rather than failed so one unimplemented node cannot break an
  // otherwise-valid published flow.
  logger.warn('Workflow node type not implemented, skipping', { type: node.type, nodeId: node.id });
  return { output: { skipped: true, reason: `Node type "${node.type}" is not implemented yet` } };
};

export const HANDLERS: Record<string, NodeHandler> = {
  trigger,
  condition,
  branch: condition, // same comparison, different palette label
  send_message: sendMessage,
  send_template: sendTemplateNode,
  set_variable: setVariable,
  delay,
  human_handover: humanHandover,
};

/** Node types that exist in the palette but have no runtime yet. */
export const UNIMPLEMENTED = new Set([
  'ai_agent',
  'intent_detection',
  'knowledge_search',
  'api_request',
  'database',
  'google_sheets',
  'loop',
]);

export const resolveHandler = (type: string): NodeHandler | null => HANDLERS[type] || (UNIMPLEMENTED.has(type) ? noop : null);

export { compare };
