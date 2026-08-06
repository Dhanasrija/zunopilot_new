import { z } from 'zod';

// The router's output contract.
//
// This is the only shape the model is allowed to return, and it is validated
// before anything acts on it. Two properties make it safe:
//
//   • `workflowId` is checked against the candidate slugs that were sent in.
//     The model cannot name a workflow it was not offered, so a hallucinated or
//     injected id is rejected rather than started.
//   • There is exactly one `workflowId`, not an array. "Never run two workflows
//     for the same incoming message" is enforced by the type, not by convention.
//
// Free-form model text is never parsed for a routing decision. If structured
// output fails to validate, the router returns NO_MATCH and the message falls
// through to the fallback — a wrong guess is worse than no guess when the wrong
// guess can create an appointment.

export const ROUTER_DECISIONS = [
  'START_WORKFLOW',
  'ASK_CLARIFICATION',
  'GENERAL_RESPONSE',
  'HUMAN_HANDOFF',
  'NO_MATCH',
] as const;

export const routerDecisionSchema = z.enum(ROUTER_DECISIONS);
export type RouterDecision = (typeof ROUTER_DECISIONS)[number];

/**
 * Reason codes. A closed set rather than free text, so routing quality can be
 * grouped and counted — and so the model's own prose never reaches the database.
 */
export const REASON_CODES = [
  'EXACT_INTENT_MATCH',
  'EXPLICIT_BOOKING_REQUEST',
  'INFORMATION_REQUEST_ONLY',
  'AMBIGUOUS_BETWEEN_WORKFLOWS',
  'MISSING_REQUIRED_INPUTS',
  'LOW_CONFIDENCE',
  'USER_REQUESTED_HUMAN',
  'EXISTING_CUSTOMER_SUPPORT',
  'BUTTON_PAYLOAD_MATCH',
  'NO_SUITABLE_WORKFLOW',
  'GENERAL_QUESTION',
] as const;

export const reasonCodeSchema = z.enum(REASON_CODES);
export type ReasonCode = (typeof REASON_CODES)[number];

export const routerOutputSchema = z.object({
  decision: routerDecisionSchema,
  /** A candidate slug, or null. Never an array — one workflow at most. */
  workflowId: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  reasonCode: reasonCodeSchema,
  /**
   * Values clearly present in the message. Never invented.
   *
   * Key/value pairs rather than an object map because OpenAI's strict
   * structured output requires a *closed* schema — an open-ended map compiles
   * to `propertyNames`, which strict mode rejects outright. Callers read the
   * derived `inputs` record instead of this.
   */
  extractedInputs: z.array(z.object({
    key: z.string(),
    value: z.string(),
  })).default([]),
  missingInputs: z.array(z.string()).default([]),
  /** Required when the decision is ASK_CLARIFICATION. */
  clarificationQuestion: z.string().nullable(),
  /** Populated when more than one workflow was plausible. */
  possibleWorkflowIds: z.array(z.string()).default([]),
});

export type RouterOutput = z.infer<typeof routerOutputSchema>;

/**
 * The JSON Schema handed to the provider for structured output.
 *
 * Derived from the Zod schema so the two cannot drift: the model is constrained
 * by exactly the shape that will then be validated.
 */
/**
 * Recursively coerce a JSON Schema into the subset OpenAI strict mode accepts:
 * no `$schema`, every object closed, and every property required — including
 * nullable ones, which strict mode expresses as required-but-null rather than
 * optional.
 */
const toStrictSchema = (input: unknown): unknown => {
  if (Array.isArray(input)) return input.map(toStrictSchema);
  if (!input || typeof input !== 'object') return input;

  const schema = { ...(input as Record<string, unknown>) };
  delete schema.$schema;
  // Emitted by `z.record`. Strict mode has no way to express an open map.
  delete schema.propertyNames;
  // Strict mode rejects validation keywords it cannot enforce.
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

export const routerJsonSchema = (): Record<string, unknown> =>
  toStrictSchema(z.toJSONSchema(routerOutputSchema, { io: 'input' })) as Record<string, unknown>;

export interface ValidatedRouterOutput extends RouterOutput {
  /** `extractedInputs` as a record, which is what the engine seeds variables from. */
  inputs: Record<string, string>;
  /** Set when the model named a workflow that was not among the candidates. */
  rejectedWorkflowId?: string;
}

const toRecord = (pairs: RouterOutput['extractedInputs']): Record<string, string> =>
  Object.fromEntries(pairs.filter((p) => p.key.trim()).map((p) => [p.key, p.value]));

/**
 * Parse and sanity-check a raw model response.
 *
 * Returns null when the response is unusable — the caller falls back rather
 * than acting on a half-understood decision.
 */
export const validateRouterOutput = (
  raw: unknown,
  candidateSlugs: string[],
): ValidatedRouterOutput | null => {
  const parsed = routerOutputSchema.safeParse(raw);
  if (!parsed.success) return null;

  const output = parsed.data;
  const inputs = toRecord(output.extractedInputs);

  // The load-bearing guard. Whatever the model returns, it can only ever
  // select from what it was offered.
  if (output.workflowId && !candidateSlugs.includes(output.workflowId)) {
    return {
      ...output,
      inputs,
      decision: 'NO_MATCH',
      workflowId: null,
      confidence: 0,
      reasonCode: 'NO_SUITABLE_WORKFLOW',
      rejectedWorkflowId: output.workflowId,
    };
  }

  // A START_WORKFLOW with no workflow is incoherent; treat it as no match
  // rather than guessing which one was meant.
  if (output.decision === 'START_WORKFLOW' && !output.workflowId) {
    return { ...output, inputs, decision: 'NO_MATCH', confidence: 0, reasonCode: 'NO_SUITABLE_WORKFLOW' };
  }

  // Likewise a clarification with nothing to ask.
  if (output.decision === 'ASK_CLARIFICATION' && !output.clarificationQuestion?.trim()) {
    return { ...output, inputs, decision: 'NO_MATCH', reasonCode: 'AMBIGUOUS_BETWEEN_WORKFLOWS' };
  }

  return {
    ...output,
    inputs,
    possibleWorkflowIds: output.possibleWorkflowIds.filter((id) => candidateSlugs.includes(id)),
  };
};
