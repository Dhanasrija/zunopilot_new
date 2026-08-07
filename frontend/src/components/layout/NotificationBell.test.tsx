import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NotificationBell } from './NotificationBell';

/*
 * The bell appears in two places that want different things, and telling them apart is not a
 * styling preference — it is a layout bug waiting to happen.
 *
 * In the sidebar, `collapsed` hides the label at `lg` and up, which is the only width the rail
 * exists at. The mobile header passed that same flag and got nothing: `lg:hidden` does not
 * apply below `lg`. So "Notifications" rendered `whitespace-nowrap` inside a `shrink-0`
 * wrapper, the header could not shrink below its own content, and that width became the
 * minimum for the whole page. Every screen was clipped at the right edge on a phone — the
 * header, the stat cards, the page heading, all of it.
 *
 * Nothing failed. The prop was accepted, the component rendered, the styles computed. It is
 * exactly the kind of defect a test has to pin down, because looking at the code it reads as
 * correct.
 */

const props = {
  notifications: [],
  unread: 0,
  onOpen: vi.fn(),
  onMarkAllRead: vi.fn(),
};

describe('NotificationBell', () => {
  it('**renders no visible label when iconOnly**', () => {
    render(<NotificationBell {...props} iconOnly />);

    // `hidden` at every width, not `lg:hidden`. Queried by role rather than by class so this
    // still holds if the utility changes — what matters is that no text is laid out.
    const label = screen.queryByText('Notifications', { selector: 'span' });
    expect(label).not.toBeNull();
    expect(label?.className).toContain('hidden');
    expect(label?.className).not.toContain('lg:hidden');
  });

  it('keeps the control reachable and named for a screen reader', () => {
    // Hiding the text must not hide the meaning: the icon-only button is still the same
    // control, and the count belongs in its accessible name.
    render(<NotificationBell {...props} unread={3} iconOnly />);
    expect(screen.getByRole('button', { name: 'Notifications, 3 unread' })).toBeTruthy();
  });

  it('hides the count badge too, so nothing can force the header wide', () => {
    // The unread pill is the other `whitespace-nowrap` child. Leaving it visible would
    // reintroduce the same overflow at a narrower threshold — only for people with unread
    // notifications, which is worse than a bug that always happens.
    render(<NotificationBell {...props} unread={12} iconOnly />);
    const badge = screen.getByText('12');
    expect(badge.className).toContain('hidden');
    expect(badge.className).not.toContain('lg:hidden');
  });

  it('**collapsed still means lg-only, because the sidebar rail depends on it**', () => {
    // The fix must not quietly change the desktop behaviour it was carved out of.
    render(<NotificationBell {...props} collapsed />);
    const label = screen.queryByText('Notifications', { selector: 'span' });
    expect(label?.className).toContain('lg:hidden');
  });

  it('shows the label when neither flag is set', () => {
    render(<NotificationBell {...props} />);
    const label = screen.queryByText('Notifications', { selector: 'span' });
    expect(label?.className).not.toContain('hidden');
  });

  /*
   * A source assertion, deliberately.
   *
   * Every test above passes with the original bug put back, because the defect was never in
   * this component — it was one word at the call site. Rendering AppLayout properly would
   * mean standing up a router, a query client and the auth store to check a single prop, and
   * jsdom computes no layout, so even then it could not observe the overflow that made this
   * matter. Reading the file is the cheap honest guard for the thing that actually broke.
   */
  it('**AppLayout asks the mobile header for iconOnly, not collapsed**', async () => {
    // A cwd-relative path, not `new URL(..., import.meta.url)`: under vitest's environment
    // `import.meta.url` is not a file: URL and readFile rejects it.
    const { readFile } = await import('node:fs/promises');
    const source = await readFile('src/components/layout/AppLayout.tsx', 'utf8');

    // Anchor on the mobile bar's own classes. `lg:hidden` alone is not enough — the sidebar
    // uses it too, and slicing from the first match landed on the SIDEBAR's bell, whose
    // `collapsed` is correct. The test failed against working code until this was pinned down.
    const barStart = source.indexOf('flex h-14 items-center gap-3');
    expect(barStart).toBeGreaterThan(-1);

    const bar = source.slice(barStart);
    const bellStart = bar.indexOf('<NotificationBell');
    const bell = bar.slice(bellStart, bar.indexOf('/>', bellStart));

    expect(bell).toContain('iconOnly');
    expect(bell).not.toMatch(/\bcollapsed\b/);
  });
});
