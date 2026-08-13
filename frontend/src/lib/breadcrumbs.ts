import { FEATURE_LINKS, SOLUTION_LINKS } from './marketing-nav';

/*
 * The breadcrumb trail for any public path, derived rather than declared.
 *
 * **What this replaces.** Four of the nineteen public pages had breadcrumbs: the four
 * feature pages that happened to declare a local `CRUMBS` constant and pass it to
 * `PageHero`. The features hub, the solutions hub, two feature pages, pricing, contact,
 * the legal pages and every placeholder had none — no visible trail, and no
 * `BreadcrumbList` graph either, so Google printed a raw URL in the result where it could
 * have printed `zunopilot.com › Features › WhatsApp Team Inbox`.
 *
 * The fix is not "remember to add CRUMBS to the other fifteen files". A trail is a pure
 * function of the URL and the nav table, and writing it out per page is how four pages
 * ended up with one and fifteen without. So it is computed here, once, from the same
 * `FEATURE_LINKS` / `SOLUTION_LINKS` the header and footer are built from — which means a
 * new page gets a correct trail the moment it appears in the nav.
 *
 * **On matching the visible label to the nav label.** The last crumb says what the nav
 * says, not what the `<h1>` says. Those differ deliberately — the nav reads "WhatsApp Team
 * Inbox" and the h1 reads "Give Your Team One Place to Work on WhatsApp Conversations" —
 * and a crumb is a position marker, not a title. Google's guidance is the same: the trail should
 * mirror the site's navigation.
 */

export interface Crumb {
  name: string;
  /** Path with a leading slash. The absolute URL is built where the schema is emitted. */
  path: string;
}

const HOME: Crumb = { name: 'Home', path: '/' };

/** The hubs, and the label each one contributes to a trail beneath it. */
const SECTIONS: readonly { prefix: string; crumb: Crumb }[] = [
  { prefix: '/features', crumb: { name: 'Features', path: '/features' } },
  { prefix: '/solutions', crumb: { name: 'Solutions', path: '/solutions' } },
];

/**
 * Labels for pages that are not children of a hub.
 *
 * Only the leaves that `FEATURE_LINKS` and `SOLUTION_LINKS` do not already name. Kept
 * small on purpose — anything appearing in the nav should be resolved from the nav.
 */
const STANDALONE: Record<string, string> = {
  '/': 'Home',
  '/features': 'Features',
  '/solutions': 'Solutions',
  '/industries': 'Industry Solutions',
  '/pricing': 'Pricing',
  '/contact': 'Contact Us',
  '/privacy': 'Privacy Policy',
  '/terms': 'Terms & Conditions',
  '/login': 'Sign in',
};

/** Every nav leaf that can be the last crumb, flattened to path → label. */
const NAV_LABELS: Record<string, string> = Object.fromEntries(
  [...FEATURE_LINKS, ...SOLUTION_LINKS].map((item) => [item.href, item.label]),
);

/**
 * Turn `/features/whatsapp-team-inbox` into `Home / Features / WhatsApp Team Inbox`.
 *
 * Returns `[Home]` alone for the home page — one crumb, which callers render as nothing
 * visible, because "Home" on the home page is noise. Everything else gets at least two.
 *
 * An unknown path falls back to a title-cased last segment rather than throwing. A
 * breadcrumb is decoration on a page that is already rendering; a crash here would take
 * the page with it, and `Whatsapp Team Inbox` is a perfectly serviceable guess.
 */
export const crumbsForPath = (pathname: string): readonly Crumb[] => {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (path === '/') return [HOME];

  const trail: Crumb[] = [HOME];

  // The hub, when the page sits under one. `/solutions` itself must not add itself twice,
  // hence the `!==` — the leaf below appends it.
  const section = SECTIONS.find((s) => path.startsWith(`${s.prefix}/`));
  if (section) trail.push(section.crumb);

  const label = NAV_LABELS[path] ?? STANDALONE[path] ?? titleCase(path);
  trail.push({ name: label, path });

  return trail;
};

/** `/features/whatsapp-team-inbox` → `Whatsapp Team Inbox`. The last-resort label. */
const titleCase = (path: string): string =>
  (path.split('/').filter(Boolean).pop() ?? '')
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
