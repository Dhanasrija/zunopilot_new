import { useEffect, useState } from 'react';
import type { ComponentType, ReactNode } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import type { Variants } from 'framer-motion';
import { ArrowDown, ArrowRight, Check, X } from 'lucide-react';
import { useCountUp } from '@/hooks/useCountUp';
import { EASE_OUT, CARD_SPRING, viewport, item, stagger } from './primitives';

/*
 * The motion kit: the parts of the premium treatment that genuinely repeat.
 *
 * **Why this file exists and `primitives.tsx` was not simply extended.** `primitives`
 * holds the page *shell* — hero, section band, FAQ, CTA — the things every marketing page
 * must share or the site stops looking like one site. What is below is the opposite kind of
 * shared code: a vocabulary of *variants*, meant to be combined differently on every page.
 * `Flow` is one component with six layouts precisely so that the six feature pages can
 * each use a different diagram without six copies of the same connector maths.
 *
 * The rule this file is built around: **share the mechanism, not the look.** A page picks
 * `variant`, `tone` and its own icons; two pages using `Flow` should not look alike.
 *
 * **Reduced motion is handled here, not per call site.** `App.tsx` wraps everything in
 * `<MotionConfig reducedMotion="user">`, which covers every framer transition. What that
 * does *not* cover is a looping animation — an infinite travelling dot is still motion
 * even if framer shortens its transition — so anything that repeats forever checks
 * `useReducedMotion()` and renders a static state instead. There are only three such
 * animations in the kit, all transform-only, all decorative.
 */

/* -------------------------------------------------------------------------- */
/*                                  Reveal                                     */
/* -------------------------------------------------------------------------- */

/**
 * Scroll-reveal: fade plus a short lift.
 *
 * Exists because the same six lines of `initial` / `whileInView` / `viewport` /
 * `transition` were being retyped in every section, and a typo in any of them produces a
 * block that is invisible until scrolled past — a failure that looks like a bug in the
 * page, not in the animation.
 *
 * `y` is deliberately small. A 24px lift reads as arrival; a 100px one reads as a website
 * showing off, and on a slow phone it reads as jank.
 */
export function Reveal({
  children, y = 24, delay = 0, className = '', as = 'div',
}: {
  children: ReactNode;
  y?: number;
  delay?: number;
  className?: string;
  as?: 'div' | 'li' | 'section';
}) {
  const Tag = motion[as] as typeof motion.div;
  return (
    <Tag
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={viewport}
      transition={{ duration: 0.55, delay, ease: EASE_OUT }}
      className={className}
    >
      {children}
    </Tag>
  );
}

/* -------------------------------------------------------------------------- */
/*                           The travelling highlight                          */
/* -------------------------------------------------------------------------- */

/**
 * Which node in a diagram is currently lit, cycling forever.
 *
 * **Why this exists.** Every flow diagram marked one stage as `active` and left it lit. On a
 * static page that reads as "this stage is special", which is wrong — the stages are a sequence,
 * and the thing worth showing is movement *through* them. So the highlight now walks the
 * diagram: stage 1, then 2, then 3, and round again.
 *
 * A `setInterval` on an index rather than a CSS keyframe per node, because the number of nodes is
 * data. One timer drives the whole diagram, and the only thing that changes per tick is which
 * element gets the lit classes — so the cost is one re-render of a handful of nodes, not an
 * animation per element.
 *
 * **Returns `fallback` (default 0) and never starts when reduced motion is asked for.** A looping
 * highlight is exactly the kind of ambient movement that setting exists to stop, and framer's
 * `reducedMotion="user"` cannot help here: this is not a transition, it is a timer. A reader who
 * asked for stillness gets one node lit and no motion at all.
 */
export function useTravellingIndex(count: number, intervalMs = 1500, fallback = 0): number {
  const reduce = useReducedMotion();
  const [index, setIndex] = useState(fallback);

  useEffect(() => {
    if (reduce || count < 2) return undefined;
    const timer = window.setInterval(() => {
      setIndex((prev) => (prev + 1) % count);
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [count, intervalMs, reduce]);

  return reduce ? fallback : index;
}

/* -------------------------------------------------------------------------- */
/*                            Icons before titles                              */
/* -------------------------------------------------------------------------- */

export type IconTone = 'violet' | 'slate' | 'solid' | 'ghost';

const ICON_TONES: Record<IconTone, string> = {
  violet: 'bg-violet-50 text-violet-600 ring-1 ring-violet-200/70 group-hover:bg-violet-600 group-hover:text-white',
  slate: 'bg-slate-100 text-slate-700 ring-1 ring-slate-200 group-hover:bg-slate-900 group-hover:text-white',
  solid: 'bg-violet-600 text-white ring-1 ring-violet-500 group-hover:bg-violet-700',
  ghost: 'bg-transparent text-violet-600 ring-1 ring-violet-200 group-hover:bg-violet-50',
};

const ICON_SIZES = {
  sm: { box: 'h-8 w-8 rounded-lg', glyph: 'h-4 w-4' },
  md: { box: 'h-10 w-10 rounded-xl', glyph: 'h-5 w-5' },
  lg: { box: 'h-12 w-12 rounded-2xl', glyph: 'h-6 w-6' },
} as const;

/**
 * A framed icon. One size scale, one tone set, one hover behaviour, everywhere.
 *
 * The hover state is driven by `group-hover:` rather than by its own `whileHover`, so the
 * icon reacts when the **card** is hovered. An icon that only animates when the pointer
 * happens to be on the icon itself is a micro-interaction nobody ever sees.
 */
export function IconBadge({
  icon: Icon, tone = 'violet', size = 'md', className = '',
}: {
  icon: ComponentType<{ className?: string }>;
  tone?: IconTone;
  size?: keyof typeof ICON_SIZES;
  className?: string;
}) {
  const s = ICON_SIZES[size];
  return (
    <span
      aria-hidden
      className={`inline-grid shrink-0 place-items-center transition-colors duration-200 ${s.box} ${ICON_TONES[tone]} ${className}`}
    >
      <Icon className={s.glyph} />
    </span>
  );
}

/**
 * A heading with its icon **immediately before the text**, on the same baseline row.
 *
 * This is the shape asked for explicitly, and it is worth stating why it is a component
 * rather than two elements at each call site: getting it right means the icon does not
 * stretch, the text wraps without sliding under the icon, and the icon stays aligned to
 * the *first* line when the title wraps to two. `items-start` plus a fixed-basis badge
 * does that; `items-center` silently breaks on the first two-line title.
 */
export function IconTitle({
  icon, children, as = 'h3', tone = 'violet', size = 'md', className = '',
}: {
  icon: ComponentType<{ className?: string }>;
  children: ReactNode;
  as?: 'h2' | 'h3' | 'h4' | 'p';
  tone?: IconTone;
  size?: keyof typeof ICON_SIZES;
  className?: string;
}) {
  const Tag = as;
  return (
    <Tag className={`flex items-start gap-3 ${className}`}>
      <IconBadge icon={icon} tone={tone} size={size} className="mt-0.5" />
      <span className="min-w-0 pt-1.5">{children}</span>
    </Tag>
  );
}

/* -------------------------------------------------------------------------- */
/*                                  Cards                                      */
/* -------------------------------------------------------------------------- */

export type CardTone = 'plain' | 'violet' | 'dark' | 'outline' | 'sheen';

const CARD_TONES: Record<CardTone, string> = {
  plain: 'bg-white ring-1 ring-slate-200/80',
  violet: 'bg-gradient-to-br from-violet-50 via-white to-white ring-1 ring-violet-200',
  dark: 'bg-slate-900 ring-1 ring-white/10',
  outline: 'bg-white ring-1 ring-violet-200',
  sheen: 'bg-white ring-1 ring-slate-200/80',
};

/**
 * The card, with a glow instead of a border on hover.
 *
 * `tone` is what keeps six pages from looking alike: the same component reads as a product
 * card in `plain`, as an AI surface in `violet`, and as a technical panel in `dark`.
 *
 * The `sheen` tone adds a diagonal highlight that sweeps across on hover. It is a single
 * translated gradient behind `overflow-hidden` — no filter, no blur animation — because a
 * blur that animates repaints the whole card every frame and is the usual reason a
 * "premium" card feels slow.
 */
export function GlowCard({
  children, tone = 'plain', className = '', interactive = true, lift = 6,
}: {
  children: ReactNode;
  tone?: CardTone;
  className?: string;
  interactive?: boolean;
  lift?: number;
}) {
  const glow = tone === 'dark'
    ? '0 22px 50px -18px rgb(15 23 42 / 0.55)'
    : '0 22px 48px -20px rgb(96 73 231 / 0.32)';

  return (
    <motion.div
      variants={item}
      whileHover={interactive ? { y: -lift, boxShadow: glow } : undefined}
      transition={CARD_SPRING}
      className={`group relative h-full overflow-hidden rounded-3xl ${CARD_TONES[tone]} ${className}`}
    >
      {tone === 'sheen' && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-violet-100/70 to-transparent transition-transform duration-700 group-hover:translate-x-full"
        />
      )}
      <span className="relative block h-full">{children}</span>
    </motion.div>
  );
}

/* -------------------------------------------------------------------------- */
/*                                   Stats                                     */
/* -------------------------------------------------------------------------- */

/**
 * A number that counts up when it scrolls into view.
 *
 * Uses the existing `useCountUp` hook rather than a second implementation. `tabular-nums`
 * matters more than it looks: without it the digits have different widths, so a counting
 * number visibly jitters left and right as it runs.
 */
export function CountStat({
  value, label, suffix = '', prefix = '', decimals = 0,
}: {
  value: number;
  label: string;
  suffix?: string;
  prefix?: string;
  decimals?: number;
}) {
  const reduce = useReducedMotion();
  const { ref, value: current } = useCountUp(value);
  const shown = reduce ? value : current;
  return (
    <div className="text-center">
      <p className="text-3xl sm:text-4xl font-extrabold tracking-tight text-slate-900 tabular-nums">
        <span ref={ref}>
          {prefix}
          {shown.toFixed(decimals)}
          {suffix}
        </span>
      </p>
      <p className="mt-1 text-[13px] font-medium text-slate-600">{label}</p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                                   Flow                                      */
/* -------------------------------------------------------------------------- */

export interface FlowNode {
  label: string;
  detail?: string;
  icon?: ComponentType<{ className?: string }>;
  /** Marks the node the diagram is *about* — drawn with a pulsing ring. */
  active?: boolean;
  /** Marks the branch a decision flow treats as the exception. */
  muted?: boolean;
}

export type FlowVariant = 'horizontal' | 'vertical' | 'radial' | 'split' | 'decision' | 'layered';

/** The pulsing ring on an active node. Decorative, transform-only, gated on reduced motion. */
function Pulse({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <motion.span
      aria-hidden
      initial={{ opacity: 0.5, scale: 1 }}
      animate={{ opacity: 0, scale: 1.7 }}
      transition={{ duration: 1.9, repeat: Infinity, ease: 'easeOut' }}
      className="pointer-events-none absolute inset-0 rounded-2xl ring-2 ring-violet-400"
    />
  );
}

/** A node body, shared by every variant so the shapes differ but the parts do not. */
function Node({ node, animate }: { node: FlowNode; animate: boolean }) {
  const Icon = node.icon;
  return (
    <motion.div
      variants={item}
      whileHover={{ y: -3 }}
      transition={CARD_SPRING}
      className={`relative h-full rounded-2xl px-4 py-3.5 text-center ring-1 ${
        node.active
          ? 'bg-violet-600 ring-violet-500'
          : node.muted
            ? 'bg-slate-50 ring-slate-200'
            : 'bg-white ring-slate-200'
      }`}
    >
      <Pulse show={Boolean(node.active) && animate} />
      {Icon && (
        <span
          aria-hidden
          className={`mx-auto mb-2 grid h-9 w-9 place-items-center rounded-xl ${
            node.active ? 'bg-white/15 text-white' : 'bg-violet-50 text-violet-600'
          }`}
        >
          <Icon className="h-4 w-4" />
        </span>
      )}
      <p className={`text-[13px] font-semibold leading-snug ${node.active ? 'text-white' : 'text-slate-900'}`}>
        {node.label}
      </p>
      {node.detail && (
        <p className={`mt-1 text-[12px] leading-relaxed ${node.active ? 'text-violet-100' : 'text-slate-600'}`}>
          {node.detail}
        </p>
      )}
    </motion.div>
  );
}

/**
 * A connector with a dot travelling along it, so the diagram reads as flowing rather than
 * as boxes in a line.
 *
 * Two spans, one for each axis, because the dot travels on X between columns and on Y
 * between stacked rows and a single element cannot do both. Both are `aria-hidden`, so the
 * duplication costs nothing a crawler or a screen reader will ever see.
 */
function Connector({ animate, delay = 0 }: { animate: boolean; delay?: number }) {
  const travel = animate
    ? { animate: { x: ['-40%', '140%'] }, transition: { duration: 2.1, repeat: Infinity, ease: 'linear' as const, delay } }
    : {};
  const travelY = animate
    ? { animate: { y: ['-40%', '140%'] }, transition: { duration: 2.1, repeat: Infinity, ease: 'linear' as const, delay } }
    : {};

  return (
    <>
      {/* Stacked layout: a short vertical rail. */}
      <span aria-hidden className="relative mx-auto my-1 block h-6 w-px overflow-hidden bg-gradient-to-b from-violet-200 via-violet-400 to-violet-200 md:hidden">
        <motion.span {...travelY} className="absolute left-1/2 top-0 h-2 w-2 -translate-x-1/2 rounded-full bg-violet-600" />
      </span>
      {/*
        Row layout: a rail of **fixed** width, not `flex-1`.

        It used to be `flex-1`, which is the bug that made the last node twice the width of the
        others. Each stage is a `flex-1` list item holding a node plus a rail; when the rail also
        claimed `flex-1` it took half of that item, so every node rendered at half-width — except
        the last one, which has no rail after it and therefore kept the whole item. A fixed basis
        plus the matching spacer below (see `RAIL_SPACER`) makes every node exactly the same width.
      */}
      <span aria-hidden className="relative hidden h-px w-10 flex-none self-center overflow-hidden bg-gradient-to-r from-violet-200 via-violet-400 to-violet-200 md:block">
        <motion.span {...travel} className="absolute top-1/2 left-0 h-2 w-2 -translate-y-1/2 rounded-full bg-violet-600" />
      </span>
    </>
  );
}

/**
 * Occupies exactly the width a `Connector` rail would, after the final node.
 *
 * Without it the last stage is wider than every other stage by the width of one rail — visible
 * immediately as one box that does not match the row. `aria-hidden` and empty: it is layout, and
 * there is nothing here for a reader or a crawler.
 */
const RailSpacer = () => (
  <span aria-hidden className="hidden md:block md:w-10 md:flex-none" />
);

const flowContainer: Variants = { hidden: {}, show: { transition: { staggerChildren: 0.09 } } };

/**
 * One flow component, six layouts.
 *
 * The variety is the requirement: a page about routing should not use the same diagram as
 * a page about privacy. But six separate components would mean six copies of the node, the
 * connector, the stagger and the reduced-motion handling — and they would drift. So the
 * *parts* are shared and only the arrangement switches.
 *
 *   horizontal — a pipeline. Stages that always happen in order.
 *   vertical   — a sequence with room for longer labels.
 *   radial     — one thing several others attach to. No implied order.
 *   split      — one input, two parallel outcomes.
 *   decision   — a question with a yes branch and a no branch.
 *   layered    — a stack, where each layer sits on the one below.
 */
export function Flow({
  variant, nodes, className = '', branchLabels, cycle = false, cycleMs = 1500,
}: {
  variant: FlowVariant;
  nodes: readonly FlowNode[];
  className?: string;
  /** `split` and `decision` only: what the two outgoing paths are called. */
  branchLabels?: [string, string];
  /**
   * Walk the highlight through every node instead of leaving one lit.
   *
   * When set, each node's own `active` flag is ignored — the diagram has one lit stage at a time
   * and it moves. The node a caller marked `active` becomes the resting position for anyone with
   * reduced motion turned on, which is why that flag is still worth setting.
   */
  cycle?: boolean;
  cycleMs?: number;
}) {
  const reduce = useReducedMotion();
  const animate = !reduce;
  // The resting node: whichever one the caller marked, so a still diagram still makes its point.
  const restAt = Math.max(0, nodes.findIndex((n) => n.active));
  const lit = useTravellingIndex(cycle ? nodes.length : 0, cycleMs, restAt);
  /** Is this the node that should currently read as active? */
  const isLit = (i: number, node: FlowNode) => (cycle ? i === lit : Boolean(node.active));

  if (variant === 'radial') {
    const [hub, ...spokes] = nodes;
    return (
      <motion.div
        initial="hidden"
        whileInView="show"
        viewport={viewport}
        variants={flowContainer}
        className={`relative mx-auto grid max-w-3xl grid-cols-1 gap-4 sm:grid-cols-3 ${className}`}
      >
        {spokes.slice(0, 2).map((n) => <Node key={n.label} node={n} animate={animate} />)}
        <div className="sm:col-span-1 sm:row-span-1">
          <Node node={{ ...hub, active: true }} animate={animate} />
        </div>
        {spokes.slice(2).map((n) => <Node key={n.label} node={n} animate={animate} />)}
      </motion.div>
    );
  }

  if (variant === 'layered') {
    return (
      <motion.ol
        initial="hidden"
        whileInView="show"
        viewport={viewport}
        variants={flowContainer}
        className={`mx-auto max-w-2xl space-y-2 ${className}`}
      >
        {nodes.map((n, i) => (
          <motion.li key={n.label} variants={item} className="relative">
            <div
              className={`flex items-center gap-3 rounded-2xl px-5 py-4 ring-1 ${
                i === nodes.length - 1 ? 'bg-violet-600 ring-violet-500' : 'bg-white ring-slate-200'
              }`}
            >
              {n.icon && (
                <span
                  aria-hidden
                  className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${
                    i === nodes.length - 1 ? 'bg-white/15 text-white' : 'bg-violet-50 text-violet-600'
                  }`}
                >
                  <n.icon className="h-4 w-4" />
                </span>
              )}
              <div className="min-w-0">
                <p className={`text-sm font-semibold ${i === nodes.length - 1 ? 'text-white' : 'text-slate-900'}`}>
                  {n.label}
                </p>
                {n.detail && (
                  <p className={`text-[13px] ${i === nodes.length - 1 ? 'text-violet-100' : 'text-slate-600'}`}>
                    {n.detail}
                  </p>
                )}
              </div>
            </div>
            {i < nodes.length - 1 && (
              <span aria-hidden className="flex justify-center py-1 text-violet-400">
                <ArrowDown className="h-3.5 w-3.5" strokeWidth={3} />
              </span>
            )}
          </motion.li>
        ))}
      </motion.ol>
    );
  }

  if (variant === 'decision' || variant === 'split') {
    // The copy shape both of these serve: some number of shared stages, then a fork.
    const trunk = nodes.slice(0, Math.max(1, nodes.length - 2));
    const [yes, no] = nodes.slice(-2);
    const labels = branchLabels ?? (variant === 'decision' ? ['Yes', 'No'] : ['Path A', 'Path B']);

    return (
      <motion.div
        initial="hidden"
        whileInView="show"
        viewport={viewport}
        variants={flowContainer}
        className={`mx-auto max-w-4xl ${className}`}
      >
        <div className="flex flex-col md:flex-row md:items-stretch md:gap-3">
          {trunk.map((n, i) => (
            <div key={n.label} className="flex flex-col md:flex-1 md:flex-row md:items-stretch">
              <div className="md:flex-1">
                <Node node={{ ...n, active: isLit(i, n) }} animate={animate} />
              </div>
              {i < trunk.length - 1
                ? <Connector animate={animate} delay={i * 0.3} />
                : <RailSpacer />}
            </div>
          ))}
        </div>

        <span aria-hidden className="mx-auto my-2 block h-6 w-px bg-gradient-to-b from-violet-200 to-violet-400" />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-6">
          {[yes, no].map((n, i) => (
            <div key={n.label}>
              <p
                className={`mb-2 text-center text-[11px] font-bold uppercase tracking-widest ${
                  i === 0 ? 'text-violet-600' : 'text-slate-500'
                }`}
              >
                <span aria-hidden className="mr-1 inline-grid h-4 w-4 place-items-center rounded-full align-middle">
                  {i === 0
                    ? <Check className="h-3 w-3" strokeWidth={3} />
                    : <X className="h-3 w-3" strokeWidth={3} />}
                </span>
                {labels[i]}
              </p>
              <Node node={i === 1 ? { ...n, muted: true } : n} animate={animate} />
            </div>
          ))}
        </div>
      </motion.div>
    );
  }

  if (variant === 'vertical') {
    return (
      <motion.ol
        initial="hidden"
        whileInView="show"
        viewport={viewport}
        variants={flowContainer}
        className={`relative mx-auto max-w-xl ${className}`}
      >
        <motion.span
          aria-hidden
          variants={{ hidden: { scaleY: 0 }, show: { scaleY: 1, transition: { duration: 0.7, ease: EASE_OUT } } }}
          className="pointer-events-none absolute left-4 top-6 bottom-6 w-px origin-top bg-gradient-to-b from-violet-200 via-violet-400 to-violet-200"
        />
        {nodes.map((n, i) => (
          <motion.li key={n.label} variants={item} className="relative pl-12 pb-3 last:pb-0">
            <span className="absolute left-0 top-2 grid h-8 w-8 place-items-center rounded-full bg-white ring-1 ring-violet-200">
              <span className="grid h-6 w-6 place-items-center rounded-full bg-violet-600 text-[10px] font-bold text-white tabular-nums">
                {String(i + 1).padStart(2, '0')}
              </span>
            </span>
            <motion.div
              whileHover={{ x: 4 }}
              transition={CARD_SPRING}
              className="rounded-2xl bg-white ring-1 ring-slate-200/80 px-5 py-3.5"
            >
              <p className="text-[15px] font-semibold text-slate-900">{n.label}</p>
              {n.detail && <p className="mt-1 text-[13px] text-slate-600 leading-relaxed">{n.detail}</p>}
            </motion.div>
            {i < nodes.length - 1 && (
              <span aria-hidden className="absolute left-[10px] -bottom-1 text-violet-400">
                <ArrowDown className="h-3.5 w-3.5" strokeWidth={3} />
              </span>
            )}
          </motion.li>
        ))}
      </motion.ol>
    );
  }

  // horizontal
  return (
    <motion.ol
      initial="hidden"
      whileInView="show"
      viewport={viewport}
      variants={flowContainer}
      className={`flex flex-col md:flex-row md:items-stretch ${className}`}
    >
      {nodes.map((n, i) => (
        <li key={n.label} className="flex flex-col md:flex-1 md:flex-row md:items-stretch md:min-w-0">
          <div className="md:flex-1 md:min-w-0">
            <Node node={{ ...n, active: isLit(i, n) }} animate={animate} />
          </div>
          {i < nodes.length - 1
            ? <Connector animate={animate} delay={i * 0.28} />
            : <RailSpacer />}
        </li>
      ))}
    </motion.ol>
  );
}

/* -------------------------------------------------------------------------- */
/*                              Small components                               */
/* -------------------------------------------------------------------------- */

/** A labelled pill row. Used where copy gives a short list of names, not sentences. */
export function ChipRow({
  chips, tone = 'violet', className = '',
}: {
  chips: readonly string[];
  tone?: 'violet' | 'slate';
  className?: string;
}) {
  const style = tone === 'violet'
    ? 'bg-violet-50 text-violet-700 ring-violet-200'
    : 'bg-slate-50 text-slate-700 ring-slate-200';
  return (
    <motion.ul
      initial="hidden"
      whileInView="show"
      viewport={viewport}
      variants={stagger(0, 0.04)}
      className={`flex flex-wrap gap-2 ${className}`}
    >
      {chips.map((chip) => (
        <motion.li
          key={chip}
          variants={item}
          whileHover={{ y: -2 }}
          transition={CARD_SPRING}
          className={`rounded-full px-3.5 py-1.5 text-[13px] font-medium ring-1 ${style}`}
        >
          {chip}
        </motion.li>
      ))}
    </motion.ul>
  );
}

/** An inline "→ next thing" affordance for cards that link somewhere. */
export function CardLink({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-violet-600">
      {children}
      <ArrowRight aria-hidden className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-1" />
    </span>
  );
}
