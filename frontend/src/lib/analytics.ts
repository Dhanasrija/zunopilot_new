/*
 * Google Analytics 4.
 *
 * **Not the copy-paste snippet in the <head>, and the difference is the point.**
 *
 * The snippet Google gives you does two things wrong here. It fires exactly one `page_view`,
 * on the initial document load — this is a single-page app, so every navigation after that
 * would be invisible and every session would look like a one-page bounce. And it reads the URL
 * straight from the browser, which in this product is not safe:
 *
 *   /support-session?token=…      a single-use support-access grant token
 *   /inbox?conversationId=<uuid>  which customer an operator is reading
 *   /orders/<uuid>, /leads/<uuid> one row, identifiable when joined to anything else
 *
 * Sending any of those to Google would be handing a third party data the rest of this codebase
 * works to contain — the number masking, the `INBOUND` media rule, robots.txt disallowing
 * /support-session. So the query string is dropped entirely and id-shaped path segments are
 * replaced before anything is sent.
 *
 * `gtag('set', …)` rather than passing the values per event: it applies to every subsequent
 * hit, including the automatic ones enhanced measurement sends (scroll, outbound click, form
 * submit). Those would otherwise each read `document.location` for themselves and carry the
 * raw URL — the leak would come back through a door this module does not control.
 */

/**
 * The measurement ID. Public by nature — it ships in the page source of every site that uses
 * GA — so it is a literal here rather than a secret to configure.
 */
const MEASUREMENT_ID = (import.meta.env.VITE_GA_MEASUREMENT_ID ?? 'G-HZF6LZSMP9') as string;

/**
 * Where analytics is collected, matched exactly.
 *
 * Not `endsWith('zunopilot.com')`: the development tunnel is `x.zunopilot.com`, and a suffix
 * test would file every local page load as production traffic. Nor `import.meta.env.PROD` on
 * its own — that is true for any build, including the one served from the tunnel.
 */
const ANALYTICS_HOSTS = ['zunopilot.com', 'www.zunopilot.com'];

export const analyticsEnabled = (hostname: string): boolean =>
  Boolean(MEASUREMENT_ID) && ANALYTICS_HOSTS.includes(hostname);

/**
 * A path safe to send.
 *
 * Two jobs. **The query string goes**, which is what keeps a support-access token out of
 * Google. And each id-shaped segment becomes `:id`, which keeps one customer's order out of a
 * report and collapses what would otherwise be thousands of single-visit pages into the one
 * row somebody actually wants to read.
 *
 * A segment is id-shaped if it is a uuid, all digits, or long and hex-ish. Deliberately not a
 * list of known route patterns: routes arrive with every feature and the list would drift,
 * while "looks like an identifier" is a property of the segment.
 */
export const safePath = (pathname: string): string => {
  const withoutQuery = pathname.split(/[?#]/)[0] ?? '/';

  const redacted = withoutQuery
    .split('/')
    .map((segment) => {
      if (!segment) return segment;
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segment)) return ':id';
      if (/^\d+$/.test(segment)) return ':id';
      if (segment.length >= 16 && /^[0-9a-z_-]+$/i.test(segment) && /\d/.test(segment)) return ':id';
      return segment;
    })
    .join('/');

  return redacted || '/';
};

type GtagArgs = [string, ...unknown[]];
interface AnalyticsWindow extends Window {
  dataLayer?: unknown[];
  gtag?: (...args: GtagArgs) => void;
}

const win = (): AnalyticsWindow => window as AnalyticsWindow;

let started = false;

/**
 * Load gtag.js and configure it. Safe to call more than once.
 *
 * `send_page_view: false` because this module sends them itself, on every navigation and with
 * a redacted path. Leaving it on would send one unredacted view before React had rendered.
 */
export const initAnalytics = (): void => {
  if (started || !analyticsEnabled(window.location.hostname)) return;
  started = true;

  const w = win();
  w.dataLayer = w.dataLayer || [];
  // The `arguments` object, not a rest parameter: gtag.js reads `dataLayer` entries as
  // arguments objects and a plain array is not treated the same way.
  // eslint-disable-next-line prefer-rest-params, func-names
  w.gtag = function () { w.dataLayer!.push(arguments); } as AnalyticsWindow['gtag'];

  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${MEASUREMENT_ID}`;
  document.head.appendChild(script);

  w.gtag!('js', new Date());
  w.gtag!('config', MEASUREMENT_ID, {
    send_page_view: false,
    /*
     * No Google Signals and no ad personalisation. This is a B2B product measuring a funnel,
     * not an audience to retarget, and both of those turn a page view into cross-device
     * advertising data — which is the part that would need a consent banner to be defensible.
     */
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
  });
};

/** Record a navigation. The path is redacted here, not by the caller. */
export const trackPageView = (pathname: string): void => {
  const w = win();
  if (!w.gtag) return;

  const path = safePath(pathname);
  w.gtag('set', {
    page_path: path,
    // Overridden explicitly. Left alone, gtag reads `document.location` — the whole URL,
    // query string and all — and this is the single line stopping that.
    page_location: `${window.location.origin}${path}`,
    page_title: document.title,
  });
  w.gtag('event', 'page_view');
};
