import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import MockAdapter from 'axios-mock-adapter';
import { api, day, rupees, tokenStore, when } from './api';

/*
 * The operator console's API client.
 *
 * This file is small and had no tests, which is the combination worth worrying about: it holds
 * the console's *only* session handling, and every screen inherits whatever it does. Three
 * behaviours below are the kind that are silently wrong rather than loudly broken.
 *
 * Money is here too. `rupees` divides by 100 because the whole system stores paise as integers,
 * and a mistake in that one division misstates every figure on the revenue screen by 100×,
 * plausibly enough that nobody questions it.
 */

let mock: MockAdapter;

beforeEach(() => { mock = new MockAdapter(api); });
afterEach(() => { mock.restore(); });

describe('the token', () => {
  it('is attached to a request once stored', async () => {
    tokenStore.set('sa-token-123');
    mock.onGet('/overview').reply((config) => [200, { data: { ok: true } }, config.headers as never]);

    await api.get('/overview');
    expect(mock.history.get[0].headers?.Authorization).toBe('Bearer sa-token-123');
  });

  it('is absent when nobody is signed in, rather than sent as "Bearer null"', async () => {
    mock.onGet('/overview').reply(200, { data: {} });
    await api.get('/overview');
    expect(mock.history.get[0].headers?.Authorization).toBeUndefined();
  });

  it('round-trips and clears through one key', () => {
    // One key, one reader. The customer app grew a `localStorage.token` and a zustand store
    // that could disagree; this exists so the console cannot repeat it.
    tokenStore.set('abc');
    expect(tokenStore.get()).toBe('abc');
    tokenStore.clear();
    expect(tokenStore.get()).toBeNull();
  });
});

describe('a 401 ends the session', () => {
  /**
   * `window.location` is not writable in jsdom, so it is replaced for these tests. The
   * assertion is on `href` because that is what the interceptor sets.
   */
  const withLocation = (pathname: string) => {
    const location = { pathname, href: pathname };
    Object.defineProperty(window, 'location', { value: location, writable: true, configurable: true });
    return location;
  };

  it('**clears the token and sends the operator to the login screen**', async () => {
    tokenStore.set('stale-token');
    const location = withLocation('/tenants');
    mock.onGet('/overview').reply(401, { message: 'Token expired' });

    await expect(api.get('/overview')).rejects.toThrow('Token expired');

    expect(tokenStore.get()).toBeNull();
    expect(location.href).toBe('/login');
  });

  it('**does not do that for a failed login** — otherwise a wrong password reloads the page', async () => {
    /*
     * The exemption that makes the rest safe. Without it, typing the wrong password 401s, the
     * interceptor navigates to `/login`, the page reloads, and the error message the operator
     * needed to read is destroyed before they can read it. Worse on a slow connection: it looks
     * like the console simply refuses to respond.
     */
    tokenStore.set('existing-token');
    const location = withLocation('/login');
    mock.onPost('/auth/login').reply(401, { message: 'Invalid credentials' });

    await expect(api.post('/auth/login', {})).rejects.toThrow('Invalid credentials');

    // The message survived, no navigation happened, and an existing session was not destroyed
    // by somebody mistyping a password on a second tab.
    expect(location.href).toBe('/login');
    expect(tokenStore.get()).toBe('existing-token');
  });

  it('does not navigate when already on the login screen', async () => {
    const location = withLocation('/login');
    mock.onGet('/overview').reply(401, {});

    await expect(api.get('/overview')).rejects.toThrow();
    // Assigning `href` on the page you are already on is a reload, which would throw away
    // whatever the screen was showing.
    expect(location.href).toBe('/login');
  });

  it('leaves the session alone on any other failure', async () => {
    // A 500 is the server having a bad minute, not the operator being signed out. Clearing the
    // token here would log an operator out mid-investigation because one panel failed to load.
    tokenStore.set('good-token');
    withLocation('/tenants');
    mock.onGet('/overview').reply(500, { message: 'Boom' });

    await expect(api.get('/overview')).rejects.toThrow('Boom');
    expect(tokenStore.get()).toBe('good-token');
  });
});

describe('what the operator is told went wrong', () => {
  it('prefers the server’s own message', async () => {
    mock.onGet('/plans').reply(422, { message: 'That plan is archived' });
    await expect(api.get('/plans')).rejects.toThrow('That plan is archived');
  });

  it('falls back to `error`, then to the transport message', async () => {
    mock.onGet('/plans').reply(422, { error: 'Legacy shape' });
    await expect(api.get('/plans')).rejects.toThrow('Legacy shape');

    mock.reset();
    mock.onGet('/plans').networkError();
    await expect(api.get('/plans')).rejects.toThrow(/network|error/i);
  });

  it('**never surfaces an empty message** — "" in a toast reads as a UI bug', async () => {
    mock.onGet('/plans').reply(500, {});
    await expect(api.get('/plans')).rejects.toSatisfy(
      (e: Error) => typeof e.message === 'string' && e.message.trim().length > 0,
    );
  });

  it('rejects with an Error, so a caller can `.message` it without a shape check', async () => {
    mock.onGet('/plans').reply(500, { message: 'nope' });
    await expect(api.get('/plans')).rejects.toBeInstanceOf(Error);
  });
});

describe('money, in paise', () => {
  it('**divides by 100 — the whole system stores paise as integers**', () => {
    // The 100× error. ₹499 stored as 49900; getting this wrong shows ₹49,900 on the revenue
    // screen, which is wrong in a direction nobody questions.
    expect(rupees(49900)).toBe('₹499');
    expect(rupees(100)).toBe('₹1');
    expect(rupees(0)).toBe('₹0');
  });

  it('groups in the Indian system, not the Western one', () => {
    // 12,34,567 rather than 1,234,567. Every price in this product is in rupees.
    expect(rupees(123456700)).toBe('₹12,34,567');
  });

  it('rounds to whole rupees by default and shows paise on request', () => {
    // Two decimals are for an invoice line; a dashboard total does not need them.
    expect(rupees(49950)).toBe('₹500');
    expect(rupees(49950, true)).toBe('₹499.50');
  });

  it('does not lose the sign on a refund or an adjustment', () => {
    expect(rupees(-49900)).toContain('499');
    expect(rupees(-49900)).toContain('-');
  });
});

describe('dates', () => {
  it('renders an em dash for a missing date rather than "Invalid Date"', () => {
    // Half the timestamps in the console are nullable — `paidAt`, `revokedAt`, `handledAt`.
    for (const empty of [null, undefined, '']) {
      expect(when(empty)).toBe('—');
      expect(day(empty)).toBe('—');
    }
  });

  it('shows a day for a date and a time for a timestamp', () => {
    const iso = '2026-08-05T09:30:00.000Z';
    expect(day(iso)).toMatch(/2026/);
    expect(day(iso)).not.toMatch(/:/);
    // `when` is used where the minute matters — an audit entry, a session start.
    expect(when(iso)).toMatch(/:/);
  });
});
