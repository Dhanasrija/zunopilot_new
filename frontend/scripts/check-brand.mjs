#!/usr/bin/env node
/*
 * The brand gate.
 *
 * **This is now the only enforcement mechanism, and that is deliberate.**
 *
 * `tailwind.config.js` briefly *replaced* Tailwind's scales, so `font-bold` and
 * `rounded-3xl` genuinely stopped existing. That broke every marketing page: a
 * deleted class is deleted for the whole build, and those pages were excluded only
 * from this linter, which restores nothing. The config now extends, and every rule
 * that deletion used to provide lives here — where it can carry an allowlist, which
 * is the actual requirement ("brand tokens everywhere except the marketing pages").
 *
 * So this script covers both what a Tailwind config *cannot* express, and what it
 * no longer does:
 *
 *   1. **Arbitrary values.** Tailwind has no setting that disables `text-[11px]`
 *      or `bg-[#fff]`, so every constraint in §2–4 is one bracket away from being
 *      bypassed. This is the only thing standing in the way of that.
 *   2. **Hex literals in components.** §2 opens with "never hardcode hex in
 *      components". A hex in a `style` prop or an SVG fill never touches Tailwind.
 *   3. **Emoji in UI chrome.** §8 bans them outside message-preview content.
 *   4. **`wa-green` outside its allowlist.** The guidelines' hard rule: WhatsApp
 *      green is never a brand colour, only a status. That is a *usage* restriction
 *      — the token has to exist, so nothing but a check like this can hold it.
 *
 * Dependency-free and synchronous on purpose: it runs on every build, so it must
 * not add install weight or meaningful time. Exits non-zero with file:line for
 * each violation.
 *
 *   node scripts/check-brand.mjs            # check
 *   node scripts/check-brand.mjs --summary  # counts only, for triaging a sweep
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// `fileURLToPath`, not `URL.pathname` — the repo lives under a directory with a
// space in it, which `pathname` percent-encodes into a path that does not exist.
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = join(ROOT, 'src');
const SUMMARY = process.argv.includes('--summary');

/**
 * Files exempt from specific rules, each with a reason.
 *
 * An allowlist rather than a blanket skip: the point is that an exemption is a
 * decision someone wrote down, not a directory that quietly stopped being checked.
 */
const ALLOW = {
  // §2.1's palette lives here as CSS custom properties, so hex/oklch literals are
  // the file's whole job.
  hex: ['src/index.css'],
  // §2.2 — WhatsApp green is permitted only where it reports WhatsApp's own state.
  waGreen: [
    // Defines the token.
    'src/index.css',
    // §7 — the `connected` status pill, which is exactly the permitted usage.
    'src/components/ui/badge.tsx',
    // Channel connection status.
    'src/pages/Whatsapp.tsx',
  ],
  // §8 — "Emoji may appear only inside message-preview content (it's user
  // content)." The Inbox renders customer messages verbatim.
  emoji: ['src/pages/Inbox.tsx'],
  // Marketing pages are on the old system until their own phase. Listed so the
  // gate stays green while the debt remains visible and enumerated.
  legacy: [
    'src/pages/Landing.tsx',
    'src/pages/Pricing.tsx',
    'src/pages/Privacy.tsx',
    'src/pages/Terms.tsx',
    'src/pages/Contact.tsx',
    'src/components/layout/LegalLayout.tsx',
    // The 404 page and the header it shares with LegalLayout. Added to this list, but the
    // header was *extracted* from LegalLayout rather than copied — so there is less
    // untokenised marketing markup in the tree than before, not more.
    'src/components/layout/PublicHeader.tsx',
    'src/pages/NotFound.tsx',
    // The features/solutions tree and the shell it shares with Landing.
    //
    // Same decision as the pages above, and worth being explicit about: these are on stock
    // Tailwind *by design*, because the marketing site's visual language (48px display
    // headings, `rounded-3xl` cards, `font-extrabold`) is deliberately not the product's.
    // Folding them into the brand tokens would mean the website could no longer look like a
    // website. The debt this list tracks is that the two systems exist; it is not a promise
    // that every file here will eventually migrate.
    //
    // `primitives.tsx`, `SiteHeader.tsx` and `SiteFooter.tsx` are the shared shell — the
    // reason the eight marketing pages are eight entries here and not eight copies of the
    // same markup.
    'src/components/marketing/primitives.tsx',
    'src/components/marketing/SiteHeader.tsx',
    'src/components/marketing/SiteFooter.tsx',
    'src/pages/Features.tsx',
    'src/pages/Solutions.tsx',
    'src/pages/DetailPage.tsx',
    /*
     * **Deleted — remove this line once the file is gone from your working copy.**
     *
     * `ComingSoon.tsx` was replaced by `DetailPage.tsx`: the eleven placeholder routes
     * became eleven real, indexable pages. Nothing imports it any more. It is listed here
     * only so that a checkout where the file is still lying around does not fail the brand
     * gate on dead code — deleting the file and this line together is the tidy end state.
     */
    'src/pages/ComingSoon.tsx',
    'src/pages/features/WhatsAppAutomation.tsx',
    'src/pages/features/AiWhatsAppAutomation.tsx',
  ],
};

const RULES = [
  {
    id: 'arbitrary-font-size',
    // `text-[11px]`, `text-[0.8rem]` — §3.2 defines eight sizes and no others.
    re: /\btext-\[[^\]]*(?:px|rem|em|%)\]/g,
    why: '§3.2 — use a type token (text-caption / text-sm / text-body / text-h3 …), not an arbitrary size',
  },
  {
    id: 'arbitrary-colour',
    re: /\b(?:bg|text|border|ring|fill|stroke|from|to|via)-\[(?:#|rgb|hsl|oklch)[^\]]*\]/g,
    why: '§2 — use a colour token (ink-* / surface-* / accent-* / success / warning / danger)',
  },
  {
    id: 'arbitrary-radius',
    re: /\brounded(?:-[a-z]+)?-\[[^\]]*\]/g,
    why: '§4.3 — radius is sm (4px) / md (8px) / lg (12px) / full for status badges only',
  },
  {
    id: 'arbitrary-spacing',
    // `p-[13px]`, `gap-[7px]` — §4.1's grid exists so rhythm stays consistent.
    re: /\b(?:p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|gap|gap-x|gap-y)-\[[^\]]*\]/g,
    why: '§4.1 — spacing is the 4px grid: 4, 8, 12, 16, 24, 32, 48, 64, 96, 128',
  },
  {
    id: 'hex-literal',
    re: /#[0-9a-fA-F]{3,8}\b/g,
    why: '§2 — never hardcode hex in components; add a token instead',
    allow: 'hex',
  },
  {
    id: 'legacy-palette',
    // The twelve Tailwind palettes the audit found. These no longer compile after
    // the config replacement, but naming them gives a useful error instead of a
    // silently missing style.
    re: /\b(?:bg|text|border|ring|from|to|via|divide|placeholder)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/g,
    why: '§2 — Tailwind default palettes are not brand tokens; map to ink/surface/accent/semantic',
  },
  {
    id: 'non-token-type',
    // §3.2 defines eight sizes. Tailwind's own steps still exist because the
    // marketing pages use them, so this is what keeps them off product screens.
    // Deliberately does not match `text-sm` (a token) or colour utilities like
    // `text-ink-500`.
    re: /\btext-(?:xs|base|lg|xl|[2-9]xl)\b/g,
    why: '§3.2 — use a type token: text-caption / text-sm / text-body / text-body-lg / text-h3 / text-h2 / text-h1 / text-display',
  },
  {
    id: 'banned-radius',
    re: /\brounded(?:-[trblse]{1,2})?-(?:xl|[23]xl)\b/g,
    why: '§4.3 — nothing rounder than rounded-lg (12px); rounded-full is for status badges only',
  },
  {
    id: 'off-grid-spacing',
    // §4.1's grid is 4, 8, 12, 16, 24, 32, 48, 64, 96, 128. These are the named
    // Tailwind steps that fall between them.
    re: /\b(?:p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|gap|gap-x|gap-y|space-x|space-y)-(?:0\.5|1\.5|2\.5|3\.5|5|7|9|10|11|14|20|28|36|44|52|56|60|72|80)\b/g,
    why: '§4.1 — spacing is the 4px grid: 1, 2, 3, 4, 6, 8, 12, 16, 24, 32 (or px for hairlines)',
  },
  {
    id: 'raw-white',
    re: /\b(?:bg|text|border|ring|divide|placeholder|from|to|via)-white\b/g,
    why: '§2.1 — use surface-1 for surfaces and on-accent for text on an accent fill',
  },
  {
    id: 'banned-weight',
    // Belt and braces: the config already deletes these classes.
    re: /\bfont-(?:bold|extrabold|black)\b/g,
    why: '§3.2 — no font weight above 600',
  },
  {
    id: 'decorative-shadow',
    re: /\bshadow-(?:sm|md|lg|xl|2xl)\b/g,
    why: '§4.4 — prefer 1px borders; shadow-overlay is only for modals and dropdowns',
  },
  {
    id: 'emoji',
    // §8 — no emoji in UI chrome.
    re: /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu,
    why: '§8 — no emoji in UI chrome (permitted only inside message-preview content)',
    allow: 'emoji',
  },
  {
    id: 'wa-green-misuse',
    re: /\bwa-green\b/g,
    why: '§2.2 — WhatsApp green is for connection status and delivered/read only, never decoration',
    allow: 'waGreen',
  },
];

const walk = (dir) => readdirSync(dir).flatMap((entry) => {
  const full = join(dir, entry);
  return statSync(full).isDirectory() ? walk(full) : [full];
});

/**
 * Blank out comments before scanning.
 *
 * Without this the checker flags its own documentation: a comment reading "the
 * `shadow-sm` that used to be here is gone" is a `decorative-shadow` violation,
 * and the guidance explaining a rule becomes the thing that breaks it. That is not
 * a hypothetical — it is what this script did on its first run.
 *
 * Comment bodies are replaced with spaces rather than deleted so every line and
 * column stays where it was and the reported positions remain accurate.
 */
const stripComments = (source) => {
  const blank = (match) => match.replace(/[^\n]/g, ' ');
  return source
    // Block comments, including the JSX `{/* … */}` form, across lines.
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    // Line comments. The `(^|[^:])` guard keeps `https://…` inside a string from
    // being read as the start of a comment.
    .replace(/(^|[^:])\/\/[^\n]*/g, (match, lead) => lead + blank(match.slice(lead.length)));
};

/*
 * Test files are not UI, so they are not scanned.
 *
 * Every rule here is about what reaches a customer's screen. A test asserts *about* those
 * rules, which means it legitimately contains the very strings they forbid — the first
 * frontend test to name `wa-green` was a `expect(classes).not.toMatch(/wa-green/)` proving the
 * categorical tint never returns it, and the gate flagged the assertion that enforces the gate.
 *
 * Excluded by path rather than added to `ALLOW`: an allowlist entry is a permanent exception
 * for one file, and this is a category. `src/test/` covers the shared harness.
 */
const isTestFile = (f) => /\.test\.tsx?$/.test(f) || /[\\/]src[\\/]test[\\/]/.test(f);

const files = walk(SRC).filter((f) => /\.(tsx?|css)$/.test(f) && !isTestFile(f));
const findings = [];

for (const file of files) {
  const rel = relative(ROOT, file);
  if (ALLOW.legacy.includes(rel)) continue;

  const lines = stripComments(readFileSync(file, 'utf8')).split('\n');

  for (const rule of RULES) {
    if (rule.allow && ALLOW[rule.allow].includes(rel)) continue;

    lines.forEach((line, index) => {
      // A line opted out on purpose, with the reason on the line itself.
      if (line.includes('brand-allow')) return;

      for (const match of line.matchAll(rule.re)) {
        findings.push({
          rule: rule.id,
          why: rule.why,
          file: rel,
          line: index + 1,
          text: match[0],
        });
      }
    });
  }
}

if (findings.length === 0) {
  console.log('✓ brand-guidelines.md — no violations');
  process.exit(0);
}

const byRule = new Map();
for (const finding of findings) {
  if (!byRule.has(finding.rule)) byRule.set(finding.rule, []);
  byRule.get(finding.rule).push(finding);
}

console.error(`\n✗ ${findings.length} brand-guideline violations in ${new Set(findings.map((f) => f.file)).size} files\n`);

for (const [rule, group] of [...byRule].sort((a, b) => b[1].length - a[1].length)) {
  console.error(`  ${rule} — ${group.length}`);
  console.error(`    ${group[0].why}`);
  if (!SUMMARY) {
    // Capped: a first sweep produces thousands, and a wall of output is not a
    // report anybody reads.
    for (const finding of group.slice(0, 8)) {
      console.error(`      ${finding.file}:${finding.line}  ${finding.text}`);
    }
    if (group.length > 8) console.error(`      … and ${group.length - 8} more`);
  }
  console.error('');
}

console.error('brand-guidelines.md at the repo root is the authority. Run with --summary for counts only.\n');
process.exit(1);
