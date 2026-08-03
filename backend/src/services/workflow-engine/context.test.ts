import { describe, expect, it } from 'vitest';
import { buildContext, interpolate, interpolateConfig, readPath } from './context.js';

// Template interpolation is a security boundary, not a convenience: whoever can
// edit a workflow controls every template string a node evaluates, and inbound
// WhatsApp text flows into `message.text`. These tests pin the properties that
// make it safe to run untrusted templates.

const ctx = buildContext({
  tenant: { businessName: 'Acme Hospital', category: 'HEALTHCARE' } as never,
  customer: { name: 'Asha', waId: '15550009911', phone: '15550009911', lifetimeSpend: 250 } as never,
  conversation: { id: 'conv_1', status: 'OPEN' } as never,
  message: { body: 'book a cardiologist', type: 'TEXT' } as never,
  variables: { speciality: 'Cardiology', slots: ['10:00', '11:30'] },
});

describe('readPath', () => {
  it('resolves a whitelisted dotted path', () => {
    expect(readPath(ctx, 'customer.name')).toBe('Asha');
    expect(readPath(ctx, 'vars.speciality')).toBe('Cardiology');
  });

  it('returns empty for anything not in the context', () => {
    expect(readPath(ctx, 'tenant.accessToken')).toBe('');
    expect(readPath(ctx, 'nope')).toBe('');
  });

  it('blocks prototype walking', () => {
    expect(readPath(ctx, '__proto__')).toBe('');
    expect(readPath(ctx, 'customer.constructor')).toBe('');
    expect(readPath(ctx, 'customer.__proto__.name')).toBe('');
  });

  it('bounds path depth', () => {
    expect(readPath(ctx, 'a.b.c.d.e.f')).toBe('');
  });
});

describe('interpolate', () => {
  it('substitutes tokens', () => {
    expect(interpolate('Hi {{customer.name}} 👋', ctx)).toBe('Hi Asha 👋');
  });

  it('leaves an unknown token as an empty string rather than the literal token', () => {
    expect(interpolate('[{{nope.here}}]', ctx)).toBe('[]');
  });

  it('does not evaluate expressions inside a token', () => {
    // If this ever returned '2' the implementation would have moved to eval.
    expect(interpolate('{{1+1}}', ctx)).toBe('{{1+1}}');
  });

  it('does not re-expand a token that came from customer text', () => {
    // The customer typed a template. Substituting it once must not then treat
    // the result as a template again.
    const hostile = buildContext({
      message: { body: '{{tenant.name}}', type: 'TEXT' } as never,
      variables: {},
    });
    expect(interpolate('You said: {{message.text}}', hostile)).toBe('You said: {{tenant.name}}');
  });

  it('passes non-strings through untouched', () => {
    expect(interpolate(42, ctx)).toBe(42);
    expect(interpolate(null, ctx)).toBeNull();
  });
});

describe('interpolateConfig', () => {
  it('walks objects and arrays', () => {
    const out = interpolateConfig(
      { body: 'Hi {{customer.name}}', params: ['{{vars.speciality}}', 'literal'], keep: 7 },
      ctx,
    );
    expect(out).toEqual({ body: 'Hi Asha', params: ['Cardiology', 'literal'], keep: 7 });
  });

  it('serialises an object-valued variable rather than emitting [object Object]', () => {
    expect(interpolate('{{vars.slots}}', ctx)).toBe('["10:00","11:30"]');
  });
});
