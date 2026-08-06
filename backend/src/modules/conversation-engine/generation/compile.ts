import type { WorkflowDefinition, WorkflowEdge, WorkflowNode } from '../domain/definition.js';
import type { CapabilityContract } from '../domain/capability.js';
import { COMPARISON_OPERATORS, DATABASE_RESOURCES, DATABASE_WRITES, type NodeType } from '../domain/node-types.js';
import type { PlanStep, WorkflowPlan } from './plan.js';

// Turning a plan into a graph.
//
// This is where the model's freedom ends and the rules begin. It builds the
// entry node, allocates handles, wires edges, and refuses anything the model
// invented — an operation that does not exist, a step id that goes nowhere.
//
// The guiding choice: **a gap is left as a gap.** When the model names an
// operation that was never offered, the compiler blanks the field and records
// it, so the node fails the publish validator and the author is shown exactly
// what to fill in. Substituting a plausible-looking guess would produce a
// workflow that publishes and then calls the wrong thing.

export interface CompiledPlan {
  definition: WorkflowDefinition;
  capability: CapabilityContract;
  /** Things the author has to resolve before this can be published. */
  gaps: string[];
}

export interface CompileContext {
  /** `connectorKey.operationKey` pairs that actually exist for this tenant. */
  operations: Array<{ connectorKey: string; operationKey: string; sideEffecting: boolean }>;
}

const ENTRY_ID = 'entry';
const COLUMN = 380;
const ROW = 130;

const slugId = (raw: string, index: number): string => {
  const cleaned = raw.toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/^_+|_+$/g, '').slice(0, 48);
  return cleaned || `step_${index + 1}`;
};

const variableName = (raw: string | null, fallback: string): string => {
  const cleaned = (raw ?? '').replace(/[^a-zA-Z0-9_]/g, '');
  return /^[a-zA-Z_]/.test(cleaned) ? cleaned.slice(0, 64) : fallback;
};

const INPUT_TYPES = new Set(['string', 'number', 'date', 'email', 'phone', 'choice']);
const OPERATORS = new Set<string>(COMPARISON_OPERATORS);

/** Roots a template may legitimately start with. Anything else is a variable. */
const SCOPE_ROOTS = new Set(['tenant', 'customer', 'conversation', 'message', 'vars', 'now']);

/**
 * Put bare variable references into the `vars` namespace.
 *
 * Models write `{{parent.id}}` for something an earlier step stored, because
 * that is how every other template language works. Our scope requires
 * `{{vars.parent.id}}`. Rewriting is mechanical and unambiguous — the root is
 * either one of ours or it is a variable — so it is a compiler job, not a
 * reason to hand the author three errors to fix by hand. A reference to a
 * variable nothing writes still surfaces, as the validator's UNKNOWN_VARIABLE.
 */
const namespaceTemplates = (value: unknown): unknown => {
  if (typeof value === 'string') {
    return value.replace(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)((?:\.[a-zA-Z0-9_]+)*)\s*\}\}/g,
      (whole, root: string, rest: string) => (SCOPE_ROOTS.has(root) ? whole : `{{vars.${root}${rest}}}`));
  }
  if (Array.isArray(value)) return value.map(namespaceTemplates);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, namespaceTemplates(v)]),
    );
  }
  return value;
};

export const compilePlan = (plan: WorkflowPlan, context: CompileContext): CompiledPlan => {
  const gaps: string[] = [...plan.openQuestions];

  // Ids are rewritten to safe slugs, and every reference is remapped through
  // the same table — so a duplicate or an awkward id from the model cannot
  // produce two nodes that collide or an edge that points at nothing.
  //
  // Two tables, because they answer different questions. `finalIds` is
  // per-position and is what each node is actually called — two steps that
  // arrive with the same id must still become two distinct nodes, or the graph
  // has a duplicate id and the walker follows the wrong one. `idMap` resolves
  // *references*, where the first occurrence necessarily wins because a
  // reference to a repeated id is ambiguous and there is nothing better to do.
  const finalIds: string[] = [];
  const idMap = new Map<string, string>();
  const used = new Set<string>([ENTRY_ID]);
  plan.steps.forEach((step, index) => {
    const base = slugId(step.id, index);
    let candidate = base;
    let suffix = 2;
    while (used.has(candidate)) candidate = `${base}_${suffix++}`;
    used.add(candidate);
    finalIds[index] = candidate;
    if (!idMap.has(step.id)) idMap.set(step.id, candidate);
  });

  const target = (raw: string | null): string | null => (raw ? idMap.get(raw) ?? null : null);

  const nodes: WorkflowNode[] = [{
    id: ENTRY_ID,
    type: 'ASSISTANT_ROUTE_ENTRY',
    name: 'Assistant Route Entry',
    position: { x: COLUMN, y: 40 },
    config: { acceptedIntents: [] },
  }];
  const edges: WorkflowEdge[] = [];

  const connect = (from: string, to: string | null, handle?: string) => {
    if (!to) return;
    edges.push({
      id: `${from}->${to}${handle ? `:${handle}` : ''}`,
      source: from,
      target: to,
      ...(handle ? { sourceHandle: handle } : {}),
    });
  };

  const known = new Set(context.operations.map((o) => `${o.connectorKey}.${o.operationKey}`));

  plan.steps.forEach((step, index) => {
    const id = finalIds[index]!;
    const y = 40 + ROW * (index + 1);
    // A node with no name reads as a blank box on the canvas, so fall back
    // through the step's own id rather than shipping an empty label.
    const label = step.title?.trim() || id.replace(/_/g, ' ');
    const push = (type: NodeType, config: Record<string, unknown>, x = COLUMN) => {
      nodes.push({
        id, type, name: label, position: { x, y },
        config: namespaceTemplates(config) as Record<string, unknown>,
      });
    };

    switch (step.kind) {
      case 'say': {
        push('SEND_WHATSAPP_MESSAGE', { body: step.text ?? '' });
        if (!step.text?.trim()) gaps.push(`"${label}" has no message text.`);
        connect(id, target(step.next));
        break;
      }

      case 'ask': {
        const inputType = INPUT_TYPES.has(step.inputType ?? '') ? step.inputType! : 'string';
        push('ASK_USER_INPUT', {
          prompt: step.text ?? '',
          variableName: variableName(step.variable, `answer_${index + 1}`),
          inputType,
          required: true,
          validation: {},
          maxRetries: 3,
        });
        if (!step.text?.trim()) gaps.push(`"${label}" has no question text.`);
        connect(id, target(step.next));
        break;
      }

      case 'list': {
        const fromVariable = !!step.itemsFrom?.trim();
        push('LIST_MESSAGE', {
          body: step.text ?? '',
          buttonLabel: 'Choose',
          source: fromVariable ? 'variable' : 'static',
          ...(fromVariable ? { itemsVariable: variableName(step.itemsFrom, 'items') } : {}),
          rows: fromVariable ? [] : (step.options ?? []).slice(0, 10).map((option) => ({
            id: option.id.slice(0, 200),
            title: option.label.slice(0, 24),
          })),
          variableName: variableName(step.variable, `choice_${index + 1}`),
          maxRetries: 3,
        });
        if (!fromVariable && !(step.options ?? []).length) {
          gaps.push(`"${label}" has no rows — point it at a variable or add options.`);
        }
        connect(id, target(step.next));
        connect(id, target(step.onError), 'error');
        break;
      }

      case 'buttons': {
        // WhatsApp allows three. A fourth is silently dropped by Meta, so the
        // extras are trimmed here and reported rather than shipped.
        const options = (step.options ?? []).slice(0, 3);
        if ((step.options ?? []).length > 3) {
          gaps.push(`"${label}" had more than three buttons; WhatsApp allows three.`);
        }
        push('BUTTON_MESSAGE', {
          body: step.text ?? '',
          buttons: options.map((option) => ({
            id: option.id.slice(0, 200),
            title: option.label.slice(0, 20),
          })),
          variableName: variableName(step.variable, `choice_${index + 1}`),
          maxRetries: 3,
        });
        if (!options.length) gaps.push(`"${label}" has no buttons.`);
        connect(id, target(step.next));
        break;
      }

      case 'connector_query':
      case 'connector_action': {
        // Models reliably read `connector.operation` from the prompt as a
        // single identifier and put the whole thing in `connectorKey`. That is
        // a naming confusion, not a hallucination — the operation it named is
        // real — so split it rather than throwing away a correct answer.
        let connectorKey = step.connectorKey ?? '';
        let operationKey = step.operationKey ?? '';
        if (!operationKey && connectorKey.includes('.')) {
          const cut = connectorKey.indexOf('.');
          operationKey = connectorKey.slice(cut + 1);
          connectorKey = connectorKey.slice(0, cut);
        }

        const pair = `${connectorKey}.${operationKey}`;
        const real = !!connectorKey && !!operationKey && known.has(pair);
        if (!real) {
          // The model named something that does not exist. Blank it so the
          // publish validator stops the workflow, and tell the author.
          gaps.push(
            `"${label}" refers to the operation "${pair}", which is not registered. `
            + 'Pick a real operation on this node.',
          );
        }
        push(step.kind === 'connector_action' ? 'CONNECTOR_ACTION' : 'CONNECTOR_QUERY', {
          connectorKey: real ? connectorKey : '',
          operationKey: real ? operationKey : '',
          inputs: (step.inputs ?? []).map((input) => ({ key: input.key, value: input.value })),
          outputVariable: variableName(step.variable, `result_${index + 1}`),
          ...(step.itemsFrom?.trim() ? { itemsVariable: variableName(step.itemsFrom, 'items') } : {}),
        });
        connect(id, target(step.next), 'success');
        connect(id, target(step.onError), 'error');
        break;
      }

      case 'db_lookup': {
        const resource = (DATABASE_RESOURCES as readonly string[]).includes(step.resource ?? '')
          ? step.resource!
          : 'order';
        push('DATABASE_LOOKUP', {
          resource,
          query: step.query ?? '',
          limit: 5,
          outputVariable: variableName(step.variable, `record_${index + 1}`),
          ...(step.itemsFrom?.trim() ? { itemsVariable: variableName(step.itemsFrom, 'items') } : {}),
        });
        connect(id, target(step.next), 'success');
        connect(id, target(step.onError), 'error');
        break;
      }

      case 'db_write': {
        const operation = (DATABASE_WRITES as readonly string[]).includes(step.resource ?? '')
          ? step.resource!
          : 'cancel_order';
        push('DATABASE_WRITE', {
          operation,
          target: step.query ?? '',
          outputVariable: variableName(step.variable, `write_${index + 1}`),
        });
        if (!step.query?.trim()) gaps.push(`"${label}" has nothing to act on.`);
        connect(id, target(step.next), 'success');
        connect(id, target(step.onError), 'error');
        break;
      }

      case 'condition': {
        const op = OPERATORS.has(step.conditionOperator ?? '') ? step.conditionOperator! : 'equals';
        push('CONDITION', {
          left: step.conditionLeft ?? '',
          op,
          right: step.conditionRight ?? '',
        });
        connect(id, target(step.onYes), 'yes');
        connect(id, target(step.onNo), 'no');
        if (!target(step.onYes) || !target(step.onNo)) {
          gaps.push(`"${label}" is missing a Yes or No branch.`);
        }
        break;
      }

      case 'handoff': {
        push('HUMAN_HANDOFF', {
          reason: step.title || 'Requested by workflow',
          message: step.text ?? 'Let me connect you with a team member. They will reply shortly.',
        }, COLUMN + 400);
        break;
      }

      case 'end':
      default: {
        push('END_WORKFLOW', {
          outcome: 'COMPLETED',
          ...(step.text?.trim() ? { message: step.text } : {}),
        });
        break;
      }
    }
  });

  const entryTarget = target(plan.firstStepId) ?? (nodes[1]?.id ?? null);
  connect(ENTRY_ID, entryTarget);
  if (!entryTarget) gaps.push('The plan has no first step.');

  // The confirmation rule is not the model's to decide. If anything in the
  // graph writes, the contract must say so — the validator then insists on a
  // confirmation step, which is what stops a generated flow from acting on a
  // question.
  const writes = nodes.some((n) => n.type === 'CONNECTOR_ACTION' || n.type === 'DATABASE_WRITE');
  const hasSideEffects = writes || plan.capability.hasSideEffects;

  const capability: CapabilityContract = {
    purpose: plan.capability.purpose,
    description: null,
    useWhen: plan.capability.useWhen.filter(Boolean),
    doNotUseWhen: plan.capability.doNotUseWhen.filter(Boolean),
    positiveExamples: plan.capability.positiveExamples.filter(Boolean),
    negativeExamples: plan.capability.negativeExamples.filter(Boolean),
    requiredInputs: [],
    optionalInputs: [],
    preconditions: [],
    sideEffects: hasSideEffects ? ['Changes data in a connected system'] : [],
    requiresConfirmation: hasSideEffects,
    minimumConfidence: hasSideEffects ? 0.75 : 0.6,
    allowsInterruption: !hasSideEffects,
  };

  if (hasSideEffects && !nodes.some((n) => n.type === 'BUTTON_MESSAGE')) {
    gaps.push(
      'This workflow changes data but never asks the customer to confirm. '
      + 'Add a confirmation step before the action — publishing is blocked without one.',
    );
  }

  return {
    definition: { schemaVersion: '1.0', entryNodeId: ENTRY_ID, nodes, edges },
    capability,
    gaps,
  };
};
