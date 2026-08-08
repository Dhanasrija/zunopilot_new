import { useEffect } from 'react';

/*
 * Per-page title, description and canonical URL.
 *
 * **What this fixes, and why it was worse than nothing.** `index.html` carries one static set
 * of SEO tags, so every route served
 *
 *     <link rel="canonical" href="https://zunopilot.com/" />
 *
 * On the home page that is correct. On /pricing, /privacy, /terms and /contact it is an
 * instruction to Google saying "this page is a duplicate of the home page — index that one
 * instead". Four of the five URLs in sitemap.xml were asking not to be indexed, which Search
 * Console reports as "Alternate page with proper canonical tag" and excludes. The sitemap said
 * index these five; the canonical said index one; the canonical wins.
 *
 * The same staleness made every page claim the home page's title and description in results.
 *
 * **What this does not fix.** Social scrapers — WhatsApp, LinkedIn, Facebook, X — do not run
 * JavaScript, so they still read the static `og:*` tags from index.html and a shared /pricing
 * link still previews as the home page. Google does run JavaScript and honours a canonical set
 * this way, which is why indexing is fixed and previews are not. The only complete answer to
 * previews is prerendering, and it is a different change. The og tags are updated here anyway
 * so that anything which *does* execute JS sees the truth.
 */

/**
 * Always the production origin, whatever host served the page.
 *
 * That is the job of a canonical: it collapses www, non-www and any other host onto one
 * address. A canonical built from `window.location.origin` would have the development tunnel
 * declaring itself canonical, which is the opposite of the point.
 */
const SITE = 'https://zunopilot.com';

export interface PageHead {
  title: string;
  description: string;
  /** Canonical path, leading slash, no query string. */
  path: string;
}

const metaByName = (name: string) => document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
const metaByProperty = (p: string) => document.querySelector<HTMLMetaElement>(`meta[property="${p}"]`);

const setName = (name: string, content: string) => {
  const tag = metaByName(name);
  if (tag) tag.content = content;
};
const setProperty = (property: string, content: string) => {
  const tag = metaByProperty(property);
  if (tag) tag.content = content;
};

/**
 * The values index.html shipped, captured once before any page overwrites them.
 *
 * Read from the DOM rather than copied into a constant here. A second copy of the title and
 * description would be a second place to edit them, and index.html's own comment already warns
 * that six tags carry the same two strings and an edit to only some makes the previews
 * disagree. This cannot drift because it is not a copy.
 */
const defaults: PageHead = {
  title: document.title,
  description: metaByName('description')?.content ?? '',
  path: '/',
};

const apply = ({ title, description, path }: PageHead): void => {
  const url = `${SITE}${path === '/' ? '/' : path}`;

  document.title = title;
  setName('description', description);

  const canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (canonical) canonical.href = url;

  setProperty('og:title', title);
  setProperty('og:description', description);
  setProperty('og:url', url);

  setName('twitter:title', title);
  setName('twitter:description', description);
};

/**
 * Claim the head for this page, and hand it back on the way out.
 *
 * The restore matters: without it, navigating from /pricing into the signed-in app would leave
 * the browser tab reading "ZunoPilot Pricing" and the canonical pointing at /pricing. The app's
 * own routes are `Disallow`ed in robots.txt so Google never sees them, but the tab title is
 * visible to the person using it.
 */
export const useDocumentHead = ({ title, description, path }: PageHead): void => {
  useEffect(() => {
    apply({ title, description, path });
    return () => { apply(defaults); };
  }, [title, description, path]);
};
