import { afterEach, describe, expect, it } from 'vitest';
import { analyticsEnabled, safePath, trackPageView } from './analytics';

/*
 * What gets sent to Google, and from where.
 *
 * The interesting cases are all refusals. Google's own snippet reads the URL from the browser,
 * and in this product the URL is not safe to forward: /support-session carries a single-use
 * support-access token in its query string, /inbox names the conversation an operator is
 * reading, and half the app's routes end in a row id.
 *
 * These are the assertions that keep that true when somebody later adds a route, or reaches
 * for the copy-paste snippet because it looked simpler.
 */

describe('the query string', () => {
  it('**never survives — a support-access token must not reach Google**', () => {
    // The token grants a support engineer access to one workspace. robots.txt already
    // disallows this path for the same reason; this is the same rule for analytics.
    expect(safePath('/support-session?token=a1b2c3d4e5f6a7b8'))
      .toBe('/support-session');
  });

  it('drops the conversation an operator is reading', () => {
    expect(safePath('/inbox?conversationId=53de4dbf-7d98-48bc-b4a3-8c454c44beb7'))
      .toBe('/inbox');
  });

  it('drops a fragment too', () => {
    expect(safePath('/pricing#annual')).toBe('/pricing');
  });
});

describe('identifiers in the path', () => {
  it('**redacts a uuid**, so one customer is not a row in a report', () => {
    expect(safePath('/orders/9fc8e10a-11c4-4544-9179-b79c6e8a53e6')).toBe('/orders/:id');
    expect(safePath('/leads/9fc8e10a-11c4-4544-9179-b79c6e8a53e6')).toBe('/leads/:id');
  });

  it('redacts a uuid with no digits in it', () => {
    /*
     * The case that makes the explicit uuid rule worth having. The general "long, and contains
     * a digit" heuristic catches every v4 uuid by accident — the version nibble is always `4`
     * — so removing the uuid rule changed nothing and the mutation check passed. This one has
     * no digit at all, so only the uuid rule sees it.
     */
    expect(safePath('/orders/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')).toBe('/orders/:id');
  });

  it('redacts a numeric id', () => {
    expect(safePath('/invoices/104721')).toBe('/invoices/:id');
  });

  it('handles an id in the middle of a path', () => {
    expect(safePath('/assistants/9fc8e10a-11c4-4544-9179-b79c6e8a53e6/routing'))
      .toBe('/assistants/:id/routing');
  });

  it('collapses to one row rather than thousands of single-visit pages', () => {
    // The reporting reason, alongside the privacy one: a page-views report where every order
    // is its own line is a report nobody reads.
    const a = safePath('/orders/9fc8e10a-11c4-4544-9179-b79c6e8a53e6');
    const b = safePath('/orders/aaaaaaaa-1111-4111-8111-111111111111');
    expect(a).toBe(b);
  });
});

describe('what must not be redacted', () => {
  it('leaves real route names alone', () => {
    for (const path of ['/', '/pricing', '/privacy', '/terms', '/contact', '/login', '/signup']) {
      expect(safePath(path), path).toBe(path);
    }
  });

  it('keeps nested route names', () => {
    expect(safePath('/campaigns/new')).toBe('/campaigns/new');
    expect(safePath('/legacy-workflows')).toBe('/legacy-workflows');
  });

  it('**does not mistake a long route name for an id**', () => {
    // The heuristic needs a digit as well as length, or `/legacy-workflows` and
    // `/support-session` would report as `:id` and the funnel would lose its own page names.
    expect(safePath('/support-session')).toBe('/support-session');
    expect(safePath('/assistants/routing')).toBe('/assistants/routing');
  });
});

describe('where analytics runs', () => {
  it('**collects on production only**', () => {
    expect(analyticsEnabled('zunopilot.com')).toBe(true);
    expect(analyticsEnabled('www.zunopilot.com')).toBe(true);
  });

  it('does not count a developer browsing localhost', () => {
    expect(analyticsEnabled('localhost')).toBe(false);
    expect(analyticsEnabled('127.0.0.1')).toBe(false);
  });

  it('**does not count the development tunnel**, which is a subdomain of production', () => {
    // `x.zunopilot.com` is the laptop exposed for Meta's benefit. A suffix match would file
    // every local page load as real traffic, which is worse than no analytics.
    expect(analyticsEnabled('x.zunopilot.com')).toBe(false);
    expect(analyticsEnabled('xapi.zunopilot.com')).toBe(false);
  });

  it('is not fooled by a lookalike host', () => {
    expect(analyticsEnabled('zunopilot.com.evil.example')).toBe(false);
  });
});

// ── What actually leaves the browser ─────────────────────────────────────────

describe('sending a page view', () => {
  afterEach(() => { delete (window as { gtag?: unknown }).gtag; });

  /** Capture the gtag calls a page view produces. */
  const sent = (pathname: string) => {
    const calls: unknown[][] = [];
    (window as { gtag?: unknown }).gtag = (...args: unknown[]) => { calls.push(args); };
    trackPageView(pathname);
    return calls;
  };

  it('**overrides `page_location`**, which is the one line stopping the leak', () => {
    /*
     * Left alone, gtag reads `document.location` for itself — the whole URL including the
     * query string — and it does so for the automatic enhanced-measurement events too, not
     * just this one. Setting it explicitly is what makes the redaction actually apply.
     */
    const calls = sent('/support-session?token=secret-grant-token');
    const set = calls.find((c) => c[0] === 'set')?.[1] as Record<string, string>;

    // Against `window.location.origin`, not a literal: hardcoding jsdom's origin would make
    // this fail the day someone changes the test environment's URL, for no real reason.
    expect(set.page_location).toBe(`${window.location.origin}/support-session`);
    expect(set.page_location).not.toContain('secret-grant-token');
    expect(set.page_path).toBe('/support-session');
  });

  it('uses `set` rather than per-event parameters', () => {
    // `set` applies to every subsequent hit. Passing them on the page_view alone would leave
    // scroll, outbound-click and form-submit events reading the raw URL.
    const calls = sent('/pricing');
    expect(calls[0]?.[0]).toBe('set');
    expect(calls[1]).toEqual(['event', 'page_view']);
  });

  it('does nothing at all when gtag was never loaded', () => {
    // Off production `initAnalytics` is a no-op, so this must not throw on every navigation
    // a developer makes.
    expect(() => trackPageView('/pricing')).not.toThrow();
  });
});
