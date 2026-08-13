#!/usr/bin/env node
/*
 * Assert that every utility the legacy pages reference actually compiles.
 *
 * **This is the check whose absence broke the marketing site.** The brand config
 * once replaced Tailwind's scales, which deletes utilities for the entire build.
 * `Landing.tsx` was excluded from the codemod and allowlisted in the linter — and
 * neither of those restores a class. ~190 utilities it depends on silently stopped
 * existing: the hero headline lost its size, weight and colour, and the primary
 * CTA lost its background. Nothing connected "this token was removed" to "that
 * page needs it", so nothing failed until a human looked at the page.
 *
 * This closes that loop. It extracts the class names the legacy pages use, compiles
 * the stylesheet, and fails if any of them produced no rule.
 *
 *   node scripts/check-legacy-pages.mjs
 */

import { readFileSync, existsSync, mkdtempSync } from 'node:fs';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** The pages still on stock Tailwind. Mirrors `ALLOW.legacy` in check-brand.mjs. */
const LEGACY = [
  'src/pages/Landing.tsx',
  'src/pages/Pricing.tsx',
  'src/pages/Privacy.tsx',
  'src/pages/Terms.tsx',
  'src/pages/Contact.tsx',
  'src/components/layout/LegalLayout.tsx',
  // The features/solutions tree. These matter to this check more than the originals did:
  // most of their utilities come from `components/marketing/primitives.tsx`, so a token
  // narrowed in tailwind.config.js would break eight pages from one file rather than one.
  'src/components/marketing/primitives.tsx',
  'src/components/marketing/motion-kit.tsx',
  'src/components/marketing/SiteHeader.tsx',
  'src/components/marketing/SiteFooter.tsx',
  'src/pages/Features.tsx',
  'src/pages/Solutions.tsx',
  'src/pages/DetailPage.tsx',
  // Deleted alongside its brand-gate entry — see the note in check-brand.mjs. Harmless
  // while present because this script skips paths that do not exist.
  'src/pages/ComingSoon.tsx',
  'src/pages/features/WhatsAppAutomation.tsx',
  'src/pages/features/AiWhatsAppAutomation.tsx',
  'src/pages/features/NumberMasking.tsx',
  'src/pages/features/Campaigns.tsx',
  'src/pages/features/BusinessApi.tsx',
  'src/pages/features/TeamInbox.tsx',
];

/**
 * Utilities that legitimately produce no CSS rule of their own, so their absence
 * from the stylesheet is not a failure.
 *
 * `group`/`peer` are markers Tailwind uses for variant targeting rather than
 * classes that emit declarations; `sr-only` and the `animate-*` names defined in
 * `index.css` are real but live outside the utility layer.
 */
const NO_RULE = new Set([
  'group', 'peer', 'dark', 'animate-marquee',
  // `prose`/`prose-slate` come from @tailwindcss/typography, which is **not
  // installed**. They have therefore never emitted a rule, long before the brand
  // work — the legal pages' body typography has never actually been styled.
  // Listed here so this check reports real regressions rather than that one; the
  // underlying gap is worth fixing separately.
  'prose', 'prose-slate',
]);

/**
 * Bare utilities with no hyphen. Everything else must contain one, which is what
 * keeps ordinary prose out: a first attempt at this scanned every quoted string in
 * the file and dutifully reported "Business" and "Automate" as missing utilities.
 */
const BARE = new Set([
  'flex', 'grid', 'block', 'inline', 'contents', 'hidden', 'table', 'relative',
  'absolute', 'fixed', 'sticky', 'static', 'truncate', 'italic', 'underline',
  'uppercase', 'lowercase', 'capitalize', 'invisible', 'visible', 'container',
  'transform', 'transition', 'resize', 'appearance', 'overflow', 'border',
  'rounded', 'shadow', 'ring', 'outline', 'antialiased', 'sr', 'isolate',
  'overline', 'ordinal', 'num', 'eyebrow',
]);

/**
 * Extract the balanced `className` expression starting at `from`, then return the
 * quoted string runs inside it.
 *
 * Reading only `className` contexts — rather than every quoted string — is what
 * makes this usable. Copy and class lists look identical to a regex.
 */
const classNameChunks = (source) => {
  const chunks = [];
  const re = /className\s*=\s*/g;
  let m;

  while ((m = re.exec(source)) !== null) {
    let i = m.index + m[0].length;
    const opener = source[i];

    if (opener === '"' || opener === "'") {
      const end = source.indexOf(opener, i + 1);
      if (end === -1) continue;
      chunks.push(source.slice(i + 1, end));
      continue;
    }

    if (opener !== '{') continue;
    // Consume to the balanced closing brace so `cn(a, cond ? b : c)` comes through
    // whole rather than being cut at the first `}`.
    let depth = 0;
    let j = i;
    for (; j < source.length; j += 1) {
      if (source[j] === '{') depth += 1;
      else if (source[j] === '}') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    const expr = source.slice(i + 1, j);
    for (const q of expr.matchAll(/["'`]([^"'`]*)["'`]/g)) chunks.push(q[1]);
  }

  return chunks;
};

/** Candidate utility names referenced by a file. */
const classesIn = (source) => {
  const found = new Set();

  for (const chunk of classNameChunks(source)) {
    for (const token of chunk.split(/\s+/)) {
      // Strip variants (`sm:`, `hover:`, `group-hover:`) down to the base utility —
      // the variant wraps the rule, the base is what must exist.
      const base = token.includes(':') ? token.slice(token.lastIndexOf(':') + 1) : token;
      if (!base || NO_RULE.has(base)) continue;
      // Lowercase only, and either hyphenated or a known bare utility.
      if (!/^-?[a-z][a-z0-9]*(-[a-z0-9.[\]#%/()_,-]+)*$/.test(base)) continue;
      if (!base.includes('-') && !BARE.has(base)) continue;
      found.add(base);
    }
  }

  return found;
};

// Compile the stylesheet the same way the app does.
const out = join(mkdtempSync(join(tmpdir(), 'brandcss-')), 'probe.css');
execFileSync('npx', ['tailwindcss', '-i', 'src/index.css', '-o', out, '--minify'], {
  cwd: ROOT,
  stdio: 'pipe',
});
const css = readFileSync(out, 'utf8');

/** Tailwind escapes `:`, `/`, `.`, `[`, `]` etc. in emitted selectors. */
const escapeForSelector = (cls) => cls.replace(/[.:/[\]()#%,]/g, (ch) => `\\${ch}`);

const missing = [];

for (const file of LEGACY) {
  const path = join(ROOT, file);
  if (!existsSync(path)) continue;

  for (const cls of classesIn(readFileSync(path, 'utf8'))) {
    // A utility may appear bare (`.text-lg`) or only under a variant
    // (`.lg\:text-6xl`), so accept either.
    const esc = escapeForSelector(cls);
    if (css.includes(`.${esc}`) || css.includes(`\\:${esc}`)) continue;
    missing.push({ file: relative(ROOT, path), cls });
  }
}

if (missing.length === 0) {
  console.log('✓ legacy pages — every referenced utility compiles');
  process.exit(0);
}

// Group by class: one missing token usually affects several files.
const byClass = new Map();
for (const { file, cls } of missing) {
  if (!byClass.has(cls)) byClass.set(cls, new Set());
  byClass.get(cls).add(file);
}

console.error(`\n✗ ${byClass.size} utilities referenced by legacy pages produce no CSS\n`);
for (const [cls, files] of [...byClass].sort()) {
  console.error(`  ${cls.padEnd(28)} ${[...files].join(', ')}`);
}
console.error(
  '\nA brand token was probably narrowed in tailwind.config.js. Those pages are on\n'
  + 'stock Tailwind by decision — restore the scale, or migrate the page.\n'
);
process.exit(1);
