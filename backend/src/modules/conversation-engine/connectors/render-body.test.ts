import { describe, expect, it } from 'vitest';
import { placeholdersIn, renderBody } from './invoke.js';

// Filling a request body template.
//
// Before this, a POST body was a flat object assembled from inputs declared `in: "body"` —
// `{ "amount": 500 }` and nothing more nested or more literal than that. Most real APIs want
// a shape, so the template exists to express one.
//
// The two rules worth testing hardest are the typed whole-value substitution and the refusal
// to leave a placeholder unfilled. Getting the first wrong sends `"500"` to an API that
// validates types; getting the second wrong sends a body with `{amount}` in it to somebody
// else's production system.

describe('substituting a whole value', () => {
  it('**keeps the input\'s type**, rather than stringifying it', () => {
    // `{"amount": "{amount}"}` has to be quoted to be valid JSON at rest. If the quotes
    // survived the substitution, an API that type-checks its input would reject every call —
    // and there is no way to write an unquoted placeholder in stored JSON.
    expect(renderBody({ amount: '{amount}' }, { amount: 500 })).toEqual({ amount: 500 });
    expect(renderBody({ live: '{live}' }, { live: true })).toEqual({ live: true });
  });

  it('leaves a plain string a string', () => {
    expect(renderBody({ note: '{note}' }, { note: 'hello' })).toEqual({ note: 'hello' });
  });

  it('leaves constants alone — that is half the point of a template', () => {
    // A flat body built from declared inputs cannot express a fixed field at all.
    expect(renderBody({ currency: 'INR', speed: 'normal' }, {}))
      .toEqual({ currency: 'INR', speed: 'normal' });
  });
});

describe('interpolating inside longer text', () => {
  it('substitutes as a string when there is text around the placeholder', () => {
    expect(renderBody({ note: 'Refund for {order_id}' }, { order_id: 'ORD-9' }))
      .toEqual({ note: 'Refund for ORD-9' });
  });

  it('handles several placeholders in one string', () => {
    expect(renderBody({ note: '{a} then {b}' }, { a: 'x', b: 'y' }))
      .toEqual({ note: 'x then y' });
  });

  it('stringifies a number when it is embedded rather than whole', () => {
    expect(renderBody({ note: 'Amount {amount}' }, { amount: 500 }))
      .toEqual({ note: 'Amount 500' });
  });
});

describe('shapes a flat body could not express', () => {
  it('fills a nested object', () => {
    expect(renderBody(
      { payment: { id: '{payment_id}', amount: '{amount}' }, notes: { reason: 'duplicate' } },
      { payment_id: 'pay_1', amount: 500 },
    )).toEqual({
      payment: { id: 'pay_1', amount: 500 },
      notes: { reason: 'duplicate' },
    });
  });

  it('fills inside an array', () => {
    expect(renderBody({ items: [{ sku: '{sku}' }, { sku: 'FIXED' }] }, { sku: 'A-1' }))
      .toEqual({ items: [{ sku: 'A-1' }, { sku: 'FIXED' }] });
  });

  it('passes null and numbers through untouched', () => {
    expect(renderBody({ a: null, b: 7, c: false }, {})).toEqual({ a: null, b: 7, c: false });
  });

  it('renders a template that is a bare array', () => {
    expect(renderBody([{ id: '{id}' }], { id: 'x' })).toEqual([{ id: 'x' }]);
  });
});

describe('an unfilled placeholder', () => {
  it('**is an error, not a literal**', () => {
    // The same stance `buildPath` takes on the path. A body reaching someone else's API with
    // `{amount}` in it is worse than a refused call.
    expect(() => renderBody({ amount: '{amount}' }, {})).toThrow(/needs amount/);
  });

  it('names every missing placeholder at once', () => {
    expect(() => renderBody({ a: '{one}', b: 'x {two}' }, {}))
      .toThrow(/needs one, two/);
  });

  it('is reported for a nested field too', () => {
    expect(() => renderBody({ outer: { inner: '{gone}' } }, {})).toThrow(/needs gone/);
  });

  it('carries the MISSING_INPUT code, so the engine treats it like any missing input', () => {
    try {
      renderBody({ a: '{nope}' }, {});
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as { code?: string }).code).toBe('MISSING_INPUT');
    }
  });
});

describe('awkward keys', () => {
  it('**sends a field literally named `__proto__` rather than dropping it**', () => {
    // Assigning that key onto a plain `{}` hits the setter and creates no own property, so
    // the field would vanish from the body with no error. A null-prototype object is built
    // instead — and there is no prototype to pollute either way.
    const rendered = renderBody({ __proto__: '{value}' }, { value: 'kept' }) as Record<string, unknown>;
    expect(JSON.parse(JSON.stringify(rendered))).toEqual({ __proto__: 'kept' });
  });

  it('does not pollute Object.prototype', () => {
    renderBody({ __proto__: { polluted: true } }, {});
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('keeps a field called constructor', () => {
    const rendered = renderBody({ constructor: 'x' }, {}) as Record<string, unknown>;
    expect(JSON.parse(JSON.stringify(rendered))).toEqual({ constructor: 'x' });
  });
});

describe('finding the placeholders a template names', () => {
  // Used to cross-check a template against the operation's declared inputs when it is saved,
  // so the rejection lands in the form rather than mid-conversation.
  it('collects them from nested strings, de-duplicated', () => {
    expect(placeholdersIn({ a: '{one}', b: { c: '{two}' }, d: ['{one}', 'x {three}'] }).sort())
      .toEqual(['one', 'three', 'two']);
  });

  it('is empty for a template with no placeholders', () => {
    expect(placeholdersIn({ currency: 'INR' })).toEqual([]);
  });

  it('is empty for null', () => {
    expect(placeholdersIn(null)).toEqual([]);
  });
});
