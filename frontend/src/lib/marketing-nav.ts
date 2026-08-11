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
}

/** The header, and the "Menus" column in the footer. */
export const PRIMARY_NAV: readonly NavItem[] = [
  { label: 'Home', href: '/' },
  { label: 'Features', href: '/features' },
  { label: 'Solutions', href: '/solutions' },
  { label: 'Pricing', href: '/pricing' },
  // Both of these are sections of the home page. They only reach their target because
  // `ScrollToTop` handles fragments — see the note in that file; before it did, every
  // one of these was an expensive way of linking to the top of `/`.
  { label: 'Testimonial', href: '/#testimonial', anchor: true },
  { label: 'FAQ', href: '/#faq', anchor: true },
  { label: 'Contact Us', href: '/contact' },
];

/**
 * The feature pages, in the order the features hub lists them.
 *
 * Shared with the footer so the two cannot disagree, and shared with the hub page
 * itself for the "which feature fits your need" table.
 */
export const FEATURE_LINKS: readonly NavItem[] = [
  { label: 'WhatsApp Automation', href: '/features/whatsapp-automation' },
  { label: 'AI WhatsApp Automation', href: '/features/ai-whatsapp-automation' },
  { label: 'Shared WhatsApp Portal', href: '/features/shared-whatsapp-portal' },
  { label: 'WhatsApp Number Masking', href: '/features/whatsapp-number-masking' },
  { label: 'WhatsApp Campaigns', href: '/features/whatsapp-campaigns' },
  { label: 'WhatsApp Team Inbox', href: '/features/whatsapp-team-inbox' },
  { label: 'WhatsApp Business API', href: '/whatsapp-business-api' },
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

/** The legal column. */
export const LEGAL_LINKS: readonly NavItem[] = [
  { label: 'Privacy Policy', href: '/privacy' },
  { label: 'Terms & Condition', href: '/terms' },
  { label: "FAQ's", href: '/#faq', anchor: true },
];

/**
 * Where "Start Free" goes.
 *
 * `/signup` redirects to `/login` in App.tsx — signing up and signing in are one
 * flow — but the CTA still says `/signup`, because that is the URL the copy and the
 * ad landing pages name and it is the one people paste into a browser.
 */
export const SIGNUP_LINK = '/signup';
