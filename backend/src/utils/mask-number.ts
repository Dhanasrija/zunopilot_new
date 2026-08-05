// Hiding most of a phone number.
//
// **The threat this addresses is an agent collecting a contact list**, not an agent seeing
// a number at all. So the shape is "enough to confirm, not enough to use": the last four
// digits let someone match a caller who reads out the end of their number, and nothing
// more. Six digits withheld from a ten-digit Indian number is 10^6 of nothing to dial.
//
// **Two constraints on the output, both discovered rather than chosen.**
//
//   1. **It must begin with `+`.** `phoneLabel` in `frontend/src/pages/Customers.tsx` runs
//      the value through libphonenumber and, when that fails, falls back to
//      `raw.startsWith('+') ? raw : '+' + raw`. A masked string without the plus would be
//      rendered as `++91 …`. Starting with it means every existing display path shows this
//      unchanged and no frontend formatter needs to know masking exists.
//   2. **It must not be parseable as a number.** The bullet character is deliberate: a
//      masked value that looked like digits could be dialled, stored, or compared as
//      though it were real.

/** The bullet used for a hidden digit. U+2022, which renders in every font we ship. */
const HIDDEN = '•';

/** How many digits stay visible. */
export const VISIBLE_DIGITS = 4;

/**
 * A masked form of a stored number, or `null` when there is nothing to mask.
 *
 * `input` is E.164 digits without the plus, as `normalisePhone` and `Customer.waId` hold
 * them — but anything is tolerated, because this also runs over `Customer.phone`, which is
 * free text a person typed.
 *
 * Short values are masked **entirely** rather than partly. Revealing the last four digits
 * of a six-digit value would leave two, which is not privacy — so anything that cannot
 * spare the digits gives up none of them.
 */
export const maskedNumber = (input: string | null | undefined): string | null => {
  if (input === null || input === undefined) return null;

  const digits = input.replace(/\D/g, '');
  if (!digits) {
    // Something with no digits at all — an empty string, or free text in `phone`. There is
    // nothing to hide and nothing to show.
    return null;
  }

  // A number too short to reveal part of. `VISIBLE_DIGITS * 2` is the threshold: below it,
  // showing four would expose at least half.
  if (digits.length < VISIBLE_DIGITS * 2) {
    return `+${HIDDEN.repeat(digits.length)}`;
  }

  const shown = digits.slice(-VISIBLE_DIGITS);
  const hidden = HIDDEN.repeat(digits.length - VISIBLE_DIGITS);
  return `+${hidden}${shown}`;
};

/**
 * Is this string a masked number rather than a real one?
 *
 * For assertions and for any code that must not treat a masked value as dialable. Cheaper
 * and clearer than checking for the bullet at each call site.
 */
export const isMasked = (value: string | null | undefined): boolean =>
  typeof value === 'string' && value.includes(HIDDEN);

/**
 * Any object carrying a contact number.
 *
 * Three field names, because the number is denormalised in three shapes:
 *
 *   • `waId` — `Customer`'s WhatsApp identity, the canonical one.
 *   • `phone` — `Customer`'s optional secondary number, free text.
 *   • `contactPhone` — a **snapshot on `Order`**, written at checkout from
 *     `customer.phone || customer.waId`. Easy to miss and the reason this interface is not
 *     just about customers: masking a customer while the order beside it in the same
 *     payload shows the number in full would defeat the whole feature.
 */
export interface MaskableContact {
  waId?: string | null;
  phone?: string | null;
  contactPhone?: string | null;
}

/**
 * Mask a contact's numbers in place, and say so.
 *
 * **In place, not into new fields.** Every display path in the frontend already reads
 * `waId` and `phone`; replacing the values means nothing downstream needs changing, and —
 * more importantly — a path that was *missed* shows bullets rather than a number. Adding
 * `maskedWaId` alongside would have meant every forgotten call site kept leaking.
 *
 * `numberMasked` is the flag the UI reads to explain *why* a number is hidden. It is
 * deliberately not used to disable dial or copy controls, because the survey found none on
 * these screens — but it exists so the next person to add one has the signal.
 */
export const maskContact = <T extends MaskableContact>(
  contact: T,
  seeFull: boolean,
): T & { numberMasked: boolean } => {
  if (seeFull) return { ...contact, numberMasked: false };
  // Each field is spread conditionally so a payload that never selected one does not gain a
  // null version of it — that would change the response shape for callers that deliberately
  // left it out.
  return {
    ...contact,
    ...(contact.waId === undefined ? {} : { waId: maskedNumber(contact.waId) }),
    ...(contact.phone === undefined ? {} : { phone: maskedNumber(contact.phone) }),
    ...(contact.contactPhone === undefined
      ? {}
      : { contactPhone: maskedNumber(contact.contactPhone) }),
    numberMasked: true,
  } as T & { numberMasked: boolean };
};
