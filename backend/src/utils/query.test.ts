import { describe, expect, it } from 'vitest';
import { queryBool, queryEnum, queryInt, queryOffset, queryString } from './query.js';

// These helpers exist because Express types a query value as
// `string | string[] | ParsedQs | ParsedQs[]`, and handing any of the non-string
// forms to Prisma either throws in the driver or — worse for an equality filter
// on `undefined` — silently widens the query. The array cases below are the ones
// that matter.

describe('queryString', () => {
  it('passes a plain string through', () => {
    expect(queryString('open')).toBe('open');
  });

  it('rejects a repeated parameter rather than picking one', () => {
    expect(queryString(['a', 'b'])).toBeUndefined();
  });

  it('treats blank and missing as absent', () => {
    expect(queryString('')).toBeUndefined();
    expect(queryString('   ')).toBeUndefined();
    expect(queryString(undefined)).toBeUndefined();
  });
});

describe('queryEnum', () => {
  const STATUSES = ['OPEN', 'CLOSED'] as const;

  it('accepts a known member', () => {
    expect(queryEnum('OPEN', STATUSES)).toBe('OPEN');
  });

  it('drops an unknown value instead of passing it to the column', () => {
    expect(queryEnum('DROP TABLE', STATUSES)).toBeUndefined();
    expect(queryEnum('open', STATUSES)).toBeUndefined();
  });
});

describe('queryInt', () => {
  it('parses and clamps', () => {
    expect(queryInt('25', 10)).toBe(25);
    expect(queryInt('9999', 10, 200)).toBe(200);
  });

  it('falls back on nonsense rather than producing NaN', () => {
    expect(queryInt('abc', 10)).toBe(10);
    expect(queryInt('-5', 10)).toBe(10);
    expect(queryInt(undefined, 10)).toBe(10);
  });
});

describe('queryOffset', () => {
  it('parses an offset', () => {
    expect(queryOffset('250')).toBe(250);
    expect(queryOffset('0')).toBe(0);
  });

  it('**is not clamped to 200 the way queryInt is**', () => {
    // The reason this helper exists. `queryInt` defaults `max` to 200, so reaching for
    // it here would pin every page past 20 (at a page size of 10) to the same rows —
    // pagination that looks like it works and does not.
    expect(queryOffset('5000')).toBe(5000);
    expect(queryInt('5000', 0)).toBe(200);
  });

  it('treats nonsense and negatives as no offset', () => {
    expect(queryOffset('abc')).toBe(0);
    expect(queryOffset('-10')).toBe(0);
    expect(queryOffset(undefined)).toBe(0);
    expect(queryOffset(['1', '2'])).toBe(0);
  });
});

describe('queryBool', () => {
  it('accepts the usual spellings', () => {
    expect(queryBool('true')).toBe(true);
    expect(queryBool('1')).toBe(true);
    expect(queryBool('false')).toBe(false);
    expect(queryBool('0')).toBe(false);
  });

  it('is undefined for anything else, so callers can tell "absent" from "false"', () => {
    expect(queryBool('yes')).toBeUndefined();
    expect(queryBool(undefined)).toBeUndefined();
  });
});
