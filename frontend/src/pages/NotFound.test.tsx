import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from '@/App';
import NotFound from './NotFound';
import { useAuthStore } from '@/stores/auth.store';

/*
 * The page for a URL that does not exist.
 *
 * **What this replaces.** `<Route path="*" element={<Navigate to="/" replace />} />`. Every
 * unknown URL became the home page: nothing told the visitor what had happened, `replace` meant
 * the back button could not return to the address they typed, and Google saw `/blog` answer 200
 * with the home page's content — a soft 404, and another duplicate of `/` for every dead link.
 */

const head = () => ({
  robots: document.querySelector<HTMLMetaElement>('meta[name="robots"]')?.content,
  canonicals: document.querySelectorAll('link[rel="canonical"]').length,
  title: document.title,
});

const at = (path: string) => render(
  <MemoryRouter initialEntries={[path]}>
    <NotFound />
  </MemoryRouter>,
);

beforeEach(() => {
  document.head.innerHTML = `
    <title>ZunoPilot – AI-Powered WhatsApp Business Automation Platform</title>
    <meta name="description" content="home" />
    <meta name="robots" content="index, follow, max-image-preview:large" />
    <link rel="canonical" href="https://zunopilot.com/" />
    <meta property="og:title" content="home" />
    <meta property="og:description" content="home" />
    <meta property="og:url" content="https://zunopilot.com/" />
    <meta name="twitter:title" content="home" />
    <meta name="twitter:description" content="home" />
  `;
  useAuthStore.setState({ token: null });
});

describe('what the visitor is told', () => {
  it('**says the page does not exist**, instead of showing the home page', () => {
    at('/no-such-page');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/doesn’t exist/i);
  });

  it('shows the path, so a typo is visible', () => {
    // The whole reason not to redirect: `/pricingg` is only obviously wrong once you see it.
    at('/pricingg');
    expect(screen.getByText('/pricingg')).toBeInTheDocument();
  });

  it('**never shows the query string**', () => {
    /*
     * A mistyped support link carries a single-use access token in `?token=`. Rendering it
     * would invite it into the screenshot somebody sends to support, and into anything that
     * captures the page.
     */
    at('/support-sessionn?token=secret-grant-token');
    expect(screen.queryByText(/secret-grant-token/)).not.toBeInTheDocument();
    expect(screen.getByText('/support-sessionn')).toBeInTheDocument();
  });

  it('offers a way out', () => {
    at('/nope');
    expect(screen.getByRole('link', { name: /back to home/i })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: /see pricing/i })).toHaveAttribute('href', '/pricing');
  });

  it('lets somebody report the dead link that brought them', () => {
    at('/nope');
    expect(screen.getByRole('link', { name: /tell us/i }))
      .toHaveAttribute('href', '/contact?interest=Broken+link');
  });
});

describe('when the person is signed in', () => {
  it('**sends them back to the app, not to the marketing site**', () => {
    // An operator who mistypes a URL inside the product was previously ejected to the website.
    useAuthStore.setState({ token: 'a-session' });
    at('/dashbaord');

    expect(screen.getByRole('link', { name: /back to dashboard/i })).toHaveAttribute('href', '/dashboard');
    expect(screen.queryByRole('link', { name: /back to home/i })).not.toBeInTheDocument();
  });
});

describe('what Google is told', () => {
  it('**is noindex**, because the server already answered 200', () => {
    /*
     * A static SPA cannot return HTTP 404 — nginx sent 200 with index.html before React ran.
     * `noindex` is the only remaining way to keep this out of the index, and it is what
     * Google's guidance for single-page apps recommends.
     */
    at('/no-such-page');
    expect(head().robots).toMatch(/noindex/);
  });

  it('**declares no canonical at all**', () => {
    /*
     * Not the home page — that is the "this is a duplicate of /" signal that took four real
     * pages out of the index. And not itself, because it does not exist.
     */
    at('/no-such-page');
    expect(head().canonicals).toBe(0);
  });

  it('has its own title rather than the home page’s', () => {
    at('/no-such-page');
    expect(head().title).toBe('Page not found – ZunoPilot');
  });

  it('puts the head back when the visitor navigates away', () => {
    const { unmount } = at('/no-such-page');
    expect(head().canonicals).toBe(0);

    unmount();
    // Both restored: a lingering `noindex` would quietly de-index whatever page came next,
    // and that is a failure nobody would notice for weeks.
    expect(head().robots).toBe('index, follow, max-image-preview:large');
    expect(head().canonicals).toBe(1);
  });
});

// ── Is it actually reachable? ────────────────────────────────────────────────

describe('the route', () => {
  it('**an unknown URL renders this page, through the real router**', async () => {
    /*
     * Rendering the whole App rather than the component, because everything above tests a page
     * that App might not be wired to. Reverting the catch-all to `<Navigate to="/" replace />`
     * left every other test in this file green — the page would exist and be unreachable, which
     * is exactly how the /automation page sat in this codebase for months with no nav entry.
     */
    window.history.pushState({}, '', '/definitely-not-a-page');
    render(<App />);

    expect(await screen.findByRole('heading', { level: 1 }))
      .toHaveTextContent(/doesn’t exist/i);
  });

  it('leaves the address in the bar, so the typo is still visible', async () => {
    // `replace` used to erase it: you landed on the home page and could not go back to see
    // what you had got wrong.
    window.history.pushState({}, '', '/pricingg');
    render(<App />);

    await screen.findByRole('heading', { level: 1 });
    expect(window.location.pathname).toBe('/pricingg');
  });
});
