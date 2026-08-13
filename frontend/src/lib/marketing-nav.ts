/*
 * The public site's link graph, in one place.
 *
 * **Why this is a module and not markup.** The marketing site is now eleven-plus
 * routes deep — a features hub with detail pages under it, a solutions hub with its
 * own children, an industries page and the API page — and the header, the footer and
 * several in-page CTA rows all have to agree about where each of those lives. When
 * the same URL was written out in four components, adding `/features/whatsapp-campaigns`
 * meant remembering four edits, and the one that got forgotten was always the footer.
 *
 * Anything with `anchor: true` is a fragment on the home page rather than a route, so
 * the header renders it as an `<a>` and the scroll-spy can claim it. Everything else
 * is a react-router `<Link>`.
 */

export interface NavItem {
  label: string;
  href: string;
  /** A `#id` on the home page rather than its own route. */
  anchor?: boolean;
  /**
   * One line for a dropdown row.
   *
   * Only read by the header's menu. A bare list of seven feature names is a list of
   * seven nouns; the blurb is what lets someone pick without opening three of them.
   */
  blurb?: string;
  /**
   * Sub-pages, rendered as a dropdown in the header and an indented group in the
   * mobile drawer. The parent stays a real link — the dropdown is in addition to it,
   * not instead of it, so "Features" still reaches the hub.
   */
  children?: readonly NavItem[];
}


/**
 * The feature pages, in the order the features hub lists them.
 *
 * Shared with the footer so the two cannot disagree, and shared with the hub page
 * itself for the "which feature fits your need" table.
 */
export const FEATURE_LINKS: readonly NavItem[] = [
  {
    label: 'WhatsApp Automation',
    href: '/features/whatsapp-automation',
    blurb: 'Turn repetitive communication into workflows',
  },
  {
    label: 'AI WhatsApp Automation',
    href: '/features/ai-whatsapp-automation',
    blurb: 'Handle enquiries in the customer\u2019s own words',
  },
  {
    label: 'WhatsApp Number Masking',
    href: '/features/whatsapp-number-masking',
    blurb: 'Keep control of customer-facing numbers',
  },
  {
    label: 'WhatsApp Campaigns',
    href: '/features/whatsapp-campaigns',
    blurb: 'Promotions and updates that start conversations',
  },
  {
    label: 'WhatsApp Team Inbox',
    href: '/features/whatsapp-team-inbox',
    blurb: 'Multiple agents, no duplicate replies',
  },
  {
    label: 'WhatsApp Business API',
    href: '/features/whatsapp-business-api',
    blurb: 'Connect WhatsApp to your own systems',
  },
];

/**
 * The solution pages, in the order the solutions hub lists them.
 *
 * Blurbs for the same reason `FEATURE_LINKS` has them: six nouns in a dropdown is a
 * list to read twice, six nouns with a line each is a list to choose from once.
 */
export const SOLUTION_LINKS: readonly NavItem[] = [
  {
    label: 'Lead Management',
    href: '/solutions/lead-management',
    blurb: 'Capture enquiries and keep follow-up on schedule',
  },
  {
    label: 'Sales Automation',
    href: '/solutions/sales-automation',
    blurb: 'Automate the repeatable half of selling',
  },
  {
    label: 'Customer Support',
    href: '/solutions/customer-support',
    blurb: 'Routine requests handled, the rest escalated',
  },
  {
    label: 'Marketing Automation',
    href: '/solutions/marketing-automation',
    blurb: 'Promotions and updates that start conversations',
  },
  {
    label: 'Customer Engagement',
    href: '/solutions/customer-engagement',
    blurb: 'Stay connected after the first conversation',
  },
  {
    label: 'Industry Solutions',
    href: '/industries',
    blurb: 'How each kind of business uses WhatsApp',
  },
];

/**
 * The header, and the "Menus" column in the footer.
 *
 * Declared *after* `FEATURE_LINKS` and `SOLUTION_LINKS` above, because the Features and
 * Solutions entries reference them as their dropdowns — a `const` cannot be read before
 * it is initialised.
 *
 * **Testimonial and FAQ are deliberately not here.** They were home-page fragments
 * (`/#testimonial`, `/#faq`) sitting between real routes, so on every page except the
 * home page two of the seven nav items navigated somewhere else entirely. Both sections
 * still exist on the home page and both are still reachable — FAQ from the footer's
 * Company column, testimonials by scrolling — they are simply not top-level destinations.
 */
export const PRIMARY_NAV: readonly NavItem[] = [
  { label: 'Home', href: '/' },
  { label: 'Features', href: '/features', children: FEATURE_LINKS },
  { label: 'Solutions', href: '/solutions', children: SOLUTION_LINKS },
  { label: 'Pricing', href: '/pricing' },
  { label: 'Contact Us', href: '/contact' },
];

/** The legal column. */
export const LEGAL_LINKS: readonly NavItem[] = [
  { label: 'Privacy Policy', href: '/privacy' },
  { label: 'Terms & Condition', href: '/terms' },
  { label: "FAQ's", href: '/#faq', anchor: true },
];

/**
 * The words on the primary call to action, in one place.
 *
 * It read "Start Free" in six components and "Start free trial" / "Start Free Trial" in
 * two more, which is three promises about the same button. "Get Started" is the one the
 * site makes now, and a constant is what stops the ninth component from inventing a
 * fourth.
 */
export const CTA_LABEL = 'Get Started';

/**
 * Where the primary CTA goes.
 *
 * **`/login`, not `/signup`.** Signing up and signing in are one flow — a phone number
 * either has an account or gets one — and `/signup` only ever `<Navigate>`d to `/login`.
 * Pointing at the redirect meant every CTA cost an extra client-side hop and showed
 * `/signup` in the address bar for a page that is the sign-in screen. The `/signup`
 * route stays, because ad landing pages and printed material name it.
 */
export const SIGNUP_LINK = '/login';
