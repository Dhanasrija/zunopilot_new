import tailwindcssAnimate from 'tailwindcss-animate';
import plugin from 'tailwindcss/plugin';

// The brand system, as tokens.
//
// Section references are to `brand-guidelines.md` at the repo root. **That file is
// the authority.** If a value here disagrees with it, this file is wrong.
//
// **Everything is `extend`, and that is deliberate — it was not always.**
//
// An earlier version of this file *replaced* Tailwind's colour, type, weight,
// radius and shadow scales, on the reasoning that a class which does not exist
// cannot be misused. That worked for the product pages and **broke every marketing
// page**, because a deleted class is deleted for the whole build: `Landing.tsx`
// referenced ~190 of them and was excluded only from the linter, which restores
// nothing. Its hero headline lost its size, weight and colour; its primary CTA
// lost its background.
//
// So enforcement lives in **one** place instead of two: `scripts/check-brand.mjs`.
// Only a linter can express "brand tokens everywhere except the marketing pages",
// which is the actual requirement — a global deletion cannot have exceptions. The
// build still runs that gate before `tsc` and `vite`, so a violation in a product
// file still fails the build; what changed is that the failure arrives at build
// time rather than as a missing autocomplete.
//
// **If you add a token here, add its rule to `check-brand.mjs`.** That file, not
// this one, is what stops the old classes coming back.
//
// Colours carry an `<alpha-value>` placeholder so opacity modifiers still work —
// without it `bg-accent-100/40` would silently drop the alpha and §7's "row hover
// accent-100 at 40% opacity" could not be written.

/**
 * §4.1 — the 4px grid, kept as documentation and as the source for the
 * `off-grid-spacing` rule in `scripts/check-brand.mjs`.
 *
 * Deliberately NOT used to override Tailwind's `spacing`: its defaults already
 * land on exactly these measurements at these keys (`4` = 1rem = 16px), and they
 * are expressed in `rem`, so they scale with a reader's font-size preference where
 * hardcoded px would not. Off-grid steps are the gate's job.
 */
export const GRID_STEPS = [0, 1, 2, 3, 4, 6, 8, 12, 16, 24, 32];

/** @type {import('tailwindcss').Config} */
export default {
  // §2.3 is deferred — the dashboard is light-only for now. The selector stays
  // configured so enabling dark later is a token change, not a config change.
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    // §4.2 — 1200px marketing content, 1400px full-bleed.
    container: { center: true, padding: '24px', screens: { '2xl': '1400px' } },

    // §4.2 — mobile-first: 640 / 768 / 1024 / 1280. Replaced rather than extended
    // because these ARE the breakpoints, not additions to a default set.
    screens: { sm: '640px', md: '768px', lg: '1024px', xl: '1280px', '2xl': '1400px' },

    extend: {

    // ── §2 Colour ────────────────────────────────────────────────────────────
    //
    // Replaced wholesale. Twelve Tailwind palettes were live across 1,847 call
    // sites, which is exactly how §2's "never hardcode hex in components" got
    // lost. Six semantic families also make §2.4's 60-30-10 legible: you can see
    // at a glance whether a screen is mostly surface, mostly ink, or has spilled
    // accent everywhere.
    //
    // OKLCH because it is perceptually uniform — equal lightness steps look
    // equal, which is what §2.4's contrast requirement relies on.
    colors: {
      transparent: 'transparent',
      current: 'currentColor',
      inherit: 'inherit',

      // §2.1 ink — text, and dark surfaces once §2.3 is picked up.
      ink: {
        950: 'oklch(0.18 0.03 260 / <alpha-value>)',
        900: 'oklch(0.22 0.03 260 / <alpha-value>)',
        700: 'oklch(0.38 0.03 260 / <alpha-value>)',
        500: 'oklch(0.55 0.02 260 / <alpha-value>)',
        // Decorative separators only — card outlines, table row dividers. At
        // 1.92:1 against `surface-0` this does NOT meet §2.4's 3:1, and it does
        // not have to: WCAG 1.4.11 requires 3:1 for boundaries that *identify a
        // control*, not for lines that merely separate content. Use `ink-400` on
        // anything a person has to find and operate.
        300: 'oklch(0.78 0.015 260 / <alpha-value>)',
        // Control borders — inputs, selects, textareas. Solved for exactly 3:1
        // against `surface-0`, so the edge of a form field is always findable.
        400: 'oklch(0.655 0.015 260 / <alpha-value>)',
      },

      // §2.1 surfaces. `surface-0` is a warm off-white, NOT pure white — the
      // single cheapest reason the product reads as considered rather than default.
      surface: {
        0: 'oklch(0.985 0.004 90 / <alpha-value>)',
        1: 'oklch(1 0 0 / <alpha-value>)',
      },

      // §2.1 accent — violet. See the note in §2.1 of the guidelines for why this
      // is violet rather than the cobalt the document originally specified.
      accent: {
        100: 'oklch(0.93 0.04 279 / <alpha-value>)',
        600: 'oklch(0.53 0.21 279 / <alpha-value>)',
        700: 'oklch(0.45 0.20 279 / <alpha-value>)',
      },
      // §7 — primary buttons are accent background, white text. Named rather than
      // left as `white` so the intent is legible and bare `bg-white` stays absent.
      'on-accent': 'oklch(1 0 0 / <alpha-value>)',

      // §2.2 semantic — status only, never decorative.
      //
      // `wa-green` carries a usage restriction no type system can express:
      // WhatsApp connection status and delivered/read states, nowhere else. The
      // guidelines open by calling that a hard rule, so `check-brand.mjs` holds an
      // allowlist for it.
      'wa-green': 'oklch(0.72 0.19 150 / <alpha-value>)',
      // Darkened from the guidelines' original 0.62, which measured **3.27:1** on
      // `surface-0` and failed the 4.5:1 that §2.4 demands — the document
      // contradicted itself. 0.52 clears AA on both surfaces and on its own tint.
      success: 'oklch(0.52 0.15 150 / <alpha-value>)',
      warning: 'oklch(0.75 0.15 75 / <alpha-value>)',
      danger: 'oklch(0.55 0.19 25 / <alpha-value>)',

      // ── Categorical chart series ─────────────────────────────────────────
      //
      // `brand-guidelines.md` does not define a chart palette — §2 gives six
      // semantic families, and a stacked chart needs more distinguishable series
      // than that without any of them implying "this bar is a warning".
      //
      // Derived rather than picked: six hues 60° apart at **constant lightness and
      // chroma**, so no series is visually heavier than its neighbours and a
      // reader does not unconsciously rank them. Series 1 is the brand accent, so
      // a single-series chart is on-brand by default.
      //
      // Semantic overlap is deliberate and harmless: series 3 sits near `success`
      // and series 5 near `danger`, but chart series are categorical, not
      // semantic, and the legend carries the meaning.
      chart: {
        1: 'oklch(0.58 0.15 279 / <alpha-value>)',
        2: 'oklch(0.58 0.15 219 / <alpha-value>)',
        3: 'oklch(0.58 0.15 159 / <alpha-value>)',
        4: 'oklch(0.58 0.15 99 / <alpha-value>)',
        5: 'oklch(0.58 0.15 39 / <alpha-value>)',
        6: 'oklch(0.58 0.15 339 / <alpha-value>)',
      },

      // ── WhatsApp's own interface colours ─────────────────────────────────
      //
      // **These are not brand colours and must never be used as such.** They exist
      // so a template preview can render what the message will actually look like
      // inside WhatsApp — which §9 sanctions ("Product screenshots are the
      // imagery: real UI") and §2.2 anticipates by permitting WhatsApp green
      // "inside product screenshots".
      //
      // This is distinct from the fake chat mockups §11 rules out: those invent a
      // conversation to decorate a marketing page. This shows the operator their
      // own template, in the chrome the customer will see it in, which is the
      // whole point of a preview.
      //
      // Hex rather than OKLCH on purpose: these are WhatsApp's published values and
      // should be recognisably those, not our re-interpretation of them.
      'wa-ui': {
        chat: '#E5DDD5',
        header: '#075E54',
        tick: '#53BDEB',
      },

      // Semantic aliases the shadcn primitives are built on, re-pointed at brand
      // tokens. Kept as an indirection layer rather than deleted: it is a real
      // seam, and it means §2.3's dark mode later is a change here rather than a
      // sweep through every component.
      //
      // shadcn's bare `accent` (a subtle hover grey) is deliberately absent — the
      // name belongs to the brand accent, and §7 specifies row hover as
      // `accent-100` at 40% anyway. `hover:bg-accent` is rewritten in Phase B.
      background: 'oklch(0.985 0.004 90 / <alpha-value>)',
      foreground: 'oklch(0.22 0.03 260 / <alpha-value>)',
      card: {
        DEFAULT: 'oklch(1 0 0 / <alpha-value>)',
        foreground: 'oklch(0.22 0.03 260 / <alpha-value>)',
      },
      popover: {
        DEFAULT: 'oklch(1 0 0 / <alpha-value>)',
        foreground: 'oklch(0.22 0.03 260 / <alpha-value>)',
      },
      primary: {
        DEFAULT: 'oklch(0.53 0.21 279 / <alpha-value>)',
        foreground: 'oklch(1 0 0 / <alpha-value>)',
      },
      secondary: {
        DEFAULT: 'oklch(0.985 0.004 90 / <alpha-value>)',
        foreground: 'oklch(0.22 0.03 260 / <alpha-value>)',
      },
      muted: {
        DEFAULT: 'oklch(0.985 0.004 90 / <alpha-value>)',
        foreground: 'oklch(0.55 0.02 260 / <alpha-value>)',
      },
      destructive: {
        DEFAULT: 'oklch(0.55 0.19 25 / <alpha-value>)',
        foreground: 'oklch(1 0 0 / <alpha-value>)',
      },
      border: 'oklch(0.78 0.015 260 / <alpha-value>)',
      input: 'oklch(0.78 0.015 260 / <alpha-value>)',
      ring: 'oklch(0.53 0.21 279 / <alpha-value>)',
    },

    // ── §3 Typography ────────────────────────────────────────────────────────
    //
    // The eight tokens from §3.2. Tailwind's own steps remain for the marketing
    // pages; the `non-token-type` rule in `check-brand.mjs` keeps them out of the
    // product pages, which is what removed the 343 sub-12px usages the audit found.
    //
    // Line height is baked in; **weight deliberately is not.** Tailwind emits a
    // `font-weight` declaration alongside `font-size` when a token specifies one,
    // and it then competes with `font-medium`/`font-semibold` on stylesheet source
    // order rather than class order — so `text-h3 font-medium` would resolve
    // differently depending on how Tailwind happened to sort its output. Weight
    // stays explicit at the call site.
    fontSize: {
      display: ['clamp(2.5rem, 6vw, 4.5rem)', { lineHeight: '1.05' }],
      h1: ['clamp(2rem, 4vw, 3rem)', { lineHeight: '1.1' }],
      h2: ['clamp(1.5rem, 2.5vw, 2rem)', { lineHeight: '1.15' }],
      h3: ['1.25rem', { lineHeight: '1.3' }],
      'body-lg': ['1.125rem', { lineHeight: '1.6' }],
      // §3.2 — the product UI default. Never smaller than this for body copy.
      body: ['1rem', { lineHeight: '1.5' }],
      // Table cells and secondary UI.
      sm: ['0.875rem', { lineHeight: '1.45' }],
      // Labels and eyebrows. The floor: there is no smaller token.
      caption: ['0.75rem', { lineHeight: '1.4' }],
    },

    // §3.2 — "No font weight above 600 anywhere (700+ reads shouty)."
    //
    // `bold`/`extrabold`/`black` still exist, because the marketing pages use them.
    // The `banned-weight` rule in `check-brand.mjs` is what keeps them out of the
    // product pages.
    fontWeight: { normal: '400', medium: '500', semibold: '600' },

    fontFamily: {
      // Self-hosted variable faces — see the @font-face block in index.css. §3.1
      // forbids the Google Fonts CDN on latency and privacy grounds.
      sans: ['Inter Variable', 'Inter', 'system-ui', '-apple-system', 'sans-serif'],
      mono: ['JetBrains Mono Variable', 'JetBrains Mono', 'ui-monospace', 'monospace'],
      // §3.1 permits Inter as the display fallback until a licensed display face
      // (Söhne / General Sans) is supplied. Tracking comes from `tracking-display`.
      display: ['Inter Variable', 'Inter', 'system-ui', 'sans-serif'],
    },

    letterSpacing: {
      display: '-0.02em', // §3.1 — display type is tight-tracked.
      normal: '0',
      caption: '0.06em', // §3.2 — eyebrows.
    },

    // ── §4 Spacing, radius, elevation ────────────────────────────────────────
    //
    // No `padding`/`margin`/`gap`/`space` overrides — see `GRID_STEPS` above.

    // §4.3 — sharp, infrastructure feel. Nothing rounder than 12px.
    borderRadius: {
      none: '0px',
      sm: '4px',
      md: '8px',
      lg: '12px',
      // §4.3 — "No pills except status badges." Reachable, because badges need
      // it; `check-brand.mjs` watches where it lands.
      full: '9999px',
    },

    // §4.4 — 1px borders are the elevation model, and `shadow-overlay` is the only
    // shadow the system uses. `shadow-sm/md/lg/xl` remain for the marketing pages;
    // `decorative-shadow` in `check-brand.mjs` keeps them off product screens.
    boxShadow: {
      none: 'none',
      overlay: '0 4px 16px oklch(0.18 0.03 260 / 0.10)',
    },

    // §5 — micro 150ms, panels 250ms, page-level 400ms.
    transitionDuration: { micro: '150ms', panel: '250ms', page: '400ms' },
    // §5 — ease-out-expo for entrances.
    transitionTimingFunction: { entrance: 'cubic-bezier(0.16, 1, 0.3, 1)' },
    // §4.2 — fixed 240px sidebar, collapsible to a 64px icon rail.
    width: { sidebar: '240px', rail: '64px' },
    maxWidth: {
      prose: '68ch', // §3.2 — max line length for prose.
      dashboard: '1400px', // §4.2
      marketing: '1200px', // §4.2
    },
    },
  },
  plugins: [
    tailwindcssAnimate,
    plugin(({ addUtilities }) => {
      addUtilities({
        // §7 — "mono tabular numerals for all metrics". One utility, so a metric
        // cannot be half-styled: figures line up in columns and stop changing
        // width as they tick.
        '.num': {
          fontFamily: 'JetBrains Mono Variable, JetBrains Mono, ui-monospace, monospace',
          fontVariantNumeric: 'tabular-nums',
        },
        // §3.2 — the eyebrow treatment as one class rather than three that can be
        // applied inconsistently.
        '.eyebrow': {
          fontSize: '0.75rem',
          lineHeight: '1.4',
          fontWeight: '500',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
        },
      });
    }),
  ],
};
