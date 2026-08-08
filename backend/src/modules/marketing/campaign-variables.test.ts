import { describe, expect, it } from 'vitest';
import {
  missingVariables, renderBody, resolveVariables, sanitiseParam, variableValuesSchema,
} from './campaign-variables.js';

/*
 * A production campaign failed every recipient.
 *
 *   template  zunopilot_welcome_v1, body "Hi {{1}}, …", variables ["1"]
 *   campaign  variableValues {}
 *   Meta      132000 "number of localizable_params (0) does not match the expected
 *             number of params (1)"
 *
 * Nothing in the composer had ever set `variableValues`, so every template with a
 * placeholder was undeliverable to its whole audience — and the campaign was still recorded
 * as SENT.
 */

/*
 * A customer who has messaged the business.
 *
 * `waProfileName` set and `name` null is the ordinary shape: WhatsApp reports what they call
 * themselves on every inbound message, and the operator's label stays empty until somebody types
 * one. This fixture used to carry only `name`, which is why the leak test below was invisible —
 * with one field, "prefer the profile name" and "use the label" are the same code.
 */
const customer = { name: null as string | null, waProfileName: 'Naveen', phone: null, waId: '917702000350' };

describe('resolveVariables', () => {
  it('**fills a placeholder from the customer, per recipient**', () => {
    const values = { 1: { kind: 'CUSTOMER', field: 'name', fallback: 'there' } };
    expect(resolveVariables(['1'], values, customer)).toEqual(['Naveen']);
    // Overriding `waProfileName`, not `name` — the greeting follows what WhatsApp says they are
    // called, which is the field that changes when they rename their profile.
    expect(resolveVariables(['1'], values, { ...customer, waProfileName: 'Priya' })).toEqual(['Priya']);
  });

  it('**never sends the operator’s private label to the customer**', () => {
    /*
     * The property this whole two-column split exists for. `Customer.name` is an internal note —
     * "Ravi — accounts, chases invoices" — and it is right there next to the profile name in
     * every recipient row. Resolving it here would put it in `Hi {{1}},` on a message Ravi reads.
     *
     * Not a hypothetical: `name` was the *only* name field until this change, so `customer.name`
     * is exactly what a reasonable person would reach for.
     */
    const values = { 1: { kind: 'CUSTOMER', field: 'name', fallback: 'there' } };
    const labelled = { ...customer, waProfileName: 'Ravi Kumar', name: 'Ravi — accounts, chases invoices' };

    expect(resolveVariables(['1'], values, labelled)).toEqual(['Ravi Kumar']);
  });

  it('uses the label when WhatsApp has given no name — an imported contact', () => {
    // Nobody has ever messaged, so there is no profile name and the operator's entry is the only
    // name anyone has. An empty parameter is rejected by Meta outright.
    const values = { 1: { kind: 'CUSTOMER', field: 'name', fallback: 'there' } };
    expect(resolveVariables(['1'], values, { ...customer, waProfileName: null, name: 'Asha' }))
      .toEqual(['Asha']);
  });

  it('**falls back when the customer has no name**', () => {
    // A contact created from an inbound message often has no profile name. Sending an empty
    // parameter is rejected by Meta, so this one recipient would fail and no other — the
    // hardest kind of failure to notice.
    const values = { 1: { kind: 'CUSTOMER', field: 'name', fallback: 'there' } };
    const nameless = { ...customer, waProfileName: null, name: null };
    expect(resolveVariables(['1'], values, nameless)).toEqual(['there']);
    // Whitespace in either field counts as absent, or the greeting becomes "Hi    ,".
    expect(resolveVariables(['1'], values, { ...nameless, waProfileName: '   ' })).toEqual(['there']);
    expect(resolveVariables(['1'], values, { ...nameless, name: '   ' })).toEqual(['there']);
  });

  it('uses the fallback when there is no customer at all — a test send', () => {
    const values = { 1: { kind: 'CUSTOMER', field: 'name', fallback: 'there' } };
    expect(resolveVariables(['1'], values, null)).toEqual(['there']);
  });

  it('reads phone from waId, which is the number for an inbound contact', () => {
    const values = { 1: { kind: 'CUSTOMER', field: 'phone', fallback: 'your number' } };
    expect(resolveVariables(['1'], values, customer)).toEqual(['917702000350']);
    expect(resolveVariables(['1'], values, { ...customer, phone: '+91 90000 11111' }))
      .toEqual(['+91 90000 11111']);
  });

  it('sends the same literal to everybody', () => {
    expect(resolveVariables(['1'], { 1: { kind: 'TEXT', value: 'Diwali' } }, customer))
      .toEqual(['Diwali']);
  });

  it('still reads a bare string, which is how campaigns were already stored', () => {
    expect(resolveVariables(['1'], { 1: 'Diwali' }, customer)).toEqual(['Diwali']);
  });

  it('**orders parameters by the template, not by the values map**', () => {
    // The old code used `Object.values(variableValues)`, which is only right while the keys
    // happen to be "1","2","3" in insertion order. Wrong-order parameters are worse than a
    // rejection, because they deliver: "Hi 20%, your Diwali offer".
    const values = { 2: { kind: 'TEXT', value: 'second' }, 1: { kind: 'TEXT', value: 'first' } };
    expect(resolveVariables(['1', '2'], values, customer)).toEqual(['first', 'second']);
    expect(resolveVariables(['greeting', 'offer'], {
      offer: { kind: 'TEXT', value: '20% off' },
      greeting: { kind: 'TEXT', value: 'Hello' },
    }, customer)).toEqual(['Hello', '20% off']);
  });

  it('returns nothing for a template with no placeholders', () => {
    expect(resolveVariables([], {}, customer)).toEqual([]);
    expect(resolveVariables(null, null, customer)).toEqual([]);
  });
});

describe('sanitiseParam', () => {
  it('**flattens whitespace, which Meta rejects inside a parameter**', () => {
    // A newline or four consecutive spaces in a parameter fails the send with the same
    // opaque error as an empty one. Paste a two-line address into {{1}} and the entire
    // campaign is undeliverable.
    expect(sanitiseParam('12 Main Street\nHyderabad')).toBe('12 Main Street Hyderabad');
    expect(sanitiseParam('a\t\tb')).toBe('a b');
    expect(sanitiseParam('spaced      out')).toBe('spaced out');
    expect(sanitiseParam('  trimmed  ')).toBe('trimmed');
  });

  it('applies to a resolved customer name too', () => {
    expect(resolveVariables(['1'], { 1: { kind: 'CUSTOMER', field: 'name', fallback: 'there' } }, {
      ...customer, waProfileName: 'Naveen\nKumar',
    })).toEqual(['Naveen Kumar']);
  });
});

describe('missingVariables', () => {
  it('**names the placeholder that sank the production campaign**', () => {
    expect(missingVariables(['1'], {})).toEqual(['1']);
  });

  it('treats a blank literal as missing — an empty parameter is refused by Meta', () => {
    expect(missingVariables(['1'], { 1: '' })).toEqual(['1']);
    expect(missingVariables(['1'], { 1: { kind: 'TEXT', value: '   ' } })).toEqual(['1']);
  });

  it('accepts a customer value, because its fallback is required and non-empty', () => {
    expect(missingVariables(['1'], { 1: { kind: 'CUSTOMER', field: 'name', fallback: 'there' } }))
      .toEqual([]);
  });

  it('reports only the unfilled ones', () => {
    expect(missingVariables(['1', '2', '3'], { 1: 'a', 3: 'c' })).toEqual(['2']);
  });

  it('is empty for a template with no placeholders — the common case must not be blocked', () => {
    expect(missingVariables([], {})).toEqual([]);
  });
});

describe('variableValuesSchema', () => {
  it('**refuses a customer value with no fallback**', () => {
    // Without this the schema would accept the one shape that fails per recipient rather
    // than up front.
    expect(variableValuesSchema.safeParse({ 1: { kind: 'CUSTOMER', field: 'name' } }).success)
      .toBe(false);
    expect(variableValuesSchema.safeParse({
      1: { kind: 'CUSTOMER', field: 'name', fallback: '  ' },
    }).success).toBe(false);
  });

  it('refuses a field that is not one we resolve', () => {
    expect(variableValuesSchema.safeParse({
      1: { kind: 'CUSTOMER', field: 'creditCard', fallback: 'x' },
    }).success).toBe(false);
  });

  it('accepts both shapes, and the legacy string', () => {
    expect(variableValuesSchema.safeParse({
      1: 'Diwali',
      2: { kind: 'TEXT', value: '20%' },
      3: { kind: 'CUSTOMER', field: 'name', fallback: 'there' },
    }).success).toBe(true);
  });
});

describe('renderBody', () => {
  it('shows what the customer will read', () => {
    expect(renderBody('Hi {{1}}, {{2}} off this week', ['Naveen', '20%']))
      .toBe('Hi Naveen, 20% off this week');
  });

  it('leaves a placeholder alone rather than printing undefined', () => {
    // The composer renders as you type, so most of the time some are still unfilled.
    expect(renderBody('Hi {{1}}, {{2}}', ['Naveen'])).toBe('Hi Naveen, {{2}}');
    expect(renderBody('Hi {{name}}', ['Naveen'])).toBe('Hi {{name}}');
  });

  it('tolerates the spacing Meta allows inside braces', () => {
    expect(renderBody('Hi {{ 1 }}', ['Naveen'])).toBe('Hi Naveen');
  });
});
