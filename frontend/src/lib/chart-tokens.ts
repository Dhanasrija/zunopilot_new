// Chart colours, as values rather than classes.
//
// Recharts sets `stroke` and `fill` as props, so it needs resolved colour strings
// — a Tailwind class cannot reach an SVG presentation attribute. This module is the
// one place in `src/` permitted to hold colour values, and it is allowlisted in
// `scripts/check-brand.mjs` for exactly that reason. Everything here mirrors a
// token in `tailwind.config.js`; if the two disagree, the config is right.
//
// The series palette is derived, not picked: six hues 60° apart at **constant
// lightness and chroma**, so no series looks heavier than its neighbours and a
// reader does not unconsciously rank them. Series 1 is the brand accent, so a
// single-series chart is on-brand without anyone choosing.

/** §2.1 accent and ink, for axes, grids and single-series charts. */
export const CHART_INK = {
  /** Grid lines. Deliberately at the §2.1 border weight, not darker. */
  grid: 'oklch(0.78 0.015 260)',
  /** Axis tick labels — `--ink-500`, the muted-text token. */
  axis: 'oklch(0.55 0.02 260)',
  accent: 'oklch(0.53 0.21 279)',
  /** `--ink-900`, for figures drawn inside a chart. */
  ink: 'oklch(0.22 0.03 260)',
} as const;

/** Categorical series. Use in order; do not reorder to "look better". */
export const CHART_SERIES = [
  'oklch(0.58 0.15 279)',
  'oklch(0.58 0.15 219)',
  'oklch(0.58 0.15 159)',
  'oklch(0.58 0.15 99)',
  'oklch(0.58 0.15 39)',
  'oklch(0.58 0.15 339)',
] as const;

/**
 * §3.2 — the type floor applies inside charts too.
 *
 * Recharts takes a number, so this cannot be a token class. 12px is the caption
 * size and the smallest the system allows; the axis labels were previously 11px.
 */
export const CHART_TICK_SIZE = 12;

/**
 * Order status → series colour.
 *
 * Status is categorical here rather than semantic: these are the stages an order
 * moves through, and colouring "cancelled" with `--danger` would imply every
 * cancellation is a failure the business should act on. The semantic tokens are
 * for states that need attention.
 */
export const ORDER_STATUS_COLOR: Record<string, string> = {
  NEW: CHART_SERIES[0],
  ACCEPTED: CHART_SERIES[1],
  PREPARING: CHART_SERIES[3],
  READY: CHART_SERIES[1],
  OUT_FOR_DELIVERY: CHART_SERIES[5],
  DELIVERED: CHART_SERIES[2],
  CANCELLED: CHART_SERIES[4],
};

/**
 * §6 — the signature flow-diagram language, as values.
 *
 * React Flow takes colours as props, so these cannot be classes. §6 is specific:
 * "Edges: 1.5px lines in `--ink-300`; active path animates to `--accent-600`."
 * The builder and the marketing hero must look identical, so both read from here.
 */
export const FLOW_INK = {
  /** Edge and arrowhead colour. §6. */
  edge: 'oklch(0.78 0.015 260)',
  /** The active path. §6. */
  edgeActive: 'oklch(0.53 0.21 279)',
  /** Canvas dot grid — the same hairline weight as a border. */
  dots: 'oklch(0.78 0.015 260)',
  /** Minimap nodes: the accent tint, so the map reads as a diagram not a heatmap. */
  minimapNode: 'oklch(0.93 0.04 279)',
  /** Minimap mask — `--surface-0` at 75%. */
  minimapMask: 'oklch(0.985 0.004 90 / 0.75)',
} as const;
