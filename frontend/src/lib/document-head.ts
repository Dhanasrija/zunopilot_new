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
  /**
   * Canonical path, leading slash, no query string.
   *
   * **`null` removes the canonical tag**, which is what an error page needs. A 404 must not
   * canonicalise to the home page — that is precisely the "this is a duplicate of /" signal
   * that made four real pages disappear from the index — and it cannot canonicalise to itself
   * either, because the page does not exist.
   */
  path: string | null;
  /**
   * The robots directive, when it differs from the site default.
   *
   * `noindex` on the 404 page. A static SPA cannot answer HTTP 404 — the server already sent
   * 200 with index.html before React ran — so `noindex` is the only way to tell Google not to
   * index it, and it is what Google's own guidance for SPAs recommends.
   */
  robots?: string;
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
 * The values index.html shipped, to restore when a page unmounts.
 *
 * Read from the DOM rather than copied into a constant here. A second copy of the title and
 * description would be a second place to edit them, and index.html's own comment already warns
 * that six tags carry the same two strings and an edit to only some makes the previews
 * disagree. This cannot drift because it is not a copy.
 *
 * **Captured on first use, not at module load.** At load time the head may not hold what this
 * expects, and the failure is silent and specific: `robots` fell back to `'index, follow'` and
 * quietly dropped `max-image-preview:large`, so restoring the defaults would have shrunk
 * Google's image previews for the whole site with nothing to report it. Lazily, the first page
 * to mount captures whatever is genuinely there.
 */
let captured: PageHead | null = null;

const siteDefaults = (): PageHead => {
  captured ??= {
    title: document.title,
    description: metaByName('description')?.content ?? '',
    path: '/',
    robots: metaByName('robots')?.content ?? 'index, follow',
  };
  return captured;
};

/**
 * Point the canonical at `url`, or remove it entirely when `url` is null.
 *
 * Queried each time and created when absent, rather than holding the node from index.html in a
 * module variable. That first version kept a reference and re-appended it, which broke the
 * moment anything replaced the head's contents: the held node was detached, `.remove()` took
 * out nothing, and the live tag stayed pointing at the old URL. Find-or-create has no such
 * state to go stale.
 */
const setCanonical = (url: string | null): void => {
  const existing = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!url) {
    existing?.remove();
    return;
  }
  const tag = existing ?? document.head.appendChild(
    Object.assign(document.createElement('link'), { rel: 'canonical' }),
  );
  tag.href = url;
};

const apply = ({ title, description, path, robots }: PageHead): void => {
  const url = path === null ? null : `${SITE}${path}`;

  document.title = title;
  setName('description', description);
  setName('robots', robots ?? siteDefaults().robots ?? 'index, follow');

  setCanonical(url);

  setProperty('og:title', title);
  setProperty('og:description', description);
  // With no canonical there is no honest og:url either, so the site's own address stands in
  // rather than a URL that 404s.
  setProperty('og:url', url ?? `${SITE}/`);

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
export const useDocumentHead = ({ title, description, path, robots }: PageHead): void => {
  useEffect(() => {
    // Before `apply`, or the first page to mount would capture its own values as the site's.
    const restore = siteDefaults();
    apply({ title, description, path, robots });
    return () => { apply(restore); };
  }, [title, description, path, robots]);
};
