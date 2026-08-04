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
  /**
   * The catalog entry this is being created from, when the tenant picked one.
   *
   * Optional on purpose. Every caller that predates the catalog — including the test
   * suite — still creates a connector by naming a `kind` directly, and that path is
   * unchanged. When this is present the type narrows what may be chosen and its
   * operation templates are cloned; the tenant still supplies the base URL and the
   * credential either way.
   */
  connectorTypeId: z.string().uuid().optional(),
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

/**
 * A partial update, with **no defaults**.
 *
 * This used to be `connectorCreateSchema.partial()`, and that was a real bug rather than a
 * tidiness problem: **Zod's `.partial()` does not suppress `.default()`.** An absent key
 * still comes back as its creation default, so every `body.x !== undefined` guard in the
 * handler was always true and a request that only changed the name also wrote
 * `kind: 'HTTP'`, `authType: 'NONE'` and `authConfig: {}`.
 *
 * What that did in practice: renaming a bearer-auth connector stopped its credential being
 * sent — every call then failed at the far end while the encrypted secret sat there looking
 * configured — and renaming a MOCK connector was refused outright, because `checkBaseUrl`
 * was handed the reset `HTTP` kind and a fixture connector has no base URL.
 *
 * Hence the fields are restated here as plainly optional. It is more typing than `.partial()`
 * and it is the only version that means what it says.
 */
export const connectorUpdateSchema = z.object({
  key: connectorKeySchema.optional(),
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(500).nullish(),
  connectorTypeId: z.string().uuid().optional(),
  kind: z.enum(CONNECTOR_KINDS).optional(),
  baseUrl: z.string().max(500).nullish(),
  authType: z.enum(CONNECTOR_AUTH_TYPES).optional(),
  authConfig: z.object({
    header: z.string().max(120).optional(),
    username: z.string().max(200).optional(),
  }).optional(),
  secret: z.string().min(1).max(4000).nullish(),
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
  /**
   * The request body to send, with `{placeholders}` filled from declared inputs.
   *
   * Stored parsed rather than as a string, so a payload that is not valid JSON cannot be
   * saved at all. Null keeps the older behaviour: a flat object assembled from whichever
   * inputs are declared `in: "body"`.
   */
  bodyTemplate: z.unknown().nullish(),
});

/**
 * A partial update, with **no defaults** — see the note on `connectorUpdateSchema`.
 *
 * This was `operationCreateSchema.partial()`, which was the most destructive instance of
 * that bug: because `.partial()` does not suppress `.default()`, a request that only changed
 * the name also wrote `method: 'GET'`, `path: '/'`, **`inputs: []`** and
 * `sideEffecting: false`. So renaming an operation wiped its entire declared parameter list,
 * reset its path, and cleared the flag that forces a destructive operation to confirm first.
 *
 * The editor in the browser always sends a full payload, which is why nobody had hit it —
 * but the route is open to any `connectors:author` caller.
 */
export const operationUpdateSchema = z.object({
  key: connectorKeySchema.optional(),
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(500).nullish(),
  method: z.enum(HTTP_METHODS).optional(),
  path: z.string().min(1).max(500).optional(),
  inputs: z.array(operationInputSchema).max(25).optional(),
  responseMapping: responseMappingSchema.optional(),
  sideEffecting: z.boolean().optional(),
  timeoutMs: z.number().int().min(100).max(30_000).nullish(),
  sampleResponse: z.unknown().nullish(),
  bodyTemplate: z.unknown().nullish(),
});

/** Methods whose body the call path actually sends. Anything else drops it. */
export const SENDS_BODY: readonly string[] = ['POST', 'PUT', 'PATCH'];

export type ConnectorCreate = z.infer<typeof connectorCreateSchema>;
export type OperationCreate = z.infer<typeof operationCreateSchema>;
