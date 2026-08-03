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

/** A boolean query value: `true`/`1` are true, `false`/`0` are false. */
export const queryBool = (value: unknown): boolean | undefined => {
  const str = queryString(value)?.toLowerCase();
  if (str === 'true' || str === '1') return true;
  if (str === 'false' || str === '0') return false;
  return undefined;
};
