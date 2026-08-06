# Brand Guidelines — WhatsApp Automation SaaS

> Working codename: **[PRODUCT]**. Replace throughout once named.
> Purpose: single source of truth for all UI (marketing site + product dashboard).
> Direction: **"Business infrastructure" aesthetic** — Stripe/Resend register, not chat-app cute.
> Hard rule: WhatsApp green is NEVER a brand color. It appears only semantically (see Color).

---

## 1. Brand Personality

- **Register:** Quiet confidence. Operationally serious. Documentation-adjacent.
- **We are:** infrastructure, reliability, delivery rates, compliance.
- **We are not:** emoji-heavy, bubbly, gradient blobs, fake chat mockups, "🚀 Supercharge your WhatsApp!"
- **Litmus test:** If a section could appear on a competitor clone (Wati/AiSensy style), redesign it.

---

## 2. Color System

All colors defined in OKLCH (perceptually uniform). Hex fallbacks provided.
Use CSS custom properties / Tailwind tokens only — never hardcode hex in components.

> **§2–4 are enforced by the build, not by memory.** `frontend/tailwind.config.js`
> *replaces* Tailwind's colour, type, weight, radius, spacing and shadow scales
> with the tokens below, so `font-bold`, `rounded-3xl` and `bg-slate-500` are no
> longer classes that exist. `frontend/scripts/check-brand.mjs` covers what a
> config cannot — arbitrary values like `text-[11px]`, hex literals, emoji in UI
> chrome, and `wa-green` outside its allowlist — and runs on `npm run build`.
>
> If you need a value the tokens do not have, add the token here first. That is the
> point: the system changes deliberately, in one place, rather than drifting one
> component at a time.

### 2.1 Core palette

| Token | OKLCH | Hex | Usage |
|---|---|---|---|
| `--ink-950` | `oklch(0.2100 0.0301 265.0)` | `#141A28` | Primary dark surface, footer, dark-mode bg |
| `--ink-900` | `oklch(0.2607 0.0301 265.0)` | `#1D2433` | Headings on light, dark-mode cards |
| `--ink-700` | `oklch(0.4552 0.0355 270.5)` | `#4F566B` | Body and secondary text on light |
| `--ink-500` | `oklch(0.5590 0.0344 271.4)` | `#6D7389` | Muted text — captions, timestamps, subtitles |
| `--ink-450` | `oklch(0.5660 0.0258 267.8)` | `#707686` | Placeholder text |
| `--ink-400` | `oklch(0.9119 0.0146 264.5)` | `#DDE2EC` | **Control** borders — inputs, selects, textareas |
| `--ink-350` | `oklch(0.8948 0.0199 270.2)` | `#D7DCEA` | Secondary button borders |
| `--ink-300` | `oklch(0.9343 0.0126 271.3)` | `#E6E9F2` | **Decorative** dividers — card outlines |
| `--ink-200` | `oklch(0.9573 0.0074 260.7)` | `#EEF1F6` | Table row dividers |
| `--surface-0` | `oklch(0.9885 0.0054 275.0)` | `#FAFBFF` | Page background (cool off-white, NOT pure white) |
| `--surface-1` | `oklch(1 0 0)` | `#FFFFFF` | Cards, elevated surfaces |
| `--surface-2` | `oklch(0.9745 0.0134 295.3)` | `#F7F5FF` | Selected row — the open conversation, the current list |
| `--surface-3` | `oklch(0.9741 0.0080 278.6)` | `#F5F6FC` | Row hover |
| `--accent-600` | `oklch(0.5490 0.2408 278.1)` | `#5B4FF8` | Primary accent — violet. CTAs, links, active states |
| `--accent-700` | `oklch(0.5082 0.2514 276.1)` | `#4C3EF0` | Accent hover/pressed |
| `--accent-200` | `oklch(0.8876 0.0589 290.5)` | `#D9D4FF` | Accent borders — outlined accent controls |
| `--accent-100` | `oklch(0.9637 0.0187 292.6)` | `#F3F1FF` | Accent tint backgrounds, badges |
| `--on-accent` | `oklch(1 0 0)` | `#FFFFFF` | Text/icons on an accent fill (§7 primary buttons) |

> **Repalette, 2026-08-06.** The whole scale was replaced from a supplied design.
> It is systematically lighter and cooler than what preceded it: the accent moved
> `#6049E7` → `#5B4FF8`, the page surface flipped from warm `#FBFAF7` to cool
> `#FAFBFF`, and the borders lightened hard — the divider by 52 points of
> lightness and the control border by 82.
>
> **Three text values were darkened from the supplied hexes**, by the smallest step
> that clears §2.4. Secondary text arrived at 3.88:1 and placeholder at 2.41:1, and
> both carry real content on every page. Hue and chroma are untouched; only
> lightness moved, so the palette still reads as the one that was drawn.
>
> **The two border values were taken exactly as supplied and do NOT clear 1.4.11.**
> That is a recorded departure, not an oversight — see §10.
>
> `--surface-2` and `--surface-3` are new. Selection and hover were the same colour
> before, which meant hovering a selected row made it look unselected.
>
> *(Superseded: the accent was cobalt `#3B5BDB` in the first draft of this document
> and violet `#6049E7` from 2026-08-01. The reasoning then — that the logo is a
> raster file that cannot be recoloured, so the document should match the assets —
> still holds, and the new violet is a 3° hue shift from the old one.)*

### 2.2 Semantic colors (status only — never decorative)

| Token | OKLCH | Hex | Usage |
|---|---|---|---|
| `--wa-green` | `oklch(0.72 0.19 150)` | `#25D366` | ONLY: WhatsApp connection status, "delivered/read" states, inside product screenshots |
| `--success` | `oklch(0.5250 0.1504 152.3)` | `#00823B` | Success toasts, passing checks, "Active" status text |
| `--success-bg` | `oklch(0.9731 0.0214 163.1)` | `#EAFBF2` | The tint behind an "Active" status badge |
| `--warning` | `oklch(0.75 0.15 75)` | `#E0A82E` | Template pending approval, quota warnings |
| `--danger` | `oklch(0.55 0.19 25)` | `#D24545` | Failures, ban-risk alerts, destructive actions |
| `--info` | same as `--accent-600` | — | Informational banners |

### 2.3 Dark mode (product dashboard is dark-mode-first)

> **DEFERRED, 2026-08-01.** The dashboard is light-only for now, by decision — not
> by oversight. Landing every other rule in §2–4 across 38 pages and doing a full
> dark visual pass at the same time is how a change this size goes wrong, so the
> light system ships first.
>
> Nothing here is discarded. `darkMode: ['class']` stays configured, and the
> palette lives in one `:root` block in `frontend/src/index.css`, so enabling dark
> mode is a second token block rather than a sweep through every component. The
> spec below stands as written for when it lands.

- Background: `--ink-950`. Cards: `--ink-900`. Never pure black `#000`.
- Text on dark: `oklch(0.93 0.005 260)` primary, `--ink-300` secondary.
- Desaturate accent slightly on dark: `--accent-dark: oklch(0.68 0.16 262)` (~`#6B8AF0`).
- Semantic greens/reds: reduce chroma ~15% on dark surfaces.

### 2.4 Rules

1. **60-30-10:** ~60% surfaces, ~30% ink/text, ~10% accent. Accent is scarce on purpose.
2. WhatsApp green never on buttons, nav, logos, headings, or backgrounds.
3. No gradients as decoration. One permitted use: a very subtle radial `--accent-600` at 4–6% opacity behind the hero.
4. All text/background pairs must pass WCAG 2.2 AA: 4.5:1 body, 3:1 large text and UI components. Verify with OKLCH-aware tooling, not eyeballing.

> **Two values in this document originally failed this rule.** Measured with
> `frontend/scripts/check-contrast.mjs` (OKLCH → OKLab → linear sRGB → WCAG ratio),
> corrected 2026-08-01:
>
> - **`--success` was `oklch(0.62 …)`, measuring 3.27:1** on `--surface-0` as text —
>   below the 4.5:1 this rule demands. Now `0.52`, which clears AA on both surfaces
>   and on its own tint background.
> - **`--ink-300` measures 1.92:1** and was specified for "borders, dividers".
>   That is fine for a *decorative* divider — WCAG 1.4.11 governs boundaries that
>   identify a control, not lines that separate content — but not for an input
>   edge. Split into `--ink-300` (decorative) and a separate `--ink-400`
>   (controls), which was then solved for exactly 3:1.
>
>   **`--ink-400` no longer meets that floor.** The 2026-08-06 repalette took the
>   supplied `#DDE2EC`, which measures **1.26:1**, on an explicit decision recorded
>   in §10. The split still stands and still matters; what changed is the value.
>
> The check runs on `npm run build`, so this cannot regress silently. It parses
> `tailwind.config.js` rather than restating the tokens — it used to hold its own
> copy of them, and that copy went stale during the repalette and printed green
> ticks for a palette that was no longer shipping.

---

## 3. Typography

### 3.1 Faces

| Role | Face | Fallback stack | Notes |
|---|---|---|---|
| Display (H1–H2, hero) | **Söhne** or **General Sans** (pick one, licensed) | `Inter, system-ui, sans-serif` | Tight tracking (-0.02em), weights 500–600 only. Used BIG and sparingly. |
| Body & UI | **Inter** (variable) | `system-ui, -apple-system, sans-serif` | Weights 400/500/600. Enable `cv05`, `cv11`, `ss01` stylistic sets if available. |
| Mono (data, API, template syntax, numbers in tables) | **JetBrains Mono** or **Geist Mono** | `ui-monospace, monospace` | Tabular numerals ON for all metrics/tables. |

Load as variable fonts, `font-display: swap`, self-hosted (no Google Fonts CDN — latency + privacy).

### 3.2 Type scale (fluid, clamp-based)

| Token | Size | Line height | Weight | Use |
|---|---|---|---|---|
| `--text-display` | `clamp(2.5rem, 6vw, 4.5rem)` | 1.05 | 600 | Hero headline only |
| `--text-h1` | `clamp(2rem, 4vw, 3rem)` | 1.1 | 600 | Page titles |
| `--text-h2` | `clamp(1.5rem, 2.5vw, 2rem)` | 1.15 | 600 | Section heads |
| `--text-h3` | `1.25rem` | 1.3 | 600 | Card titles |
| `--text-body-lg` | `1.125rem` (18px) | 1.6 | 400 | Marketing body copy |
| `--text-body` | `1rem` (16px) | 1.5 | 400 | Product UI default. NEVER smaller for body. |
| `--text-sm` | `0.875rem` | 1.45 | 400/500 | Table cells, secondary UI |
| `--text-caption` | `0.75rem` | 1.4 | 500 | Labels, eyebrows — uppercase, tracking +0.06em |

Rules: max line length 68ch for prose. Headings use `text-wrap: balance`. No font weight above 600 anywhere (700+ reads shouty). No italics in UI.

---

## 4. Spacing, Layout, Radius, Elevation

### 4.1 Spacing
- 4px base grid. Allowed steps: 4, 8, 12, 16, 24, 32, 48, 64, 96, 128.
- Section vertical padding (marketing): 96px desktop / 64px mobile.
- Card padding: 24px. Dense tables: 12px cell padding.

### 4.2 Layout
- Marketing max-width: 1200px content, 1440px full-bleed moments.
- Dashboard: fixed 240px sidebar (collapsible to 64px icon rail), fluid main, max content width 1400px.
- Use container queries for components, viewport queries only for page shell.
- Breakpoints: 640 / 768 / 1024 / 1280. Mobile-first.

### 4.3 Radius — sharp, infrastructure feel
- `--radius-sm: 4px` (inputs, tags), `--radius-md: 8px` (buttons, cards), `--radius-lg: 12px` (modals, hero media). Nothing rounder. No pills except status badges (`--radius-full`).

### 4.4 Elevation
- Prefer 1px borders (`--ink-300` light / `oklch(0.30 0.03 260)` dark) over shadows.
- Shadows only for overlays: `0 4px 16px oklch(0.18 0.03 260 / 0.10)` (modals, dropdowns). No decorative drop shadows on cards.

---

## 5. Motion

- Durations: 150ms (micro: hover, toggles), 250ms (panels, dropdowns), 400ms (page-level, hero orchestration).
- Easing: `cubic-bezier(0.16, 1, 0.3, 1)` (ease-out-expo) for entrances; `ease-in-out` for movement.
- ONE orchestrated moment per page: the hero flow-diagram animation (marketing home). Everything else is micro-interaction only.
- No scroll-jacking, no parallax, no auto-playing carousels.
- `prefers-reduced-motion: reduce` → all transitions drop to 0ms opacity-only. Non-negotiable.
- Use CSS View Transitions API for dashboard route changes where supported.

---

## 6. Signature Element — Flow Diagram Language

The brand's memorable element. Used in hero, empty states, and the actual flow-builder product UI. Must be visually identical in both.

- **Nodes:** `--surface-1` cards, 1px `--ink-300` border, `--radius-md`, mono-labeled type (trigger / condition / action).
- **Edges:** 1.5px lines in `--ink-300`; active path animates to `--accent-600` with a moving dash.
- **Status pills:** delivered/read use `--wa-green`, pending `--warning`, failed `--danger`. This is the ONLY place green lives on marketing pages.
- Hero version: subtle looping animation of one message flowing trigger → logic → delivered, with a real latency figure ticking (e.g. "142ms").

---

## 7. Components (baseline specs)

- **Buttons:** Primary = `--accent-600` bg, white text, 8px radius, 40px height (44px min touch target incl. padding), hover `--accent-700`, focus ring 2px `--accent-600` at 2px offset. Secondary = 1px border, ink text. Destructive = `--danger`. No icon-only buttons without `aria-label`.
- **Inputs:** 40px height, 1px `--ink-300` border, focus border `--accent-600` + ring. Error state: `--danger` border + message below (never placeholder-as-label).
- **Tables:** mono tabular numerals for all metrics, row hover `--accent-100` at 40% opacity, sticky header.
- **Badges:** status pills only — approved/connected (`--wa-green` tint bg + dark green text), pending (`--warning` tint), rejected/banned-risk (`--danger` tint).
- **Toasts:** bottom-right, 4s auto-dismiss, action verb matches trigger ("Publish" → "Published").
- **Empty states:** an illustration + a short heading + one sentence + one primary action. Never a sad-face illustration, never a stock graphic.
  - **Default to the §6 mini flow-diagram** (`ui/empty-state.tsx`). It is the right answer wherever the missing thing is automation — an unbuilt workflow, an assistant with no routes.
  - **A subject-specific spot illustration is allowed where the flow diagram would lie.** An empty customer list is an address book with nobody in it, not a missing automation; drawing a trigger→action chain there is decoration wearing the signature element's clothes. First example: `customers/EmptyListArt.tsx`.
  - Either way the drawing is **inline SVG on tokens** — 1px strokes per §4.4, `--radius-md` corners, no fill that is not a token, `aria-hidden` because the words carry the meaning. An exported asset drifts from the palette; an announced one repeats the heading.
  - Write the copy for *that* empty state. "No customers on this list" and "No customers match" want different sentences, and offering "Add customer" to someone whose search returned nothing answers a question they did not ask.

---

## 8. Voice & UX Writing

- Sentence case everywhere (buttons, headings, labels). No Title Case, no ALL CAPS except eyebrows.
- Active, specific verbs: "Save template", "Connect number" — never "Submit", "Get started" (except one homepage CTA).
- Same action keeps the same name through the whole flow.
- Errors: what happened + how to fix. Never apologize, never vague. ("Template rejected: variable {{2}} has no sample value. Add one and resubmit.")
- Numbers over adjectives: "99.2% delivery rate" beats "blazing fast". Show real metrics wherever possible.
- Compliance language is explicit and prominent: "Official WhatsApp Business API", opt-in/opt-out shown in screenshots, per-conversation pricing in ₹ with visible math.
- No emoji in UI chrome. Emoji may appear only inside message-preview content (it's user content).

---

## 9. Imagery & Iconography

- Icons: Lucide, 1.5px stroke, 20px in UI / 24px marketing. Never mix icon sets.
- No stock photos, no 3D blob illustrations, no fake phone mockups with invented chats.
- Product screenshots are the imagery: real UI, real (anonymized) data, dark-mode dashboard shots framed in a 12px-radius `--ink-950` browser chrome.
- Logo rules (once designed): clear space = height of one logomark; never on green; monochrome ink or white variants only.

---

## 10. Accessibility & Performance Floor (release-blocking)

- WCAG 2.2 AA: contrast per §2.4, visible focus on ALL interactive elements, 24px min target size (aim 44px), full keyboard nav, logical heading order.

> **One departure from this floor, accepted 2026-08-06 with the measurement in
> hand.** WCAG 1.4.11 asks for 3:1 on a boundary that identifies a control.
> `--ink-400` (input, select and textarea edges) measures **1.26:1** against the
> page and 1.30:1 against a card; `--ink-350` (secondary button edges) measures
> 1.37:1. Both were taken as supplied by the design.
>
> The cost is product-wide and worth stating plainly: **the edge of a text field
> against a white card is very faint**, on every form in the product, not just the
> screen the palette arrived on. Focus rings are unaffected — `--accent-600`
> against either surface clears 5:1, so a field is unmistakable once you are in it;
> what is hard is finding it before you are.
>
> `frontend/scripts/check-contrast.mjs` keeps testing these pairs and labels them
> `[DEPARTURE]` against a lowered threshold rather than dropping the rows, so the
> departure is visible on every build instead of being a green tick over nothing.
> Reverting is one value in `frontend/tailwind.config.js`: `--ink-400` at
> `oklch(0.655 0.015 260)` restores 3:1.
- `prefers-reduced-motion` and `prefers-color-scheme` respected.
- Core Web Vitals budgets: LCP < 2.5s, INP < 200ms, CLS < 0.1. Hero animation must not block LCP — render static first frame, animate after.
- Self-hosted variable fonts, `font-display: swap`, images via `next/image` (or equivalent) with explicit dimensions.

---

## 11. Do / Don't Quick Reference

| ✅ Do | ❌ Don't |
|---|---|
| Violet accent, used sparingly | WhatsApp green as brand color |
| Big confident display type as hero | Phone mockup with fake chats |
| 1px borders, sharp-ish radii | Soft shadows + 24px rounded everything |
| Real metrics, mono numerals | "Supercharge 🚀" adjectives |
| One orchestrated hero animation | Scroll-jacking, parallax, floating blobs |
| Sentence case, specific verbs | Title Case, "Submit", "Learn More" |
| Cool off-white `#FAFBFF` surfaces | Pure white or cream+terracotta AI-default look |
| Distinct selected and hover tints | One tint doing both, so hover unselects |
| Dark-mode-first dashboard | Auto-inverted dark mode |
