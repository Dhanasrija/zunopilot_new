import { z } from 'zod';

// What the model is allowed to emit.
//
// Not a WorkflowDefinition. The model produces a *plan* — a flat list of steps
// in a closed vocabulary — and code compiles that into a definition. Three
// reasons, in order of how much they matter:
//
//   1. A definition's `config` is `z.record(string, unknown)`, and OpenAI
//      strict mode compiles an open map to `propertyNames`, which it rejects.
//      The real schema is literally not expressible as a constrained output.
//   2. The model should choose *what happens*, not construct edges, handles and
//      node ids. Every graph invariant the compiler maintains is one the model
//      cannot get wrong.
//   3. A plan is reviewable. When something is missing, the gap is a named step
//      field rather than a malformed graph.
//
// Everything here is a single closed object with nullable fields rather than a
// discriminated union. Unions are legal in strict mode but every extra degree
// of freedom is another way for a generation to be structurally valid and
// semantically wrong; one flat shape narrows in code, where the rules live.

export const PLAN_STEP_KINDS = [
  'say',
  'ask',
  'list',
  'buttons',
  'connector_query',
  'connector_action',
  'db_lookup',
  'db_write',
  'condition',
  'handoff',
  'end',
] as const;

export type PlanStepKind = (typeof PLAN_STEP_KINDS)[number];

export const planStepSchema = z.object({
  /** Short slug, unique in the plan. Becomes the node id. */
  id: z.string(),
  kind: z.enum(PLAN_STEP_KINDS),
  /** Label on the canvas. */
  title: z.string(),

  /** Message body or question text. Null for steps that say nothing. */
  text: z.string().nullable(),
  /** Where an answer or a result is stored. */
  variable: z.string().nullable(),
  /** For `ask`: one of string, number, date, email, phone. */
  inputType: z.string().nullable(),

  /** For `buttons`, and for a `list` with fixed rows. */
  options: z.array(z.object({ id: z.string(), label: z.string() })).nullable(),
  /** For `list`: the variable holding rows a previous step fetched. */
  itemsFrom: z.string().nullable(),

  /** For connector steps. Must be one of the operations offered in the prompt. */
  connectorKey: z.string().nullable(),
  operationKey: z.string().nullable(),
  inputs: z.array(z.object({ key: z.string(), value: z.string() })).nullable(),

  /** For db steps: a named resource or write, from the offered list. */
  resource: z.string().nullable(),
  /** Order number or search term for a db step. */
  query: z.string().nullable(),

  /** For `condition`. */
  conditionLeft: z.string().nullable(),
  conditionOperator: z.string().nullable(),
  conditionRight: z.string().nullable(),

  /** Step id to run next, or null to stop. */
  next: z.string().nullable(),
  /** For `condition`: where each answer goes. */
  onYes: z.string().nullable(),
  onNo: z.string().nullable(),
  /** For steps that can fail: connector, db and list steps. */
  onError: z.string().nullable(),
});

export type PlanStep = z.infer<typeof planStepSchema>;

/**
 * The capability contract, generated alongside the graph.
 *
 * A conversation workflow without one cannot be published — the router has
 * nothing to select it by — so generating the graph and leaving the contract
 * empty would produce something that looks finished and cannot ship.
 */
export const planCapabilitySchema = z.object({
  purpose: z.string(),
  useWhen: z.array(z.string()),
  doNotUseWhen: z.array(z.string()),
  positiveExamples: z.array(z.string()),
  negativeExamples: z.array(z.string()),
  /** True when the flow changes something the customer cannot undo. */
  hasSideEffects: z.boolean(),
});

export const workflowPlanSchema = z.object({
  name: z.string(),
  slug: z.string(),
  capability: planCapabilitySchema,
  /** The id of the first step. */
  firstStepId: z.string(),
  steps: z.array(planStepSchema),
  /**
   * Anything the model could not fill in — a value it did not know, an
   * operation that does not exist. Surfaced to the author rather than guessed.
   */
  openQuestions: z.array(z.string()),
});

export type WorkflowPlan = z.infer<typeof workflowPlanSchema>;
