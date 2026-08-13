import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  SUPPORT_EMAIL, SUPPORT_PHONE_DISPLAY, SUPPORT_PHONE_E164, SUPPORT_PHONE_SCHEMA, WHATSAPP_LINK,
} from './contact';

/*
 * The support number, in the four places it is written.
 *
 * **The defect this exists for.** The number appeared as a `tel:` href, as a visible label,
 * as `telephone` inside the Organization JSON-LD in index.html, and — once WhatsApp was
 * added — inside a `wa.me` URL. Three of the four are invisible when you look at the page,
 * so changing the number and missing one is not a mistake anyone catches by looking. A
 * `contactPoint` advertising a disconnected number is worse than no `contactPoint`, and a
 * `wa.me` link to the wrong number opens a chat with a stranger.
 *
 * index.html is static and cannot import the module, which is exactly why the assertion has
 * to cross the file boundary rather than trusting a shared constant to be shared.
 */

const projectFile = (relative: string): string => {
  const path = resolve(process.cwd(), relative);
  try {
    return readFileSync(path, 'utf8');
  } catch {
    throw new Error(`Could not read ${relative} (looked in ${path}). Run vitest from frontend/.`);
  }
};

const INDEX_HTML = projectFile('index.html');
const LLMS_TXT = projectFile('public/llms.txt');

/** The number with nothing but digits, which is what every format below reduces to. */
const digits = (s: string) => s.replace(/\D/g, '');

describe('the support number is one number', () => {
  it('reads the same in E.164, display, schema and WhatsApp form', () => {
    const canonical = digits(SUPPORT_PHONE_E164);
    expect(digits(SUPPORT_PHONE_DISPLAY)).toBe(canonical);
    expect(digits(SUPPORT_PHONE_SCHEMA)).toBe(canonical);
    expect(WHATSAPP_LINK.startsWith(`https://wa.me/${canonical}`)).toBe(true);
  });

  it('**carries no `+` in the wa.me path**', () => {
    // `wa.me/+91...` resolves to a page that cannot find the number. The failure is silent —
    // the link opens, WhatsApp shrugs — so nothing about it looks broken until a customer
    // says nobody replied.
    expect(new URL(WHATSAPP_LINK).pathname).toMatch(/^\/\d+$/);
  });
});

describe('index.html agrees with the module', () => {
  it('the Organization contactPoint names the current number', () => {
    expect(INDEX_HTML).toContain(`"telephone": "${SUPPORT_PHONE_SCHEMA}"`);
  });

  it('the Organization contactPoint names the current email', () => {
    expect(INDEX_HTML).toContain(`"email": "${SUPPORT_EMAIL}"`);
  });

  it('holds no stale copy of the previous number', () => {
    // The number this replaced. Named explicitly rather than checked by pattern, because a
    // pattern would also match the current one.
    expect(INDEX_HTML).not.toContain('9390683154');
  });
});

describe('llms.txt agrees with the module', () => {
  // Assistants read this file instead of crawling, so a stale number here is a wrong answer
  // given confidently, to someone who never sees the page that would have corrected it.
  it('states the current email and number', () => {
    expect(LLMS_TXT).toContain(SUPPORT_EMAIL);
    expect(LLMS_TXT).toContain(SUPPORT_PHONE_DISPLAY);
  });
});
