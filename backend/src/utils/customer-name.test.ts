import { describe, expect, it } from 'vitest';
import { customerFacingName, operatorDisplayName } from './customer-name.js';

/*
 * Two names, and the split is not cosmetic.
 *
 * `waProfileName` is what WhatsApp reports — for a business account, the business's display name.
 * `name` is the operator's own label, and it exists because "Ravi — accounts, chases invoices" is
 * worth writing down and used to be destroyed by the customer's next message.
 *
 * **The dangerous direction is one-way.** An agent's label appearing in a campaign or a workflow
 * template means it is sent to the customer, and that is the failure this file exists to prevent.
 * Showing WhatsApp's name to an agent is harmless; showing an internal note to Ravi is not.
 */

const contact = (over: { name?: string | null; waProfileName?: string | null } = {}) => ({
  name: null,
  waProfileName: null,
  ...over,
});

describe('the name a customer will read', () => {
  it('**is WhatsApp’s, never the operator’s label**', () => {
    // The whole point. This value goes into `Hi {{1}},` on a message Ravi receives.
    expect(customerFacingName(contact({
      waProfileName: 'Ravi Kumar',
      name: 'Ravi — accounts, chases invoices',
    }))).toBe('Ravi Kumar');
  });

  it('falls back to the label when WhatsApp has told us nothing', () => {
    /*
     * A customer added by hand or imported has no profile name. There the operator's entry is the
     * only name anyone has, and it was almost certainly typed as a name rather than as a note —
     * an empty greeting is worse than a slightly informal one, and Meta rejects an empty
     * parameter outright.
     */
    expect(customerFacingName(contact({ name: 'Asha' }))).toBe('Asha');
  });

  it('is null when there is no name at all', () => {
    expect(customerFacingName(contact())).toBeNull();
  });

  it('treats whitespace as absent, in both fields', () => {
    // A form that submits "   " must not produce a greeting of "Hi    ,".
    expect(customerFacingName(contact({ waProfileName: '  ', name: 'Asha' }))).toBe('Asha');
    expect(customerFacingName(contact({ waProfileName: '  ', name: '\t' }))).toBeNull();
  });

  it('trims, because Meta counts the parameter’s characters', () => {
    expect(customerFacingName(contact({ waProfileName: '  The Jora Group ' }))).toBe('The Jora Group');
  });
});

describe('the name an operator sees', () => {
  it('**puts the label after WhatsApp’s name**', () => {
    expect(operatorDisplayName(contact({
      waProfileName: 'The Jora Group',
      name: 'Ravi — accounts',
    }))).toBe('The Jora Group (Ravi — accounts)');
  });

  it('**collapses them when they are the same**', () => {
    /*
     * This is what makes the migration safe rather than a nicety. Every existing row had `name`
     * copied into `waProfileName`, because the old upsert had already overwritten `name` from
     * WhatsApp on every message — clearing it instead would have destroyed the one case where it
     * genuinely was somebody's label. So duplicates are expected, and "X (X)" would appear on
     * every customer in the workspace the moment this shipped.
     */
    expect(operatorDisplayName(contact({
      waProfileName: 'The Jora Group', name: 'The Jora Group',
    }))).toBe('The Jora Group');
  });

  it('shows whichever one exists', () => {
    expect(operatorDisplayName(contact({ waProfileName: 'Asha' }))).toBe('Asha');
    expect(operatorDisplayName(contact({ name: 'Asha' }))).toBe('Asha');
  });

  it('**returns null rather than falling back to the number**', () => {
    /*
     * Looks like a missing convenience, and is the point. `notification.producers.ts` fills this
     * gap with `maskedNumber(waId)`; a helper that quietly supplied the raw `waId` would undo
     * number masking in a notification — which is exactly where it is most likely to be read by
     * a seat that does not hold `customers:view_full_number`.
     */
    expect(operatorDisplayName(contact())).toBeNull();
  });

  it('does not build a bracket out of whitespace', () => {
    expect(operatorDisplayName(contact({ waProfileName: 'Asha', name: '   ' }))).toBe('Asha');
  });
});
