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

/** The solution pages, in the order the solutions hub lists them. */
export const SOLUTION_LINKS: readonly NavItem[] = [
  { label: 'Lead Management', href: '/solutions/lead-management' },
  { label: 'Sales Automation', href: '/solutions/sales-automation' },
  { label: 'Customer Support', href: '/solutions/customer-support' },
  { label: 'Marketing Automation', href: '/solutions/marketing-automation' },
  { label: 'Customer Engagement', href: '/solutions/customer-engagement' },
  { label: 'Industry Solutions', href: '/industries' },
];

/**
 * The header, and the "Menus" column in the footer.
 *
 * Declared *after* `FEATURE_LINKS` and `SOLUTION_LINKS`, because both hub entries reference
 * their list as a dropdown — a `const` cannot be read before it is initialised.
 */
export const PRIMARY_NAV: readonly NavItem[] = [
  { label: 'Home', href: '/' },
  { label: 'Features', href: '/features', children: FEATURE_LINKS },
  // Solutions now opens the same way Features does. Both hubs have real children, and a hub
  // whose children are only reachable *from the hub* buries six indexable pages one click
  // deeper than they need to be — for a visitor and for a crawler.
  { label: 'Solutions', href: '/solutions', children: SOLUTION_LINKS },
  { label: 'Pricing', href: '/pricing' },
  /*
   * **Testimonial and FAQ were removed from the bar.**
   *
   * Both were fragments of the home page rather than pages, so on any other route they meant
   * "leave this page, go to `/`, then scroll" — a nav item that navigates away is a strange
   * thing to put beside five real destinations. Both sections are still on the home page, still
   * have their `#testimonial` and `#faq` anchors, and the FAQ is still linked from the footer,
   * so nothing became unreachable.
   */
  { label: 'Contact Us', href: '/contact' },
];

/** The legal column. */
export const LEGAL_LINKS: readonly NavItem[] = [
  { label: 'Privacy Policy', href: '/privacy' },
  { label: 'Terms & Condition', href: '/terms' },
  { label: "FAQ's", href: '/#faq', anchor: true },
];

/**
 * Where the primary CTA goes.
 *
 * **Points at `/login` directly, and the label is "Get Started".** It used to say "Start Free"
 * and point at `/signup`, which then redirected to `/login` — so every click paid for a redirect
 * to reach the page it was always going to reach. Signing up and signing in are one flow here: a
 * phone number either has an account or gets one, so there is no separate signup screen for the
 * old URL to be worth preserving.
 *
 * `/signup` still exists as a route and still redirects, because it is the URL that appears in
 * older copy and in anything already pasted into a browser.
 */
export const GET_STARTED_LINK = '/login';

/**
 * @deprecated Kept so nothing breaks mid-refactor; use `GET_STARTED_LINK`.
 */
export const SIGNUP_LINK = GET_STARTED_LINK;
