import { z } from 'zod';

// The shapes a connector and its operations are defined in.
//
// Everything here is deliberately array-of-pairs rather than open maps. That is
// not a style choice: OpenAI strict structured output compiles an open map to
// `propertyNames` and rejects it, so a shape with a free-form object in it
// cannot be handed to a model. Since the whole point of registering operations
// is that a model can later assemble workflows around them, the declarations
// have to stay strict-expressible from the start.

/** A stable identifier a workflow node stores. Renaming the label must not break graphs. */
export const connectorKeySchema = z.string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9_]*$/, 'Lowercase letters, digits and underscores; must start with a letter');

export const INPUT_LOCATIONS = ['path', 'query', 'body', 'header'] as const;
export const INPUT_TYPES = ['string', 'number', 'boolean'] as const;

export const operationInputSchema = z.object({
  key: connectorKeySchema,
  label: z.string().min(1).max(120),
  type: z.enum(INPUT_TYPES).default('string'),
  required: z.boolean().default(true),
  /** Where the value goes in the request. `path` fills a `{placeholder}`. */
  in: z.enum(INPUT_LOCATIONS).default('query'),
  description: z.string().max(300).optional(),
});

export type OperationInput = z.infer<typeof operationInputSchema>;

/**
 * How to find the useful parts of a response.
 *
 * Dotted paths, resolved by a whitelisted walker — never `eval`, and never a
 * general expression language. Whoever edits a connector controls these
 * strings, and a connector is edited by a tenant.
 */
export const responseMappingSchema = z.object({
  /** Dotted path to the array of records, e.g. `data.students`. Empty means the root. */
  itemsPath: z.string().max(200).default(''),
  /** Field on each record holding its id. */
  idField: z.string().max(120).default('id'),
  /** Field shown to the customer in a list row. */
  titleField: z.string().max(120).default('name'),
  /** Optional secondary line on a list row. */
  descriptionField: z.string().max(120).optional(),
});

export type ResponseMapping = z.infer<typeof responseMappingSchema>;

export const CONNECTOR_KINDS = ['HTTP', 'MOCK', 'GOOGLE_SHEETS', 'EMAIL'] as const;
export const CONNECTOR_AUTH_TYPES = ['NONE', 'API_KEY_HEADER', 'BEARER', 'BASIC'] as const;
export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

export const connectorCreateSchema = z.object({
  key: connectorKeySchema,
  name: z.string().min(1).max(120),
  description: z.string().max(500).nullish(),
  kind: z.enum(CONNECTOR_KINDS).default('HTTP'),
  baseUrl: z.string().max(500).nullish(),
  authType: z.enum(CONNECTOR_AUTH_TYPES).default('NONE'),
  /** Non-secret auth details. The secret itself goes in `secret`, write-only. */
  authConfig: z.object({
    header: z.string().max(120).optional(),
    username: z.string().max(200).optional(),
  }).default({}),
  /** Write-only. Sealed before storage and never returned. */
  secret: z.string().min(1).max(4000).nullish(),
});

export const connectorUpdateSchema = connectorCreateSchema.partial().extend({
  status: z.enum(['ACTIVE', 'DISABLED']).optional(),
});

export const operationCreateSchema = z.object({
  key: connectorKeySchema,
  name: z.string().min(1).max(120),
  description: z.string().max(500).nullish(),
  method: z.enum(HTTP_METHODS).default('GET'),
  path: z.string().min(1).max(500).default('/'),
  inputs: z.array(operationInputSchema).max(25).default([]),
  responseMapping: responseMappingSchema.default(() => responseMappingSchema.parse({})),
  sideEffecting: z.boolean().default(false),
  timeoutMs: z.number().int().min(100).max(30_000).nullish(),
  sampleResponse: z.unknown().nullish(),
});

export const operationUpdateSchema = operationCreateSchema.partial();

export type ConnectorCreate = z.infer<typeof connectorCreateSchema>;
export type OperationCreate = z.infer<typeof operationCreateSchema>;
