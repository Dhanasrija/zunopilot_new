import { PAGE_HEADS } from './page-heads';

/*
 * The sitemap, as code.
 *
 * **Why this file exists, and what it is not.** `sitemap.ts` in a Next.js project is a
 * framework convention: Next reads `app/sitemap.ts` at build time and serves the result at
 * `/sitemap.xml`. This project is Vite + React Router, which has no such convention — a
 * file named `sitemap.ts` is, to Vite, just a module nobody imports. So this is not that
 * convention; it is the same *idea* implemented for this stack: one typed source of truth,
 * and a build step (`scripts/generate-sitemap.mjs`) that writes `public/sitemap.xml` from
 * it. What crawlers fetch is still a plain static XML file at the origin, because that is
 * the only thing the sitemap protocol actually specifies.
 *
 * **What it replaces.** `public/sitemap.xml` was hand-written — nineteen URLs, each with a
 * `lastmod`, `changefreq` and `priority` typed out by hand. A test already asserted that
 * the file and `PAGE_HEADS` were the same set, which caught a *missing* or *extra* URL, but
 * nothing stopped the two from disagreeing about anything else, and nothing stopped a
 * malformed entry from shipping. Deriving the list from `PAGE_HEADS` makes the set
 * agreement structural rather than asserted: adding a page means adding a head, and the
 * URL follows.
 *
 * **What is deliberately still manual.** `lastmod`, `changefreq` and `priority` are stated
 * per page in `PAGE_METADATA` below, because they are editorial judgements, not facts a
 * build can derive. A `lastmod` set from the build clock is worse than none — it tells
 * Google every page changed every deploy, and Google learns to ignore the field. See the
 * note on `PAGE_METADATA`.
 */

/**
 * The canonical origin, with no trailing slash.
 *
 * The same value `document-head.ts` builds canonicals from, restated rather than imported
 * because that module reaches for `document` at module scope and this one runs in Node
 * during the build. Kept in step by `sitemap.test.ts`.
 */
export const SITE_ORIGIN = 'https://zunopilot.com';

/** How often the content behind a URL actually changes. */
type ChangeFreq = 'daily' | 'weekly' | 'monthly' | 'yearly';

export interface SitemapEntry {
  /** Path with a leading slash. `/` for the home page. */
  path: string;
  /**
   * The date the page's **copy** last changed, `YYYY-MM-DD`.
   *
   * Not a build timestamp, and this is the whole point of the field. A `lastmod` that moves
   * on every deploy is a page that claims to change daily; Google notices that the claim is
   * not borne out and stops trusting the field for the whole site. So it is edited by hand,
   * when the words on the page are edited.
   */
  lastmod: string;
  changefreq: ChangeFreq;
  /**
   * Relative importance within this site only, 0.0–1.0.
   *
   * It says nothing to Google about ranking against other sites, and Google has said it
   * largely ignores the field. It stays because it costs nothing and other crawlers do read
   * it — but it is not worth agonising over.
   */
  priority: number;
}

/**
 * The editorial half, keyed by the same paths `PAGE_HEADS` declares.
 *
 * Typed as a lookup rather than a list so a page in `PAGE_HEADS` with nothing here is a
 * type error, not a silently-defaulted entry. That is the direction that matters: adding a
 * page and forgetting its sitemap metadata should not compile.
 */
const PAGE_METADATA: Record<string, Omit<SitemapEntry, 'path'>> = {
  '/': { lastmod: '2026-08-13', changefreq: 'weekly', priority: 1.0 },

  '/features': { lastmod: '2026-08-13', changefreq: 'monthly', priority: 0.9 },
  '/solutions': { lastmod: '2026-08-13', changefreq: 'monthly', priority: 0.9 },

  '/features/whatsapp-automation': { lastmod: '2026-08-12', changefreq: 'monthly', priority: 0.8 },
  '/features/ai-whatsapp-automation': { lastmod: '2026-08-13', changefreq: 'monthly', priority: 0.8 },
  '/features/whatsapp-number-masking': { lastmod: '2026-08-12', changefreq: 'monthly', priority: 0.8 },
  '/features/whatsapp-campaigns': { lastmod: '2026-08-12', changefreq: 'monthly', priority: 0.8 },
  '/features/whatsapp-team-inbox': { lastmod: '2026-08-12', changefreq: 'monthly', priority: 0.8 },
  '/features/whatsapp-business-api': { lastmod: '2026-08-12', changefreq: 'monthly', priority: 0.8 },

  '/pricing': { lastmod: '2026-08-13', changefreq: 'monthly', priority: 0.8 },
  '/contact': { lastmod: '2026-08-13', changefreq: 'monthly', priority: 0.6 },

  // Legal pages change when the terms change, which is rarely and never on a schedule.
  '/privacy': { lastmod: '2026-08-05', changefreq: 'yearly', priority: 0.3 },
  '/terms': { lastmod: '2026-08-05', changefreq: 'yearly', priority: 0.3 },
};

/**
 * Every URL to advertise, in the order the site is structured.
 *
 * **Derived from `PAGE_HEADS`, filtered on `path !== null`.** That filter is the mechanism
 * that keeps the placeholders out: `/solutions/*` and `/industries` render `ComingSoon`,
 * which sets `noindex, follow` and no canonical, so they have no entry in `PAGE_HEADS` at
 * all — and `/login` has an entry with `path: null`, because it is `noindex` too. A sitemap
 * is a list of pages you are *asking* to be indexed, and neither group qualifies.
 *
 * A page whose head exists but whose metadata is missing above throws here rather than
 * being emitted with invented values. Failing the build is the correct response: a sitemap
 * is either right or it is misinformation.
 */
export const SITEMAP_ENTRIES: readonly SitemapEntry[] = Object.entries(PAGE_HEADS)
  .filter(([, head]) => head.path !== null)
  .map(([key, head]) => {
    const path = head.path as string;
    const meta = PAGE_METADATA[path];
    if (!meta) {
      throw new Error(
        `sitemap: PAGE_HEADS.${key} declares "${path}" but PAGE_METADATA has no entry for it. `
        + 'Add a lastmod, changefreq and priority in src/lib/sitemap.ts.',
      );
    }
    return { path, ...meta };
  });

/** The five characters XML requires escaped, in case a path ever contains one. */
const escapeXml = (value: string): string =>
  value.replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
  }[ch] as string));

/** `1.0` and `0.8`, never `1` or `0.80` — the protocol wants one decimal place. */
const formatPriority = (n: number): string => n.toFixed(1);

/**
 * The complete `sitemap.xml` document, including the trailing newline.
 *
 * A string rather than a file write, so the same function serves the generator *and* the
 * test that asserts the committed file matches it. That is what makes the check meaningful:
 * if someone edits `public/sitemap.xml` by hand, the test fails and prints the diff.
 */
export const buildSitemapXml = (
  entries: readonly SitemapEntry[] = SITEMAP_ENTRIES,
): string => {
  const urls = entries.map((entry) => [
    '  <url>',
    `    <loc>${escapeXml(`${SITE_ORIGIN}${entry.path}`)}</loc>`,
    `    <lastmod>${entry.lastmod}</lastmod>`,
    `    <changefreq>${entry.changefreq}</changefreq>`,
    `    <priority>${formatPriority(entry.priority)}</priority>`,
    '  </url>',
  ].join('\n')).join('\n');

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!--',
    '  GENERATED FILE — do not edit.',
    '',
    '  Written by scripts/generate-sitemap.mjs from src/lib/sitemap.ts, which derives the URL',
    '  list from src/lib/page-heads.ts. Edit those, then run `npm run sitemap` (the build does',
    '  it for you). src/lib/sitemap.test.ts fails if this file and that module disagree, so a',
    '  hand-edit here does not survive CI.',
    '',
    `  ${entries.length} URLs. Pages that set noindex are absent by construction: the placeholders`,
    '  under /solutions and /industries have no PAGE_HEADS entry, and /login has one with a null',
    '  path. A sitemap is a request to index, and neither group is asking.',
    '-->',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    urls,
    '</urlset>',
    '',
  ].join('\n');
};
