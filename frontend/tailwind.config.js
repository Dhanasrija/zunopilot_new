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

      /*
       * §2.1 ink — text and borders.
       *
       * Converted from the supplied hex palette (2026-08-06). Every value round-trips to the
       * exact hex it came from, so what ships is the colour that was designed, not a near miss.
       *
       * **Three text values were darkened from the supplied ones**, by the smallest step that
       * clears §2.4's 4.5:1 — the palette as drawn put secondary text at 3.88:1 and placeholder
       * at 2.41:1, and secondary text carries captions, timestamps and subtitles on every page.
       * The shift is barely perceptible; the failure would not have been.
       *
       * **The border values were NOT darkened**, deliberately. See the note on 400 below.
       */
      ink: {
        950: 'oklch(0.2100 0.0301 265.0 / <alpha-value>)',
        // Headings. #1D2433 as supplied — 15.5:1 on a card.
        900: 'oklch(0.2607 0.0301 265.0 / <alpha-value>)',
        // Body. #4F566B as supplied — 7.3:1 on a card.
        700: 'oklch(0.4552 0.0355 270.5 / <alpha-value>)',
        // Secondary text. Supplied #7A8197 measured 3.88:1; this is #6D7389 at 4.55:1, the
        // minimum darkening that clears AA with the hue and chroma untouched.
        500: 'oklch(0.5590 0.0344 271.4 / <alpha-value>)',
        // Placeholder. Supplied #A0A7B8 measured 2.41:1 — the worst pair in the palette, and
        // placeholder text is text. #707686 at 4.54:1. The only visibly darker change.
        450: 'oklch(0.5660 0.0258 267.8 / <alpha-value>)',
        /*
         * Control borders — inputs, selects, textareas. **#DDE2EC as supplied: 1.26:1.**
         *
         * This previously carried a comment saying it was "solved for exactly 3:1, so the edge
         * of a form field is always findable". That is no longer true and the comment would be
         * a lie if left. WCAG 1.4.11 wants 3:1 for a boundary that identifies a control, and
         * §10 called that release-blocking.
         *
         * Kept as designed on an explicit, informed decision (2026-08-06) after the measurement
         * was put in front of the owner. The cost is real and product-wide: the edge of a text
         * input against a white card is very faint. `scripts/check-contrast.mjs` records the
         * same departure rather than quietly passing, and reverting is one value here.
         */
        400: 'oklch(0.9119 0.0146 264.5 / <alpha-value>)',
        // Secondary button borders. #D7DCEA, 1.37:1 — same decision as 400.
        350: 'oklch(0.8948 0.0199 270.2 / <alpha-value>)',
        // Card outlines and default borders. #E6E9F2. Decorative, so no contrast floor applies
        // — this one was always allowed to be light.
        300: 'oklch(0.9343 0.0126 271.3 / <alpha-value>)',
        // Table row dividers. #EEF1F6. Also decorative.
        200: 'oklch(0.9573 0.0074 260.7 / <alpha-value>)',
      },

      /*
       * §2.1 surfaces.
       *
       * `surface-0` is now a **cool** near-white (#FAFBFF), reversing the warm #FBFAF7 the
       * guidelines used to insist on — §11 read "Warm off-white" against "Pure white… AI-default
       * look". Amended there rather than contradicted here.
       */
      surface: {
        0: 'oklch(0.9885 0.0054 275.0 / <alpha-value>)',
        1: 'oklch(1 0 0 / <alpha-value>)',
        // Selected row, e.g. the current conversation. #F7F5FF.
        2: 'oklch(0.9745 0.0134 295.3 / <alpha-value>)',
        // Hover. #F5F6FC — cooler and flatter than `surface-2`, so selection and hover do not
        // read as the same state.
        3: 'oklch(0.9741 0.0080 278.6 / <alpha-value>)',
      },

      // §2.1 accent — violet. See the note in §2.1 of the guidelines for why this
      // is violet rather than the cobalt the document originally specified.
      accent: {
        /*
         * **`DEFAULT` is new, and its absence was a live bug.**
         *
         * `bg-accent` and `hover:bg-accent` appear in Inbox, Dashboard, Leads, Orders and
         * Whatsapp — on selected rows and hover states. With only 100/600/700 defined, Tailwind
         * generated no CSS for the bare name, so those selectors did nothing: the selected
         * conversation had no highlight and rows had no hover. Silent, because a missing
         * background looks like a design choice.
         *
         * #F3F1FF, the light purple from the palette, which is what those call sites wanted.
         */
        DEFAULT: 'oklch(0.9637 0.0187 292.6 / <alpha-value>)',
        // #F3F1FF — light purple fills and badge backgrounds.
        100: 'oklch(0.9637 0.0187 292.6 / <alpha-value>)',
        // #D9D4FF — purple borders, e.g. a selected card's edge.
        200: 'oklch(0.8876 0.0589 290.5 / <alpha-value>)',
        // #5B4FF8 — primary. White on it is 5.36:1.
        600: 'oklch(0.5490 0.2408 278.1 / <alpha-value>)',
        // #4C3EF0 — primary hover.
        700: 'oklch(0.5082 0.2514 276.1 / <alpha-value>)',
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
      /*
       * The "Active" status colour. Supplied as #1F9D55, which measured 3.26:1 on its own tint
       * — status text is text. #00823B, the darkest of the four backgrounds it actually lands
       * on: the supplied tint, a 10% self-tint, a 15% wa-green tint, and `surface-0`. Worst case
       * 4.54:1.
       *
       * Solving against only the supplied tint gave a value that failed the two badge
       * composites by 0.02 and 0.05 — caught by the contrast script once it started reading the
       * real config instead of a copy of it. Hue and chroma are the supplied green's; only the
       * lightness moved.
       */
      success: 'oklch(0.5250 0.1504 152.3 / <alpha-value>)',
      // #EAFBF2 — the tint behind it.
      'success-bg': 'oklch(0.9731 0.0214 163.1 / <alpha-value>)',
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

      // Text sitting on a 15% tint of the matching `chart-N` — avatar initials,
      // categorical tag pills.
      //
      // **Measured, not guessed.** `chart-N` on its own 15% tint is 3.4:1 at worst,
      // which fails §2.4's 4.5:1 — the obvious construction is the wrong one, and
      // it looks fine, which is how it would have shipped. Solving for the
      // lightness that clears AA on all six hues gives **0.48** (worst case
      // 5.11:1); 0.52 still fails at 4.34:1. Same hue and chroma as `chart-N` so a
      // pill and its text read as one colour.
      //
      // Precedent: `success` above was darkened from the guidelines' own 0.62 for
      // exactly this reason. A palette that fails contrast is a palette that gets
      // used anyway.
      'chart-ink': {
        1: 'oklch(0.48 0.15 279 / <alpha-value>)',
        2: 'oklch(0.48 0.15 219 / <alpha-value>)',
        3: 'oklch(0.48 0.15 159 / <alpha-value>)',
        4: 'oklch(0.48 0.15 99 / <alpha-value>)',
        5: 'oklch(0.48 0.15 39 / <alpha-value>)',
        6: 'oklch(0.48 0.15 339 / <alpha-value>)',
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
      /*
       * These values are **duplicates of the brand tokens above, not references to them**, and
       * that is a trap worth naming: they were left on the old palette during the retune and a
       * page using `bg-primary` came out the previous violet while one using `bg-accent-600`
       * came out the new one. The Inbox alone mixes both within a few lines.
       *
       * Kept in sync by hand because Tailwind config cannot self-reference inside one object
       * literal without a second pass. **If you change a token above, change its twin here.**
       */
      background: 'oklch(0.9885 0.0054 275.0 / <alpha-value>)',
      foreground: 'oklch(0.2607 0.0301 265.0 / <alpha-value>)',
      card: {
        DEFAULT: 'oklch(1 0 0 / <alpha-value>)',
        foreground: 'oklch(0.2607 0.0301 265.0 / <alpha-value>)',
      },
      popover: {
        DEFAULT: 'oklch(1 0 0 / <alpha-value>)',
        foreground: 'oklch(0.2607 0.0301 265.0 / <alpha-value>)',
      },
      primary: {
        DEFAULT: 'oklch(0.5490 0.2408 278.1 / <alpha-value>)',
        foreground: 'oklch(1 0 0 / <alpha-value>)',
      },
      secondary: {
        DEFAULT: 'oklch(0.9885 0.0054 275.0 / <alpha-value>)',
        foreground: 'oklch(0.2607 0.0301 265.0 / <alpha-value>)',
      },
      muted: {
        DEFAULT: 'oklch(0.9885 0.0054 275.0 / <alpha-value>)',
        // Twin of `ink-500`, so it carries the AA-darkened value rather than the supplied one.
        foreground: 'oklch(0.5590 0.0344 271.4 / <alpha-value>)',
      },
      destructive: {
        DEFAULT: 'oklch(0.55 0.19 25 / <alpha-value>)',
        foreground: 'oklch(1 0 0 / <alpha-value>)',
      },
      // Twin of `ink-300` — decorative card outlines and dividers.
      border: 'oklch(0.9343 0.0126 271.3 / <alpha-value>)',
      // Twin of `ink-400` — control edges, and the departure recorded there applies here too.
      input: 'oklch(0.9119 0.0146 264.5 / <alpha-value>)',
      ring: 'oklch(0.5490 0.2408 278.1 / <alpha-value>)',
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
      // The tint is `ink-950`, restated because a boxShadow string cannot reference a
      // colour token. It was missed by the 2026-08-06 repalette and spent that change
      // casting the *previous* ink — the same drift that hid in `index.css` and in the
      // contrast script. If `ink-950` moves, move this with it.
      overlay: '0 4px 16px oklch(0.2100 0.0301 265.0 / 0.10)',
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
