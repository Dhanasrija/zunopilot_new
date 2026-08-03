import { z } from 'zod';
import { capabilityContractSchema } from '../domain/capability.js';
import { workflowDefinitionSchema } from '../domain/definition.js';
import { ROUTER_DECISIONS } from '../routing/contract.js';

// Request schemas for the conversation-engine API.
//
// Zod rather than express-validator throughout this module: the payloads are
// nested documents (a node graph, a capability contract) that express-validator
// cannot describe, and these are the same schemas the engine validates against
// internally — so a request that parses here cannot fail deeper down.

export const idParam = z.object({ id: z.uuid('Not a valid id') });

export const assistantIdParam = z.object({ assistantId: z.uuid('Not a valid assistant id') });

export const workflowIdParam = z.object({ workflowId: z.uuid('Not a valid workflow id') });

export const instanceIdParam = z.object({ instanceId: z.uuid('Not a valid instance id') });

// ── Assistants ────────────────────────────────────────────────────────────────

export const updateAssistantSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(1000).nullish(),
  generalSystemPrompt: z.string().trim().max(4000).nullish(),
  generalResponseEnabled: z.boolean().optional(),
  status: z.enum(['DRAFT', 'ACTIVE', 'PAUSED']).optional(),
}).refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });

export const updateRoutingConfigSchema = z.object({
  highConfidenceThreshold: z.number().min(0).max(1).optional(),
  mediumConfidenceThreshold: z.number().min(0).max(1).optional(),
  maxRecentMessages: z.number().int().min(0).max(50).optional(),
  generalResponseEnabled: z.boolean().optional(),
  defaultFallbackWorkflowId: z.uuid().nullish(),
  humanHandoffWorkflowId: z.uuid().nullish(),
}).refine(
  (v) => v.highConfidenceThreshold === undefined
    || v.mediumConfidenceThreshold === undefined
    || v.highConfidenceThreshold >= v.mediumConfidenceThreshold,
  {
    // Inverted thresholds would make the clarification band empty and every
    // medium-confidence match start a workflow — exactly backwards.
    message: 'The high-confidence threshold must be at or above the clarification threshold',
    path: ['highConfidenceThreshold'],
  },
);

// ── Workflows ─────────────────────────────────────────────────────────────────

const slugSchema = z.string()
  .trim()
  .min(2)
  .max(64)
  .regex(/^[a-z][a-z0-9_]*$/, 'Use lower_snake_case, starting with a letter');

export const createWorkflowSchema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: slugSchema.optional(),
  description: z.string().trim().max(1000).nullish(),
  category: z.enum(['CONVERSATION', 'EVENT']).default('CONVERSATION'),
  priority: z.number().int().min(0).max(100).default(50),
  /** A conversation workflow needs its contract up front — see the validator. */
  capability: capabilityContractSchema.optional(),
  definition: workflowDefinitionSchema.optional(),
});

export const updateWorkflowSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  slug: slugSchema.optional(),
  description: z.string().trim().max(1000).nullish(),
  priority: z.number().int().min(0).max(100).optional(),
  status: z.enum(['DRAFT', 'ARCHIVED']).optional(),
}).refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });

export const listWorkflowsQuery = z.object({
  status: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']).optional(),
  category: z.enum(['CONVERSATION', 'EVENT']).optional(),
  search: z.string().trim().max(120).optional(),
});

export const putCapabilitySchema = capabilityContractSchema;

export const createFromTemplateSchema = z.object({
  templateId: z.string().min(1),
  /** Override the template's suggested name and slug. */
  name: z.string().trim().min(1).max(120).optional(),
  slug: slugSchema.optional(),
});

export const createVersionSchema = z.object({
  definition: workflowDefinitionSchema,
});

export const validateWorkflowSchema = z.object({
  /** Omit to validate the current draft version. */
  definition: workflowDefinitionSchema.optional(),
});

export const publishWorkflowSchema = z.object({
  /** Omit to publish the newest version. */
  versionId: z.uuid().optional(),
});

// ── Routing ───────────────────────────────────────────────────────────────────

export const routeTestSchema = z.object({
  message: z.string().trim().min(1).max(2000),
  /** Reuse an existing thread's context instead of routing in isolation. */
  conversationId: z.uuid().optional(),
});

export const createRoutingTestSchema = z.object({
  message: z.string().trim().min(1).max(2000),
  expectedDecision: z.enum(ROUTER_DECISIONS),
  expectedWorkflowId: z.uuid().nullish(),
  notes: z.string().trim().max(500).nullish(),
});

export const createRoutingRuleSchema = z.object({
  name: z.string().trim().min(1).max(120),
  type: z.enum([
    'BUTTON_PAYLOAD', 'LIST_PAYLOAD', 'KEYWORD',
    'CUSTOMER_TAG', 'BUSINESS_HOURS', 'CRM_STATE', 'COMMAND',
  ]),
  configuration: z.record(z.string(), z.unknown()),
  workflowId: z.uuid().nullish(),
  priority: z.number().int().min(0).max(100).default(50),
  enabled: z.boolean().default(true),
});

export const updateRoutingRuleSchema = createRoutingRuleSchema.partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });

// ── Execution ─────────────────────────────────────────────────────────────────

export const testWorkflowSchema = z.object({
  message: z.string().trim().max(2000).default(''),
  /** Seed variables as if the router had extracted them. */
  inputs: z.record(z.string(), z.string()).default({}),
  /**
   * Suppress every external side effect. Defaults to true: a test run that
   * silently books a real appointment is a much worse surprise than one that
   * does nothing.
   */
  dryRun: z.boolean().default(true),
});

export const simulatorReplySchema = z.object({
  message: z.string().trim().min(1).max(2000),
  dryRun: z.boolean().default(true),
});

export const cancelInstanceSchema = z.object({
  reason: z.string().trim().max(300).default('Cancelled by an operator'),
});

export const handoffSchema = z.object({
  reason: z.string().trim().min(1).max(300),
  assignedUserId: z.uuid().nullish(),
});

export const listInstancesQuery = z.object({
  status: z.enum([
    'PENDING', 'RUNNING', 'WAITING_FOR_USER', 'WAITING_FOR_APPROVAL',
    'PAUSED', 'COMPLETED', 'CANCELLED', 'FAILED',
  ]).optional(),
  workflowId: z.uuid().optional(),
  conversationId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
