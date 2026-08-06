import { describe, expect, it } from 'vitest';
import { VISIBLE_DIGITS, isMasked, maskContact, maskedNumber } from './mask-number.js';

// Masking a contact number.
//
// The tests worth reading are the two format constraints, which are requirements imposed by
// code elsewhere rather than preferences: the leading `+` that `phoneLabel` in
// `Customers.tsx` depends on, and never revealing more than the last four digits.

describe('what it reveals', () => {
  it('shows the last four digits of an Indian E.164 number', () => {
    expect(maskedNumber('917702006670')).toBe('+••••••••6670');
  });

  it('**never reveals more than the last four, whatever the length**', () => {
    // The property, stated over lengths rather than one example. Anything that leaks a
    // fifth digit makes the number materially easier to guess.
    for (const digits of ['917702006670', '14155550132', '971501234567', '447911123456']) {
      const masked = maskedNumber(digits)!;
      const revealed = masked.replace(/[^\d]/g, '');
      expect(revealed).toBe(digits.slice(-VISIBLE_DIGITS));
      expect(revealed).toHaveLength(VISIBLE_DIGITS);
    }
  });

  it('keeps the length, so it still reads as a phone number', () => {
    // A masked value the same length as the real one looks like a number with digits
    // hidden. Collapsing every number to a fixed run of bullets reads like an error.
    expect(maskedNumber('917702006670')).toHaveLength('917702006670'.length + 1);
  });
});

describe('the two format constraints', () => {
  it('**always begins with a plus**', () => {
    // Not cosmetic. `phoneLabel` in `frontend/src/pages/Customers.tsx` does
    // `raw.startsWith('+') ? raw : '+' + raw`, so a masked value without one renders as
    // `++91 …`. This is what lets every existing display path stay untouched.
    for (const input of ['917702006670', '7702006670', '15550001234', '12345']) {
      expect(maskedNumber(input)!.startsWith('+')).toBe(true);
    }
  });

  it('**is not parseable as digits**', () => {
    // A masked value that looked numeric could be dialled, stored, or compared as if real.
    const masked = maskedNumber('917702006670')!;
    expect(masked).toMatch(/•/);
    expect(Number.isNaN(Number(masked))).toBe(true);
  });
});

describe('values that cannot spare four digits', () => {
  it('**hides a short number completely rather than half of it**', () => {
    // Revealing the last four of a six-digit value leaves two. That is not privacy, so
    // anything under twice the reveal length gives up none.
    expect(maskedNumber('123456')).toBe('+••••••');
    expect(maskedNumber('1234567')).toBe('+•••••••');
    // At exactly twice, partial masking begins.
    expect(maskedNumber('12345678')).toBe('+••••5678');
  });

  it('returns null when there is nothing to mask', () => {
    expect(maskedNumber(null)).toBeNull();
    expect(maskedNumber(undefined)).toBeNull();
    expect(maskedNumber('')).toBeNull();
    // `Customer.phone` is free text a person typed — it may hold no digits at all.
    expect(maskedNumber('not a number')).toBeNull();
  });

  it('strips formatting before masking, so a typed number behaves like a stored one', () => {
    expect(maskedNumber('+91 77020 06670')).toBe(maskedNumber('917702006670'));
  });
});

describe('recognising a masked value', () => {
  it('tells a masked number from a real one', () => {
    expect(isMasked(maskedNumber('917702006670'))).toBe(true);
    expect(isMasked('917702006670')).toBe(false);
    expect(isMasked(null)).toBe(false);
  });
});

describe('masking a contact', () => {
  const contact = { id: 'c1', name: 'Asha Patel', waId: '917702006670', phone: '917702006670' };

  it('leaves everything alone when the caller may see full numbers', () => {
    const result = maskContact(contact, true);
    expect(result.waId).toBe('917702006670');
    expect(result.phone).toBe('917702006670');
    expect(result.numberMasked).toBe(false);
  });

  it('**masks in place, so a missed display path shows bullets and not a number**', () => {
    // The load-bearing choice. Adding `maskedWaId` alongside would mean every call site we
    // forgot to update kept leaking; replacing the value means a forgotten one fails safe.
    const result = maskContact(contact, false);
    expect(result.waId).toBe('+••••••••6670');
    expect(result.phone).toBe('+••••••••6670');
    expect(result.numberMasked).toBe(true);
  });

  it('keeps every other field', () => {
    const result = maskContact(contact, false);
    expect(result.id).toBe('c1');
    expect(result.name).toBe('Asha Patel');
  });

  it('does not invent fields that were not selected', () => {
    // A payload that never included `phone` must not gain a null one — that would change
    // the response shape for callers that deliberately left it out.
    const result = maskContact({ waId: '917702006670' }, false);
    expect('phone' in result).toBe(false);
  });

  it('handles a contact whose phone is null', () => {
    const result = maskContact({ waId: '917702006670', phone: null }, false);
    expect(result.waId).toBe('+••••••••6670');
    expect(result.phone).toBeNull();
  });

  it('**leaves no full number anywhere in the serialised result**', () => {
    // The shape of the test the endpoints will use: not "is this field masked" but "is the
    // number absent from the whole payload".
    const serialised = JSON.stringify(maskContact(contact, false));
    expect(serialised).not.toContain('917702006670');
    expect(serialised).not.toContain('7702006670');
  });
});
