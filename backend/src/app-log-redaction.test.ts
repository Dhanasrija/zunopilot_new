import { describe, expect, it } from 'vitest';
import morgan from 'morgan';
import { redactUrl } from './app.js';

/*
 * Secrets must not reach the request log.
 *
 * This is a real leak that shipped: Meta verifies a webhook with
 * `GET /api/webhook?hub.mode=subscribe&hub.verify_token=<token>&hub.challenge=…`, morgan's
 * `dev` format logs the whole URL, and so every handshake wrote the production
 * META_WEBHOOK_VERIFY_TOKEN into api.out.log in plaintext. Found by reading the logs of the
 * live server, not by any test — hence this one.
 */

const TOKEN = 'znp_vt_9f7KxQ2mL8rWc4NpT1yH6eZaB3uD5sJ';

describe('request-log redaction', () => {
  it('**redacts the webhook verify token, in both spellings Meta sends**', () => {
    // Meta sends the value twice: dotted, and underscored. Catching only one is no better
    // than catching neither, because both land in the same log line.
    const out = redactUrl(
      `/api/webhook?hub.mode=subscribe&hub.verify_token=${TOKEN}`
      + `&hub_mode=subscribe&hub_verify_token=${TOKEN}&hub.challenge=1433994969`,
    );
    expect(out).not.toContain(TOKEN);
    expect(out).toContain('hub.verify_token=%5Bredacted%5D');
    expect(out).toContain('hub_verify_token=%5Bredacted%5D');
  });

  it('keeps the parts that make a log line useful', () => {
    // Redaction that eats the path or the non-secret parameters trades one problem for
    // another — nobody can debug a webhook they cannot identify.
    const out = redactUrl(`/api/webhook?hub.mode=subscribe&hub.verify_token=${TOKEN}&hub.challenge=42`);
    expect(out.startsWith('/api/webhook?')).toBe(true);
    expect(out).toContain('hub.mode=subscribe');
    expect(out).toContain('hub.challenge=42');
  });

  it('redacts the OAuth code and access token too', () => {
    // Embedded Signup returns an authorisation code on the query string, and the same logger
    // will see it. Cheaper to cover now than after the next incident.
    expect(redactUrl('/api/whatsapp/callback?code=AQD-secret-code')).not.toContain('AQD-secret-code');
    expect(redactUrl('/x?access_token=EAAG-secret')).not.toContain('EAAG-secret');
    expect(redactUrl('/x?token=abc123')).not.toContain('abc123');
  });

  it('leaves ordinary URLs byte-for-byte alone', () => {
    // No query string, and a query string with nothing sensitive: both must pass through
    // untouched rather than being re-encoded into something subtly different.
    expect(redactUrl('/api/orders')).toBe('/api/orders');
    expect(redactUrl('/api/orders?take=50&skip=0')).toBe('/api/orders?take=50&skip=0');
  });

  it('**is actually wired into morgan, not merely exported**', () => {
    // The function being correct proves nothing if the token override never registered.
    // Ask morgan for the token it will really use.
    const fn = (morgan as unknown as {
      url: (req: unknown, res: unknown) => string;
    }).url ?? null;

    const req = { originalUrl: `/api/webhook?hub.verify_token=${TOKEN}` };
    const rendered = fn
      ? fn(req, {})
      : (morgan.compile(':url') as (t: unknown, r: unknown, s: unknown) => string)(morgan, req, {});

    expect(rendered).not.toContain(TOKEN);
  });
});
