/**
 * What the contact form can be about, and how to deep-link into it.
 *
 * This lives outside `Contact.tsx` for one reason: the "Request a Demo" buttons on
 * other pages have to name an interest that the form actually offers. Keeping the
 * list and the link in one module means a demo CTA cannot quietly point at an
 * option that no longer exists — if the label here changes, the link changes with
 * it.
 */

/**
 * The options in "Interested In".
 *
 * Marketing copy, not an enum. `POST /api/contact` deliberately validates
 * `interest` as a bounded string so adding an option here needs no backend deploy,
 * and so the two can never drift into a rejected enquiry.
 *
 * `Demo Request` leads because it is where the demo CTAs land.
 */
export const INTERESTS = [
  'Demo Request',
  'WhatsApp Business Setup',
  'Shared Team Inbox',
  'Keyword Automation',
  'Order Management',
  'Pricing & Plans',
  'Other',
] as const;

export const DEMO_REQUEST = INTERESTS[0];

/** Query parameter that preselects the dropdown, e.g. `/contact?interest=Demo%20Request`. */
export const INTEREST_PARAM = 'interest';

/**
 * Where every "Request a Demo" control should point.
 *
 * A deep link into the one enquiry form, rather than a separate `/demo` route with
 * its own form: one form means one place submissions land, so a demo request
 * arrives in the operator console alongside everything else with its intent already
 * recorded. Built through `URLSearchParams` so the space is encoded correctly.
 */
export const DEMO_REQUEST_LINK =
  `/contact?${new URLSearchParams({ [INTEREST_PARAM]: DEMO_REQUEST })}`;

/**
 * Resolve the preselection from a URL, accepting **only an exact match** from
 * `INTERESTS`.
 *
 * Two reasons this is not just `params.get('interest')`. A `<select>` handed a value
 * none of its `<option>`s carry renders blank, so a stale or mistyped link would
 * silently show an empty field rather than a sensible default. And an arbitrary
 * string off the URL has no business becoming form state that gets submitted — the
 * dropdown is the one input on that page a stranger can set by handing someone a
 * link.
 */
export const interestFromUrl = (params: URLSearchParams): string => {
  const asked = params.get(INTEREST_PARAM)?.trim().toLowerCase();
  if (!asked) return '';
  return INTERESTS.find((i) => i.toLowerCase() === asked) ?? '';
};
