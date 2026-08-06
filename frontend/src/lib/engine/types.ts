import type { Edge, Node } from '@xyflow/react';
import { specFor, type NodeConfig, type NodeType } from './nodes.js';

// The stored workflow definition, and its mapping to React Flow.
//
// Mirrors `domain/definition.ts` on the backend. `position` and `name` are
// editor-only and the engine ignores them; `config`, `outputVariable` and the
// edge `sourceHandle` are the parts it reads.

export const SCHEMA_VERSION = '1.0';

export interface DefinitionNode {
  id: string;
  type: NodeType;
  position: { x: number; y: number };
  name?: string;
  description?: string;
  config: NodeConfig;
  outputVariable?: string | null;
  retry?: { maxAttempts: number; backoffMs: number };
  onErrorHandle?: string | null;
}

export interface DefinitionEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  label?: string | null;
}

export interface WorkflowDefinition {
  schemaVersion: string;
  entryNodeId: string;
  nodes: DefinitionNode[];
  edges: DefinitionEdge[];
}

export interface FlowNodeData extends Record<string, unknown> {
  type: NodeType;
  name: string;
  config: NodeConfig;
  outputVariable: string | null;
  /** Status from the last test run, painted onto the node. Mirrors NodeExecution.status. */
  runStatus?: 'PENDING' | 'RUNNING' | 'WAITING' | 'SUCCESS' | 'FAILED' | 'SKIPPED' | null;
}

export type FlowNode = Node<FlowNodeData, 'engineNode'>;

export const newNodeId = (type: string) =>
  `${type.toLowerCase().replace(/[^a-z]/g, '_').slice(0, 12)}_${Math.random().toString(36).slice(2, 7)}`;

export const edgeIdFor = (source: string, target: string, handle?: string | null) =>
  `${source}->${target}${handle ? `:${handle}` : ''}`;

/** A brand new conversation workflow: entry node placed, nothing else. */
export const emptyDefinition = (): WorkflowDefinition => {
  const id = 'entry';
  return {
    schemaVersion: SCHEMA_VERSION,
    entryNodeId: id,
    nodes: [{
      id,
      type: 'ASSISTANT_ROUTE_ENTRY',
      position: { x: 360, y: 60 },
      name: 'Assistant Route Entry',
      config: { acceptedIntents: [] },
    }],
    edges: [],
  };
};

export function toFlow(definition: WorkflowDefinition): { nodes: FlowNode[]; edges: Edge[] } {
  const nodes: FlowNode[] = definition.nodes.map((n, i) => ({
    id: n.id,
    type: 'engineNode',
    // A definition authored outside the editor may carry no positions; stack
    // those in a readable column rather than piling them on the origin.
    position: n.position ?? { x: 360, y: 60 + i * 150 },
    data: {
      type: n.type,
      name: n.name ?? specFor(n.type).label,
      config: n.config ?? {},
      outputVariable: n.outputVariable ?? null,
    },
  }));

  const known = new Set(nodes.map((n) => n.id));
  const edges: Edge[] = definition.edges
    // Drop dangling edges rather than handing React Flow a broken reference.
    .filter((e) => known.has(e.source) && known.has(e.target))
    .map((e) => ({
      id: e.id || edgeIdFor(e.source, e.target, e.sourceHandle),
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle ?? null,
      type: 'smoothstep',
      label: e.sourceHandle ? e.sourceHandle.toUpperCase() : undefined,
    }));

  return { nodes, edges };
}

export function toDefinition(
  nodes: FlowNode[],
  edges: Edge[],
  entryNodeId?: string,
): WorkflowDefinition {
  const entry = entryNodeId
    ?? nodes.find((n) => specFor(n.data.type).group === 'Entry')?.id
    ?? nodes[0]?.id
    ?? 'entry';

  return {
    schemaVersion: SCHEMA_VERSION,
    entryNodeId: entry,
    nodes: nodes.map((n) => ({
      id: n.id,
      type: n.data.type,
      // Rounded: sub-pixel drift would mark the canvas dirty on every drag.
      position: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
      name: n.data.name,
      config: n.data.config ?? {},
      ...(n.data.outputVariable ? { outputVariable: n.data.outputVariable } : {}),
    })),
    edges: edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      ...(e.sourceHandle ? { sourceHandle: e.sourceHandle } : {}),
    })),
  };
}

/** Canonical serialisation for dirty-checking, so key order cannot lie. */
export const fingerprint = (definition: WorkflowDefinition): string => JSON.stringify({
  entry: definition.entryNodeId,
  nodes: [...definition.nodes]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((n) => [n.id, n.type, n.name, n.position?.x, n.position?.y, n.config, n.outputVariable ?? null]),
  edges: [...definition.edges]
    .map((e) => `${e.source}|${e.target}|${e.sourceHandle ?? ''}`)
    .sort(),
});
