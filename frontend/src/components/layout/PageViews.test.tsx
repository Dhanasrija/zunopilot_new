import { afterEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Link, Route, Routes } from 'react-router-dom';
import PageViews from './PageViews';

/*
 * One page view per navigation.
 *
 * **This is the reason the copy-paste snippet was not used.** Google's `<head>` snippet fires
 * a single `page_view` on document load. This is a single-page app, so every navigation after
 * the first would be invisible: /pricing and /contact would record no traffic at all, and
 * every session would look like a one-page bounce.
 */

const gtagCalls = (): unknown[][] => {
  const calls: unknown[][] = [];
  (window as { gtag?: unknown }).gtag = (...args: unknown[]) => { calls.push(args); };
  return calls;
};

const pageViews = (calls: unknown[][]) => calls.filter((c) => c[1] === 'page_view');
const paths = (calls: unknown[][]) => calls
  .filter((c) => c[0] === 'set')
  .map((c) => (c[1] as { page_path: string }).page_path);

afterEach(() => { delete (window as { gtag?: unknown }).gtag; });

const app = () => (
  <MemoryRouter initialEntries={['/pricing']}>
    <PageViews />
    <Routes>
      <Route path="/pricing" element={<Link to="/contact">Contact us</Link>} />
      <Route path="/contact" element={<p>Contact</p>} />
    </Routes>
  </MemoryRouter>
);

describe('a first load', () => {
  it('records the page it landed on', () => {
    const calls = gtagCalls();
    render(app());
    expect(paths(calls)).toEqual(['/pricing']);
  });
});

describe('a navigation', () => {
  it('**records the second page too**, which the head snippet would have missed', async () => {
    const calls = gtagCalls();
    render(app());

    await userEvent.click(screen.getByRole('link', { name: /contact us/i }));

    expect(paths(calls)).toEqual(['/pricing', '/contact']);
    expect(pageViews(calls)).toHaveLength(2);
  });

  it('sends one view per page, not one per render', async () => {
    const calls = gtagCalls();
    const { rerender } = render(app());
    rerender(app());

    // Keyed on the pathname, so React re-rendering the tree does not inflate the count.
    expect(pageViews(calls)).toHaveLength(1);
  });
});
