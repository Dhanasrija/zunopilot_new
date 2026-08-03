import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import net from 'node:net';
import { env } from '../../../config/env.js';
import { logger } from '../../../config/logger.js';

// Outbound HTTP for connectors.
//
// This is the SSRF surface. A tenant controls the connector's base URL, so
// "just call fetch" would let any workspace owner point the product at
// 169.254.169.254 and read the instance's cloud credentials, or at an internal
// service that trusts anything originating from inside the VPC.
//
// Four defences, and each one exists because the others are insufficient:
//
//   1. Scheme and shape checks, so a `file://` or credential-bearing URL never
//      gets as far as a socket.
//   2. Address filtering on every resolved IP, not on the hostname — a name
//      like `internal.attacker.com` can resolve to 127.0.0.1.
//   3. **A pinned connection.** The addresses are validated and then the socket
//      is opened to the exact address that was checked. Validating a hostname
//      and then handing it to the HTTP client is the classic DNS-rebinding bug:
//      the second lookup can return a different, private address.
//   4. No automatic redirects. A 302 to a private address would bypass all of
//      the above, so redirects are returned to the caller as-is.
//
// Plus a timeout and a response size cap, because a connector that hangs or
// streams gigabytes is a denial of service against our own workers.

export class EgressBlockedError extends Error {
  readonly code = 'EGRESS_BLOCKED';
  constructor(message: string) {
    super(message);
    this.name = 'EgressBlockedError';
  }
}

export class EgressTimeoutError extends Error {
  readonly code = 'EGRESS_TIMEOUT';
  constructor(ms: number) {
    super(`The request took longer than ${ms}ms`);
    this.name = 'EgressTimeoutError';
  }
}

/**
 * Address ranges a connector may never reach.
 *
 * `net.BlockList` does the range arithmetic, which is worth using rather than
 * hand-rolling CIDR checks — an off-by-one in a subnet mask is a silent hole.
 */
const buildBlockList = (): net.BlockList => {
  const list = new net.BlockList();

  // IPv4
  list.addSubnet('0.0.0.0', 8, 'ipv4'); // "this network"
  list.addSubnet('10.0.0.0', 8, 'ipv4'); // private
  list.addSubnet('100.64.0.0', 10, 'ipv4'); // carrier-grade NAT
  list.addSubnet('127.0.0.0', 8, 'ipv4'); // loopback
  list.addSubnet('169.254.0.0', 16, 'ipv4'); // link-local — cloud metadata lives here
  list.addSubnet('172.16.0.0', 12, 'ipv4'); // private
  list.addSubnet('192.0.0.0', 24, 'ipv4'); // IETF protocol assignments
  list.addSubnet('192.168.0.0', 16, 'ipv4'); // private
  list.addSubnet('198.18.0.0', 15, 'ipv4'); // benchmarking
  list.addSubnet('224.0.0.0', 4, 'ipv4'); // multicast
  list.addSubnet('240.0.0.0', 4, 'ipv4'); // reserved

  // IPv6
  list.addAddress('::', 'ipv6'); // unspecified
  list.addAddress('::1', 'ipv6'); // loopback
  list.addSubnet('fc00::', 7, 'ipv6'); // unique local
  list.addSubnet('fe80::', 10, 'ipv6'); // link-local
  list.addSubnet('ff00::', 8, 'ipv6'); // multicast

  // Deliberately NOT `addSubnet('::ffff:0:0', 96, 'ipv6')`. Node normalises
  // IPv4 into the mapped range internally, so that entry makes `check(addr,
  // 'ipv4')` true for *every* IPv4 address — it blocks the whole internet.
  // IPv4-mapped addresses are handled by unwrapping them in `addressAllowed`
  // and judging them as the IPv4 addresses they are.

  return list;
};

const BLOCKED = buildBlockList();

const addressAllowed = (address: string, family: number): boolean => {
  if (env.egress.allowPrivateAddresses) return true;
  // An IPv4-mapped address must be judged as the IPv4 address it really is.
  const mapped = address.startsWith('::ffff:') ? address.slice(7) : null;
  if (mapped && net.isIPv4(mapped)) return !BLOCKED.check(mapped, 'ipv4');
  return !BLOCKED.check(address, family === 6 ? 'ipv6' : 'ipv4');
};

/**
 * `URL.hostname` keeps the brackets on an IPv6 literal (`[::1]`), which makes
 * `net.isIP` say no and would skip the address check entirely.
 */
const bareHost = (hostname: string): string =>
  (hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname);

/**
 * Validate a URL's shape. Called when a connector is *saved*, so a bad base URL
 * is rejected while an operator is looking at the form rather than mid-run.
 */
export const assertUrlAllowed = (raw: string): URL => {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new EgressBlockedError(`"${raw}" is not a valid URL`);
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new EgressBlockedError(`Only http and https are allowed, not "${url.protocol}"`);
  }
  if (url.username || url.password) {
    throw new EgressBlockedError('Credentials in the URL are not allowed — use the connector\'s auth settings');
  }
  if (!url.hostname) throw new EgressBlockedError('The URL has no host');

  // A literal private address needs no DNS to be dangerous.
  const host = bareHost(url.hostname);
  if (net.isIP(host) && !addressAllowed(host, net.isIPv6(host) ? 6 : 4)) {
    throw new EgressBlockedError(`${host} is a private or reserved address`);
  }

  return url;
};

/** Resolve a hostname to addresses we are willing to connect to. */
const resolveAllowed = async (hostname: string): Promise<Array<{ address: string; family: number }>> => {
  if (net.isIP(hostname)) {
    const family = net.isIPv6(hostname) ? 6 : 4;
    if (!addressAllowed(hostname, family)) {
      throw new EgressBlockedError(`${hostname} is a private or reserved address`);
    }
    return [{ address: hostname, family }];
  }

  let resolved: dns.LookupAddress[];
  try {
    resolved = await dns.promises.lookup(hostname, { all: true });
  } catch {
    throw new EgressBlockedError(`Could not resolve ${hostname}`);
  }

  const allowed = resolved.filter((r) => addressAllowed(r.address, r.family));
  if (!allowed.length) {
    throw new EgressBlockedError(
      `${hostname} resolves only to private or reserved addresses`,
    );
  }
  return allowed;
};

export interface EgressRequest {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string | null;
  timeoutMs?: number;
  maxResponseBytes?: number;
}

export interface EgressResponse {
  status: number;
  ok: boolean;
  headers: Record<string, string>;
  body: unknown;
  /** The raw text, when the body was not JSON. */
  text: string;
  durationMs: number;
}

/** Headers a caller may never set — they belong to the transport or to us. */
const FORBIDDEN_HEADERS = new Set([
  'host', 'content-length', 'connection', 'transfer-encoding',
  'upgrade', 'proxy-authorization', 'te', 'trailer',
]);

/**
 * Make one outbound call, to a pinned, validated address.
 *
 * Returns non-2xx responses rather than throwing: a 404 from an LMS is
 * information the workflow's error branch should act on, not an exception.
 * Throwing is reserved for "we refused to make this call" and "the call could
 * not complete".
 */
export const egressRequest = async (request: EgressRequest): Promise<EgressResponse> => {
  const url = assertUrlAllowed(request.url);
  const [target] = await resolveAllowed(bareHost(url.hostname));
  const timeoutMs = request.timeoutMs ?? env.egress.timeoutMs;
  const maxBytes = request.maxResponseBytes ?? env.egress.maxResponseBytes;
  const startedAt = Date.now();

  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(request.headers ?? {})) {
    if (!FORBIDDEN_HEADERS.has(name.toLowerCase())) headers[name] = value;
  }
  // The socket goes to an IP, so the Host header and TLS SNI have to carry the
  // real name or virtual hosting and certificate validation both break.
  headers.Host = url.host;

  const transport = url.protocol === 'https:' ? https : http;

  return new Promise<EgressResponse>((resolve, reject) => {
    const req = transport.request(
      {
        method: request.method.toUpperCase(),
        // Connect to the address that was checked, not to the name. This is
        // what closes the DNS-rebinding window between validation and connect.
        host: target!.address,
        family: target!.family,
        servername: url.protocol === 'https:' ? url.hostname : undefined,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        headers,
        timeout: timeoutMs,
        // Redirects are not followed. A 302 to a private address would step
        // around every check above, and re-validating each hop is more
        // machinery than a connector needs — the operator can point the
        // operation at the final URL.
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;

        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxBytes) {
            res.destroy();
            reject(new EgressBlockedError(`Response exceeded ${maxBytes} bytes`));
            return;
          }
          chunks.push(chunk);
        });

        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let body: unknown = text;
          const type = String(res.headers['content-type'] ?? '');
          if (type.includes('json') && text.trim()) {
            try {
              body = JSON.parse(text);
            } catch {
              // Leave it as text. A malformed body from the far end is the
              // workflow's problem to branch on, not a reason to throw.
            }
          }

          const status = res.statusCode ?? 0;
          resolve({
            status,
            ok: status >= 200 && status < 300,
            headers: Object.fromEntries(
              Object.entries(res.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : String(v ?? '')]),
            ),
            body,
            text,
            durationMs: Date.now() - startedAt,
          });
        });
      },
    );

    req.on('timeout', () => {
      req.destroy();
      reject(new EgressTimeoutError(timeoutMs));
    });

    req.on('error', (err) => {
      logger.debug('Connector request failed', { host: url.hostname, error: err.message });
      reject(err);
    });

    if (request.body) req.write(request.body);
    req.end();
  });
};

/** Exposed for tests and for explaining a rejection in the connector UI. */
export const isAddressAllowed = addressAllowed;
