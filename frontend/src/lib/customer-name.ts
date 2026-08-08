// A customer has two names, and the screens have to agree about how to show both.
//
// `waProfileName` is what WhatsApp says they call themselves, refreshed on every inbound
// message — for a WhatsApp Business account it is the business's display name, which is why the
// Inbox reads "The Jora Group" and not a phone number. It is also the *only* profile field Meta
// gives us: there is no contact photo, and nothing in the payload says whether the sender is a
// business or a person who named their profile after one. The tinted initials are the substitute.
//
// `name` is the operator's own label, and it is null until somebody types one. It exists because
// "Ravi — accounts, chases invoices" is worth writing down and used to be destroyed by the next
// inbound message: one column held both meanings and the webhook overwrote it every time.
//
// Here rather than in `components/inbox/types.ts` because the Customers table needs the same
// answer, and two copies of this would drift into two formats for one person.

export interface NamedContact {
  name?: string | null;
  waProfileName?: string | null;
}

const trimmed = (value: string | null | undefined): string | null => {
  const text = value?.trim();
  return text ? text : null;
};

/**
 * The single name this person is best known by — WhatsApp's, falling back to the label.
 *
 * For initials and for the avatar tint, where a two-part string would produce nonsense: "The
 * Jora Group (Ravi)" initialises to "TJ" from the profile name, not "TG(R" from the whole label.
 */
export const primaryName = (contact: NamedContact): string | undefined =>
  trimmed(contact.waProfileName) ?? trimmed(contact.name) ?? undefined;

/**
 * What to show an operator: WhatsApp's name, then the label in brackets when it adds something.
 *
 * `The Jora Group (Ravi — accounts)`. Falls back to the number, which is already masked by the
 * server when the seat does not hold `customers:view_full_number` — this must never try to
 * un-mask or reformat it.
 *
 * **The two collapse when equal**, and that is what makes the migration safe rather than a
 * cosmetic nicety. Every existing row had `name` copied into `waProfileName`, because the old
 * upsert had already overwritten `name` from WhatsApp on every message; clearing it instead
 * would have destroyed the one case where it really was somebody's label. So duplicates are
 * expected, and a duplicate must read as one name rather than "X (X)".
 */
export const displayName = (contact: NamedContact & { waId?: string | null }): string => {
  const profile = trimmed(contact.waProfileName);
  const label = trimmed(contact.name);

  if (profile && label && profile !== label) return `${profile} (${label})`;
  return profile ?? label ?? trimmed(contact.waId) ?? 'Unknown';
};
