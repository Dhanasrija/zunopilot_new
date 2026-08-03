import { z } from 'zod';
import {
  collectTemplateTokens,
  findCycles,
  nodeMap,
  outgoingEdges,
  reachableNodeIds,
  safeParseDefinition,
  type WorkflowDefinition,
} from '../domain/definition.js';
import {
  CONVERSATION_ENTRY_TYPES,
  EVENT_ENTRY_TYPES,
  configSchemaFor,
  isEntryType,
  metaFor,
  nodeHasSideEffect,
  type NodeType,
} from '../domain/node-types.js';
import { isImplemented, isWaitingCapable } from '../engine/executors/index.js';
import type { CapabilityContract } from '../domain/capability.js';

// Pre-publish validation.
//
// Errors block publishing; warnings do not. The split is not stylistic — an
// error is a graph the engine cannot run correctly, a warning is one it runs in
// a way the author may not have intended. Anything the engine tolerates at
// runtime (skipping an unimplemented node, a cycle that stays under the step
// cap) is a warning, so the operator keeps the decision.

export type IssueLevel = 'error' | 'warning';

export interface ValidationIssue {
  level: IssueLevel;
  code: string;
  message: string;
  nodeId?: string;
  edgeId?: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

/** Roots of the template scope a workflow may address. */
const SCOPE_ROOTS = new Set(['tenant', 'customer', 'conversation', 'message', 'vars', 'now']);

export interface ValidateArgs {
  definition: unknown;
  category: 'CONVERSATION' | 'EVENT';
  capability?: CapabilityContract | null;
  /** Slugs already taken by other workflows in this tenant. */
  siblingSlugs?: string[];
  slug?: string | null;
}

export const validateWorkflowDefinition = ({
  definition: raw,
  category,
  capability,
  siblingSlugs = [],
  slug,
}: ValidateArgs): ValidationResult => {
  const issues: ValidationIssue[] = [];
  const error = (code: string, message: string, extra: Partial<ValidationIssue> = {}) =>
    issues.push({ level: 'error', code, message, ...extra });
  const warn = (code: string, message: string, extra: Partial<ValidationIssue> = {}) =>
    issues.push({ level: 'warning', code, message, ...extra });

  // ── 1. Structure ───────────────────────────────────────────────────────────
  const parsed = safeParseDefinition(raw);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      error('INVALID_STRUCTURE', `${issue.path.join('.') || 'definition'}: ${issue.message}`);
    }
    return { valid: false, issues };
  }
  const definition: WorkflowDefinition = parsed.data;
  const nodes = nodeMap(definition);

  // ── 2. Duplicate node ids ──────────────────────────────────────────────────
  if (nodes.size !== definition.nodes.length) {
    const seen = new Set<string>();
    for (const node of definition.nodes) {
      if (seen.has(node.id)) error('DUPLICATE_NODE_ID', `Duplicate node id "${node.id}"`, { nodeId: node.id });
      seen.add(node.id);
    }
  }

  // ── 3/4. Entry node: exactly one, of the right kind ────────────────────────
  const entryNodes = definition.nodes.filter((n) => isEntryType(n.type));
  const entry = nodes.get(definition.entryNodeId);

  if (!entry) {
    error('MISSING_ENTRY_NODE', `entryNodeId "${definition.entryNodeId}" does not match any node`);
  } else if (!isEntryType(entry.type)) {
    error('ENTRY_NOT_A_TRIGGER', `Entry node "${entry.id}" is a ${entry.type}, which cannot start a workflow`, { nodeId: entry.id });
  }

  if (entryNodes.length > 1) {
    error(
      'MULTIPLE_ENTRY_NODES',
      `${entryNodes.length} entry nodes found — a workflow can only start in one place`,
      { nodeId: entryNodes[1]!.id },
    );
  }

  const allowedEntries: readonly string[] = category === 'CONVERSATION'
    ? CONVERSATION_ENTRY_TYPES
    : EVENT_ENTRY_TYPES;

  for (const node of entryNodes) {
    if (!allowedEntries.includes(node.type)) {
      error(
        'WRONG_ENTRY_FOR_CATEGORY',
        category === 'CONVERSATION'
          ? `A conversation workflow must start with ASSISTANT_ROUTE_ENTRY, not ${node.type}. `
            + 'Conversation workflows are started by the assistant router, not by a raw WhatsApp trigger.'
          : `An event workflow must start with a webhook, schedule or business-event trigger, not ${node.type}`,
        { nodeId: node.id },
      );
    }
  }

  // ── 5. Edges must reference real nodes and real handles ────────────────────
  for (const edge of definition.edges) {
    if (!nodes.has(edge.source)) {
      error('EDGE_BAD_SOURCE', `Edge "${edge.id}" starts at unknown node "${edge.source}"`, { edgeId: edge.id });
      continue;
    }
    if (!nodes.has(edge.target)) {
      error('EDGE_BAD_TARGET', `Edge "${edge.id}" points at unknown node "${edge.target}"`, { edgeId: edge.id });
      continue;
    }
    const sourceNode = nodes.get(edge.source)!;
    const branches = metaFor(sourceNode.type as NodeType).branches;
    if (edge.sourceHandle && branches && !branches.includes(edge.sourceHandle)) {
      error(
        'EDGE_BAD_HANDLE',
        `Edge "${edge.id}" leaves ${sourceNode.type} via "${edge.sourceHandle}", which is not one of: ${branches.join(', ')}`,
        { edgeId: edge.id, nodeId: sourceNode.id },
      );
    }
  }

  // Two edges off the same handle is non-deterministic — the walker takes the
  // exact match, so the second is dead, but which one is "second" is arbitrary.
  const handleSeen = new Set<string>();
  for (const edge of definition.edges) {
    const key = `${edge.source}::${edge.sourceHandle ?? ''}`;
    if (handleSeen.has(key)) {
      error(
        'DUPLICATE_HANDLE_EDGE',
        `Node "${edge.source}" has more than one edge leaving the same output — the flow would be non-deterministic`,
        { nodeId: edge.source, edgeId: edge.id },
      );
    }
    handleSeen.add(key);
  }

  // ── 6. Per-node config ─────────────────────────────────────────────────────
  for (const node of definition.nodes) {
    const schema = configSchemaFor(node.type as NodeType);
    const result = schema.safeParse(node.config);
    if (!result.success) {
      for (const issue of (result.error as z.ZodError).issues) {
        error(
          'INVALID_NODE_CONFIG',
          `"${node.name ?? node.id}" (${node.type}): ${issue.path.join('.') || 'config'} ${issue.message}`,
          { nodeId: node.id },
        );
      }
    }

    if (!isImplemented(node.type as NodeType)) {
      warn(
        'NODE_NOT_IMPLEMENTED',
        `"${node.name ?? node.id}" is a ${node.type}, which has no runtime yet — the engine will skip it and carry on`,
        { nodeId: node.id },
      );
    }
  }

  // ── 7. Reachability ────────────────────────────────────────────────────────
  if (entry) {
    const reachable = reachableNodeIds(definition);
    for (const node of definition.nodes) {
      if (!reachable.has(node.id)) {
        warn(
          'UNREACHABLE_NODE',
          `"${node.name ?? node.id}" cannot be reached from the entry node — it will never run`,
          { nodeId: node.id },
        );
      }
    }
  }

  // ── 8. Branches without a fallback ─────────────────────────────────────────
  for (const node of definition.nodes) {
    const meta = metaFor(node.type as NodeType);
    if (meta.terminal) continue;

    const out = outgoingEdges(definition, node.id);
    if (!out.length) {
      warn(
        'DEAD_END',
        `"${node.name ?? node.id}" has no outgoing connection — the run ends there`,
        { nodeId: node.id },
      );
      continue;
    }

    if (meta.branches) {
      const taken = new Set(out.map((e) => e.sourceHandle ?? ''));
      const missing = meta.branches.filter((b) => !taken.has(b));
      const hasDefault = taken.has('');
      if (missing.length && !hasDefault) {
        warn(
          'BRANCH_WITHOUT_FALLBACK',
          `"${node.name ?? node.id}" has no ${missing.map((m) => m.toUpperCase()).join(' or ')} branch and no default — that path ends the run`,
          { nodeId: node.id },
        );
      }
    }
  }

  // ── 9. Cycles ──────────────────────────────────────────────────────────────
  for (const cycle of findCycles(definition)) {
    const hasBound = cycle.some((id) => {
      const node = nodes.get(id);
      if (!node) return false;
      // Anything that parks for a reply yields between iterations — asked via
      // the executor registry rather than a list of type names, so an
      // interactive node added later counts without touching this file.
      return node.type === 'DELAY'
        || node.type === 'LOOP'
        || isWaitingCapable(node.type as NodeType);
    });
    if (hasBound) {
      // A loop that waits on the customer or the clock cannot spin — it is a
      // legitimate retry, polling or "add another item" loop.
      continue;
    }
    warn(
      'UNBOUNDED_CYCLE',
      `Nodes ${cycle.join(' → ')} form a loop with nothing to pause it. The engine's step cap will stop it, but it will burn the run's budget first.`,
      { nodeId: cycle[0]! },
    );
  }

  // ── 10. Template references ────────────────────────────────────────────────
  const declaredVariables = new Set<string>();
  for (const node of definition.nodes) {
    if (node.outputVariable) declaredVariables.add(node.outputVariable);
    const config = node.config as Record<string, unknown>;
    if (typeof config.variableName === 'string') declaredVariables.add(config.variableName);
    if (typeof config.outputVariable === 'string') declaredVariables.add(config.outputVariable);
    // A list or button node writes the tapped row's *title* here as well as its
    // id, and reading it back is the normal way to name the choice in the next
    // message — so it is a declared variable, not an unknown one.
    if (typeof config.labelVariable === 'string') declaredVariables.add(config.labelVariable);
  }
  for (const input of capability?.requiredInputs ?? []) declaredVariables.add(input.key);
  for (const input of capability?.optionalInputs ?? []) declaredVariables.add(input.key);

  for (const token of collectTemplateTokens(definition)) {
    const [root, ...rest] = token.split('.');
    if (!root || !SCOPE_ROOTS.has(root)) {
      error(
        'INVALID_TEMPLATE_ROOT',
        `Template "{{${token}}}" starts with "${root}", which is not readable. Use one of: ${[...SCOPE_ROOTS].join(', ')}.`,
      );
      continue;
    }
    if (root === 'vars') {
      const name = rest[0];
      if (name && !declaredVariables.has(name)) {
        warn(
          'UNKNOWN_VARIABLE',
          `Template "{{${token}}}" reads a variable nothing in this workflow writes — it will resolve to an empty string`,
        );
      }
    }
  }

  // ── 11/12. Capability contract ─────────────────────────────────────────────
  if (category === 'CONVERSATION') {
    if (!capability) {
      error(
        'MISSING_CAPABILITY',
        'A conversation workflow needs a routing capability contract before it can be published — '
        + 'the router has nothing to select it by otherwise.',
      );
    } else {
      if (!capability.purpose?.trim()) {
        error('MISSING_PURPOSE', 'The capability contract needs a purpose');
      }
      if (capability.positiveExamples.length < 3) {
        error('TOO_FEW_POSITIVE_EXAMPLES', 'Give at least 3 positive routing examples');
      }
      if (capability.negativeExamples.length < 2) {
        error('TOO_FEW_NEGATIVE_EXAMPLES', 'Give at least 2 negative routing examples');
      }

      // The load-bearing one. A workflow that creates an appointment and does
      // not confirm first is how "is Dr Rao free tomorrow?" books a slot.
      const hasSideEffect = capability.sideEffects.length > 0
        || definition.nodes.some((n) => nodeHasSideEffect(n.type as NodeType, n.config));
      if (hasSideEffect && !capability.requiresConfirmation) {
        error(
          'SIDE_EFFECT_WITHOUT_CONFIRMATION',
          'This workflow performs an action the customer cannot undo, but is not marked as requiring '
          + 'confirmation. Add a confirmation step, or clear the declared side effects.',
        );
      }
      if (hasSideEffect && capability.minimumConfidence < 0.7) {
        warn(
          'LOW_CONFIDENCE_FOR_SIDE_EFFECT',
          `Minimum confidence is ${capability.minimumConfidence} on a workflow with side effects — `
          + 'a near-miss message could trigger a real action.',
        );
      }
    }

    if (!slug?.trim()) {
      error('MISSING_SLUG', 'A conversation workflow needs a slug — it is what the router selects by');
    } else if (siblingSlugs.includes(slug)) {
      error('DUPLICATE_SLUG', `Another workflow already uses the slug "${slug}"`);
    }
  }

  return { valid: !issues.some((i) => i.level === 'error'), issues };
};
