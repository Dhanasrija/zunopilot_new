import { z } from 'zod';
import type { Tenant } from '@prisma/client';
import { prisma } from '../../../config/prisma.js';
import { withContext } from '../../../config/logger.js';
import { env } from '../../../config/env.js';
import { llmProvider } from '../providers/llm.js';
import { validateWorkflowDefinition, type ValidationIssue } from '../validation/definition-validator.js';
import { IMPLEMENTED_NODE_TYPES } from '../engine/executors/index.js';
import { DATABASE_RESOURCES, DATABASE_WRITES } from '../domain/node-types.js';
import { workflowPlanSchema, type WorkflowPlan } from './plan.js';
import { compilePlan, type CompiledPlan } from './compile.js';
import { GENERATOR_PROMPT_VERSION, buildGeneratorPrompt } from './prompt.js';

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

export interface GenerationResult {
  plan: WorkflowPlan;
  compiled: CompiledPlan;
  issues: ValidationIssue[];
  model: string;
  latencyMs: number;
  promptVersion: string;
}

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

  const provider = llmProvider();
  const startedAt = Date.now();

  const response = await provider.completeStructured({
    systemPrompt: buildGeneratorPrompt({ tenant, ...context }),
    // Fenced and labelled. The description is written by an operator, but an
    // operator can paste in a customer's message, so it is data either way.
    userPrompt: `--- BEGIN WORKFLOW DESCRIPTION ---\n${description}\n--- END WORKFLOW DESCRIPTION ---`,
    schemaName: 'workflow_plan',
    jsonSchema: toStrictSchema(z.toJSONSchema(workflowPlanSchema, { io: 'input' })) as Record<string, unknown>,
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
      issues: parsed.error.issues.slice(0, 3).map((i) => i.path.join('.')),
    });
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

  logger.info('Workflow generated', {
    steps: parsed.data.steps.length,
    nodes: compiled.definition.nodes.length,
    gaps: compiled.gaps.length,
    errors: validation.issues.filter((i) => i.level === 'error').length,
    latencyMs: Date.now() - startedAt,
  });

  return {
    plan: parsed.data,
    compiled,
    issues: validation.issues,
    model: response.model,
    latencyMs: Date.now() - startedAt,
    promptVersion: GENERATOR_PROMPT_VERSION,
  };
};
