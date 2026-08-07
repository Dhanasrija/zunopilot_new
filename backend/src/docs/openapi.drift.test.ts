import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { MOBILE_SURFACE, openapi } from './openapi.js';

/*
 * The spec, checked against the API it claims to describe.
 *
 * Hand-written API documentation rots. Not slowly and visibly, but on the first endpoint
 * somebody adds in a hurry — and the failure mode is worse than no documentation, because a
 * mobile team builds against a document that is confidently wrong.
 *
 * So this walks Express's own router table and fails if a route exists under one of the
 * prefixes `MOBILE_SURFACE` claims, with no entry in `openapi.ts`. It also fails the other way:
 * a documented path that no longer exists is a promise to a client that will 404.
 *
 * Everything outside those prefixes — super admin, billing, workflows, the engine — is out of
 * scope by design, and the list is the record of that decision. Adding a router to it is
 * choosing to document it.
 */

interface Layer {
  route?: { path: string; methods: Record<string, boolean> };
  handle?: { stack?: Layer[] };
  regexp?: RegExp;
}

/** Express keeps a mounted router's prefix as a regex. This reads it back out. */
const prefixOf = (re: RegExp | undefined): string => {
  if (!re) return '';
  const match = re.source.match(/^\^\\\/((?:[\w\-.]|\\\/)*)/);
  return match ? `/${match[1].replace(/\\\//g, '/')}` : '';
};

const walk = (stack: Layer[], base = '', out: string[] = []): string[] => {
  for (const layer of stack) {
    if (layer.route) {
      const path = `${base}${layer.route.path}`.replace(/\/{2,}/g, '/').replace(/(.)\/$/, '$1');
      for (const method of Object.keys(layer.route.methods)) out.push(`${method.toUpperCase()} ${path}`);
    } else if (layer.handle?.stack) {
      walk(layer.handle.stack, base + prefixOf(layer.regexp), out);
    }
  }
  return out;
};

/** `/api/inbox/conversations/:id` → `/inbox/conversations/{id}`, the OpenAPI spelling. */
const asSpecPath = (expressPath: string): string =>
  expressPath.replace(/^\/api/, '').replace(/:(\w+)/g, '{$1}');

const app = buildApp() as unknown as { _router: { stack: Layer[] } };

const liveRoutes = walk(app._router.stack)
  .map((entry) => {
    const [method, path] = entry.split(' ');
    return { method: method.toLowerCase(), path, spec: asSpecPath(path) };
  })
  // Express registers a HEAD for every GET; documenting both would be noise.
  .filter((route) => route.method !== 'head');

const inScope = liveRoutes.filter((route) =>
  MOBILE_SURFACE.some((prefix) => route.path === prefix || route.path.startsWith(`${prefix}/`)));

const documented = new Set(
  Object.entries(openapi.paths).flatMap(([path, ops]) =>
    Object.keys(ops as Record<string, unknown>).map((method) => `${method} ${path}`)),
);

describe('the OpenAPI document', () => {
  it('**documents every route on the mobile surface**', () => {
    const missing = inScope
      .filter((route) => !documented.has(`${route.method} ${route.spec}`))
      .map((route) => `${route.method.toUpperCase()} ${route.spec}`)
      .sort();

    expect(
      missing,
      `Undocumented, and reachable by the mobile client:\n  ${missing.join('\n  ')}\n\n`
      + 'Add it to src/docs/openapi.ts, or take its router out of MOBILE_SURFACE if it is '
      + 'genuinely not part of that surface.',
    ).toEqual([]);
  });

  it('**describes nothing that no longer exists**', () => {
    // The other direction, and the one that quietly hurts a client: a documented endpoint that
    // was renamed or removed is a promise that 404s.
    const live = new Set(inScope.map((route) => `${route.method} ${route.spec}`));
    const ghosts = [...documented].filter((entry) => !live.has(entry)).sort();

    expect(ghosts, `Documented but not routed:\n  ${ghosts.join('\n  ')}`).toEqual([]);
  });

  it('covers a surface worth calling a surface', () => {
    // A guard against the first test passing because `MOBILE_SURFACE` was quietly emptied.
    expect(inScope.length).toBeGreaterThan(60);
    expect(documented.size).toBe(inScope.length);
  });

  it('**the committed openapi.json matches this module**', () => {
    // The JSON is what the mobile team hold. If someone edits the spec and forgets
    // `npm run openapi`, they are working from a stale file and nothing else would say so.
    const onDisk = readFileSync(resolve(import.meta.dirname, '../../openapi.json'), 'utf8');
    expect(onDisk, 'Run `npm run openapi` — the committed artifact is out of date.')
      .toBe(`${JSON.stringify(openapi, null, 2)}\n`);
  });

  it('every $ref resolves', () => {
    // A typo in a `$ref` produces a document that imports with no error and renders an empty
    // schema, which is the kind of wrong that reaches a client.
    const text = JSON.stringify(openapi);
    const names = [...text.matchAll(/"#\/components\/schemas\/(\w+)"/g)].map((m) => m[1]);
    const defined = new Set(Object.keys(openapi.components.schemas));
    const dangling = [...new Set(names)].filter((name) => !defined.has(name)).sort();

    expect(dangling, `Referenced but never defined: ${dangling.join(', ')}`).toEqual([]);
  });

  it('every operation says whether it needs a token', () => {
    // Omitting `security` inherits the document default, which is "bearer required". That is
    // usually right, but for the four public endpoints it would be a lie — so each operation
    // states it explicitly and this checks nobody forgot.
    const missing = Object.entries(openapi.paths).flatMap(([path, ops]) =>
      Object.entries(ops as Record<string, { security?: unknown }>)
        .filter(([, op]) => op.security === undefined)
        .map(([method]) => `${method.toUpperCase()} ${path}`));

    expect(missing).toEqual([]);
  });
});
