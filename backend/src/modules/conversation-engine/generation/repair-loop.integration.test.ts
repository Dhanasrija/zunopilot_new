import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Tenant } from '@prisma/client';
import { prisma } from '../../../config/prisma.js';
import { setLlmProvider } from '../providers/llm.js';
import type { LLMProvider, StructuredRequest, StructuredResponse } from '../providers/llm.js';
import { GenerationFailedError, generateWorkflow } from './generate.js';
import type { PlanStep, WorkflowPlan } from './plan.js';

// The bounded repair loop.
//
// Driven by a **scripted provider** rather than a real model, because the property
// under test is the loop's control flow — how many times it asks, which answer it
// keeps, what it does when asked to give up — and a real model would make every one
// of those non-deterministic. What the model actually produces is the end-to-end
// check, not this.
//
// It is an integration test regardless: `generateWorkflow` reads the tenant's
// connectors and catalogue out of Postgres to build the prompt.

const TENANT = '77777777-7777-7777-7777-777777777773';

/** A plan step with every nullable field filled in, as strict mode requires. */
const step = (over: Partial<PlanStep> & Pick<PlanStep, 'id' | 'kind' | 'title'>): PlanStep => ({
  text: null, variable: null, inputType: null, options: null, itemsFrom: null,
  connectorKey: null, operationKey: null, inputs: null, resource: null, query: null,
  conditionLeft: null, conditionOperator: null, conditionRight: null,
  next: null, onYes: null, onNo: null, onError: null,
  ...over,
});

const plan = (steps: PlanStep[], firstStepId: string): WorkflowPlan => ({
  name: 'Scripted flow',
  slug: 'scripted_flow',
  capability: {
    purpose: 'Tell the customer their opening hours',
    useWhen: ['asks about timings', 'wants to know if we are open'],
    doNotUseWhen: ['wants to place an order', 'wants to cancel'],
    positiveExamples: ['what time do you open', 'are you open now', 'timings please'],
    negativeExamples: ['I want two biryanis', 'cancel my order'],
    hasSideEffects: false,
  },
  firstStepId,
  steps,
  openQuestions: [],
});

// The `end` step matters: a `say` with `next: null` is a DEAD_END, which is itself
// a generation blocker. Both fixtures below terminate properly so that the only
// difference between them is reachability — otherwise the counts these tests assert
// would be measuring two faults at once.
/** Reaches its steps and stops cleanly. No blocking issues at all. */
const cleanPlan = () => plan([
  step({
    id: 'greet', kind: 'say', title: 'Say the hours',
    text: 'We are open 11am to 11pm.', next: 'stop',
  }),
  step({ id: 'stop', kind: 'end', title: 'Done' }),
], 'greet');

/** Same, plus `orphans` islands nothing links to — one `UNREACHABLE_NODE` each. */
const orphanPlan = (orphans = 1) => plan([
  step({
    id: 'greet', kind: 'say', title: 'Say the hours',
    text: 'We are open 11am to 11pm.', next: 'stop',
  }),
  step({ id: 'stop', kind: 'end', title: 'Done' }),
  ...Array.from({ length: orphans }, (_, i) => step({
    id: `orphan${i}`, kind: 'say', title: `Orphan ${i}`,
    text: 'Nothing links here.', next: 'stop',
  })),
], 'greet');

/** Records every request and replies from a script. */
class ScriptedProvider implements LLMProvider {
  readonly name = 'scripted';
  readonly requests: StructuredRequest[] = [];

  constructor(private readonly script: unknown[]) {}

  async completeStructured(request: StructuredRequest): Promise<StructuredResponse> {
    this.requests.push(request);
    const data = this.script[Math.min(this.requests.length - 1, this.script.length - 1)];
    return { data, model: 'scripted-1', tokenUsage: {}, latencyMs: 1 };
  }

  // `generateWorkflow` only ever calls completeStructured; the rest of the
  // interface exists for the router.
  async complete(): Promise<never> { throw new Error('not used by generation'); }
}

let tenant: Tenant;

beforeEach(async () => {
  await prisma.tenant.deleteMany({ where: { id: TENANT } });
  tenant = await prisma.tenant.create({
    data: { id: TENANT, businessName: 'Repair Loop Kitchen', category: 'RESTAURANT' },
  });
});

afterEach(() => {
  setLlmProvider(null);
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: TENANT } });
  await prisma.$disconnect();
});

const generate = () => generateWorkflow({ tenant, description: 'Tell people our opening hours.' });

describe('when the first plan is usable', () => {
  it('**asks once and records no repairs**', async () => {
    // The cost claim. Nothing about this feature may add a model call to the happy
    // path — most generations are fine and must stay one request.
    const provider = new ScriptedProvider([cleanPlan()]);
    setLlmProvider(provider);

    const result = await generate();

    expect(provider.requests).toHaveLength(1);
    expect(result.repairs).toEqual([]);
    expect(result.unresolved).toEqual([]);
  });
});

describe('when the first plan cannot work', () => {
  it('**asks again and keeps the answer that fixed it**', async () => {
    const provider = new ScriptedProvider([orphanPlan(), cleanPlan()]);
    setLlmProvider(provider);

    const result = await generate();

    expect(provider.requests).toHaveLength(2);
    expect(result.repairs).toHaveLength(1);
    expect(result.repairs[0].attempt).toBe(1);
    expect(result.repairs[0].issues.map((i) => i.code)).toContain('UNREACHABLE_NODE');
    // The draft handed over is the repaired one.
    expect(result.unresolved).toEqual([]);
    expect(result.compiled.definition.nodes.some((n) => n.id === 'orphan0')).toBe(false);
  });

  it('**names the failing steps in the repair prompt**', async () => {
    const provider = new ScriptedProvider([orphanPlan(2), cleanPlan()]);
    setLlmProvider(provider);

    await generate();

    const repairPrompt = provider.requests[1].userPrompt;
    expect(repairPrompt).toContain('UNREACHABLE_NODE');
    expect(repairPrompt).toContain('orphan0');
    expect(repairPrompt).toContain('orphan1');
    // Still carries the original description — it asks for a whole new plan.
    expect(repairPrompt).toContain('Tell people our opening hours.');
  });

  it('**reuses a byte-identical system prompt**, so the cache still hits', async () => {
    // The repair feedback goes on the user prompt for exactly this reason. The
    // system prompt is the larger half and it is rebuilt per attempt otherwise.
    const provider = new ScriptedProvider([orphanPlan(), cleanPlan()]);
    setLlmProvider(provider);

    await generate();

    expect(provider.requests[1].systemPrompt).toBe(provider.requests[0].systemPrompt);
  });
});

describe('when it cannot be fixed', () => {
  it('**stops after two repairs rather than looping**', async () => {
    // Three calls total, and a person is watching a spinner for all of them.
    const provider = new ScriptedProvider([orphanPlan()]); // always broken
    setLlmProvider(provider);

    const result = await generate();

    expect(provider.requests).toHaveLength(3);
    expect(result.repairs).toHaveLength(2);
  });

  it('**hands the draft over with what is still wrong attached**', async () => {
    const provider = new ScriptedProvider([orphanPlan()]);
    setLlmProvider(provider);

    const result = await generate();

    // Saved, not thrown away — and honest about why it is not publishable.
    expect(result.unresolved.map((i) => i.code)).toContain('UNREACHABLE_NODE');
    expect(result.compiled.definition.nodes.length).toBeGreaterThan(0);
  });

  it('**keeps the closest attempt, not the last one**', async () => {
    // A repair turn is not guaranteed to improve anything. Handing back a worse
    // third attempt because it happened to be last would waste the better one.
    const provider = new ScriptedProvider([orphanPlan(1), orphanPlan(5), orphanPlan(9)]);
    setLlmProvider(provider);

    const result = await generate();

    expect(result.unresolved).toHaveLength(1);
    expect(result.compiled.definition.nodes.some((n) => n.id === 'orphan4')).toBe(false);
  });
});

describe('when the provider returns something unusable', () => {
  it('fails outright if the very first answer does not match the schema', async () => {
    setLlmProvider(new ScriptedProvider([{ nonsense: true }]));
    await expect(generate()).rejects.toBeInstanceOf(GenerationFailedError);
  });

  it('**keeps a usable earlier draft when a repair turn returns nonsense**', async () => {
    // "Try describing it again" is the wrong answer when a draft is already in
    // hand — it throws away work the operator can act on.
    const provider = new ScriptedProvider([orphanPlan(), { nonsense: true }]);
    setLlmProvider(provider);

    const result = await generate();

    expect(result.unresolved.map((i) => i.code)).toContain('UNREACHABLE_NODE');
    expect(result.repairs).toHaveLength(1);
  });
});
