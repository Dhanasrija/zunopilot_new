import { z } from 'zod';
import type { Tenant } from '@prisma/client';
import { prisma } from '../../../config/prisma.js';
import { withContext } from '../../../config/logger.js';
import { env } from '../../../config/env.js';
import { authoringProvider } from '../providers/llm.js';
import { validateWorkflowDefinition, type ValidationIssue } from '../validation/definition-validator.js';
import { IMPLEMENTED_NODE_TYPES } from '../engine/executors/index.js';
import { DATABASE_RESOURCES, DATABASE_WRITES } from '../domain/node-types.js';
import { workflowPlanSchema, type WorkflowPlan } from './plan.js';
import { compilePlan, type CompiledPlan } from './compile.js';
import { GENERATOR_PROMPT_VERSION, buildGeneratorPrompt } from './prompt.js';
import { blockingIssues, repairInstruction } from './blockers.js';

// Prompt → workflow.
//
// The model plans; code compiles, validates and reports the gaps. It is the
// same division as the router: the model chooses among things that exist, and
// nothing it returns is trusted to be well-formed.
//
// The output is always a DRAFT. Generation is a starting point for someone to
// review, not a way to put a graph in front of customers without a human ever
// having read it.

/** Strict-mode JSON Schema, derived from the plan's Zod schema so the two cannot drift. */
const toStrictSchema = (input: unknown): unknown => {
  if (Array.isArray(input)) return input.map(toStrictSchema);
  if (!input || typeof input !== 'object') return input;

  const schema = { ...(input as Record<string, unknown>) };
  delete schema.$schema;
  delete schema.propertyNames;
  delete schema.default;

  if (schema.properties && typeof schema.properties === 'object') {
    const properties = schema.properties as Record<string, unknown>;
    schema.properties = Object.fromEntries(
      Object.entries(properties).map(([key, value]) => [key, toStrictSchema(value)]),
    );
    schema.required = Object.keys(properties);
    schema.additionalProperties = false;
  }
  if (schema.items) schema.items = toStrictSchema(schema.items);
  for (const key of ['anyOf', 'oneOf', 'allOf'] as const) {
    if (Array.isArray(schema[key])) schema[key] = (schema[key] as unknown[]).map(toStrictSchema);
  }
  return schema;
};

export interface RepairAttempt {
  /** 1-based: attempt 1 is the first *re*-try, so a clean first pass records none. */
  attempt: number;
  /** The blocking issues this attempt was asked to fix. */
  issues: ValidationIssue[];
}

export interface GenerationResult {
  plan: WorkflowPlan;
  compiled: CompiledPlan;
  issues: ValidationIssue[];
  /** What each repair turn was asked to fix. Empty when the first plan was usable. */
  repairs: RepairAttempt[];
  /**
   * Blocking issues still standing after the last attempt.
   *
   * Empty is the good case. Non-empty means the loop gave up, and the draft is saved
   * with these attached rather than handed over as if it were fine.
   */
  unresolved: ValidationIssue[];
  model: string;
  latencyMs: number;
  promptVersion: string;
}

/**
 * How many times to hand the problems back.
 *
 * Two, and bounded for a reason a limit like this usually is not: the caller is a
 * person watching a spinner. Three model calls at `generationTimeoutMs` each is
 * already the outer edge of what a synchronous request can spend, and a model that
 * has failed the same check twice is not converging.
 */
const MAX_REPAIR_ATTEMPTS = 2;

export class GenerationFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GenerationFailedError';
  }
}

/** What the model is told exists. Nothing outside this may be referenced. */
export const generationContext = async (tenantId: string) => {
  const [connectors, menuItems] = await Promise.all([
    prisma.connector.findMany({
      where: { tenantId, status: 'ACTIVE' },
      select: {
        key: true,
        name: true,
        operations: {
          select: { key: true, name: true, description: true, inputs: true, sideEffecting: true },
        },
      },
    }),
    prisma.menuItem.count({ where: { tenantId, inStock: true } }),
  ]);

  const operations = connectors.flatMap((connector) => connector.operations.map((operation) => ({
    connectorKey: connector.key,
    connectorName: connector.name,
    operationKey: operation.key,
    name: operation.name,
    description: operation.description,
    inputs: (operation.inputs as Array<{ key: string; label: string; required: boolean }> | null) ?? [],
    sideEffecting: operation.sideEffecting,
  })));

  return {
    operations,
    hasCatalogue: menuItems > 0,
    databaseResources: [...DATABASE_RESOURCES],
    databaseWrites: [...DATABASE_WRITES],
    nodeTypes: IMPLEMENTED_NODE_TYPES,
  };
};

export const generateWorkflow = async ({
  tenant, description,
}: {
  tenant: Tenant;
  description: string;
}): Promise<GenerationResult> => {
  const logger = withContext({ tenantId: tenant.id });
  const context = await generationContext(tenant.id);

  /*
   * **Always OpenAI, whatever this workspace is pinned to** — see `authoringProvider`.
   *
   * Generating a whole node graph against a strict schema is not the job a per-workspace vendor is
   * chosen for, and it is the one place where losing `json_schema` strict mode costs a visible retry
   * rather than a duller answer.
   */
  const provider = authoringProvider();
  const startedAt = Date.now();

  // Byte-identical across every attempt, so the cache keeps hitting on the larger
  // half of the request. The repair feedback goes on the user prompt instead.
  const systemPrompt = buildGeneratorPrompt({ tenant, ...context });
  // Fenced and labelled. The description is written by an operator, but an
  // operator can paste in a customer's message, so it is data either way.
  const basePrompt = `--- BEGIN WORKFLOW DESCRIPTION ---\n${description}\n--- END WORKFLOW DESCRIPTION ---`;
  const jsonSchema = toStrictSchema(
    z.toJSONSchema(workflowPlanSchema, { io: 'input' }),
  ) as Record<string, unknown>;

  interface Candidate {
    plan: WorkflowPlan;
    compiled: CompiledPlan;
    issues: ValidationIssue[];
    blocking: ValidationIssue[];
    model: string;
  }

  const repairs: RepairAttempt[] = [];
  /**
   * The best answer so far — fewest blocking issues, earliest on a tie.
   *
   * Keeping the *last* attempt would be wrong: a repair turn is not guaranteed to
   * improve anything, and a model handed "fix these eight unreachable nodes" can
   * come back with a differently-broken graph. If neither attempt is clean, the
   * operator should get whichever is closest to working.
   */
  let best: Candidate | null = null;

  for (let attempt = 0; ; attempt += 1) {
    const response = await provider.completeStructured({
      systemPrompt,
      userPrompt: attempt === 0
        ? basePrompt
        : basePrompt + repairInstruction(repairs[attempt - 1].issues),
      schemaName: 'workflow_plan',
      jsonSchema,
      temperature: 0.2,
      maxTokens: 4000,
      // Authoring, not answering — a person clicked a button and will wait.
      timeoutMs: env.generationTimeoutMs,
    });

    const parsed = workflowPlanSchema.safeParse(response.data);
    if (!parsed.success) {
      // Constrained decoding should make this impossible; if it happens the model
      // or the provider is misbehaving, and half-parsing the result would be
      // worse than saying so.
      logger.error('Generated plan did not match its own schema', {
        attempt,
        issues: parsed.error.issues.slice(0, 3).map((i) => i.path.join('.')),
      });
      // On a repair turn, a schema miss must not throw away a plan we already
      // have. Stop asking and hand over the best attempt with its problems
      // attached — that is strictly more useful than "try describing it again"
      // when a usable draft is already in hand.
      if (best) break;
      throw new GenerationFailedError('The generated plan was not usable. Try describing it again.');
    }

    const compiled = compilePlan(parsed.data, { operations: context.operations });

    // The same validator a publish runs. What it says here is exactly what will
    // block publishing later, so the author fixes real problems rather than
    // problems a second, drifting copy of the rules invented.
    const validation = validateWorkflowDefinition({
      definition: compiled.definition,
      category: 'CONVERSATION',
      capability: compiled.capability,
      slug: parsed.data.slug,
    });

    const blocking = blockingIssues(validation.issues);
    const candidate: Candidate = {
      plan: parsed.data,
      compiled,
      issues: validation.issues,
      blocking,
      model: response.model,
    };
    if (!best || blocking.length < best.blocking.length) best = candidate;

    if (!blocking.length) break;
    if (attempt >= MAX_REPAIR_ATTEMPTS) break;

    logger.info('Generated plan is not usable — asking for a repair', {
      attempt: attempt + 1,
      blocking: blocking.length,
      codes: [...new Set(blocking.map((i) => i.code))],
    });
    repairs.push({ attempt: attempt + 1, issues: blocking });
  }

  // Unreachable in practice: the loop either sets `best` or throws on the first
  // attempt. Asserted rather than non-null-asserted so a future edit that adds a
  // `continue` cannot turn this into a confusing property access on undefined.
  if (!best) throw new GenerationFailedError('The generated plan was not usable. Try describing it again.');

  logger.info('Workflow generated', {
    steps: best.plan.steps.length,
    nodes: best.compiled.definition.nodes.length,
    gaps: best.compiled.gaps.length,
    errors: best.issues.filter((i) => i.level === 'error').length,
    repairs: repairs.length,
    unresolved: best.blocking.length,
    latencyMs: Date.now() - startedAt,
  });

  return {
    plan: best.plan,
    compiled: best.compiled,
    issues: best.issues,
    repairs,
    unresolved: best.blocking,
    model: best.model,
    latencyMs: Date.now() - startedAt,
    promptVersion: GENERATOR_PROMPT_VERSION,
  };
};
