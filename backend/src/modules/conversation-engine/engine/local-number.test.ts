import { describe, expect, it } from 'vitest';
import { localNumberOf } from './local-number.js';

// Splitting a WhatsApp id into its national part.
//
// The whole reason this is a metadata lookup and not `waId.replace(/^91/, '')` is in the
// second block below: dialling codes are one, two or three digits, two countries share some
// of them, and a national number can legitimately begin with the same digits as a code. Every
// test there is a case the naive version gets wrong.

describe('the case this was built for', () => {
  it('strips the Indian country code', () => {
    // `917702000350` returns nothing from an API that stores `7702000350` — and returns it
    // with a 200, so the workflow reads the miss as "no children" rather than as a failure.
    expect(localNumberOf('917702000350')).toBe('7702000350');
  });

  it('tolerates a plus, spaces and dashes in stored input', () => {
    expect(localNumberOf('+91 77020-00350')).toBe('7702000350');
  });
});

describe('what a prefix rule would get wrong', () => {
  it('**does not strip anything from a US number, whose code is one digit**', () => {
    // `+1 415 555 0132`. A rule written for India would leave `415…` alone but a rule that
    // strips two digits would eat into the area code.
    expect(localNumberOf('14155550132')).toBe('4155550132');
  });

  it('**handles a shared dialling code**', () => {
    // `+7` is Russia *and* Kazakhstan. The code is one digit either way, so the split is the
    // same — but a prefix table keyed on "the country" has to pick one, and picking is where
    // it goes wrong.
    expect(localNumberOf('79161234567')).toBe('9161234567');
  });

  it('**leaves the UK national number without its trunk zero**', () => {
    // `+44 7911 123456` is dialled locally as `07911 123456`. The national number is
    // `7911123456` — a naive strip of "44" gets that right by luck, but only because the
    // trunk prefix is not stored. Pinning it so a future change cannot reintroduce one.
    expect(localNumberOf('447911123456')).toBe('7911123456');
  });

  it('handles a three-digit code', () => {
    // `+971` — UAE. One, two and three digit codes all exist, which is why no fixed slice
    // works.
    expect(localNumberOf('971501234567')).toBe('501234567');
  });
});

describe('when it cannot tell', () => {
  it('**returns empty for a number already missing its country code**', () => {
    // Ten bare digits starting `77` parse as Kazakhstan, because `+7` is a valid code. A
    // "national part" derived from that misread would be `702000350` — the same number with
    // a digit eaten off the front, which is worse than nothing because it looks plausible.
    expect(localNumberOf('7702000350')).toBe('');
  });

  it('returns empty rather than throwing on nonsense', () => {
    // This runs while building the scope for every node of every conversation, so a bad
    // stored value must not stop a workflow.
    expect(localNumberOf('not-a-number')).toBe('');
    expect(localNumberOf('123')).toBe('');
    expect(localNumberOf('')).toBe('');
    expect(localNumberOf(null)).toBe('');
    expect(localNumberOf(undefined)).toBe('');
  });

  it('**never falls back to the full number**', () => {
    // The load-bearing choice. An empty required path input is refused with MISSING_INPUT,
    // which is a loud failure in the execution log. Falling back to the prefixed number
    // would instead send a request that succeeds and matches nobody.
    const unparseable = '99999999999999';
    expect(localNumberOf(unparseable)).not.toBe(unparseable);
    expect(localNumberOf(unparseable)).toBe('');
  });

  it('returns empty for the reserved +1 555 range used in tests', () => {
    // Worth knowing rather than being surprised by: the fictional range is not a valid
    // number, so a webhook test posted as 15550009911 gets no local number and any
    // operation requiring one is refused instead of called with a wrong value.
    expect(localNumberOf('15550009911')).toBe('');
  });
});
