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
import ComingSoon, { COMING_SOON } from './ComingSoon';
import { PAGE_HEADS } from '@/lib/page-heads';
import { FEATURE_LINKS, LEGAL_LINKS, PRIMARY_NAV, SOLUTION_LINKS } from '@/lib/marketing-nav';

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
  ...COMING_SOON.map((p) => [
    `coming soon: ${p.path}`, p.path, <ComingSoon />, p.title,
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

  it('a coming-soon page carries no FAQ graph', () => {
    // It has no questions on it. Markup describing questions a page does not answer is a
    // rich-result violation, and the placeholder is exactly where one would get copied in
    // by accident.
    at('/solutions/lead-management', <ComingSoon />);
    expect(faqGraphs()).toHaveLength(0);
  });
});

describe('indexability', () => {
  beforeEach(() => {
    document.head.innerHTML = `
      <meta name="robots" content="index, follow, max-image-preview:large" />
      <meta name="description" content="the home page description" />
      <link rel="canonical" href="https://zunopilot.com/" />
    `;
  });

  it.each(HUBS.map((h) => [h[0], h[1]] as const))(
    '%s canonicalises to itself and is not noindex',
    (_name, path) => {
      const entry = HUBS.find((h) => h[1] === path)!;
      at(path, entry[2]);

      expect(document.querySelector('link[rel="canonical"]')?.getAttribute('href'))
        .toBe(`https://zunopilot.com${path}`);
      expect(document.querySelector('meta[name="robots"]')?.getAttribute('content'))
        .not.toMatch(/noindex/);

      cleanup();
    },
  );

  /*
   * **The placeholders must be the exact opposite, and that is the assertion worth having.**
   *
   * A "coming soon" page that ranks for "whatsapp lead management" is worse than no page:
   * it burns the click and teaches the ranking system that the site does not answer the
   * query. `noindex, follow` keeps the outbound links working while removing the page from
   * results, and no canonical is emitted because there is nothing to canonicalise to.
   */
  it.each(COMING_SOON.map((p) => [p.path] as const))(
    '%s is noindex and claims no canonical',
    (path) => {
      at(path, <ComingSoon />);

      expect(document.querySelector('meta[name="robots"]')?.getAttribute('content'))
        .toMatch(/noindex/);
      // **No canonical tag at all**, not one pointing at the home page. `path: null` removes
      // it. Canonicalising a placeholder to `/` would be the exact "this is a duplicate of the
      // home page" signal that once dropped four real pages out of the index; canonicalising
      // it to itself would ask Google to index the thing the `noindex` just refused.
      expect(document.querySelector('link[rel="canonical"]')).toBeNull();

      cleanup();
    },
  );

  it('**no placeholder path has a head or a sitemap entry**', () => {
    // The inverse of the check in `document-head.test.ts`, which proves every head is in the
    // sitemap. This proves the placeholders are in neither — the two together are what stop
    // an unwritten page being advertised for indexing.
    const advertised = new Set(Object.values(PAGE_HEADS).map((h) => h.path));
    for (const page of COMING_SOON) {
      expect(advertised.has(page.path), `${page.path} should not have a PAGE_HEADS entry`)
        .toBe(false);
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
    // The automation page is picked because its worked example is the longest vertical
    // chain on the site; a page without one would vacuously pass.
    const { container } = at('/features/whatsapp-automation', <WhatsAppAutomation />);
    const flow = [...container.querySelectorAll('ol')]
      .find((ol) => ol.querySelector('svg.lucide-arrow-down'));

    expect(flow, 'no flow chain rendered').toBeTruthy();
    const steps = flow!.querySelectorAll(':scope > li').length;
    expect(flow!.querySelectorAll('svg.lucide-arrow-down').length).toBe(steps - 1);
    cleanup();
  });
});

describe('the header dropdowns', () => {
  /*
   * **Two of them now, and the same assertions have to hold for both.**
   *
   * Solutions grew a dropdown after Features had one, and the failure mode with a second
   * instance of an interactive component is that it is *nearly* the first: the panel opens
   * but the parent stopped being a link, or the children render but the mobile drawer
   * lists only one group's. Parameterising over the table is what makes adding a third
   * dropdown a zero-line change to this suite.
   */
  const DROPDOWNS = [
    ['Features', FEATURE_LINKS, '/features'],
    ['Solutions', SOLUTION_LINKS, '/solutions'],
  ] as const;

  it('are exactly the two entries that declare children', () => {
    expect(PRIMARY_NAV.filter((n) => n.children).map((n) => n.label))
      .toEqual(['Features', 'Solutions']);
  });

  it.each(DROPDOWNS)('%s lists its own pages', (label, links) => {
    const entry = PRIMARY_NAV.find((n) => n.label === label)!;
    expect(entry.children).toEqual(links);
  });

  it.each(DROPDOWNS)(
    '%s **stays closed until asked**, then lists every child with its own href',
    (label, links) => {
      const { container } = at('/', <Landing />);
      const toggle = screen.getByRole('button', { name: new RegExp(`${label} menu`, 'i') });

      // Closed by default, and it says so — a dropdown that lies about `aria-expanded`
      // is invisible to a screen reader even when it works with a mouse.
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
      expect(toggle.getAttribute('aria-haspopup')).toBe('true');

      fireEvent.click(toggle);
      expect(toggle.getAttribute('aria-expanded')).toBe('true');

      // Every child is present, and points at its own page rather than at the hub.
      const panel = toggle.closest('div')!;
      for (const child of links) {
        const anchors = [...panel.querySelectorAll(`a[href="${child.href}"]`)];
        expect(anchors.length, `${child.label} is missing from the ${label} dropdown`)
          .toBeGreaterThan(0);
        expect(within(anchors[0] as HTMLElement).getByText(child.label)).toBeTruthy();
      }
      cleanup();
    },
  );

  it.each(DROPDOWNS)('%s keeps the parent a real link to the hub', (_label, _links, hub) => {
    // The whole point of the chevron being separate: the hub itself is a page, and a
    // parent that only opens a menu makes it unreachable from the nav.
    const { container } = at('/', <Landing />);
    const nav = container.querySelector('nav')!;
    expect(nav.querySelector(`a[href="${hub}"]`)).toBeTruthy();
    cleanup();
  });

  it.each(DROPDOWNS)('%s closes on Escape', (label) => {
    at('/', <Landing />);
    const toggle = screen.getByRole('button', { name: new RegExp(`${label} menu`, 'i') });
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    cleanup();
  });

  it('lists every child of both groups in the mobile drawer without needing hover', () => {
    // Touch has no hover, so the drawer shows them outright.
    const { container } = at('/', <Landing />);
    fireEvent.click(screen.getByRole('button', { name: /^menu$/i }));
    const drawer = container.querySelector('.lg\\:hidden.border-t')!;
    for (const child of [...FEATURE_LINKS, ...SOLUTION_LINKS]) {
      expect(
        drawer.querySelector(`a[href="${child.href}"]`),
        `${child.label} is missing from the mobile drawer`,
      ).toBeTruthy();
    }
    cleanup();
  });

  /*
   * **Testimonial and FAQ are gone from the bar.** Asserted by absence, because the
   * request was specifically that they stop being top-level nav items and the regression
   * would be someone re-adding them to `PRIMARY_NAV` without the cross-page consequence
   * in mind — see the note on `PRIMARY_NAV` itself.
   */
  it('shows no Testimonial or FAQ entry', () => {
    const labels = PRIMARY_NAV.map((n) => n.label);
    expect(labels).not.toContain('Testimonial');
    expect(labels).not.toContain('FAQ');
    expect(labels).toEqual(['Home', 'Features', 'Solutions', 'Pricing', 'Contact Us']);
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
   * conversion pages, and the placeholders under `/solutions` and `/industries`.
   *
   * The bespoke half is written out rather than derived, because there is nothing to
   * derive it from — those pages are components, not table rows. Which means this list
   * is the thing that goes stale when a placeholder graduates to its own file, and the
   * assertion below is what catches it.
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
    ...COMING_SOON.map((entry) => entry.path),
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

  it('every "in the meantime" link on a placeholder resolves', () => {
    for (const page of COMING_SOON) {
      for (const link of [...page.related, page.parent]) {
        expect(ROUTES.has(link.href), `${page.path} → ${link.href}`).toBe(true);
      }
    }
  });

  /*
   * **The header carries no fragment links any more, and that is now the assertion.**
   *
   * `Testimonial` and `FAQ` were `/#testimonial` and `/#faq` sitting between real routes,
   * so on every page except the home page two of the seven nav items navigated to a
   * different page and then scrolled. Both sections still exist on the home page; neither
   * is a top-level destination. This fails if one is put back without the cross-page
   * behaviour being thought about again.
   */
  it('the header links to routes only, never to home-page fragments', () => {
    expect(PRIMARY_NAV.filter((n) => n.anchor)).toEqual([]);
  });

  it('the home page still has the sections the footer links to', () => {
    const { container } = at('/', <Landing />);
    for (const entry of LEGAL_LINKS.filter((n) => n.anchor)) {
      const id = entry.href.replace('/#', '');
      expect(container.querySelector(`#${id}`), `#${id} is missing from the home page`).toBeTruthy();
    }
  });
});
