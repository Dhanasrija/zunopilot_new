import { z } from 'zod';

/*
 * The values that fill a template's `{{1}}`, `{{2}}` placeholders.
 *
 * **Why this file exists.** A campaign was sent in production against a template whose body
 * opens `Hi {{1}},`. Every recipient failed:
 *
 *   132000  "body: number of localizable_params (0) does not match the expected number of
 *            params (1)"
 *
 * `variableValues` was `{}` because nothing in the composer ever set it — the field existed
 * on the model and in the API and had no input behind it. So any template with a placeholder
 * failed for its entire audience, and the campaign was still recorded as sent.
 *
 * Two kinds of value, because a placeholder is used for two different things:
 *
 *   TEXT      one string for everybody — "Diwali", "20%", a date.
 *   CUSTOMER  a field off each recipient — overwhelmingly the name, which is the whole
 *             reason `Hi {{1}},` is written that way.
 *
 * A bare string is still accepted and read as TEXT. Campaigns already stored that shape, and
 * a migration to rewrite historic JSON would be a lot of risk for a format nobody is reading
 * any more.
 */

export const CUSTOMER_FIELDS = ['name', 'phone'] as const;
export type CustomerField = (typeof CUSTOMER_FIELDS)[number];

export type VariableValue =
  | { kind: 'TEXT'; value: string }
  | { kind: 'CUSTOMER'; field: CustomerField; fallback: string };

/**
 * A fallback is **required**, not optional.
 *
 * `Hi {{1}},` against a contact with no profile name would otherwise send an empty
 * parameter, which Meta rejects outright — so the one recipient whose name is missing
 * fails, and only that one, which is the worst kind of bug to notice. Making the operator
 * name a fallback turns a per-recipient failure into a decision taken once, on screen.
 */
export const variableValueSchema = z.union([
  // Legacy, and the shape a plain text value still takes on the wire.
  z.string().max(1_000),
  z.object({ kind: z.literal('TEXT'), value: z.string().max(1_000) }),
  z.object({
    kind: z.literal('CUSTOMER'),
    field: z.enum(CUSTOMER_FIELDS),
    fallback: z.string().trim().min(1).max(200),
  }),
]);

export const variableValuesSchema = z
  .record(z.string().max(80), variableValueSchema)
  .default({});

/** What a template declares, read defensively — `variables` is a Json column. */
export const declaredVariables = (variables: unknown): string[] =>
  (Array.isArray(variables) ? variables : [])
    .filter((v): v is string => typeof v === 'string');

/** The stored map, read defensively for the same reason. */
const storedValues = (values: unknown): Record<string, unknown> =>
  (values && typeof values === 'object' && !Array.isArray(values))
    ? values as Record<string, unknown>
    : {};

const normalise = (raw: unknown): VariableValue | null => {
  if (typeof raw === 'string') return { kind: 'TEXT', value: raw };
  const parsed = variableValueSchema.safeParse(raw);
  if (!parsed.success) return null;
  return typeof parsed.data === 'string'
    ? { kind: 'TEXT', value: parsed.data }
    : parsed.data;
};

/**
 * Whitespace flattened, because Meta rejects a parameter that contains any.
 *
 * A template parameter may not carry a newline, a tab, or four consecutive spaces — paste a
 * two-line address into a `{{1}}` and every message fails with the same opaque 132000 as an
 * empty one. Collapsing here is not tidying: it is the difference between a campaign that
 * sends and one that does not, and there is no version of the operator's intent that needs
 * the line break preserved inside a single placeholder.
 */
export const sanitiseParam = (text: string): string => text.replace(/\s+/g, ' ').trim();

export interface ResolvableCustomer {
  name: string | null;
  phone: string | null;
  waId: string;
}

const fieldOf = (customer: ResolvableCustomer, field: CustomerField): string => {
  // `phone` falls back to `waId`: the WhatsApp id *is* the number, and a customer created
  // from an inbound message has no separate `phone` at all.
  if (field === 'phone') return customer.phone ?? customer.waId;
  return customer.name ?? '';
};

/**
 * The parameters for one message, in the order the template declares them.
 *
 * Driven by `variables` rather than by `Object.values(variableValues)`. The old code took
 * the values map's own order, which is only correct while the keys happen to be "1", "2",
 * "3" — a template using named placeholders, or a map that gained a key out of order, would
 * have silently sent the right number of parameters in the wrong slots. That is a worse
 * failure than a rejection, because it delivers.
 *
 * `customer` is null for a test send with no matching contact; every CUSTOMER value then
 * resolves to its fallback.
 */
export const resolveVariables = (
  variables: unknown,
  values: unknown,
  customer: ResolvableCustomer | null,
): string[] => {
  const stored = storedValues(values);

  return declaredVariables(variables).map((name) => {
    const value = normalise(stored[name]);
    if (!value) return '';

    if (value.kind === 'TEXT') return sanitiseParam(value.value);

    const resolved = customer ? sanitiseParam(fieldOf(customer, value.field)) : '';
    return resolved || sanitiseParam(value.fallback);
  });
};

/**
 * The placeholders that have nothing behind them.
 *
 * Called before a campaign starts and before a test send, so the answer is one error on one
 * screen rather than the same rejection repeated once per recipient.
 */
export const missingVariables = (variables: unknown, values: unknown): string[] => {
  const stored = storedValues(values);

  return declaredVariables(variables).filter((name) => {
    const value = normalise(stored[name]);
    if (!value) return true;
    // A CUSTOMER value always resolves, because its fallback is required and non-empty.
    return value.kind === 'TEXT' && sanitiseParam(value.value) === '';
  });
};

/**
 * The body as the customer will read it.
 *
 * Only ever used for the Inbox mirror and the composer's preview — Meta renders the approved
 * template itself, so this is our reading of it and never what goes on the wire.
 */
export const renderBody = (bodyPreview: string, params: string[]): string =>
  bodyPreview.replace(/\{\{\s*(\w+)\s*\}\}/g, (whole, token: string) => {
    const index = Number(token);
    // Positional placeholders are 1-based. A named one, or an index past the end, is left
    // alone rather than replaced with "undefined".
    if (!Number.isInteger(index) || index < 1 || index > params.length) return whole;
    return params[index - 1] ?? whole;
  });
