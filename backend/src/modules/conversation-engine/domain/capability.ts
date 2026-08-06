import { z } from 'zod';

// The workflow capability contract — the only thing the AI router is ever shown
// about a workflow. It never sees node graphs, URLs, or credentials.
//
// The minimums below (3 positive, 2 negative examples) are enforced rather than
// suggested. The failure this prevents is specific and was the motivating
// example in the spec: "Is Dr Rao available tomorrow?" routing to Appointment
// Booking and creating a real appointment. A workflow with a transactional side
// effect and no negative examples is the shape that causes it.

export const inputTypeSchema = z.enum([
  'string', 'number', 'date', 'time', 'datetime', 'email', 'phone', 'boolean', 'choice',
]);

export const capabilityInputSchema = z.object({
  key: z.string()
    .min(1)
    .max(64)
    .regex(/^[a-z][a-z0-9_]*$/, 'Use lower_snake_case'),
  label: z.string().min(1).max(120),
  type: inputTypeSchema.default('string'),
  description: z.string().max(300).nullish(),
  choices: z.array(z.string()).max(50).optional(),
});

export type CapabilityInput = z.infer<typeof capabilityInputSchema>;

const phrase = z.string().trim().min(3).max(300);

export const capabilityContractSchema = z.object({
  purpose: z.string().trim().min(10, 'Purpose must say what the workflow achieves').max(300),
  // `.nullish()`, not `.optional()`: this is read back from a nullable Postgres
  // column, so it arrives as `null` rather than absent. With `.optional()` every
  // capability saved without a description failed to parse on read — and the
  // caller reported that as "no capability", which is a very misleading way to
  // say "the description was null".
  description: z.string().trim().max(1000).nullish(),

  useWhen: z.array(phrase).min(1, 'Give at least one "use when" condition').max(20),
  doNotUseWhen: z.array(phrase).default([]),

  // Below three, the router has too little signal to separate near-neighbours
  // like booking from availability.
  positiveExamples: z.array(phrase).min(3, 'Give at least 3 positive examples').max(30),
  negativeExamples: z.array(phrase).min(2, 'Give at least 2 negative examples').max(30),

  requiredInputs: z.array(capabilityInputSchema).max(20).default([]),
  optionalInputs: z.array(capabilityInputSchema).max(20).default([]),

  preconditions: z.array(phrase).default([]),
  sideEffects: z.array(phrase).default([]),

  requiresConfirmation: z.boolean().default(false),
  minimumConfidence: z.number().min(0).max(1).default(0.8),
  allowsInterruption: z.boolean().default(false),
})
  .refine(
    (c) => c.sideEffects.length === 0 || c.requiresConfirmation,
    {
      message: 'A workflow with side effects must require confirmation before performing them',
      path: ['requiresConfirmation'],
    },
  )
  .refine(
    (c) => {
      const keys = [...c.requiredInputs, ...c.optionalInputs].map((i) => i.key);
      return new Set(keys).size === keys.length;
    },
    { message: 'Input keys must be unique across required and optional', path: ['requiredInputs'] },
  );

export type CapabilityContract = z.infer<typeof capabilityContractSchema>;

/**
 * The compact form handed to the router, one per candidate workflow.
 *
 * `workflowId` is the workflow's slug, not its uuid: the model has to echo it
 * back, and a slug is both cheaper in tokens and easier to validate against the
 * candidate list. The router's output is checked against exactly this list, so
 * a hallucinated id is rejected rather than started.
 */
export interface RouterCapabilityView {
  workflowId: string;
  name: string;
  purpose: string;
  description?: string;
  useWhen: string[];
  doNotUseWhen: string[];
  positiveExamples: string[];
  negativeExamples: string[];
  requiredInputs: Array<{ key: string; label: string; type: string }>;
  optionalInputs: Array<{ key: string; label: string; type: string }>;
  preconditions: string[];
  sideEffects: string[];
  requiresConfirmation: boolean;
  priority: number;
  minimumConfidence: number;
}

/** Coerce a stored capability row into the view the router prompt embeds. */
export const toRouterView = (
  workflow: { slug: string | null; name: string; priority: number },
  capability: {
    purpose: string;
    description: string | null;
    useWhen: unknown;
    doNotUseWhen: unknown;
    positiveExamples: unknown;
    negativeExamples: unknown;
    requiredInputs: unknown;
    optionalInputs: unknown;
    preconditions: unknown;
    sideEffects: unknown;
    requiresConfirmation: boolean;
    minimumConfidence: number;
  },
): RouterCapabilityView => {
  const strings = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];

  const inputs = (value: unknown): Array<{ key: string; label: string; type: string }> =>
    Array.isArray(value)
      ? value.flatMap((v) => {
        const parsed = capabilityInputSchema.safeParse(v);
        return parsed.success
          ? [{ key: parsed.data.key, label: parsed.data.label, type: parsed.data.type }]
          : [];
      })
      : [];

  return {
    workflowId: workflow.slug ?? '',
    name: workflow.name,
    purpose: capability.purpose,
    ...(capability.description ? { description: capability.description } : {}),
    useWhen: strings(capability.useWhen),
    doNotUseWhen: strings(capability.doNotUseWhen),
    positiveExamples: strings(capability.positiveExamples),
    negativeExamples: strings(capability.negativeExamples),
    requiredInputs: inputs(capability.requiredInputs),
    optionalInputs: inputs(capability.optionalInputs),
    preconditions: strings(capability.preconditions),
    sideEffects: strings(capability.sideEffects),
    requiresConfirmation: capability.requiresConfirmation,
    priority: workflow.priority,
    minimumConfidence: capability.minimumConfidence,
  };
};
