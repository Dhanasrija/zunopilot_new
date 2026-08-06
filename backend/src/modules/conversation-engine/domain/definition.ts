import { z } from 'zod';
import { nodeTypeSchema, variableNameSchema } from './node-types.js';

// The stored shape of a workflow graph — what lands in
// `WorkflowVersion.definition` and what the engine walks.
//
// Validated with Zod on every write because it is tenant-authored: whoever can
// edit a workflow controls every template string a node evaluates and every URL
// an HTTP node calls. Structural validation happens here; the deeper publish
// checks (reachability, cycles, confirmation-before-side-effect) live in
// ../validation/definition-validator.ts.

export const SCHEMA_VERSION = '1.0';

export const positionSchema = z.object({
  x: z.number(),
  y: z.number(),
});

export const workflowNodeSchema = z.object({
  id: z.string().min(1).max(64),
  type: nodeTypeSchema,
  /** Editor-only. The engine never reads it. */
  position: positionSchema.default({ x: 0, y: 0 }),
  /** Editor-only label; falls back to the node type in the UI. */
  name: z.string().max(120).optional(),
  description: z.string().max(500).optional(),
  /** Shape depends on `type`; checked against its schema by the validator. */
  config: z.record(z.string(), z.unknown()).default({}),
  /** Where this node's output is stored, addressable as `{{vars.<name>}}`. */
  outputVariable: variableNameSchema.nullish(),
  /** Per-node overrides of the engine defaults. */
  retry: z.object({
    maxAttempts: z.number().int().min(0).max(5).default(0),
    backoffMs: z.number().int().min(0).max(60_000).default(1_000),
  }).optional(),
  timeoutMs: z.number().int().min(100).max(60_000).optional(),
  /** Handle to take when the node fails, instead of failing the whole run. */
  onErrorHandle: z.string().max(64).nullish(),
});

export const workflowEdgeSchema = z.object({
  id: z.string().min(1).max(128),
  source: z.string().min(1).max(64),
  target: z.string().min(1).max(64),
  /**
   * Which output of the source node this edge leaves from — 'yes'/'no' on a
   * CONDITION, 'success'/'error' on an HTTP_REQUEST. Null is the default path.
   */
  sourceHandle: z.string().max(64).nullish(),
  /** Reserved for edge-level guards. Unused by the current walker. */
  condition: z.unknown().nullish(),
  label: z.string().max(64).nullish(),
});

export const workflowDefinitionSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION).default(SCHEMA_VERSION),
  entryNodeId: z.string().min(1).max(64),
  nodes: z.array(workflowNodeSchema).min(1, 'A workflow needs at least one node').max(200),
  edges: z.array(workflowEdgeSchema).max(400).default([]),
});

export type WorkflowNode = z.infer<typeof workflowNodeSchema>;
export type WorkflowEdge = z.infer<typeof workflowEdgeSchema>;
export type WorkflowDefinition = z.infer<typeof workflowDefinitionSchema>;

/** Parse an unknown value (a JSON column, a request body) into a definition. */
export const parseDefinition = (value: unknown): WorkflowDefinition =>
  workflowDefinitionSchema.parse(value);

export const safeParseDefinition = (value: unknown) =>
  workflowDefinitionSchema.safeParse(value);

// ── Graph helpers ─────────────────────────────────────────────────────────────

export const nodeMap = (definition: WorkflowDefinition): Map<string, WorkflowNode> =>
  new Map(definition.nodes.map((n) => [n.id, n]));

export const outgoingEdges = (definition: WorkflowDefinition, nodeId: string): WorkflowEdge[] =>
  definition.edges.filter((e) => e.source === nodeId);

/**
 * Pick the next node given the handle a node's executor asked for.
 *
 * Control flow lives here rather than in executors: an executor returns a
 * handle name, and the graph — not the executor — decides where that goes.
 * An exact handle match wins; otherwise the unlabelled edge is the default.
 * Returns null when the walk should stop.
 */
export const resolveNextNodeId = (
  definition: WorkflowDefinition,
  fromNodeId: string,
  handle?: string | null,
): string | null => {
  const out = outgoingEdges(definition, fromNodeId);
  if (!out.length) return null;

  if (handle) {
    const exact = out.find(
      (e) => (e.sourceHandle ?? '').toLowerCase() === handle.toLowerCase(),
    );
    if (exact) return exact.target;
  }

  const unlabelled = out.find((e) => !e.sourceHandle);
  // Falling back to out[0] would make a graph with two labelled edges and no
  // default silently non-deterministic, so stop instead — the publish validator
  // already warns about that shape.
  return unlabelled ? unlabelled.target : null;
};

/** Every node id reachable from the entry node. */
export const reachableNodeIds = (definition: WorkflowDefinition): Set<string> => {
  const adjacency = new Map<string, string[]>();
  for (const edge of definition.edges) {
    adjacency.set(edge.source, [...(adjacency.get(edge.source) ?? []), edge.target]);
  }

  const seen = new Set<string>([definition.entryNodeId]);
  const queue = [definition.entryNodeId];
  while (queue.length) {
    const current = queue.shift()!;
    for (const next of adjacency.get(current) ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen;
};

/**
 * Every cycle in the graph, as lists of node ids.
 *
 * Cycles are not banned — a retry loop is legitimate — but one without a bound
 * is how a single inbound message turns into an unbounded walk, so the publish
 * validator wants to know where they are.
 */
export const findCycles = (definition: WorkflowDefinition): string[][] => {
  const adjacency = new Map<string, string[]>();
  for (const edge of definition.edges) {
    adjacency.set(edge.source, [...(adjacency.get(edge.source) ?? []), edge.target]);
  }

  const cycles: string[][] = [];
  const state = new Map<string, 'visiting' | 'done'>();
  const stack: string[] = [];

  const visit = (nodeId: string): void => {
    const current = state.get(nodeId);
    if (current === 'done') return;
    if (current === 'visiting') {
      const start = stack.indexOf(nodeId);
      if (start !== -1) cycles.push(stack.slice(start));
      return;
    }

    state.set(nodeId, 'visiting');
    stack.push(nodeId);
    for (const next of adjacency.get(nodeId) ?? []) visit(next);
    stack.pop();
    state.set(nodeId, 'done');
  };

  for (const node of definition.nodes) visit(node.id);
  return cycles;
};

/** Every `{{path}}` token used anywhere in the graph's config strings. */
export const collectTemplateTokens = (definition: WorkflowDefinition): Set<string> => {
  const tokens = new Set<string>();
  const pattern = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

  const walk = (value: unknown): void => {
    if (typeof value === 'string') {
      for (const match of value.matchAll(pattern)) tokens.add(match[1]!);
      return;
    }
    if (Array.isArray(value)) { value.forEach(walk); return; }
    if (value && typeof value === 'object') { Object.values(value).forEach(walk); }
  };

  for (const node of definition.nodes) walk(node.config);
  return tokens;
};
