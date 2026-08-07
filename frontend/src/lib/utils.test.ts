import { describe, expect, it } from 'vitest';
import { cn } from './utils';

/*
 * `cn` was deleting text colours.
 *
 * tailwind-merge resolves conflicts by class group. Our type scale (§3.2) is custom, so
 * `text-caption` was not recognised as a font size — it looked like a text colour, "conflicted"
 * with the real one, and won by being last:
 *
 *   cn('text-on-accent', 'text-caption')  ->  'text-caption'
 *
 * That is how the current page number ended up as dark text on a solid accent fill: the Button
 * variant's `text-on-accent` never survived the merge with the call site's `text-caption`.
 * Silent, and invisible in the source — both class names are right there.
 */

describe('cn', () => {
  it('**keeps a text colour when a size token is also applied**', () => {
    // The exact pairing from the pagination control, in both orders — the merge must not
    // depend on which one the call site happens to put first.
    expect(cn('text-on-accent', 'text-caption')).toContain('text-on-accent');
    expect(cn('text-on-accent', 'text-caption')).toContain('text-caption');
    expect(cn('text-caption', 'text-on-accent')).toContain('text-caption');
  });

  it('keeps colours alongside every token in the scale', () => {
    // One missing entry re-opens the bug for that size only, which is the kind of gap that
    // survives a review.
    for (const size of ['display', 'h1', 'h2', 'h3', 'body-lg', 'body', 'caption'] as const) {
      const out = cn('text-ink-700', `text-${size}`);
      expect(out, `text-${size} ate the colour`).toContain('text-ink-700');
      expect(out).toContain(`text-${size}`);
    }
  });

  it('still lets a later size replace an earlier one', () => {
    // The point of the merge is that genuine conflicts still resolve. Two sizes conflict.
    expect(cn('text-caption', 'text-h3')).toBe('text-h3');
  });

  it('still lets a later colour replace an earlier one', () => {
    expect(cn('text-ink-500', 'text-danger')).toBe('text-danger');
  });

  it('leaves Tailwind\'s own sizes working', () => {
    // `sm` is in our scale AND a Tailwind built-in; it must behave like a size either way.
    expect(cn('text-on-accent', 'text-sm')).toContain('text-on-accent');
    expect(cn('text-sm', 'text-body')).toBe('text-body');
  });

  it('reproduces the real pagination class list with the colour intact', () => {
    // Button's default variant, then the call site's overrides, verbatim.
    const out = cn(
      'bg-accent-600 text-on-accent hover:bg-accent-700',
      'h-7 w-7 text-caption border-accent-600 bg-accent-600 hover:bg-accent-700',
    );
    expect(out).toContain('text-on-accent');
    expect(out).toContain('bg-accent-600');
  });
});
