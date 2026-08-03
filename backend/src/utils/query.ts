// Express types a query value as `string | string[] | ParsedQs | ParsedQs[]`,
// because `?status=A&status=B` is legal. Feeding that straight into a Prisma
// `where` is what these helpers prevent: an array reaching an equality filter
// throws at runtime, and an unvalidated string reaching an enum column throws
// in the driver. Both become "absent" here instead.

/** A query value only if it is a single non-empty string. */
export const queryString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value : undefined;

/** A query value only if it is one of the allowed enum members. */
export const queryEnum = <T extends string>(
  value: unknown,
  allowed: readonly T[],
): T | undefined => {
  const str = queryString(value);
  return str !== undefined && (allowed as readonly string[]).includes(str) ? (str as T) : undefined;
};

/** A positive integer query value, clamped to `max`. */
export const queryInt = (value: unknown, fallback: number, max = 200): number => {
  const str = queryString(value);
  if (str === undefined) return fallback;
  const parsed = Number.parseInt(str, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
};

/**
 * A pagination offset: a non-negative integer, unclamped.
 *
 * Separate from `queryInt` for two reasons, both of which are bugs if you reach for
 * that instead. `queryInt` treats anything below 1 as absent and returns the fallback,
 * so it cannot express "skip nothing" distinctly from "no value given" — harmless here
 * only because both mean 0. More importantly its `max` defaults to **200**, which for a
 * page size of 10 would silently pin every request past page 20 to the same rows.
 *
 * There is no upper bound because there is nothing sensible to bound it to: the ceiling
 * is the row count, which the caller does not know. An offset past the end returns an
 * empty page, which is the correct answer.
 */
export const queryOffset = (value: unknown): number => {
  const str = queryString(value);
  if (str === undefined) return 0;
  const parsed = Number.parseInt(str, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return parsed;
};

/** A boolean query value: `true`/`1` are true, `false`/`0` are false. */
export const queryBool = (value: unknown): boolean | undefined => {
  const str = queryString(value)?.toLowerCase();
  if (str === 'true' || str === '1') return true;
  if (str === 'false' || str === '0') return false;
  return undefined;
};
