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

/** §2.1/§2.2 tokens, mirroring tailwind.config.js. */
const T = {
  'ink-950': [0.18, 0.03, 260],
  'ink-900': [0.22, 0.03, 260],
  'ink-700': [0.38, 0.03, 260],
  'ink-500': [0.55, 0.02, 260],
  'ink-300': [0.78, 0.015, 260],
  'ink-400': [0.655, 0.015, 260],
  'surface-0': [0.985, 0.004, 90],
  'surface-1': [1, 0, 0],
  'accent-600': [0.53, 0.21, 279],
  'accent-700': [0.45, 0.20, 279],
  'accent-100': [0.93, 0.04, 279],
  'on-accent': [1, 0, 0],
  'wa-green': [0.72, 0.19, 150],
  success: [0.52, 0.15, 150],
  warning: [0.75, 0.15, 75],
  danger: [0.55, 0.19, 25],
};

const rgb = (name) => oklchToLinearRgb(...T[name]);

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

  // Accent.
  ['on-accent on accent-600', rgb('on-accent'), rgb('accent-600'), 4.5, 'primary button label'],
  ['on-accent on accent-700', rgb('on-accent'), rgb('accent-700'), 4.5, 'primary button, hover'],
  ['accent-600 on surface-0', rgb('accent-600'), rgb('surface-0'), 4.5, 'links, active nav'],
  ['accent-600 on surface-1', rgb('accent-600'), rgb('surface-1'), 4.5, 'links on cards'],
  ['accent-700 on accent-100', rgb('accent-700'), rgb('accent-100'), 4.5, 'default badge'],

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
  ['ink-300 divider on surface-0', rgb('ink-300'), rgb('surface-0'), 1.5, 'card outlines (decorative)'],
  ['ink-400 border on surface-0', rgb('ink-400'), rgb('surface-0'), 3, 'input and select borders'],
  ['ink-400 border on surface-1', rgb('ink-400'), rgb('surface-1'), 3, 'input borders on cards'],
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
