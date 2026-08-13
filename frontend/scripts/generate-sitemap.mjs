#!/usr/bin/env node
/*
 * Write public/sitemap.xml from src/lib/sitemap.ts.
 *
 *   node scripts/generate-sitemap.mjs           # write it
 *   node scripts/generate-sitemap.mjs --check   # fail if the committed file is stale
 *
 * **Why esbuild rather than plain `import`.** The source of truth is TypeScript, and Node
 * cannot import a `.ts` file without either a loader or `--experimental-strip-types` (Node
 * 22.6+, which the deploy environment is not guaranteed to be). esbuild is already in the
 * tree as a Vite dependency, so transpiling the two modules in-memory costs nothing to
 * install and works on any Node that runs Vite. `src/lib/sitemap.ts` and its one import,
 * `src/lib/page-heads.ts`, have no runtime dependencies at all — no React, no DOM — which
 * is what makes bundling them for Node this cheap.
 *
 * **Why a generated file and not a serverless route.** A sitemap served from a function is
 * a sitemap that can 500, and Vercel's SPA rewrite would have to be taught to exclude it.
 * A static file in `public/` is copied to `dist/` by Vite, served ahead of the rewrite, and
 * cannot fail at request time. The protocol asks for a document at a URL; this is that.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
import { build } from 'esbuild';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, 'public/sitemap.xml');
const check = process.argv.includes('--check');

/**
 * Bundle `src/lib/sitemap.ts` to an in-memory ESM module and import it.
 *
 * `write: false` keeps the transpiled JS out of the tree — it is a build artefact of a
 * build script, and a stray `.mjs` next to the source would eventually get edited.
 * The data URL import is what turns the bundled text back into a live module.
 */
const loadSitemapModule = async () => {
  const result = await build({
    entryPoints: [join(ROOT, 'src/lib/sitemap.ts')],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    target: 'node18',
    // `@/…` is a Vite alias; these two modules use relative imports only, but declaring it
    // means a future import written the app's way does not fail here with a cryptic
    // "could not resolve" from esbuild.
    alias: { '@': join(ROOT, 'src') },
    logLevel: 'silent',
  });

  const [file] = result.outputFiles;
  return import(`data:text/javascript;base64,${Buffer.from(file.contents).toString('base64')}`);
};

const { buildSitemapXml, SITEMAP_ENTRIES } = await loadSitemapModule();
const xml = buildSitemapXml();

/** What is on disk now, or null if the file does not exist yet. */
const current = (() => {
  try {
    return readFileSync(OUT, 'utf8');
  } catch {
    return null;
  }
})();

if (check) {
  if (current === xml) {
    console.log(`✓ ${relative(ROOT, OUT)} is up to date (${SITEMAP_ENTRIES.length} URLs)`);
    process.exit(0);
  }
  console.error(
    `\n✗ ${relative(ROOT, OUT)} does not match src/lib/sitemap.ts.\n\n`
    + '  Run `npm run sitemap` and commit the result.\n',
  );
  process.exit(1);
}

if (current === xml) {
  console.log(`✓ ${relative(ROOT, OUT)} already current (${SITEMAP_ENTRIES.length} URLs)`);
} else {
  writeFileSync(OUT, xml, 'utf8');
  console.log(`✓ wrote ${relative(ROOT, OUT)} — ${SITEMAP_ENTRIES.length} URLs`);
}
