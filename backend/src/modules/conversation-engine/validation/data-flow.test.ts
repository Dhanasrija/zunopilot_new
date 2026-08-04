import { describe, expect, it } from 'vitest';
import { validateWorkflowDefinition, type ValidationIssue } from './definition-validator.js';

// The three data-flow checks.
//
// Written after a generated draft got every edge plausible and every variable wrong. Each of
// these caught a fault that survived validation, reached a published workflow, and answered a
// real WhatsApp number — so each test states the consequence, not just the rule.
//
// The important negative is at the bottom: a person who parks a node or compares a body on
// purpose must still only be warned. These checks exist to stop a *generator* shipping a graph
// that cannot work, not to take decisions away from an author.

// Only the fields these checks read. Cast at the call site rather than building a whole
// contract: the validator's capability section is covered by its own suite, and a full fixture
// here would be noise that has to be maintained alongside the schema.
const capability = {
  purpose: 'Cancel a class for a parent',
  positiveExamples: ['cancel my class', 'I want to cancel', 'drop tomorrow'],
  negativeExamples: ['what are your timings', 'I want to enrol'],
  // `sideEffects` is a list of phrases, not a boolean — and `requiresConfirmation` must be
  // true alongside it or every fixture trips SIDE_EFFECT_WITHOUT_CONFIRMATION instead of the
  // check under test.
  sideEffects: ['cancels a scheduled class'],
  requiresConfirmation: true,
};

/** A minimal runnable graph, with nodes and edges the caller wants layered on. */
const graph = (
  nodes: Array<Record<string, unknown>>,
  edges: Array<{ source: string; target: string; sourceHandle?: string }>,
) => ({
  entryNodeId: 'entry',
  nodes: [
    { id: 'entry', type: 'ASSISTANT_ROUTE_ENTRY', name: 'Start', config: {}, position: { x: 0, y: 0 } },
    ...nodes,
    { id: 'done', type: 'END_WORKFLOW', name: 'Done', config: {}, position: { x: 0, y: 900 } },
  ],
  edges: edges.map((e) => ({ id: `${e.source}->${e.target}:${e.sourceHandle ?? 'next'}`, ...e })),
});

const check = (definition: unknown): ValidationIssue[] =>
  validateWorkflowDefinition({
    definition,
    category: 'CONVERSATION',
    capability: capability as never,
    slug: 'x',
    siblingSlugs: [],
  }).issues;

const codes = (issues: ValidationIssue[]) => issues.map((i) => i.code);
const find = (issues: ValidationIssue[], code: string) => issues.find((i) => i.code === code);

const query = (id: string, extra: Record<string, unknown> = {}) => ({
  id, type: 'CONNECTOR_QUERY', name: 'Fetch', position: { x: 0, y: 100 },
  config: { connectorKey: 'lms', operationKey: 'students', outputVariable: 'parent', ...extra },
});

const list = (id: string, itemsVariable: string | undefined) => ({
  id, type: 'LIST_MESSAGE', name: 'Choose', position: { x: 0, y: 200 },
  config: {
    body: 'Pick one', source: 'variable', rows: [], buttonLabel: 'Choose',
    variableName: 'chosen', ...(itemsVariable === undefined ? {} : { itemsVariable }),
  },
});

describe('a list rendering from a variable nothing fills', () => {
  it('**is an error when no node writes those rows**', () => {
    // The engine reports this at runtime as "No rows to show" — in a customer's conversation,
    // not in a form. It is knowable here.
    const issues = check(graph(
      [query('q'), list('l', 'students')],
      [{ source: 'entry', target: 'q' }, { source: 'q', target: 'l', sourceHandle: 'success' },
        { source: 'l', target: 'done' }],
    ));
    const issue = find(issues, 'LIST_ITEMS_VARIABLE_UNWRITTEN');
    expect(issue?.level).toBe('error');
    expect(issue?.nodeId).toBe('l');
    expect(issue?.message).toMatch(/No node writes rows into "students"/);
  });

  it('passes once the connector actually stores them', () => {
    const issues = check(graph(
      [query('q', { itemsVariable: 'students' }), list('l', 'students')],
      [{ source: 'entry', target: 'q' }, { source: 'q', target: 'l', sourceHandle: 'success' },
        { source: 'l', target: 'done' }],
    ));
    expect(codes(issues)).not.toContain('LIST_ITEMS_VARIABLE_UNWRITTEN');
  });

  it('**says so when the variable holds a whole body rather than rows**', () => {
    // The generated draft's exact mistake, twice: reading the connector's `outputVariable`,
    // which is the entire response, where a list wants normalised rows. Naming the difference
    // is the whole value of the message.
    const issues = check(graph(
      [query('q'), list('l', 'parent')],
      [{ source: 'entry', target: 'q' }, { source: 'q', target: 'l', sourceHandle: 'success' },
        { source: 'l', target: 'done' }],
    ));
    expect(find(issues, 'LIST_ITEMS_VARIABLE_UNWRITTEN')?.message)
      .toMatch(/holds a whole response body, not rows/);
  });

  it('is an error when it names no variable at all', () => {
    const issues = check(graph(
      [query('q'), list('l', undefined)],
      [{ source: 'entry', target: 'q' }, { source: 'q', target: 'l', sourceHandle: 'success' },
        { source: 'l', target: 'done' }],
    ));
    expect(find(issues, 'LIST_ITEMS_VARIABLE_UNWRITTEN')?.message).toMatch(/names none/);
  });
});

describe('a confirmation that gates nothing', () => {
  const buttons = (id: string) => ({
    id, type: 'BUTTON_MESSAGE', name: 'Confirm', position: { x: 0, y: 300 },
    config: {
      body: 'Shall I go ahead?', variableName: 'confirmation',
      buttons: [{ id: 'yes_confirm', title: 'Yes, confirm' }, { id: 'keep_it', title: 'Keep it' }],
    },
  });
  const action = (id: string) => ({
    id, type: 'CONNECTOR_ACTION', name: 'Cancel the class', position: { x: 0, y: 500 },
    config: { connectorKey: 'lms', operationKey: 'cancel', outputVariable: 'result' },
  });
  const gate = (id: string) => ({
    id, type: 'CONDITION', name: 'Did they agree?', position: { x: 0, y: 400 },
    config: { op: 'equals', left: '{{vars.confirmation}}', right: 'yes_confirm' },
  });

  it('**is an error when the action runs whichever button is tapped**', () => {
    // "Keep it" cancelled the class. The buttons were rendered and then ignored, which is the
    // worst kind of bug: it looks like a safeguard.
    const issues = check(graph(
      [buttons('b'), action('a')],
      [{ source: 'entry', target: 'b' }, { source: 'b', target: 'a' },
        { source: 'a', target: 'done', sourceHandle: 'success' }],
    ));
    const issue = find(issues, 'CONFIRMATION_NOT_BRANCHED');
    expect(issue?.level).toBe('error');
    expect(issue?.nodeId).toBe('b');
    expect(issue?.message).toMatch(/declining still acts/);
  });

  it('**passes when a condition reads the stored choice** — one edge is fine', () => {
    // The rule is deliberately not "has one outgoing edge": a BUTTON_MESSAGE legitimately has
    // one, because the branching belongs to the CONDITION that follows it. This is the correct
    // shape and must not be flagged.
    const issues = check(graph(
      [buttons('b'), gate('g'), action('a')],
      [{ source: 'entry', target: 'b' }, { source: 'b', target: 'g' },
        { source: 'g', target: 'a', sourceHandle: 'yes' },
        { source: 'g', target: 'done', sourceHandle: 'no' },
        { source: 'a', target: 'done', sourceHandle: 'success' }],
    ));
    expect(codes(issues)).not.toContain('CONFIRMATION_NOT_BRANCHED');
  });

  it('is not flagged when nothing irreversible follows at all', () => {
    const issues = check(graph(
      [buttons('b')],
      [{ source: 'entry', target: 'b' }, { source: 'b', target: 'done' }],
    ));
    expect(codes(issues)).not.toContain('CONFIRMATION_NOT_BRANCHED');
  });
});

describe('a condition comparing a whole response body', () => {
  it('warns, because it can never match', () => {
    // `readPath` stringifies an object, so `{{vars.result}} equals "success"` is false however
    // well the call went — the generated draft told every parent "too late to cancel" moments
    // after cancelling their class.
    const issues = check(graph(
      [query('q'), {
        id: 'c', type: 'CONDITION', name: 'Worked?', position: { x: 0, y: 300 },
        config: { op: 'equals', left: '{{vars.parent}}', right: 'success' },
      }],
      [{ source: 'entry', target: 'q' }, { source: 'q', target: 'c', sourceHandle: 'success' },
        { source: 'c', target: 'done', sourceHandle: 'yes' },
        { source: 'c', target: 'done', sourceHandle: 'no' }],
    ));
    expect(find(issues, 'CONDITION_COMPARES_WHOLE_BODY')?.message)
      .toMatch(/entire response body/);
  });

  it('passes when a field is read out of it', () => {
    const issues = check(graph(
      [query('q'), {
        id: 'c', type: 'CONDITION', name: 'Worked?', position: { x: 0, y: 300 },
        config: { op: 'equals', left: '{{vars.parent.Status}}', right: '1' },
      }],
      [{ source: 'entry', target: 'q' }, { source: 'q', target: 'c', sourceHandle: 'success' },
        { source: 'c', target: 'done', sourceHandle: 'yes' },
        { source: 'c', target: 'done', sourceHandle: 'no' }],
    ));
    expect(codes(issues)).not.toContain('CONDITION_COMPARES_WHOLE_BODY');
  });

  it('**stays a warning, so a person can still publish it**', () => {
    // The load-bearing distinction in all of this. An author comparing a body may be testing
    // for emptiness and know exactly what they are doing; a generator doing it has made a
    // mistake. Same code, different meaning — which is why the *generator* treats this as
    // disqualifying and validation does not.
    const issues = check(graph(
      [query('q'), {
        id: 'c', type: 'CONDITION', name: 'Worked?', position: { x: 0, y: 300 },
        config: { op: 'is_not_empty', left: '{{vars.parent}}', right: '' },
      }],
      [{ source: 'entry', target: 'q' }, { source: 'q', target: 'c', sourceHandle: 'success' },
        { source: 'c', target: 'done', sourceHandle: 'yes' },
        { source: 'c', target: 'done', sourceHandle: 'no' }],
    ));
    expect(find(issues, 'CONDITION_COMPARES_WHOLE_BODY')?.level).toBe('warning');
    expect(issues.some((i) => i.level === 'error')).toBe(false);
  });
});
