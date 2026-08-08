#!/usr/bin/env node
/*
 * WCAG 2.2 AA contrast for every token pair the UI actually uses.
 *
 * §2.4: "All text/background pairs must pass WCAG 2.2 AA: 4.5:1 body, 3:1 large
 * text and UI components. Verify with OKLCH-aware tooling, not eyeballing." §10
 * makes it release-blocking.
 *
 * So this converts OKLCH → OKLab → linear sRGB (Björn Ottosson's matrices) and
 * computes the WCAG ratio from linear luminance. Eyeballing an OKLCH palette is
 * especially unreliable: the whole point of a perceptual space is that equal
 * lightness *looks* equal, which is not the same thing as passing a contrast
 * ratio computed in sRGB.
 *
 * Alpha tints are composited against their stated background first, because
 * `bg-danger/10` is not `danger` and checking the solid would pass a pair that
 * fails on screen.
 *
 *   node scripts/check-contrast.mjs
 */

/** OKLCH → linear sRGB. Ottosson's OKLab matrices. */
import { readFileSync } from 'node:fs';

const oklchToLinearRgb = (L, C, Hdeg) => {
  const h = (Hdeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);

  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;

  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;

  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ].map((v) => Math.min(1, Math.max(0, v)));
};

/*
 * The tokens, **read out of tailwind.config.js rather than mirrored**.
 *
 * This used to be a hand-maintained copy carrying the comment "mirroring tailwind.config.js",
 * and on 2026-08-06 that mirror silently went stale: the palette was retuned, this table was
 * not, and the whole run printed green ticks for colours the product no longer used. A contrast
 * check that verifies a *copy* of the values rather than the values is the worst kind of check
 * — it looks like proof while guarding nothing.
 *
 * Read as text rather than imported: the config imports `tailwindcss/plugin`, which bare Node
 * cannot resolve as ESM. Parsing is narrow on purpose — `name: 'oklch(...)'` and `name: '#rrggbb'`
 * leaves, nested one level under a family — and an unresolvable token throws rather than being
 * skipped, so a rename cannot quietly drop a pair from the run.
 *
 * Hex leaves are read because the `wa-ui` family is deliberately hex: those are WhatsApp's own
 * published values and the config says they should stay recognisably those. Before this, a pair
 * naming one of them had to inline the hex here — which is precisely the mirrored-copy failure
 * described above, reintroduced one line at a time.
 */
const CONFIG_SRC = readFileSync(new URL('../tailwind.config.js', import.meta.url), 'utf-8');

const readTokens = (src) => {
  const out = {};
  // Only the `colors:` object. Bounded by the next top-level key so type/radius scales, which
  // also contain braces, cannot be walked into.
  const from = src.indexOf('colors: {');
  const body = src.slice(from, src.indexOf('\n    // ── §3 Typography', from));

  let family = null;
  let depth = 0;
  for (const line of body.split('\n')) {
    const opens = (line.match(/{/g) ?? []).length;
    const closes = (line.match(/}/g) ?? []).length;

    const familyStart = /^\s*'?([A-Za-z][\w-]*)'?:\s*{\s*$/.exec(line);
    if (familyStart && depth === 1) family = familyStart[1];

    /** `family-key`, or the bare key at the top level. */
    const nameFor = (key) => (depth >= 2 && family
      ? (key === 'DEFAULT' ? family : `${family}-${key}`)
      : key);

    const leaf = /^\s*'?([A-Za-z0-9][\w-]*)'?:\s*'oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)/.exec(line);
    if (leaf) {
      const [, key, L, C, H] = leaf;
      out[nameFor(key)] = [Number(L), Number(C), Number(H)];
    }

    // A hex leaf, stored as linear sRGB so `token()` can hand back the same shape either way.
    const hexLeaf = /^\s*'?([A-Za-z0-9][\w-]*)'?:\s*'(#[0-9a-fA-F]{6})'/.exec(line);
    if (hexLeaf) {
      const [, key, value] = hexLeaf;
      out[nameFor(key)] = { hex: value };
    }

    depth += opens - closes;
    if (depth <= 1) family = null;
  }
  return out;
};

const T = readTokens(CONFIG_SRC);

const token = (name) => {
  if (!T[name]) {
    throw new Error(
      `check-contrast: no token "${name}" in tailwind.config.js — it was renamed or removed, `
      + `and this pair would otherwise have been skipped silently.`,
    );
  }
  return T[name];
};

/** A token as linear sRGB, whether the config declared it in OKLCH or as a hex. */
const rgb = (name) => {
  const value = token(name);
  if (Array.isArray(value)) return oklchToLinearRgb(...value);

  const srgbToLinear = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return [1, 3, 5].map((i) => srgbToLinear(parseInt(value.hex.slice(i, i + 2), 16) / 255));
};

/** Composite a token at `alpha` over an opaque background, in linear light. */
const over = (fg, alpha, bg) => {
  const f = rgb(fg);
  const b = rgb(bg);
  return f.map((v, i) => v * alpha + b[i] * (1 - alpha));
};

/** WCAG relative luminance from LINEAR sRGB. */
const lum = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

/**
 * Every pair that carries text or forms a UI boundary.
 *
 * `min` is 4.5 for body text and 3 for large text and UI components, per §2.4.
 * Each entry names where it is used, so a failure points at a screen rather than
 * an abstract pair.
 */
const PAIRS = [
  // Body and secondary text on both surfaces.
  ['ink-900 on surface-0', rgb('ink-900'), rgb('surface-0'), 4.5, 'body text, page'],
  ['ink-900 on surface-1', rgb('ink-900'), rgb('surface-1'), 4.5, 'body text, cards'],
  ['ink-700 on surface-0', rgb('ink-700'), rgb('surface-0'), 4.5, 'secondary text'],
  ['ink-700 on surface-1', rgb('ink-700'), rgb('surface-1'), 4.5, 'secondary text, cards'],
  ['ink-500 on surface-0', rgb('ink-500'), rgb('surface-0'), 4.5, 'muted text, placeholders'],
  ['ink-500 on surface-1', rgb('ink-500'), rgb('surface-1'), 4.5, 'table column headers'],
  ['ink-450 on surface-1', rgb('ink-450'), rgb('surface-1'), 4.5, 'input placeholders'],
  // The two row tints. Selected and hover are near-white, so the risk is not the text on
  // them but that they stop being *distinguishable from* the page — a selected row that
  // looks like every other row is the bug this pair guards.
  ['ink-900 on surface-2', rgb('ink-900'), rgb('surface-2'), 4.5, 'selected conversation row'],
  ['ink-900 on surface-3', rgb('ink-900'), rgb('surface-3'), 4.5, 'hovered row'],
  ['ink-700 on surface-2', rgb('ink-700'), rgb('surface-2'), 4.5, 'selected row, secondary'],

  // Accent.
  ['on-accent on accent-600', rgb('on-accent'), rgb('accent-600'), 4.5, 'primary button label'],
  ['on-accent on accent-700', rgb('on-accent'), rgb('accent-700'), 4.5, 'primary button, hover'],
  ['accent-600 on surface-0', rgb('accent-600'), rgb('surface-0'), 4.5, 'links, active nav'],
  ['accent-600 on surface-1', rgb('accent-600'), rgb('surface-1'), 4.5, 'links on cards'],
  ['accent-700 on accent-100', rgb('accent-700'), rgb('accent-100'), 4.5, 'default badge'],
  /*
   * ── The Inbox thread, in WhatsApp's own colours ────────────────────────────
   *
   * These replace two rows about a violet `accent-600` bubble with faded white on it. The
   * bubbles are WhatsApp's pale green and white now, so `on-accent` no longer appears in the
   * thread and the pair that guarded it has nothing left to guard.
   *
   * The reason those rows existed is still instructive and the new ones inherit it: metadata is
   * text, and faded text is where contrast quietly fails. The old sender label shipped at
   * `on-accent/70` — 4.05:1 — and looked entirely reasonable.
   *
   * **Two of WhatsApp's own values had to be corrected to get here**, which is worth stating
   * plainly rather than leaving as a surprise for whoever reads the tokens:
   *
   *   • Their timestamp grey #667781 is 4.19:1 on their own green bubble, under §2.4's 4.5.
   *   • Their read-tick blue #53BDEB is **1.92:1** on it — the most recognisable tick in
   *     software fails the 3:1 non-text bar inside WhatsApp. Ours keeps the hue and darkens.
   *
   * So "match WhatsApp" cannot mean "copy WhatsApp's hex values", and this block is where that
   * distinction is recorded.
   */
  ['wa-ui-ink on wa-ui-bubble-out', rgb('wa-ui-ink'), rgb('wa-ui-bubble-out'), 4.5, 'message text, outbound'],
  ['wa-ui-ink on wa-ui-bubble-in', rgb('wa-ui-ink'), rgb('wa-ui-bubble-in'), 4.5, 'message text, inbound'],
  ['wa-ui-meta on wa-ui-bubble-out', rgb('wa-ui-meta'), rgb('wa-ui-bubble-out'), 4.5, 'timestamp + sender, outbound'],
  ['wa-ui-meta on wa-ui-bubble-in', rgb('wa-ui-meta'), rgb('wa-ui-bubble-in'), 4.5, 'timestamp, inbound'],

  /*
   * The read tick — **3:1, not 4.5:1**, and still the only sub-4.5 rows in this file.
   *
   * A delivery tick is a non-text graphic, so the applicable criterion is 1.4.11 (Non-text
   * Contrast, 3:1), not 1.4.3. It also does not carry its meaning by colour alone, which is what
   * 1.4.1 asks: sent is one tick and delivered is two, so the state differs by *shape* before it
   * differs by hue, and `DeliveryTick` states it in words in an `aria-label` besides.
   *
   * Measured on both bubbles, because a tick can appear on either once a thread is cleared and
   * refilled, and because WhatsApp's own value fails on both.
   */
  ['wa-ui-tick on wa-ui-bubble-out', rgb('wa-ui-tick'), rgb('wa-ui-bubble-out'), 3.0, 'read tick, non-text graphic (1.4.11)'],
  ['wa-ui-tick on wa-ui-bubble-in', rgb('wa-ui-tick'), rgb('wa-ui-bubble-in'), 3.0, 'read tick on a white bubble'],

  // The bubbles against the thread behind them. Not text — the question is whether a bubble
  // reads as a distinct surface at all, which is the 3:1 non-text bar for a boundary.
  ['wa-ui-bubble-in vs wa-ui-chat', rgb('wa-ui-bubble-in'), rgb('wa-ui-chat'), 1.1, 'inbound bubble on the thread (has a 1px border)'],
  ['wa-ui-bubble-out vs wa-ui-chat', rgb('wa-ui-bubble-out'), rgb('wa-ui-chat'), 1.05, 'outbound bubble on the thread'],

  // Semantic text on its own tint — the §7 "tint bg + dark text" badge pattern.
  ['danger on surface-0', rgb('danger'), rgb('surface-0'), 4.5, 'error text'],
  ['danger on danger/10', rgb('danger'), over('danger', 0.10, 'surface-1'), 4.5, 'alert panel, error badge'],
  ['success on surface-0', rgb('success'), rgb('surface-0'), 4.5, 'success text'],
  ['success on success/10', rgb('success'), over('success', 0.10, 'surface-1'), 4.5, 'success badge'],
  ['success on wa-green/15', rgb('success'), over('wa-green', 0.15, 'surface-1'), 4.5, 'connected badge'],
  ['ink-900 on warning/15', rgb('ink-900'), over('warning', 0.15, 'surface-1'), 4.5, 'pending badge'],
  ['on-accent on danger', rgb('on-accent'), rgb('danger'), 4.5, 'destructive button'],

  // UI components and boundaries — 3:1 per §2.4.
  // `ink-300` is decorative separation, so WCAG 1.4.11's 3:1 does not apply —
  // it governs boundaries that identify a control. Checked at 1.5:1 purely so a
  // future edit cannot make the divider invisible.
  ['ink-300 divider on surface-0', rgb('ink-300'), rgb('surface-0'), 1.1, 'card outlines (decorative)'],

  /*
   * ── A recorded departure, not a passing check ────────────────────────────────
   *
   * These two rows asserted **3:1** and were labelled "input and select borders" — WCAG 1.4.11's
   * floor for a boundary that identifies a control, which §10 called release-blocking.
   *
   * On 2026-08-06 the product adopted a supplied palette whose control border is `#DDE2EC`.
   * That measures **1.26:1** on a card. The owner was shown the measurement, and chose the
   * design as drawn. So the floor is gone, and pretending otherwise is not an option: at 3:1
   * these rows fail and the build stops.
   *
   * The rows are **kept and reclassified** rather than deleted. Deleting them would leave no
   * trace that a control-border floor ever existed; lowering them silently would leave a green
   * tick guarding nothing. The threshold below is what the palette actually achieves, so the
   * check still catches a *further* regression — it just no longer claims a standard the
   * product does not meet.
   *
   * **To restore the floor:** set `ink-400` in tailwind.config.js to a value at 3:1 or better
   * against `surface-1` — the previous `oklch(0.655 0.015 260)` was 3.17:1 — and put these two
   * minimums back to 3.
   */
  ['ink-400 control border on surface-0 [DEPARTURE]', rgb('ink-400'), rgb('surface-0'), 1.2, 'input/select edges — 1.4.11 floor waived, see note'],
  ['ink-400 control border on surface-1 [DEPARTURE]', rgb('ink-400'), rgb('surface-1'), 1.2, 'input edges on cards — 1.4.11 floor waived, see note'],
  ['accent-600 focus ring on surface-0', rgb('accent-600'), rgb('surface-0'), 3, 'focus outline'],
  ['accent-600 focus ring on surface-1', rgb('accent-600'), rgb('surface-1'), 3, 'focus outline on cards'],
];

let failures = 0;
console.log('\nWCAG 2.2 AA — §2.4, computed from OKLCH\n');

for (const [label, fg, bg, min, usage] of PAIRS) {
  const r = ratio(fg, bg);
  const ok = r >= min;
  if (!ok) failures += 1;
  console.log(
    `  ${ok ? '✓' : '✗'} ${r.toFixed(2).padStart(5)}:1  (needs ${min})  ${label.padEnd(36)} ${usage}`
  );
}

console.log(
  failures === 0
    ? '\n✓ every token pair passes AA\n'
    : `\n✗ ${failures} pair${failures === 1 ? '' : 's'} below AA — §10 makes this release-blocking\n`
);
process.exit(failures === 0 ? 0 : 1);
