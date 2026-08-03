import {
  Zap, MessageSquare, FileText, GitBranch, Variable, Clock, UserCheck,
  Bot, Crosshair, BookOpen, Globe, Database, Table, Repeat, HelpCircle,
  type LucideIcon,
} from 'lucide-react';
import type { Edge, Node } from '@xyflow/react';

// Shared vocabulary for the workflow canvas.
//
// The single source of truth for what a node *does* is the backend
// (`services/workflow-engine/nodes.js`). This file is the editor's view of the
// same list: one spec per node type, covering how it looks in the palette, what
// config it starts with, and what makes it invalid. Node types the engine has
// not implemented yet are listed too, marked `implemented: false`, because the
// engine skips them rather than failing — so an operator has to be told a node
// will do nothing before they publish it.

// ── Node kinds ────────────────────────────────────────────────────────────────

export type NodeKind =
  | 'trigger'
  | 'condition'
  | 'branch'
  | 'send_message'
  | 'send_template'
  | 'set_variable'
  | 'delay'
  | 'human_handover'
  | 'ai_agent'
  | 'intent_detection'
  | 'knowledge_search'
  | 'api_request'
  | 'database'
  | 'google_sheets'
  | 'loop';

export type NodeGroup = 'Trigger' | 'Messaging' | 'Logic' | 'AI' | 'Data';

export const GROUP_ORDER: NodeGroup[] = ['Trigger', 'Messaging', 'Logic', 'AI', 'Data'];

export type NodeConfig = Record<string, any>;

export interface NodeSpec {
  kind: NodeKind;
  label: string;
  blurb: string;
  icon: LucideIcon;
  group: NodeGroup;
  /** Tailwind classes for the icon chip. */
  accent: string;
  /** Source handle ids. Undefined means one unlabelled output. */
  branches?: readonly string[];
  /** Only one of these may exist on a canvas (the entry point). */
  once?: boolean;
  /** False for palette entries the engine will skip at runtime. */
  implemented: boolean;
  /** Hidden from the palette — kept so a legacy graph still renders. */
  hidden?: boolean;
  defaults: () => NodeConfig;
  /** One-line description shown on the node card. */
  summary: (config: NodeConfig) => string;
  /** Returns an error string when the config would fail at runtime. */
  configError?: (config: NodeConfig) => string | null;
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
  { value: 'gt', label: '>' },
  { value: 'gte', label: '≥' },
  { value: 'lt', label: '<' },
  { value: 'lte', label: '≤' },
] as const;

const OP_LABEL = Object.fromEntries(OPERATORS.map((o) => [o.value, o.label]));

const humanDuration = (seconds: unknown): string => {
  const n = Number(seconds);
  if (!Number.isFinite(n) || n < 0) return 'invalid duration';
  if (n < 60) return `${n}s`;
  if (n < 3600) return `${Math.round((n / 60) * 10) / 10}m`;
  if (n < 86400) return `${Math.round((n / 3600) * 10) / 10}h`;
  return `${Math.round((n / 86400) * 10) / 10}d`;
};

const truncate = (s: string, n = 90) => (s.length > n ? `${s.slice(0, n)}…` : s);

/** Shared by the node types that exist in the palette but have no runtime yet. */
const comingSoon = (
  kind: NodeKind, label: string, blurb: string, icon: LucideIcon, group: NodeGroup, accent: string,
): NodeSpec => ({
  kind, label, blurb, icon, group, accent,
  implemented: false,
  defaults: () => ({}),
  summary: () => 'Not built yet — the engine will skip this node.',
});

// ── Specs ─────────────────────────────────────────────────────────────────────

const conditionSpec = (kind: 'condition' | 'branch', hidden = false): NodeSpec => ({
  kind,
  label: 'Condition',
  blurb: 'Split the flow on a Yes / No test.',
  icon: GitBranch,
  group: 'Logic',
  accent: 'bg-warning/15 text-ink-900',
  branches: ['yes', 'no'] as const,
  implemented: true,
  hidden,
  defaults: () => ({ left: '{{message.text}}', op: 'contains', right: '' }),
  summary: (c) => {
    const op = OP_LABEL[c.op as string] ?? c.op ?? 'equals';
    const needsRight = c.op !== 'is_empty' && c.op !== 'is_not_empty';
    return truncate(`${c.left || '—'} ${op}${needsRight ? ` ${c.right || '—'}` : ''}`);
  },
  configError: (c) => (String(c.left ?? '').trim() ? null : 'Needs a value to test.'),
});

export const SPECS: Record<NodeKind, NodeSpec> = {
  trigger: {
    kind: 'trigger',
    label: 'Trigger',
    blurb: 'Where every run starts.',
    icon: Zap,
    group: 'Trigger',
    accent: 'bg-success/10 text-success',
    once: true,
    implemented: true,
    defaults: () => ({}),
    summary: () => "Runs when this workflow's trigger fires.",
  },

  send_message: {
    kind: 'send_message',
    label: 'Send WhatsApp',
    blurb: 'Send a free-text WhatsApp message.',
    icon: MessageSquare,
    group: 'Messaging',
    accent: 'bg-accent-100 text-accent-700',
    implemented: true,
    defaults: () => ({ body: '' }),
    summary: (c) => (String(c.body ?? '').trim() ? truncate(String(c.body)) : 'No message body yet.'),
    configError: (c) => (String(c.body ?? '').trim() ? null : 'Message body is empty.'),
  },

  send_template: {
    kind: 'send_template',
    label: 'Template Message',
    blurb: 'Send an approved Meta template.',
    icon: FileText,
    group: 'Messaging',
    accent: 'bg-accent-100 text-accent-700',
    implemented: true,
    defaults: () => ({ templateName: '', language: 'en', params: [] }),
    summary: (c) => (String(c.templateName ?? '').trim()
      ? `${c.templateName} (${c.language || 'en'})`
      : 'No template selected.'),
    configError: (c) => (String(c.templateName ?? '').trim() ? null : 'No template selected.'),
  },

  human_handover: {
    kind: 'human_handover',
    label: 'Human Handover',
    blurb: 'Pause automation and flag for an agent.',
    icon: UserCheck,
    group: 'Messaging',
    accent: 'bg-danger/10 text-danger',
    implemented: true,
    defaults: () => ({}),
    summary: () => 'Pauses automation and marks the chat for takeover.',
  },

  condition: conditionSpec('condition'),
  // The engine maps `branch` to the same handler. Kept out of the palette so the
  // list has one Condition node, but still renders in a graph that uses it.
  branch: conditionSpec('branch', true),

  set_variable: {
    kind: 'set_variable',
    label: 'Set Variable',
    blurb: 'Store a value for later nodes.',
    icon: Variable,
    group: 'Logic',
    accent: 'bg-surface-0 text-ink-700',
    implemented: true,
    defaults: () => ({ value: '' }),
    summary: (c) => (String(c.value ?? '').trim() ? truncate(`= ${c.value}`) : 'No value set.'),
  },

  delay: {
    kind: 'delay',
    label: 'Delay',
    blurb: 'Wait before continuing the flow.',
    icon: Clock,
    group: 'Logic',
    accent: 'bg-accent-100 text-accent-700',
    implemented: true,
    defaults: () => ({ seconds: 60 }),
    summary: (c) => `Wait ${humanDuration(c.seconds)} before the next step.`,
    configError: (c) => {
      const n = Number(c.seconds);
      return Number.isFinite(n) && n >= 0 ? null : 'Needs a non-negative duration.';
    },
  },

  loop: comingSoon('loop', 'Loop', 'Repeat steps over a list.', Repeat, 'Logic', 'bg-surface-0 text-ink-700'),

  ai_agent: comingSoon('ai_agent', 'AI Agent', 'Let a model answer in your brand voice.', Bot, 'AI', 'bg-accent-100 text-accent-700'),
  intent_detection: comingSoon('intent_detection', 'Intent Detection', 'Classify what the customer wants.', Crosshair, 'AI', 'bg-accent-100 text-accent-700'),
  knowledge_search: comingSoon('knowledge_search', 'Knowledge Search', 'Answer from your own content.', BookOpen, 'AI', 'bg-accent-100 text-accent-700'),

  api_request: comingSoon('api_request', 'API Request', 'Call an external HTTP endpoint.', Globe, 'Data', 'bg-surface-0 text-ink-700'),
  database: comingSoon('database', 'Database', 'Read or write your ZunoPilot data.', Database, 'Data', 'bg-surface-0 text-ink-700'),
  google_sheets: comingSoon('google_sheets', 'Google Sheets', 'Append or look up a spreadsheet row.', Table, 'Data', 'bg-surface-0 text-ink-700'),
};

/** Spec lookup that never throws — a graph may name a type this build removed. */
export const specFor = (kind: string): NodeSpec => SPECS[kind as NodeKind] ?? {
  kind: kind as NodeKind,
  label: kind,
  blurb: '',
  icon: HelpCircle,
  group: 'Logic',
  accent: 'bg-surface-0 text-ink-500',
  implemented: false,
  defaults: () => ({}),
  summary: () => `Unknown node type "${kind}".`,
};

export const PALETTE = GROUP_ORDER.map((group) => ({
  group,
  items: Object.values(SPECS).filter((s) => s.group === group && !s.hidden),
})).filter((g) => g.items.length > 0);

// ── Stored graph shape ────────────────────────────────────────────────────────
//
// This is what lands in `Workflow.graph` and what the engine walks. `position`
// and `label` are editor-only and ignored by the engine; `config`,
// `outputVariable` and the edge `branch` are the parts it reads.

export interface GraphNode {
  id: string;
  type: string;
  label?: string;
  position?: { x: number; y: number };
  config?: NodeConfig;
  outputVariable?: string | null;
}

export interface GraphEdge {
  from: string;
  to: string;
  branch?: string | null;
}

export interface WorkflowGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export const EMPTY_GRAPH: WorkflowGraph = { nodes: [], edges: [] };

// ── React Flow mapping ────────────────────────────────────────────────────────

export interface FlowNodeData extends Record<string, unknown> {
  kind: NodeKind;
  label: string;
  config: NodeConfig;
  outputVariable: string | null;
}

export type FlowNode = Node<FlowNodeData, 'flowNode'>;

/** Stable id so re-rendering the same edge does not remount it. */
export const edgeIdFor = (from: string, to: string, branch?: string | null) =>
  `${from}->${to}${branch ? `:${branch}` : ''}`;

export const newNodeId = () =>
  `n_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;

export function toFlow(graph: WorkflowGraph | null | undefined): { nodes: FlowNode[]; edges: Edge[] } {
  const rawNodes = graph?.nodes ?? [];
  const rawEdges = graph?.edges ?? [];

  const nodes: FlowNode[] = rawNodes.map((n, i) => ({
    id: n.id,
    type: 'flowNode',
    // A graph authored outside the editor (tests, an import) has no positions.
    // Stack those in a readable column rather than piling them on the origin.
    position: n.position ?? { x: 260, y: 80 + i * 150 },
    data: {
      kind: (n.type as NodeKind) ?? 'trigger',
      label: n.label ?? specFor(n.type).label,
      config: n.config ?? {},
      outputVariable: n.outputVariable ?? null,
    },
  }));

  const known = new Set(nodes.map((n) => n.id));
  const edges: Edge[] = rawEdges
    // Drop dangling edges instead of handing React Flow a broken reference.
    .filter((e) => known.has(e.from) && known.has(e.to))
    .map((e) => ({
      id: edgeIdFor(e.from, e.to, e.branch),
      source: e.from,
      target: e.to,
      sourceHandle: e.branch ?? null,
      type: 'smoothstep',
      label: e.branch ? e.branch.toUpperCase() : undefined,
    }));

  return { nodes, edges };
}

export function toGraph(nodes: FlowNode[], edges: Edge[]): WorkflowGraph {
  return {
    nodes: nodes.map((n) => ({
      id: n.id,
      type: n.data.kind,
      label: n.data.label,
      // Round: sub-pixel drift would mark the canvas dirty on every drag.
      position: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
      config: n.data.config ?? {},
      ...(n.data.outputVariable ? { outputVariable: n.data.outputVariable } : {}),
    })),
    edges: edges.map((e) => ({
      from: e.source,
      to: e.target,
      ...(e.sourceHandle ? { branch: e.sourceHandle } : {}),
    })),
  };
}

/** Canonical serialisation used for dirty-checking, so key order can't lie. */
export const fingerprint = (graph: WorkflowGraph): string => JSON.stringify({
  nodes: [...graph.nodes]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((n) => [n.id, n.type, n.label, n.position?.x, n.position?.y, n.config, n.outputVariable ?? null]),
  edges: [...graph.edges]
    .map((e) => `${e.from}|${e.to}|${e.branch ?? ''}`)
    .sort(),
});

// ── Validation ────────────────────────────────────────────────────────────────

export interface Issue {
  level: 'error' | 'warning';
  message: string;
  nodeId?: string;
}

/**
 * Editor-side checks, mirroring what the engine does at runtime.
 *
 * Errors block publishing: they are cases where a run would fail or never
 * start. Warnings do not: the engine tolerates them (skipping an unimplemented
 * node, falling back to a lone root as the entry point), so the operator gets
 * to decide.
 */
export function validateGraph(graph: WorkflowGraph): Issue[] {
  const issues: Issue[] = [];
  const { nodes, edges } = graph;

  if (!nodes.length) {
    return [{ level: 'error', message: 'Add at least one node before publishing.' }];
  }

  // Entry point — mirrors findStartNode() in the engine.
  const triggers = nodes.filter((n) => n.type === 'trigger');
  const targets = new Set(edges.map((e) => e.to));
  const roots = nodes.filter((n) => !targets.has(n.id));

  let startId: string | null = null;
  if (triggers.length === 1) {
    startId = triggers[0].id;
  } else if (triggers.length > 1) {
    startId = triggers[0].id;
    issues.push({
      level: 'error',
      message: `${triggers.length} Trigger nodes — a workflow can only start in one place.`,
      nodeId: triggers[1].id,
    });
  } else if (roots.length === 1) {
    startId = roots[0].id;
    issues.push({
      level: 'warning',
      message: `No Trigger node. “${roots[0].label ?? roots[0].type}” will be used as the entry point.`,
      nodeId: roots[0].id,
    });
  } else {
    issues.push({
      level: 'error',
      message: 'No entry point. Add a Trigger node, or leave exactly one node with nothing pointing into it.',
    });
  }

  // Reachability from the entry point.
  if (startId) {
    const out = new Map<string, string[]>();
    for (const e of edges) out.set(e.from, [...(out.get(e.from) ?? []), e.to]);
    const seen = new Set([startId]);
    const queue = [startId];
    while (queue.length) {
      for (const next of out.get(queue.shift()!) ?? []) {
        if (!seen.has(next)) { seen.add(next); queue.push(next); }
      }
    }
    for (const n of nodes) {
      if (!seen.has(n.id)) {
        issues.push({
          level: 'warning',
          nodeId: n.id,
          message: `“${n.label ?? n.type}” can't be reached from the start — it will never run.`,
        });
      }
    }
  }

  // Per-node checks.
  for (const n of nodes) {
    const spec = specFor(n.type);
    const name = n.label ?? spec.label;

    const configError = spec.configError?.(n.config ?? {});
    if (configError) issues.push({ level: 'error', nodeId: n.id, message: `“${name}”: ${configError}` });

    if (!spec.implemented) {
      issues.push({
        level: 'warning',
        nodeId: n.id,
        message: `“${name}” isn't built yet — the engine will skip it and carry on.`,
      });
    }

    if (spec.branches) {
      const taken = new Set(edges.filter((e) => e.from === n.id).map((e) => e.branch ?? ''));
      const missing = spec.branches.filter((b) => !taken.has(b));
      if (missing.length === spec.branches.length) {
        issues.push({ level: 'warning', nodeId: n.id, message: `“${name}” has no outgoing branch — the run ends there.` });
      } else if (missing.length) {
        issues.push({
          level: 'warning',
          nodeId: n.id,
          message: `“${name}” has no ${missing.map((m) => m.toUpperCase()).join(' or ')} branch — that path ends the run.`,
        });
      }
    }
  }

  return issues;
}
