import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PAGE_HEADS } from './page-heads';

/*
 * Canonical URLs.
 *
 * **The bug.** index.html carries one static set of SEO tags, so every route served
 * `<link rel="canonical" href="https://zunopilot.com/" />`. Correct on the home page and a
 * disaster on the other four: a canonical pointing elsewhere tells Google the page is a
 * duplicate and to index the target instead. So /pricing, /privacy, /terms and /contact were
 * each asking not to be indexed, while sitemap.xml asked for all five. Google follows the
 * canonical, and Search Console files the rest under "Alternate page with proper canonical
 * tag".
 *
 * The assertions worth having are the ones that cross files. A canonical is only meaningful
 * relative to the route it is on and the sitemap that advertises it, and those three live in
 * three different places that no type checker relates to each other.
 */

/**
 * Read a file from the project root.
 *
 * `process.cwd()`, not `new URL(..., import.meta.url)`: under Vite `import.meta.url` is an
 * http:// URL, so `readFileSync` rejects it with "The URL must be of scheme file". Throwing a
 * named error beats a confusing ENOENT if the working directory is ever not the project root.
 */
const projectFile = (relative: string): string => {
  const path = resolve(process.cwd(), relative);
  try {
    return readFileSync(path, 'utf8');
  } catch {
    throw new Error(`Could not read ${relative} (looked in ${path}). Run vitest from frontend/.`);
  }
};

const SITEMAP = projectFile('public/sitemap.xml');
const APP = projectFile('src/App.tsx');
const INDEX_HTML = projectFile('index.html');

const heads = Object.entries(PAGE_HEADS);

/**
 * The subset that claims a canonical.
 *
 * `login` is in `PAGE_HEADS` for reviewability but is `path: null` — it is `noindex` and has
 * no canonical, so "is it a route in App.tsx" and "is it in the sitemap" are the wrong
 * questions to ask of it. Filtering on `path` rather than excluding it by name means a future
 * `noindex` entry is handled without editing this file.
 */
const publicHeads = heads.filter((entry): entry is [string, typeof entry[1] & { path: string }] =>
  entry[1].path !== null);

describe('every page declares its own canonical', () => {
  it('**no two pages share one**, which is the whole defect', () => {
    const paths = publicHeads.map(([, head]) => head.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('claims the production origin, not whatever host served it', () => {
    // A canonical exists to collapse www, non-www and staging onto one address. Built from
    // `window.location.origin` the development tunnel would declare itself canonical.
    expect(INDEX_HTML).toContain('<link rel="canonical" href="https://zunopilot.com/" />');
  });
});

describe('the canonical, the route and the sitemap agree', () => {
  it.each(publicHeads)('%s is a real route in App.tsx', (_name, head) => {
    // The nested app routes are relative, so a leading-slash path only appears for the public
    // ones — which is exactly the set this table should cover.
    expect(APP).toContain(`path="${head.path}"`);
  });

  it.each(publicHeads)('%s is advertised in sitemap.xml', (_name, head) => {
    // **The cross-check that matters.** A page whose canonical is not in the sitemap, or a
    // sitemap entry whose page canonicalises elsewhere, is the contradiction that started this.
    expect(SITEMAP).toContain(`<loc>https://zunopilot.com${head.path}</loc>`);
  });

  it('covers every URL the sitemap advertises, with none left over', () => {
    const advertised = [...SITEMAP.matchAll(/<loc>https:\/\/zunopilot\.com([^<]*)<\/loc>/g)]
      .map((m) => m[1] || '/');
    expect(advertised.sort()).toEqual(publicHeads.map(([, h]) => h.path).sort());
  });
});

describe('the copy', () => {
  it.each(heads)('%s has a title Google will not truncate', (_name, head) => {
    expect(head.title.length).toBeGreaterThan(10);
    expect(head.title.length).toBeLessThanOrEqual(60);
  });

  it.each(heads)('%s has a description Google will not truncate', (_name, head) => {
    expect(head.description.length).toBeGreaterThan(50);
    expect(head.description.length).toBeLessThanOrEqual(160);
  });

  it('**says something different on each page**', () => {
    // Five pages sharing the home page's description is the state this replaced. Identical
    // descriptions are also how Google decides to write its own instead.
    const descriptions = heads.map(([, h]) => h.description);
    expect(new Set(descriptions).size).toBe(descriptions.length);

    const titles = heads.map(([, h]) => h.title);
    expect(new Set(titles).size).toBe(titles.length);
  });

  it('keeps the home page matching the static tags scrapers read', () => {
    // WhatsApp and LinkedIn do not run JS, so index.html stays the source of truth for them.
    // If these drift, a shared home-page link previews differently from what Google indexes.
    expect(INDEX_HTML).toContain(`<title>${PAGE_HEADS.landing.title}</title>`);
    expect(INDEX_HTML).toContain(PAGE_HEADS.landing.description);
  });
});

describe('applying it to the document', () => {
  beforeEach(() => {
    document.head.innerHTML = `
      <title>ZunoPilot – AI-Powered WhatsApp Business Automation Platform</title>
      <meta name="description" content="the home page description" />
      <link rel="canonical" href="https://zunopilot.com/" />
      <meta property="og:title" content="home" />
      <meta property="og:description" content="home" />
      <meta property="og:url" content="https://zunopilot.com/" />
      <meta name="twitter:title" content="home" />
      <meta name="twitter:description" content="home" />
    `;
  });

  const canonical = () => document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href;
  const prop = (p: string) => document.querySelector<HTMLMetaElement>(`meta[property="${p}"]`)?.content;

  it('**rewrites the canonical rather than adding a second one**', async () => {
    // Two canonical tags is undefined behaviour; Google picks one and it may not be ours. The
    // tag from index.html is updated in place.
    const { useDocumentHead } = await import('./document-head');
    const { renderHook } = await import('@testing-library/react');

    renderHook(() => useDocumentHead(PAGE_HEADS.pricing));

    expect(document.querySelectorAll('link[rel="canonical"]')).toHaveLength(1);
    expect(canonical()).toBe('https://zunopilot.com/pricing');
    expect(prop('og:url')).toBe('https://zunopilot.com/pricing');
    expect(document.title).toBe(PAGE_HEADS.pricing.title);
  });

  it('hands the head back on the way out', async () => {
    // Without this, leaving /pricing for the signed-in app leaves the tab reading "Pricing".
    const { useDocumentHead } = await import('./document-head');
    const { renderHook } = await import('@testing-library/react');

    const { unmount } = renderHook(() => useDocumentHead(PAGE_HEADS.pricing));
    expect(canonical()).toBe('https://zunopilot.com/pricing');

    unmount();
    expect(canonical()).toBe('https://zunopilot.com/');
  });
});
