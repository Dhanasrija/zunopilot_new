import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Linkify, safeHref, tokenise } from './Linkify';

/*
 * URLs in a message body.
 *
 * **A message body is whatever a customer typed**, so most of this file is about what does *not*
 * become a link. The dangerous version of this feature is four lines — a regex replace into
 * `dangerouslySetInnerHTML` — and it hands anyone who can WhatsApp the business an XSS in an
 * authenticated operator's session.
 */

describe('what becomes a link', () => {
  it('links an http and an https URL', () => {
    render(<Linkify text="Docs at https://zunopilot.com/api and http://example.org" />);
    expect(screen.getByRole('link', { name: 'https://zunopilot.com/api' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'http://example.org' })).toBeInTheDocument();
  });

  it('links a bare www., adding https to the href but not to the text', () => {
    // The text stays what the customer typed; the href has to be absolute or the browser treats
    // it as a path on our own origin.
    render(<Linkify text="see www.zunopilot.com" />);
    const link = screen.getByRole('link', { name: 'www.zunopilot.com' });
    expect(link).toHaveAttribute('href', 'https://www.zunopilot.com/');
  });

  it('leaves the surrounding words alone', () => {
    render(<Linkify text="before https://x.com after" />);
    expect(screen.getByText(/before/)).toBeInTheDocument();
    expect(screen.getByText(/after/)).toBeInTheDocument();
  });
});

describe('what must never become a link', () => {
  it('**refuses javascript:**', () => {
    /*
     * The one that matters. An `href` of `javascript:` runs on click — in the agent's session,
     * with their token in localStorage. It renders as text instead.
     */
    render(<Linkify text="javascript:alert(document.cookie)" />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('**refuses data: and every other scheme**', () => {
    // `data:` can carry an entire HTML document; `file:` and `vbscript:` are not links either.
    for (const text of [
      'data:text/html,<script>alert(1)</script>',
      'file:///etc/passwd',
      'vbscript:msgbox(1)',
      'ftp://example.com/x',
    ]) {
      const { unmount } = render(<Linkify text={text} />);
      expect(screen.queryByRole('link'), text).not.toBeInTheDocument();
      unmount();
    }
  });

  it('**is not fooled by casing or whitespace inside the scheme**', () => {
    // Parsed with `new URL`, not matched with a pattern, so it resolves the way a browser would
    // rather than the way a regex guesses.
    expect(safeHref('JaVaScRiPt:alert(1)')).toBeNull();
    expect(safeHref('java\nscript:alert(1)')).toBeNull();
    expect(safeHref('  javascript:alert(1)')).toBeNull();
  });

  it('does not invent links out of ordinary text', () => {
    // Detecting `example.com` without a scheme turns "see clause 3.1" and every decimal into a
    // link, which is worse than missing a few real ones.
    for (const text of ['see clause 3.1', 'that will be 1,250.00', 'v2.0 released', 'a.b']) {
      const { unmount } = render(<Linkify text={text} />);
      expect(screen.queryByRole('link'), text).not.toBeInTheDocument();
      unmount();
    }
  });
});

describe('how a link opens', () => {
  it('**opens in a new tab, with noopener and noreferrer**', () => {
    /*
     * Without `noopener` the opened page gets `window.opener` and can navigate this tab to a
     * login page it controls — reverse tabnabbing, and a shared inbox is exactly the target.
     * Without `noreferrer` the destination learns the URL the agent came from, which carries a
     * conversation id.
     */
    render(<Linkify text="https://zunopilot.com" />);
    const link = screen.getByRole('link');

    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
    expect(link.getAttribute('rel')).toContain('noreferrer');
  });

  it('**shows the destination verbatim**', () => {
    /*
     * The link text is the URL and nothing else. The moment visible text can differ from the
     * destination, "paypal.com" can point anywhere — so it never can. That is also why a long
     * URL wraps rather than being truncated: a truncated URL is a divergence.
     */
    const url = 'https://zunopilot.com/a/very/long/path?with=query&and=more#fragment';
    render(<Linkify text={url} />);

    const link = screen.getByRole('link');
    expect(link).toHaveTextContent(url);
    expect(link).toHaveAttribute('href', url);
  });
});

describe('punctuation around a URL', () => {
  it('**does not swallow the full stop that ends the sentence**', () => {
    const [link] = tokenise('Read https://zunopilot.com/api.').filter((t) => t.href);
    expect(link!.text).toBe('https://zunopilot.com/api');
  });

  it('drops an unbalanced closing paren but keeps a balanced one', () => {
    // `(https://x.com/a)` is a URL in brackets; `.../Bracket_(architecture)` ends in one.
    expect(tokenise('(https://x.com/a)').find((t) => t.href)!.text).toBe('https://x.com/a');
    expect(tokenise('https://en.wikipedia.org/wiki/Bracket_(architecture)').find((t) => t.href)!.text)
      .toBe('https://en.wikipedia.org/wiki/Bracket_(architecture)');
  });

  it('puts the trimmed punctuation back as text, so the body reads unchanged', () => {
    // The message must still say what the customer said, character for character.
    const rebuilt = tokenise('Read https://x.com/a. Thanks!').map((t) => t.text).join('');
    expect(rebuilt).toBe('Read https://x.com/a. Thanks!');
  });

  it('keeps a body with no links completely intact', () => {
    const body = 'No links here — just 3.14 and a (parenthetical).';
    expect(tokenise(body).map((t) => t.text).join('')).toBe(body);
    expect(tokenise(body).every((t) => t.href === null)).toBe(true);
  });
});
