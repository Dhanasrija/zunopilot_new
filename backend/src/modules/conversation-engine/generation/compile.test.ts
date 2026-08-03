import { describe, expect, it } from 'vitest';
import { compilePlan } from './compile.js';
import type { PlanStep, WorkflowPlan } from './plan.js';
import { validateWorkflowDefinition } from '../validation/definition-validator.js';

// The compiler is where a model's output stops being suggestions. These tests
// are about what it refuses and what it corrects — the model is not in the
// loop, so they are fast and deterministic.

const step = (over: Partial<PlanStep> & Pick<PlanStep, 'id' | 'kind'>): PlanStep => ({
  title: over.id,
  text: null,
  variable: null,
  inputType: null,
  options: null,
  itemsFrom: null,
  connectorKey: null,
  operationKey: null,
  inputs: null,
  resource: null,
  query: null,
  conditionLeft: null,
  conditionOperator: null,
  conditionRight: null,
  next: null,
  onYes: null,
  onNo: null,
  onError: null,
  ...over,
});

const plan = (steps: PlanStep[], over: Partial<WorkflowPlan> = {}): WorkflowPlan => ({
  name: 'Test flow',
  slug: 'test_flow',
  capability: {
    purpose: 'Do a thing',
    useWhen: ['They want the thing'],
    doNotUseWhen: ['They want something else'],
    positiveExamples: ['a', 'b', 'c'],
    negativeExamples: ['x', 'y'],
    hasSideEffects: false,
  },
  firstStepId: steps[0]?.id ?? '',
  steps,
  openQuestions: [],
  ...over,
});

const CONTEXT = {
  operations: [
    { connectorKey: 'acme_lms', operationKey: 'list_students', sideEffecting: false },
    { connectorKey: 'acme_lms', operationKey: 'cancel_class', sideEffecting: true },
  ],
};

describe('graph construction', () => {
  it('adds the entry node and wires it to the first step', () => {
    const { definition } = compilePlan(plan([step({ id: 'hello', kind: 'say', text: 'Hi' })]), CONTEXT);

    expect(definition.entryNodeId).toBe('entry');
    expect(definition.nodes[0]?.type).toBe('ASSISTANT_ROUTE_ENTRY');
    expect(definition.edges).toContainEqual(
      expect.objectContaining({ source: 'entry', target: 'hello' }),
    );
  });

  it('rewrites unsafe step ids and remaps every reference through them', () => {
    const { definition } = compilePlan(plan([
      step({ id: 'Step One!', kind: 'say', text: 'Hi', next: 'Step Two!' }),
      step({ id: 'Step Two!', kind: 'end' }),
    ], { firstStepId: 'Step One!' }), CONTEXT);

    const ids = definition.nodes.map((n) => n.id);
    expect(ids).toEqual(['entry', 'step_one', 'step_two']);
    expect(definition.edges).toContainEqual(
      expect.objectContaining({ source: 'step_one', target: 'step_two' }),
    );
  });

  it('drops an edge to a step that does not exist rather than inventing one', () => {
    const { definition } = compilePlan(
      plan([step({ id: 'a', kind: 'say', text: 'Hi', next: 'nowhere' })]),
      CONTEXT,
    );
    expect(definition.edges.filter((e) => e.source === 'a')).toHaveLength(0);
  });

  it('gives duplicate ids distinct nodes', () => {
    const { definition } = compilePlan(plan([
      step({ id: 'same', kind: 'say', text: 'One' }),
      step({ id: 'same', kind: 'say', text: 'Two' }),
    ]), CONTEXT);
    expect(new Set(definition.nodes.map((n) => n.id)).size).toBe(3);
  });
});

describe('what it refuses from the model', () => {
  it('blanks an operation that is not registered, and reports it', () => {
    // A plausible-looking substitution would publish and then call the wrong
    // thing. Leaving it blank makes the publish validator stop it.
    const { definition, gaps } = compilePlan(plan([
      step({ id: 'call', kind: 'connector_query', connectorKey: 'acme_lms', operationKey: 'delete_everything' }),
    ]), CONTEXT);

    expect(definition.nodes[1]?.config).toMatchObject({ connectorKey: '', operationKey: '' });
    expect(gaps.join(' ')).toContain('not registered');
  });

  it('splits a dotted key the model packed into one field', () => {
    // Models read `connector.operation` from the prompt as one identifier. The
    // operation it named is real, so the answer is right and only the shape is
    // wrong — correcting that is not the same as guessing.
    const { definition, gaps } = compilePlan(plan([
      step({ id: 'call', kind: 'connector_query', connectorKey: 'acme_lms.list_students' }),
    ]), CONTEXT);

    expect(definition.nodes[1]?.config).toMatchObject({
      connectorKey: 'acme_lms', operationKey: 'list_students',
    });
    expect(gaps).toEqual([]);
  });

  it('trims a fourth button and says so', () => {
    const { definition, gaps } = compilePlan(plan([
      step({
        id: 'pick',
        kind: 'buttons',
        text: 'Which?',
        options: ['a', 'b', 'c', 'd'].map((id) => ({ id, label: id })),
      }),
    ]), CONTEXT);

    expect((definition.nodes[1]?.config as { buttons: unknown[] }).buttons).toHaveLength(3);
    expect(gaps.join(' ')).toContain('three');
  });

  it('falls back to a safe operator rather than accepting an invented one', () => {
    const { definition } = compilePlan(plan([
      step({
        id: 'check', kind: 'condition',
        conditionLeft: '{{vars.x}}', conditionOperator: 'is_approximately', conditionRight: '1',
        onYes: 'check', onNo: 'check',
      }),
    ]), CONTEXT);
    expect(definition.nodes[1]?.config).toMatchObject({ op: 'equals' });
  });
});

describe('template namespacing', () => {
  it('moves a bare variable reference into the vars namespace', () => {
    const { definition } = compilePlan(plan([
      step({ id: 'say_hi', kind: 'say', text: 'Hello {{parent.name}}, order {{order_number}}' }),
    ]), CONTEXT);

    expect(definition.nodes[1]?.config).toMatchObject({
      body: 'Hello {{vars.parent.name}}, order {{vars.order_number}}',
    });
  });

  it('leaves the real scope roots alone', () => {
    const { definition } = compilePlan(plan([
      step({ id: 'say_hi', kind: 'say', text: '{{customer.name}} {{now.date}} {{vars.x}} {{message.text}}' }),
    ]), CONTEXT);

    expect(definition.nodes[1]?.config).toMatchObject({
      body: '{{customer.name}} {{now.date}} {{vars.x}} {{message.text}}',
    });
  });
});

describe('the confirmation rule', () => {
  it('marks a workflow with a write as side-effecting whatever the model said', () => {
    // Not the model's call. If anything writes, the contract has to say so, and
    // the validator then insists on a confirmation step.
    const { capability } = compilePlan(plan([
      step({ id: 'do_it', kind: 'connector_action', connectorKey: 'acme_lms', operationKey: 'cancel_class' }),
    ], { capability: { ...plan([]).capability, hasSideEffects: false } }), CONTEXT);

    expect(capability.requiresConfirmation).toBe(true);
    expect(capability.sideEffects.length).toBeGreaterThan(0);
  });

  it('flags a write with no confirmation step anywhere', () => {
    const { gaps } = compilePlan(plan([
      step({ id: 'do_it', kind: 'connector_action', connectorKey: 'acme_lms', operationKey: 'cancel_class' }),
    ]), CONTEXT);
    expect(gaps.join(' ')).toContain('never asks the customer to confirm');
  });

  it('and the validator agrees — such a graph cannot be published', () => {
    const compiled = compilePlan(plan([
      step({ id: 'do_it', kind: 'connector_action', connectorKey: 'acme_lms', operationKey: 'cancel_class' }),
    ]), CONTEXT);

    const result = validateWorkflowDefinition({
      definition: compiled.definition,
      category: 'CONVERSATION',
      // The contract the compiler produced is honest; the graph is what is
      // wrong, so blocking has to come from somewhere. Clearing the flag is how
      // an author would try to sneak past it.
      capability: { ...compiled.capability, requiresConfirmation: false },
      slug: 'test_flow',
    });

    expect(result.issues.map((i) => i.code)).toContain('SIDE_EFFECT_WITHOUT_CONFIRMATION');
  });
});

describe('a complete plan', () => {
  it('compiles to a graph the publish validator accepts', () => {
    const compiled = compilePlan(plan([
      step({ id: 'lookup', kind: 'connector_query', connectorKey: 'acme_lms', operationKey: 'list_students', variable: 'students_response', itemsFrom: 'students', next: 'pick', onError: 'nope' }),
      step({ id: 'pick', kind: 'list', text: 'Which student?', itemsFrom: 'students', variable: 'student_id', next: 'confirm' }),
      step({ id: 'confirm', kind: 'buttons', text: 'Cancel it?', options: [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }], variable: 'answer', next: 'branch' }),
      step({ id: 'branch', kind: 'condition', conditionLeft: '{{vars.answer}}', conditionOperator: 'equals', conditionRight: 'yes', onYes: 'do_it', onNo: 'finish' }),
      step({ id: 'do_it', kind: 'connector_action', connectorKey: 'acme_lms', operationKey: 'cancel_class', inputs: [{ key: 'class_id', value: '{{vars.student_id}}' }], variable: 'result', next: 'finish', onError: 'nope' }),
      step({ id: 'finish', kind: 'end', text: 'All done.' }),
      step({ id: 'nope', kind: 'handoff', text: 'Let me get someone.' }),
    ], { firstStepId: 'lookup' }), CONTEXT);

    const result = validateWorkflowDefinition({
      definition: compiled.definition,
      category: 'CONVERSATION',
      capability: compiled.capability,
      slug: 'test_flow',
    });

    expect(result.issues.filter((i) => i.level === 'error')).toEqual([]);
    expect(result.valid).toBe(true);
    expect(compiled.gaps).toEqual([]);
  });
});
