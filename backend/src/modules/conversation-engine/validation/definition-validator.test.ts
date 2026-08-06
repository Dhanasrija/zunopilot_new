import { describe, expect, it } from 'vitest';
import { validateWorkflowDefinition } from './definition-validator.js';
import type { CapabilityContract } from '../domain/capability.js';

const capability = (overrides: Partial<CapabilityContract> = {}): CapabilityContract => ({
  purpose: 'Create a confirmed doctor appointment',
  useWhen: ['The user explicitly wants to book an appointment'],
  doNotUseWhen: ['The user only asks whether a doctor is available'],
  positiveExamples: [
    'I want to book a cardiologist appointment',
    'Schedule a consultation for tomorrow',
    'Can you book Dr Rao for Friday?',
  ],
  negativeExamples: ['Is Dr Rao available tomorrow?', 'How much is my hospital bill?'],
  requiredInputs: [],
  optionalInputs: [],
  preconditions: [],
  sideEffects: [],
  requiresConfirmation: false,
  minimumConfidence: 0.8,
  allowsInterruption: false,
  ...overrides,
} as CapabilityContract);

const node = (id: string, type: string, config: Record<string, unknown> = {}) => ({
  id, type, position: { x: 0, y: 0 }, config,
});

const edge = (id: string, source: string, target: string, sourceHandle?: string) => ({
  id, source, target, ...(sourceHandle ? { sourceHandle } : {}),
});

const linear = () => ({
  schemaVersion: '1.0' as const,
  entryNodeId: 'entry',
  nodes: [
    node('entry', 'ASSISTANT_ROUTE_ENTRY'),
    node('ask', 'ASK_USER_INPUT', { prompt: 'Which speciality?', variableName: 'speciality' }),
    node('say', 'SEND_WHATSAPP_MESSAGE', { body: 'Thanks, {{vars.speciality}}' }),
    node('end', 'END_WORKFLOW', {}),
  ],
  edges: [edge('e1', 'entry', 'ask'), edge('e2', 'ask', 'say'), edge('e3', 'say', 'end')],
});

const validate = (definition: unknown, extra: Record<string, unknown> = {}) =>
  validateWorkflowDefinition({
    definition,
    category: 'CONVERSATION',
    capability: capability(),
    slug: 'appointment_booking',
    siblingSlugs: [],
    ...extra,
  });

const codes = (result: ReturnType<typeof validate>, level?: 'error' | 'warning') =>
  result.issues.filter((i) => !level || i.level === level).map((i) => i.code);

describe('a valid conversation workflow', () => {
  it('passes', () => {
    const result = validate(linear());
    expect(result.valid).toBe(true);
    expect(codes(result, 'error')).toEqual([]);
  });
});

describe('entry node rules', () => {
  it('rejects a definition whose entryNodeId matches nothing', () => {
    const def = linear();
    def.entryNodeId = 'ghost';
    expect(codes(validate(def), 'error')).toContain('MISSING_ENTRY_NODE');
  });

  it('rejects two entry nodes', () => {
    const def = linear();
    def.nodes.push(node('entry2', 'ASSISTANT_ROUTE_ENTRY'));
    expect(codes(validate(def), 'error')).toContain('MULTIPLE_ENTRY_NODES');
  });

  it('rejects a conversation workflow started by a raw webhook trigger', () => {
    // The spec is explicit: conversation workflows are started by the router,
    // not by a generic WhatsApp/webhook trigger.
    const def = linear();
    def.nodes[0] = node('entry', 'WEBHOOK_TRIGGER');
    expect(codes(validate(def), 'error')).toContain('WRONG_ENTRY_FOR_CATEGORY');
  });

  it('rejects an event workflow started by ASSISTANT_ROUTE_ENTRY', () => {
    const result = validateWorkflowDefinition({
      definition: linear(),
      category: 'EVENT',
      capability: null,
    });
    expect(codes(result, 'error')).toContain('WRONG_ENTRY_FOR_CATEGORY');
  });
});

describe('edge integrity', () => {
  it('rejects an edge pointing at a node that does not exist', () => {
    const def = linear();
    def.edges.push(edge('bad', 'say', 'ghost'));
    expect(codes(validate(def), 'error')).toContain('EDGE_BAD_TARGET');
  });

  it('rejects an edge leaving a handle the node does not have', () => {
    const def = linear();
    def.nodes.push(node('cond', 'CONDITION', { left: '{{message.text}}', op: 'contains', right: 'yes' }));
    def.edges.push(edge('e4', 'end', 'cond'), edge('e5', 'cond', 'say', 'maybe'));
    expect(codes(validate(def), 'error')).toContain('EDGE_BAD_HANDLE');
  });

  it('rejects two edges off the same output as non-deterministic', () => {
    const def = linear();
    def.edges.push(edge('dup', 'ask', 'end'));
    expect(codes(validate(def), 'error')).toContain('DUPLICATE_HANDLE_EDGE');
  });
});

describe('node configuration', () => {
  it('rejects an empty message body', () => {
    const def = linear();
    def.nodes[2] = node('say', 'SEND_WHATSAPP_MESSAGE', { body: '' });
    expect(codes(validate(def), 'error')).toContain('INVALID_NODE_CONFIG');
  });

  it('rejects a variable name templates could not address', () => {
    const def = linear();
    def.nodes[1] = node('ask', 'ASK_USER_INPUT', { prompt: 'Which?', variableName: '2-bad name' });
    expect(codes(validate(def), 'error')).toContain('INVALID_NODE_CONFIG');
  });
});

describe('reachability and flow shape', () => {
  it('warns about an unreachable node rather than blocking', () => {
    const def = linear();
    def.nodes.push(node('orphan', 'SEND_WHATSAPP_MESSAGE', { body: 'never sent' }));
    const result = validate(def);
    expect(codes(result, 'warning')).toContain('UNREACHABLE_NODE');
    expect(result.valid).toBe(true);
  });

  it('warns about a condition branch with no fallback', () => {
    const def = linear();
    def.nodes.push(node('cond', 'CONDITION', { left: '{{vars.speciality}}', op: 'is_not_empty' }));
    def.edges.push(edge('e4', 'say', 'cond'), edge('e5', 'cond', 'end', 'yes'));
    def.edges = def.edges.filter((e) => e.id !== 'e3');
    expect(codes(validate(def), 'warning')).toContain('BRANCH_WITHOUT_FALLBACK');
  });

  it('warns about a cycle with nothing to pause it', () => {
    const def = linear();
    def.edges.push(edge('loop', 'say', 'say2'));
    def.nodes.push(node('say2', 'SEND_WHATSAPP_MESSAGE', { body: 'again' }));
    def.edges.push(edge('loop2', 'say2', 'say'));
    expect(codes(validate(def), 'warning')).toContain('UNBOUNDED_CYCLE');
  });

  it('does not warn about a loop that goes through ASK_USER_INPUT', () => {
    // Re-asking after an invalid answer is a legitimate loop: it yields to the
    // customer each time, so it cannot spin.
    const def = linear();
    def.edges.push(edge('retry', 'say', 'ask'));
    def.edges = def.edges.filter((e) => e.id !== 'e3');
    expect(codes(validate(def), 'warning')).not.toContain('UNBOUNDED_CYCLE');
  });
});

describe('template references', () => {
  it('rejects a template reading something outside the scope', () => {
    const def = linear();
    def.nodes[2] = node('say', 'SEND_WHATSAPP_MESSAGE', { body: 'Token: {{channel.accessToken}}' });
    expect(codes(validate(def), 'error')).toContain('INVALID_TEMPLATE_ROOT');
  });

  it('warns about a variable nothing writes', () => {
    const def = linear();
    def.nodes[2] = node('say', 'SEND_WHATSAPP_MESSAGE', { body: 'Hi {{vars.never_set}}' });
    expect(codes(validate(def), 'warning')).toContain('UNKNOWN_VARIABLE');
  });

  it('accepts a variable an earlier ASK_USER_INPUT writes', () => {
    expect(codes(validate(linear()), 'warning')).not.toContain('UNKNOWN_VARIABLE');
  });
});

describe('capability contract', () => {
  it('rejects a conversation workflow with no contract', () => {
    expect(codes(validate(linear(), { capability: null }), 'error')).toContain('MISSING_CAPABILITY');
  });

  it('rejects too few routing examples', () => {
    const result = validate(linear(), {
      capability: capability({ positiveExamples: ['book me in'], negativeExamples: [] }),
    });
    expect(codes(result, 'error')).toContain('TOO_FEW_POSITIVE_EXAMPLES');
    expect(codes(result, 'error')).toContain('TOO_FEW_NEGATIVE_EXAMPLES');
  });

  it('rejects a side effect with no confirmation — the booking-vs-availability guard', () => {
    // This is the specific failure the whole capability contract exists to
    // prevent: a workflow that creates an appointment being reachable from
    // "is Dr Rao available tomorrow?" without ever confirming.
    const result = validate(linear(), {
      capability: capability({
        sideEffects: ['Creates an appointment record'],
        requiresConfirmation: false,
      }),
    });
    expect(codes(result, 'error')).toContain('SIDE_EFFECT_WITHOUT_CONFIRMATION');
    expect(result.valid).toBe(false);
  });

  it('accepts a side effect when confirmation is required', () => {
    const result = validate(linear(), {
      capability: capability({
        sideEffects: ['Creates an appointment record'],
        requiresConfirmation: true,
      }),
    });
    expect(codes(result, 'error')).toEqual([]);
  });

  it('warns when a side-effecting workflow sets a low confidence bar', () => {
    const result = validate(linear(), {
      capability: capability({
        sideEffects: ['Creates an appointment record'],
        requiresConfirmation: true,
        minimumConfidence: 0.4,
      }),
    });
    expect(codes(result, 'warning')).toContain('LOW_CONFIDENCE_FOR_SIDE_EFFECT');
  });

  it('rejects a duplicate slug', () => {
    const result = validate(linear(), { siblingSlugs: ['appointment_booking'] });
    expect(codes(result, 'error')).toContain('DUPLICATE_SLUG');
  });
});
