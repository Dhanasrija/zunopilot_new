// A customer has two names, and which one you want depends on who is reading.
//
// `Customer.waProfileName` is what WhatsApp says they call themselves, refreshed on every
// inbound message. For a WhatsApp Business account it is the business's display name — it is
// why the Inbox reads "The Jora Group" rather than a phone number. It is also **the only
// profile field Meta gives us**: `contacts[].profile` carries `name` and nothing else, there
// is no endpoint for a contact's photo, and nothing in the payload marks the sender as a
// business rather than a person who named their profile after one.
//
// `Customer.name` is the agent's own label. Null until somebody types one. It exists because
// "Ravi — accounts, chases invoices" is worth writing down and used to be destroyed by the
// next inbound message: one column held both meanings and the webhook overwrote it every time.
//
// **The distinction that matters is not cosmetic.** One of these can be interpolated into a
// message the customer receives and the other cannot, so the choice is made here, once, rather
// than at nine call sites that each look reasonable in isolation.

/** The two name fields, and nothing else — so this works on a full row or a narrow select. */
export interface NamedContact {
  name?: string | null;
  waProfileName?: string | null;
}

const trimmed = (value: string | null | undefined): string | null => {
  const text = value?.trim();
  return text ? text : null;
};

/**
 * The name to use in anything the **customer** will read.
 *
 * Campaign variables, workflow scope, an order confirmation: all of these end up inside a
 * WhatsApp message. An agent's label is an internal note — sending "Hi Ravi — accounts, chases
 * invoices," would be a small disaster, and the kind that only shows up in production.
 *
 * Falls back to `name` when there is no profile name at all, which is the case for a customer
 * created by hand or imported: there the agent's entry is the only name anyone has, and it was
 * almost certainly typed as a name rather than as a note.
 */
export const customerFacingName = (contact: NamedContact): string | null =>
  trimmed(contact.waProfileName) ?? trimmed(contact.name);

/**
 * What an **operator** sees: WhatsApp's name, with the agent's label after it when it adds
 * something.
 *
 * `The Jora Group (Ravi — accounts)`. One string rather than two fields, so the Inbox list, the
 * thread header, the Customers table and a notification cannot drift into three formats.
 *
 * **The two are collapsed when equal**, which is what makes the migration safe. Every existing
 * row had `name` copied into `waProfileName`, because the old upsert had already overwritten
 * `name` with the profile name on every message — clearing it instead would have destroyed the
 * one case where it genuinely was an agent's label. So duplicates are expected, and they render
 * as one name rather than "X (X)".
 *
 * **Returns null when there is no name at all, rather than falling back to the number.** That
 * looks like a missing convenience and is deliberate: `notification.producers.ts` puts
 * `maskedNumber(waId)` in that gap, and a helper that quietly supplied the raw `waId` would
 * undo number masking in the one place a notification is most likely to be read by someone who
 * is not allowed to see it. The fallback belongs to whoever knows what is safe to show.
 */
export const operatorDisplayName = (contact: NamedContact): string | null => {
  const profile = trimmed(contact.waProfileName);
  const label = trimmed(contact.name);

  if (profile && label && profile !== label) return `${profile} (${label})`;
  return profile ?? label;
};
