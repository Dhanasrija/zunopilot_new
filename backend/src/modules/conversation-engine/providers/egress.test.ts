import { describe, expect, it } from 'vitest';
import { assertUrlAllowed, isAddressAllowed } from './egress.js';

// The egress guard is a security control, so the tests are mostly about what it
// refuses. A hole here is a tenant reading the host's cloud credentials.

describe('address filtering', () => {
  const blocked = [
    ['loopback', '127.0.0.1', 4],
    ['loopback, unusual spelling', '127.1.2.3', 4],
    ['cloud metadata', '169.254.169.254', 4],
    ['private 10/8', '10.0.5.7', 4],
    ['private 172.16/12', '172.20.1.1', 4],
    ['private 192.168/16', '192.168.1.1', 4],
    ['carrier-grade NAT', '100.64.0.1', 4],
    ['unspecified', '0.0.0.0', 4],
    ['IPv6 loopback', '::1', 6],
    ['IPv6 unique local', 'fd00::1', 6],
    ['IPv6 link-local', 'fe80::1', 6],
    // The same private address wearing an IPv6 hat. An IPv4-only check misses
    // this, and it is a one-line bypass if you get it wrong.
    ['IPv4-mapped loopback', '::ffff:127.0.0.1', 6],
    ['IPv4-mapped metadata', '::ffff:169.254.169.254', 6],
  ] as const;

  for (const [label, address, family] of blocked) {
    it(`refuses ${label} (${address})`, () => {
      expect(isAddressAllowed(address, family)).toBe(false);
    });
  }

  const allowed = [
    ['a public IPv4', '93.184.216.34', 4],
    ['a public IPv6', '2606:2800:220:1:248:1893:25c8:1946', 6],
  ] as const;

  for (const [label, address, family] of allowed) {
    it(`allows ${label}`, () => {
      expect(isAddressAllowed(address, family)).toBe(true);
    });
  }
});

describe('URL validation at connector-save time', () => {
  it('accepts an ordinary https URL', () => {
    expect(assertUrlAllowed('https://api.example.com/v1').hostname).toBe('api.example.com');
  });

  it('refuses a non-http scheme', () => {
    expect(() => assertUrlAllowed('file:///etc/passwd')).toThrow(/only http and https/i);
    expect(() => assertUrlAllowed('gopher://example.com')).toThrow(/only http and https/i);
  });

  it('refuses credentials embedded in the URL', () => {
    // They would end up in logs, in the execution record, and in the graph JSON.
    expect(() => assertUrlAllowed('https://user:pass@api.example.com'))
      .toThrow(/credentials in the url/i);
  });

  it('refuses a literal private address without needing DNS', () => {
    expect(() => assertUrlAllowed('http://169.254.169.254/latest/meta-data/'))
      .toThrow(/private or reserved/i);
    expect(() => assertUrlAllowed('http://127.0.0.1:5432')).toThrow(/private or reserved/i);
    expect(() => assertUrlAllowed('http://[::1]/admin')).toThrow(/private or reserved/i);
  });

  it('refuses nonsense', () => {
    expect(() => assertUrlAllowed('not a url')).toThrow(/not a valid url/i);
  });
});
