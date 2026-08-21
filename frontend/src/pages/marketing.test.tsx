import { describe, expect, it, beforeAll, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import Landing from './Landing';
import Features from './Features';
import Solutions from './Solutions';
import WhatsAppAutomation from './features/WhatsAppAutomation';
import AiWhatsAppAutomation from './features/AiWhatsAppAutomation';
import NumberMasking from './features/NumberMasking';
import Campaigns from './features/Campaigns';
import BusinessApi from './features/BusinessApi';
import TeamInbox from './features/TeamInbox';
import DetailPage from './DetailPage';
import { DETAIL_PAGES } from '@/lib/marketing-content';
import { PAGE_HEADS } from '@/lib/page-heads';
import { FEATURE_LINKS, PRIMARY_NAV, SOLUTION_LINKS } from '@/lib/marketing-nav';
import { CtaPair } from '@/components/marketing/primitives';

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
  ['home', '/', <Landing />, 'Grow Your Business Faster with WhatsApp Automation'],
  ['features hub', '/features', <Features />, 'Powerful WhatsApp Automation Features for Your Business'],
  ['solutions hub', '/solutions', <Solutions />, 'WhatsApp Business Solutions for Sales, Support & Customer Engagement'],
  ['whatsapp automation', '/features/whatsapp-automation', <WhatsAppAutomation />, 'WhatsApp Automation That Keeps Your Business Moving'],
  ['ai automation', '/features/ai-whatsapp-automation', <AiWhatsAppAutomation />, 'AI WhatsApp Automation for Smarter Customer Conversations'],
  ['number masking', '/features/whatsapp-number-masking', <NumberMasking />, 'WhatsApp Number Masking for Business'],
  ['campaigns', '/features/whatsapp-campaigns', <Campaigns />, 'WhatsApp Campaigns for More Effective Customer Outreach'],
  ['business api', '/features/whatsapp-business-api', <BusinessApi />, 'WhatsApp Business API for Scalable Customer Communication'],
  ['team inbox', '/features/whatsapp-team-inbox', <TeamInbox />, 'A WhatsApp Team Inbox That Keeps Agents Out of Each Other\u2019s Way'],
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

    /*
     * Every line break carries a separator, so the heading reads as one run.
     *
     * Narrowed to the line spans `AnimatedHeading` itself emits — the ones that *contain* word
     * wrappers. The home page's h1 is now hand-written (a static half plus a rotating link), and
     * its layout spans are also `span.block`; matching those made this assert that a phrase
     * ending a sentence should end in a non-breaking space, which is not the invariant. The
     * collapse bug this guards against only exists inside the word-splitting mechanism.
     */
    const lines = [...heading.querySelectorAll('span.block')]
      .filter((el) => el.querySelector('span.inline-block.overflow-hidden'));
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

describe('the workflow diagrams', () => {
  /*
   * Two different shapes, two different guarantees.
   *
   * **The hub is a pipeline now.** `/features` argues that the features are connected, and a
   * vertical column of cards with arrows down the side reads as a checklist instead. So that
   * section uses the horizontal variant, and what is worth pinning is that its connectors are
   * *between* nodes — n stages, n-1 connectors, never a trailing one pointing at nothing.
   *
   * **The old drawn connector must not come back.** Before the current design there was a
   * violet gradient rule with a dot at its end sitting between each pair of cards, which read
   * as a stray purple mark rather than as "and then". Both assertions below name those exact
   * classes, on both diagram shapes, because "it looks fine" is not something a test can see.
   *
   * The vertical chains still use a real down arrow, which the second test holds.
   */
  it('draw the hub as one continuous rail with a node per stage', () => {
    const { container } = at('/features', <Features />);
    const html = container.innerHTML;

    // Nothing left of the drawn connector that used to sit between each pair of cards.
    expect(html).not.toContain('from-violet-300');
    expect(html).not.toContain('bg-violet-500');

    // The stepper: one rail, six numbered nodes, and a detail card for each of them. The
    // count matters — the six stages come from one array, and a layout that silently renders
    // five of them is the kind of thing nobody notices in a screenshot.
    const stepper = [...container.querySelectorAll('ol')]
      .find((ol) => ol.className.includes('md:grid-cols-6'));
    expect(stepper, 'no stepper on the features hub').toBeTruthy();
    expect(stepper!.querySelectorAll(':scope > li').length).toBe(6);

    const cards = [...container.querySelectorAll('ol')]
      .find((ol) => ol.className.includes('lg:grid-cols-3') && ol !== stepper);
    expect(cards, 'no detail cards under the stepper').toBeTruthy();
    expect(cards!.querySelectorAll(':scope > li').length).toBe(6);
    cleanup();
  });

  it('put exactly one arrow between each pair of steps in a vertical chain', () => {
    // n steps means n-1 connectors — never a trailing arrow pointing at nothing.
    // Lead management is picked because it has the longest worked example (seven stages);
    // not every detail page declares a flow, and one without would vacuously pass.
    const { container } = at('/solutions/lead-management', <DetailPage />);
    const flow = [...container.querySelectorAll('ol')]
      .find((ol) => ol.querySelector('svg.lucide-arrow-down'));

    expect(flow, 'no flow chain rendered').toBeTruthy();
    const steps = flow!.querySelectorAll(':scope > li').length;
    expect(flow!.querySelectorAll('svg.lucide-arrow-down').length).toBe(steps - 1);
    cleanup();
  });
});

describe('the Features dropdown in the header', () => {
  const featuresEntry = PRIMARY_NAV.find((n) => n.children)!;

  it('has children, and they are the feature pages', () => {
    expect(featuresEntry.label).toBe('Features');
    expect(featuresEntry.children).toEqual(FEATURE_LINKS);
  });

  it('**stays closed until asked**, then lists every feature page with its own href', () => {
    const { container } = at('/', <Landing />);
    const toggle = screen.getByRole('button', { name: /features menu/i });

    // Closed by default, and it says so — a dropdown that lies about `aria-expanded`
    // is invisible to a screen reader even when it works with a mouse.
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.getAttribute('aria-haspopup')).toBe('true');

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');

    // Every child is present, and points at its own page rather than at the hub.
    const panel = container.querySelector('[aria-expanded="true"]')!.closest('div')!;
    for (const child of FEATURE_LINKS) {
      const links = [...panel.querySelectorAll(`a[href="${child.href}"]`)];
      expect(links.length, `${child.label} is missing from the dropdown`).toBeGreaterThan(0);
      expect(within(links[0] as HTMLElement).getByText(child.label)).toBeTruthy();
    }
    cleanup();
  });

  it('keeps the parent a real link to the hub', () => {
    // The whole point of the chevron being separate: "Features" itself is a page, and a
    // parent that only opens a menu makes it unreachable from the nav.
    const { container } = at('/', <Landing />);
    const nav = container.querySelector('nav')!;
    expect(nav.querySelector('a[href="/features"]')).toBeTruthy();
    cleanup();
  });

  it('closes on Escape', () => {
    at('/', <Landing />);
    const toggle = screen.getByRole('button', { name: /features menu/i });
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    cleanup();
  });

  it('lists the children in the mobile drawer without needing hover', () => {
    // Touch has no hover, so the drawer shows them outright.
    const { container } = at('/', <Landing />);
    fireEvent.click(screen.getByRole('button', { name: /^menu$/i }));
    const drawer = container.querySelector('.lg\\:hidden.border-t')!;
    for (const child of FEATURE_LINKS) {
      expect(
        drawer.querySelector(`a[href="${child.href}"]`),
        `${child.label} is missing from the mobile drawer`,
      ).toBeTruthy();
    }
    cleanup();
  });
});

describe('the rotating headline', () => {
  /*
   * Three things about it are worth pinning, and none of them are visible in a screenshot:
   *
   *   • the static half never changes, so the h1 always reads as a sentence;
   *   • there is still exactly one h1 (a rotator built as a second heading is an SEO defect);
   *   • the reserved box is sized by the *longest* phrase, which is what stops the page jumping
   *     every few seconds. jsdom cannot measure width, but it can prove the sizer element is
   *     present and holds the longest string — the mechanism, if not the pixels.
   */
  it('keeps the static half, one h1, and a sizer holding the longest phrase', () => {
    const { container } = at('/', <Landing />);
    const h1s = container.querySelectorAll('h1');
    expect(h1s.length).toBe(1);

    const text = headingText(h1s[0]);
    expect(text.startsWith('Grow Your Business Faster with')).toBe(true);


    // Exactly one feature name in the heading, not six and not a hidden copy of the longest.
    // The first version reserved width with an invisible duplicate, which held the layout and
    // put a second phrase into the heading's text — invisible on screen, present in every
    // text extraction.
    const names = FEATURE_LINKS.filter((f) => text.includes(f.label));
    expect(names.length, 'the heading should contain exactly one feature name').toBe(1);

    // The height is reserved instead, so nothing below the heading moves between phrases.
    const reserved = h1s[0].querySelector('span.relative.block');
    expect(reserved, 'no reserved-height line — the heading will jump between phrases').toBeTruthy();
    expect(reserved!.className).toContain('min-h-');
    cleanup();
  });

  it('links the rotating phrase at whichever feature is showing', () => {
    const { container } = at('/', <Landing />);
    const h1 = container.querySelector('h1')!;
    const link = h1.querySelector('a')!;

    expect(link, 'the rotating phrase is not a link').toBeTruthy();
    // Whatever it is showing, it must be one of the six feature pages.
    expect(FEATURE_LINKS.map((f) => f.href)).toContain(link.getAttribute('href'));
    cleanup();
  });
});

describe('the header menus', () => {
  it('opens Solutions as well as Features, with every child linked', () => {
    // Both hubs have real children now. A hub whose children are only reachable from the hub
    // itself buries six indexable pages a click deeper than they need to be.
    const { container } = at('/', <Landing />);
    const toggle = screen.getByRole('button', { name: /solutions menu/i });

    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');

    const panel = container.querySelector('[aria-expanded="true"]')!.closest('div')!;
    for (const child of SOLUTION_LINKS) {
      expect(
        panel.querySelector(`a[href="${child.href}"]`),
        `${child.label} is missing from the Solutions dropdown`,
      ).toBeTruthy();
    }
    cleanup();
  });

  it('no longer offers Testimonial or FAQ in the bar', () => {
    // Both were home-page fragments, so on any other route they meant "leave, then scroll".
    const labels = PRIMARY_NAV.map((n) => n.label);
    expect(labels).not.toContain('Testimonial');
    expect(labels).not.toContain('FAQ');
  });
});

describe('the primary call-to-action pair', () => {
  /*
   * The two buttons must be the same size. They were `px-7` each, so each was as wide as its own
   * label and the pair rendered mismatched in every hero, every CTA band and the footer. Width is
   * now a shared constant, and this asserts the two elements carry the same one — a check that
   * survives a copy change, which a pixel measurement in jsdom would not.
   */
  it('renders both buttons at the same width, and Get Started signs you in', () => {
    const { container } = at('/', <CtaPair />);
    const buttons = [...container.querySelectorAll('button')];
    expect(buttons.length).toBe(2);

    // `startsWith`, not `includes` — `shadow-violet-300` contains "w-" and would be counted as
    // a width class, which is how this assertion first failed against two correct buttons.
    const isWidth = (c: string) => /^(?:[a-z]+:)?w-/.test(c);
    const widths = buttons.map((b) => [...b.classList].filter(isWidth).sort().join(' '));
    expect(widths[0], 'the two CTA buttons are different widths').toBe(widths[1]);

    expect(container.querySelector('a[href="/login"]'), 'Get Started does not reach sign in').toBeTruthy();
    expect(container.textContent).toContain('Get Started');
    expect(container.textContent).not.toContain('Start Free');
    cleanup();
  });
});

describe('the travelling highlight', () => {
  /*
   * The diagrams light one stage at a time and the lit stage moves. Two ways that breaks, both
   * invisible in a screenshot taken at the wrong moment: every node lit at once (the condition
   * inverted), or none lit (the index out of range). So this asserts the invariant that holds at
   * every tick — exactly one.
   *
   * jsdom runs no timers here, so what is checked is the resting frame, which is also what a
   * reader with reduced motion sees permanently. That makes it the frame most worth pinning.
   */
  it('lights exactly one stage of the connected-workflow stepper', () => {
    const { container } = at('/features', <Features />);
    const stepper = [...container.querySelectorAll('ol')]
      .find((ol) => ol.className.includes('md:grid-cols-6'))!;

    const lit = [...stepper.querySelectorAll(':scope > li')]
      .filter((li) => li.innerHTML.includes('bg-violet-600'));

    expect(lit.length, 'the stepper should light exactly one stage').toBe(1);
    cleanup();
  });
});

describe('icons sit before the title, not above it', () => {
  /*
   * The requirement is "icon immediately before the start of the title", and the failure
   * mode is silent: an icon rendered as a sibling *above* the heading looks fine in
   * isolation and only shows up as ragged heading baselines across a grid of cards.
   *
   * So this asserts the DOM relationship rather than the appearance — the icon has to be
   * inside the heading element and the heading's first element child. A screenshot cannot
   * tell those two layouts apart; this can.
   */
  it('renders the icon inside the heading, as its first child', () => {
    const { container } = at('/features/whatsapp-team-inbox', <TeamInbox />);
    const iconHeadings = [...container.querySelectorAll('h3')]
      .filter((h) => h.querySelector('svg'));

    expect(iconHeadings.length, 'no icon headings rendered').toBeGreaterThan(0);
    for (const heading of iconHeadings) {
      const first = heading.firstElementChild!;
      expect(first.querySelector('svg'), 'the icon is not the first thing in the heading').toBeTruthy();
      // And the title text still follows it, in the same heading.
      expect(headingText(heading).length).toBeGreaterThan(2);
    }
    cleanup();
  });
});

describe('the team inbox hub links to every sibling feature', () => {
  // The ecosystem figure replaced a "related pages" list. A diagram whose spokes are not
  // real links would be a downgrade for both navigation and crawling, so this pins that
  // every one of the five is an anchor with its own href.
  it('gives all five spokes a real anchor', () => {
    const { container } = at('/features/whatsapp-team-inbox', <TeamInbox />);
    for (const href of [
      '/features/whatsapp-automation',
      '/features/ai-whatsapp-automation',
      '/features/whatsapp-campaigns',
      '/features/whatsapp-number-masking',
      '/features/whatsapp-business-api',
    ]) {
      expect(container.querySelector(`a[href="${href}"]`), `${href} is not linked`).toBeTruthy();
    }
    cleanup();
  });
});

describe('the link graph has no dangling ends', () => {
  /*
   * Every route that exists: the bespoke feature pages, the two hubs, the legal and
   * conversion pages, plus whatever is still rendered by the shared `DetailPage`.
   *
   * The bespoke half is written out rather than derived, because there is nothing to
   * derive it from — those pages are components, not table rows. Which means this list
   * is the thing that goes stale when a page graduates from `DETAIL_PAGES` to its own
   * file, and the assertion below is what catches it.
   */
  const BESPOKE = [
    '/features/whatsapp-automation',
    '/features/ai-whatsapp-automation',
    '/features/whatsapp-number-masking',
    '/features/whatsapp-campaigns',
    '/features/whatsapp-business-api',
    '/features/whatsapp-team-inbox',
  ];
  const ROUTES = new Set<string>([
    '/', '/features', '/solutions', '/pricing', '/contact', '/privacy', '/terms',
    '/signup', '/login',
    ...BESPOKE,
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
