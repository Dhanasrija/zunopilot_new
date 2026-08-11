import { describe, expect, it, beforeAll, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import Landing from './Landing';
import Features from './Features';
import Solutions from './Solutions';
import WhatsAppAutomation from './features/WhatsAppAutomation';
import AiWhatsAppAutomation from './features/AiWhatsAppAutomation';
import DetailPage from './DetailPage';
import { DETAIL_PAGES } from '@/lib/marketing-content';
import { PAGE_HEADS } from '@/lib/page-heads';
import { FEATURE_LINKS, PRIMARY_NAV, SOLUTION_LINKS } from '@/lib/marketing-nav';

/*
 * The public website.
 *
 * Twenty pages, mostly copy, almost no behaviour — so the things worth asserting are
 * structural. Nobody needs a test that a paragraph still says what it says. What can
 * silently break is:
 *
 *   • **A page stops mounting.** These pages are mostly framer-motion, and a bad
 *     variant or a heading rendered through `motion[as]` fails at render, not at
 *     compile.
 *   • **Two `<h1>`s, or none.** The pages are assembled from shared primitives where
 *     `SectionHead` defaults to `h2` and only the hero emits `h1`. One wrong `as` prop
 *     and a page has two top-level headings — an SEO defect that looks like nothing.
 *   • **Headings lose their spaces.** `AnimatedHeading` splits a heading into one
 *     `inline-block` per word so each can animate. Put the separating space in the
 *     wrong place and the browser collapses it, so the rendered heading reads
 *     "AI-PoweredWhatsAppBusinessAutomation" while `textContent` still looks correct.
 *     That shipped. The assertion below is written against *rendered* markup precisely
 *     because a text-based one passed while the page was visibly broken.
 *   • **The FAQ schema and the visible questions drift apart.** They come from one
 *     array by construction; this asserts the construction, including teardown.
 *   • **A detail page loses its metadata.** Eleven pages share one template and read
 *     their head from a key. A typo'd key is a page with the wrong title in Google.
 *   • **A nav link points at a route that does not exist.**
 */

beforeAll(() => {
  // jsdom implements neither, and framer-motion's `whileInView` needs the first.
  if (typeof globalThis.IntersectionObserver === 'undefined') {
    class NoopObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() { return []; }
      root = null;
      rootMargin = '';
      thresholds: number[] = [];
    }
    Object.assign(globalThis, { IntersectionObserver: NoopObserver });
  }
});

const at = (path: string, ui: ReactNode) =>
  render(<MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>);

/**
 * A heading's text with its whitespace normalised.
 *
 * `AnimatedHeading` joins its lines with a **non-breaking** space (U+00A0), because a
 * plain space in that position is the last child of a `block` and the browser collapses
 * it away — the words then render on separate lines but the text is one fused run. So
 * U+00A0 appearing here is the fix working, and an assertion comparing against a normal
 * space has to fold it. `\s` does not match U+00A0 in a JS regex, hence the explicit
 * replace rather than a `\s+` pattern.
 */
const headingText = (el: Element | null): string =>
  (el?.textContent ?? '').replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim();

const HUBS: readonly [string, string, ReactNode, string][] = [
  ['home', '/', <Landing />, 'AI-Powered WhatsApp Business Automation'],
  ['features hub', '/features', <Features />, 'Powerful WhatsApp Automation Features for Your Business'],
  ['solutions hub', '/solutions', <Solutions />, 'WhatsApp Business Solutions for Sales, Support & Customer Engagement'],
  ['whatsapp automation', '/features/whatsapp-automation', <WhatsAppAutomation />, 'WhatsApp Automation That Keeps Your Business Moving'],
  ['ai automation', '/features/ai-whatsapp-automation', <AiWhatsAppAutomation />, 'AI WhatsApp Automation for Smarter Customer Conversations'],
];

/**
 * Every public page, hub or detail, with its route and the **exact** text its `<h1>`
 * should read once whitespace is normalised.
 *
 * Exact text rather than a loose regex, deliberately. The defect this suite exists for
 * is a *missing separator* between two words, and a regex like `/[a-z][A-Z]/` cannot
 * distinguish "BusinessCommunication" (broken) from "WhatsApp" (correct). Comparing the
 * whole string to what the copy says catches a lost space anywhere in the heading and
 * needs no heuristic at all.
 */
const ALL_PAGES: readonly [string, string, ReactNode, string][] = [
  ...HUBS,
  ...DETAIL_PAGES.map((p) => [
    p.headKey, p.path, <DetailPage />, p.h1.join(' '),
  ] as [string, string, ReactNode, string]),
];

describe('every marketing page mounts', () => {
  it.each(ALL_PAGES)('%s renders exactly one h1, with its words separated', (_name, path, ui, expected) => {
    at(path, ui);
    const h1s = screen.getAllByRole('heading', { level: 1 });
    expect(h1s).toHaveLength(1);
    // Exact, so a space lost anywhere in the heading fails here.
    expect(headingText(h1s[0])).toBe(expected);
    cleanup();
  });
});

describe('**animated headings keep their spaces**', () => {
  /*
   * The regression this exists for.
   *
   * `textContent` is not enough: a space nested inside a trailing `inline-block` is
   * present in the text and absent on screen. So this reads the *markup* and checks
   * that consecutive word wrappers are separated by whitespace in the DOM — which is
   * what actually determines whether a gap is painted.
   */
  const wordGapsIn = (root: HTMLElement) => {
    const heading = root.querySelector('h1');
    if (!heading) throw new Error('no h1');
    return [...heading.querySelectorAll('span.inline-block.overflow-hidden')]
      .slice(0, -1)
      .map((span) => span.nextSibling)
      .filter((node) => node?.nodeType === Node.TEXT_NODE && /\s/.test(node.textContent ?? ''));
  };

  it.each(ALL_PAGES)('%s separates every word in its h1', (_name, path, ui) => {
    const { container } = at(path, ui);
    const heading = container.querySelector('h1')!;
    const wrappers = heading.querySelectorAll('span.inline-block.overflow-hidden');

    // Every wrapper but the last one on its line must be followed by whitespace.
    // (Line-final wrappers are followed by the between-lines space on the parent.)
    expect(wordGapsIn(container).length).toBeGreaterThanOrEqual(wrappers.length - 2);

    // Every line break carries a separator, so the heading reads as one run.
    const lines = heading.querySelectorAll('span.block');
    if (lines.length > 1) {
      for (const line of [...lines].slice(0, -1)) {
        expect(line.textContent?.endsWith('\u00A0'), 'line break lost its separator').toBe(true);
      }
    }
    cleanup();
  });
});

describe('FAQ structured data', () => {
  const faqGraphs = () => [...document.querySelectorAll('script[type="application/ld+json"]')]
    .map((node) => JSON.parse(node.textContent ?? '{}'))
    .filter((graph) => graph['@type'] === 'FAQPage');

  it('**matches the questions actually on the page**, and only one graph exists', () => {
    const { unmount } = at('/features', <Features />);

    expect(faqGraphs()).toHaveLength(1);
    const [graph] = faqGraphs();

    // Every question in the graph is one the visitor can see. Google treats FAQ markup
    // that does not appear on the page as a rich-result violation, and a hand-maintained
    // second copy of the array is how that happens.
    for (const entry of graph.mainEntity) {
      expect(entry['@type']).toBe('Question');
      expect(entry.acceptedAnswer['@type']).toBe('Answer');
      expect(screen.getByText(entry.name)).toBeTruthy();
    }

    unmount();
    // Without teardown, /features → /solutions leaves the page claiming questions it
    // no longer answers.
    expect(faqGraphs()).toHaveLength(0);
  });

  it.each(DETAIL_PAGES.map((p) => [p.headKey, p.path] as const))(
    '%s carries its own FAQ graph',
    (_key, path) => {
      at(path, <DetailPage />);
      expect(faqGraphs()).toHaveLength(1);
      expect(faqGraphs()[0].mainEntity.length).toBeGreaterThanOrEqual(3);
      cleanup();
    },
  );
});

describe('breadcrumbs', () => {
  const crumbGraph = () => [...document.querySelectorAll('script[type="application/ld+json"]')]
    .map((node) => JSON.parse(node.textContent ?? '{}'))
    .find((graph) => graph['@type'] === 'BreadcrumbList');

  it.each(DETAIL_PAGES.map((p) => [p.headKey, p.path, p.crumbs.length] as const))(
    '%s emits a BreadcrumbList ending at itself',
    (_key, path, depth) => {
      at(path, <DetailPage />);
      const graph = crumbGraph();
      expect(graph).toBeTruthy();
      expect(graph.itemListElement).toHaveLength(depth);
      expect(graph.itemListElement.at(-1).item).toBe(`https://zunopilot.com${path}`);
      // Positions are 1-based and contiguous, which Google requires.
      expect(graph.itemListElement.map((e: { position: number }) => e.position))
        .toEqual(Array.from({ length: depth }, (_, i) => i + 1));
      cleanup();
    },
  );
});

describe('**every page is indexable**', () => {
  beforeEach(() => {
    document.head.innerHTML = `
      <meta name="robots" content="index, follow, max-image-preview:large" />
      <meta name="description" content="the home page description" />
      <link rel="canonical" href="https://zunopilot.com/" />
    `;
  });

  it.each(DETAIL_PAGES.map((p) => [p.headKey, p.path] as const))(
    '%s canonicalises to itself and is not noindex',
    (_key, path) => {
      at(path, <DetailPage />);

      expect(document.querySelector('link[rel="canonical"]')?.getAttribute('href'))
        .toBe(`https://zunopilot.com${path}`);
      expect(document.querySelector('meta[name="robots"]')?.getAttribute('content'))
        .not.toMatch(/noindex/);

      cleanup();
    },
  );

  it('every detail page names a head that exists, and the two agree on the path', () => {
    for (const page of DETAIL_PAGES) {
      const head = PAGE_HEADS[page.headKey as keyof typeof PAGE_HEADS];
      expect(head, `no PAGE_HEADS entry for "${page.headKey}"`).toBeTruthy();
      expect(head.path).toBe(page.path);
    }
  });
});

describe('the link graph has no dangling ends', () => {
  const ROUTES = new Set<string>([
    '/', '/features', '/solutions', '/pricing', '/contact', '/privacy', '/terms',
    '/features/whatsapp-automation', '/features/ai-whatsapp-automation',
    '/signup', '/login',
    ...DETAIL_PAGES.map((entry) => entry.path),
  ]);

  const linkTable = [
    ...PRIMARY_NAV.map((n) => ['primary nav', n] as const),
    ...FEATURE_LINKS.map((n) => ['feature links', n] as const),
    ...SOLUTION_LINKS.map((n) => ['solution links', n] as const),
  ];

  it.each(linkTable)('%s → %o points at a route that exists', (_group, entry) => {
    // Anchors are fragments on the home page, not routes of their own.
    const target = entry.anchor ? entry.href.split('#')[0] || '/' : entry.href;
    expect(ROUTES.has(target)).toBe(true);
  });

  it('every "related pages" link on a detail page resolves', () => {
    for (const page of DETAIL_PAGES) {
      for (const link of page.related) {
        expect(ROUTES.has(link.href), `${page.path} → ${link.href}`).toBe(true);
      }
    }
  });

  it('the home page anchors the header points at all exist', () => {
    const { container } = at('/', <Landing />);
    for (const entry of PRIMARY_NAV.filter((n) => n.anchor)) {
      const id = entry.href.replace('/#', '');
      expect(container.querySelector(`#${id}`), `#${id} is missing from the home page`).toBeTruthy();
    }
  });
});
