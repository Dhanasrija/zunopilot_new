/*
 * How to reach ZunoPilot, in one place.
 *
 * **Why a module for four strings.** The support number was written out in three
 * formats across three files — `+919390683154` in a `tel:` href, `+91 939-068-3154` as
 * the visible label, and `+91-9390683154` inside the Organization JSON-LD in
 * index.html. Changing the number meant finding all three, and the one that gets missed
 * is the structured-data copy, because nothing on the page shows it. A `contactPoint`
 * advertising a number nobody answers is worse than no `contactPoint` at all.
 *
 * index.html is static and cannot import this, so its JSON-LD still holds a literal —
 * but `contact.test.ts` asserts the two agree, which turns "someone will notice
 * eventually" into a failing build.
 */

export const SUPPORT_EMAIL = 'support@zunopilot.com';

/**
 * The number, digits only with a country code and a leading `+`.
 *
 * E.164 because that is what `tel:` should carry and what schema.org's `telephone`
 * expects. Never render this — see `SUPPORT_PHONE_DISPLAY`.
 */
export const SUPPORT_PHONE_E164 = '+919014793487';

/** The same number, grouped for reading. */
export const SUPPORT_PHONE_DISPLAY = '+91 90147 93487';

/**
 * The `telephone` value in the Organization graph in index.html.
 *
 * schema.org accepts either form; the hyphenated one is what the file already used and
 * changing it would be churn. Stated here so the test has something to compare against.
 */
export const SUPPORT_PHONE_SCHEMA = '+91-9014793487';

/**
 * A WhatsApp chat, prefilled.
 *
 * `wa.me` rather than `api.whatsapp.com/send`: both work, but `wa.me` is the short form
 * Meta documents and it opens the installed app on mobile instead of bouncing through
 * web.whatsapp.com first. The number in the path carries no `+` — that is the format
 * `wa.me` requires, and passing one silently produces a broken link.
 */
export const WHATSAPP_LINK =
  `https://wa.me/${SUPPORT_PHONE_E164.replace('+', '')}`
  + `?text=${encodeURIComponent("Hi ZunoPilot, I'd like to know more about WhatsApp automation.")}`;

/** The registered address, as it appears in the footer. */
export const OFFICE_ADDRESS =
  '#514, Manjeera Trinity Corporate, JNTU-Hitech City Road, Kukatpally, '
  + 'Hyderabad, Telangana 500072, India';
