import { Fragment, type ReactNode } from 'react';

/*
 * Turning URLs in a message into links.
 *
 * **This is untrusted content and the whole file is about that.** A message body is whatever a
 * customer typed, so every decision here is a refusal of something:
 *
 *   • **React nodes, never `dangerouslySetInnerHTML`.** The tempting implementation is a regex
 *     replace producing an `<a>` string. That is an XSS hole in an authenticated operator's
 *     session, handed to anyone who can send the business a WhatsApp message.
 *   • **`http` and `https` only.** `javascript:alert(document.cookie)` in an `href` runs on click
 *     — in the agent's session, with their token in `localStorage`. `data:` can carry a whole
 *     HTML document. Both are common in the wild and neither is a link.
 *   • **`rel="noopener noreferrer"`.** Without `noopener` the page we open gets `window.opener`
 *     and can navigate this tab to a login page it controls — reverse tabnabbing, and a shared
 *     inbox is exactly the target for it. Without `noreferrer` the destination learns the URL
 *     the agent came from, which carries a conversation id.
 *   • **The link text is the URL, verbatim.** No shortening, no titles. The moment the visible
 *     text can differ from the destination, "paypal.com" can point anywhere — so it never can.
 *     Long URLs wrap rather than truncate, because a truncated URL *is* a divergence.
 */

/**
 * A URL inside a run of text.
 *
 * Deliberately conservative about what starts one: an explicit scheme, or a bare `www.`. Trying
 * to detect `example.com` without either turns "see clause 3.1" and every decimal into a link.
 *
 * The tail excludes whitespace and the characters that end a sentence rather than a URL —
 * trailing punctuation is stripped below, because `(` and `)` need balancing and a full stop
 * almost never belongs to the address.
 */
const URL_PATTERN = /\b(?:https?:\/\/|www\.)[^\s<>"']+/gi;

/** Schemes we will put in an `href`. Everything else renders as plain text. */
const SAFE_SCHEMES = new Set(['http:', 'https:']);

/**
 * Trim punctuation that belongs to the sentence rather than the address.
 *
 * `https://x.com/a.` and `(https://x.com/a)` are both common; so is
 * `https://en.wikipedia.org/wiki/Bracket_(architecture)`, where the closing paren *is* part of
 * the URL. So parens are only dropped when they are unbalanced.
 */
const trimTrailing = (url: string): string => {
  let end = url.length;

  while (end > 0) {
    const char = url[end - 1]!;
    if ('.,;:!?"\''.includes(char)) { end -= 1; continue; }

    if (char === ')' || char === ']') {
      const open = char === ')' ? '(' : '[';
      const slice = url.slice(0, end);
      const opens = slice.split(open).length - 1;
      const closes = slice.split(char).length - 1;
      if (closes > opens) { end -= 1; continue; }
    }
    break;
  }

  return url.slice(0, end);
};

/**
 * The `href` for a matched URL, or null when it is not safe to make one.
 *
 * `new URL` does the parsing rather than a regex, so a scheme hidden by casing, whitespace or
 * encoding — `JaVaScRiPt:`, `java\nscript:` — is resolved the way the browser would resolve it
 * rather than the way a pattern guesses.
 */
export const safeHref = (raw: string): string | null => {
  const candidate = /^www\./i.test(raw) ? `https://${raw}` : raw;

  try {
    const url = new URL(candidate);
    return SAFE_SCHEMES.has(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
};

/**
 * Split text into plain runs and links.
 *
 * Exported for its own tests: the interesting cases are all about what does *not* become a link,
 * and asserting that through rendered output is slower and less direct.
 */
export const tokenise = (text: string): Array<{ text: string; href: string | null }> => {
  const tokens: Array<{ text: string; href: string | null }> = [];
  let last = 0;

  for (const match of text.matchAll(URL_PATTERN)) {
    const raw = match[0];
    const start = match.index!;
    const trimmed = trimTrailing(raw);

    if (start > last) tokens.push({ text: text.slice(last, start), href: null });

    const href = safeHref(trimmed);
    tokens.push({ text: trimmed, href });

    // Whatever punctuation was trimmed goes back as plain text, so the body reads unchanged.
    if (trimmed.length < raw.length) {
      tokens.push({ text: raw.slice(trimmed.length), href: null });
    }
    last = start + raw.length;
  }

  if (last < text.length) tokens.push({ text: text.slice(last), href: null });
  return tokens;
};

/** Render a message body with its URLs as links. */
export function Linkify({ text }: { text: string }) {
  return (
    <>
      {tokenise(text).map((token, i) => (token.href ? (
        <a
          // eslint-disable-next-line react/no-array-index-key -- tokens have no stable identity
          key={i}
          href={token.href}
          target="_blank"
          // Both, and neither is optional — see the header.
          rel="noopener noreferrer"
          className="underline underline-offset-2 hover:no-underline break-all"
        >
          {token.text}
        </a>
      ) : (
        // eslint-disable-next-line react/no-array-index-key -- as above
        <Fragment key={i}>{token.text}</Fragment>
      )))}
    </>
  );
}
