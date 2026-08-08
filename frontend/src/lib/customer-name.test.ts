import { describe, expect, it } from 'vitest';
import { displayName, primaryName } from './customer-name';

/*
 * How a customer's two names are shown.
 *
 * `waProfileName` is WhatsApp's — for a business account, the business's display name.
 * `name` is the operator's own label, null until somebody types one.
 *
 * The whole reason this needs its own tests: **the collapse rule is what makes the migration
 * safe.** Every existing row had `name` copied into `waProfileName`, so equal values are the norm
 * rather than an edge case, and getting it wrong puts "The Jora Group (The Jora Group)" on every
 * customer in the workspace.
 */

const contact = (over: Partial<{ name: string | null; waProfileName: string | null; waId: string }> = {}) => ({
  name: null,
  waProfileName: null,
  waId: '917702000350',
  ...over,
});

describe('displayName', () => {
  it('**puts the operator’s label in brackets after WhatsApp’s name**', () => {
    expect(displayName(contact({ waProfileName: 'The Jora Group', name: 'Ravi — accounts' })))
      .toBe('The Jora Group (Ravi — accounts)');
  });

  it('**collapses a duplicate rather than printing it twice**', () => {
    // The migrated state of every pre-existing customer. Without this, the Inbox list reads
    // "Asha (Asha)" on every row the day this ships.
    expect(displayName(contact({ waProfileName: 'Asha', name: 'Asha' }))).toBe('Asha');
  });

  it('shows whichever name exists on its own', () => {
    expect(displayName(contact({ waProfileName: 'Asha' }))).toBe('Asha');
    // An imported contact nobody has messaged: the label is the only name there is.
    expect(displayName(contact({ name: 'Asha' }))).toBe('Asha');
  });

  it('**falls back to the number, and does not reformat it**', () => {
    /*
     * The server has already masked it to `+••••••0350` when the seat lacks
     * `customers:view_full_number`. Anything clever here — re-adding a `+`, grouping digits —
     * would either corrupt the mask or imply this code knows the real number. It does not.
     */
    expect(displayName(contact())).toBe('917702000350');
    expect(displayName(contact({ waId: '+••••••0350' }))).toBe('+••••••0350');
  });

  it('treats whitespace as no name at all', () => {
    expect(displayName(contact({ waProfileName: '  ', name: '\t' }))).toBe('917702000350');
    // And never builds an empty bracket.
    expect(displayName(contact({ waProfileName: 'Asha', name: '   ' }))).toBe('Asha');
  });
});

describe('primaryName', () => {
  it('**is the single name, for initials and the avatar tint**', () => {
    /*
     * Initials come from here rather than from `displayName`, because "The Jora Group (Ravi)"
     * initialises to nonsense — the avatar would read "TG(R" instead of "TJ".
     */
    expect(primaryName(contact({ waProfileName: 'The Jora Group', name: 'Ravi — accounts' })))
      .toBe('The Jora Group');
  });

  it('is undefined, not an empty string, when there is no name', () => {
    // `initialsOf` takes an optional name and derives from the number instead; an empty string
    // would be a name it had to render.
    expect(primaryName(contact())).toBeUndefined();
  });

  it('keeps the tint stable for a customer migrated from the old single column', () => {
    // The tint keys on this. For every pre-existing row `waProfileName` holds what `name` used to,
    // so the same person stays the same colour rather than every avatar changing on deploy.
    expect(primaryName(contact({ waProfileName: 'Asha', name: 'Asha' }))).toBe('Asha');
  });
});
