import { Fragment, useState, type ComponentType, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDown, ArrowRight, Check, Plus } from 'lucide-react';
import {
  motion, AnimatePresence, useScroll, useSpring, type Variants,
} from 'framer-motion';
import { Button } from '@/components/ui/button';
import { useFaqSchema, type FaqEntry } from '@/lib/json-ld';
import { DEMO_REQUEST_LINK } from '@/lib/enquiry';
import { CTA_LABEL, SIGNUP_LINK } from '@/lib/marketing-nav';

/*
 * The building blocks every marketing page is made of.
 *
 * **Why these exist.** The site went from one long page to eight, and the eight share
 * a shape: a hero, then alternating bands of "heading + lead paragraph + a list or a
 * grid of tiles", then an FAQ, then a call to action. Written out per page that is
 * roughly nine hundred lines of near-identical JSX apiece, and — more to the point —
 * nine chances for the heading sizes, the card radius or the FAQ markup to drift
 * apart. A visitor moving from /features to /solutions should not be able to tell
 * they changed template.
 *
 * The animation variants at the top were lifted from Landing.tsx unchanged, so the
 * new pages move the way the home page already did.
 *
 * **On the FAQ block specifically:** `FaqSection` renders the accordion *and* emits
 * the `FAQPage` JSON-LD from the same array. That coupling is the point. The previous
 * arrangement had the questions in the component and a hand-maintained copy of them in
 * a schema file, which is how a page ends up telling Google about an answer it no
 * longer shows — the exact mismatch Google penalises rich results for.
 */

/* -------------------------------------------------------------------------- */
/*                             Animation vocabulary                            */
/* -------------------------------------------------------------------------- */

export const EASE_OUT = [0.22, 0.61, 0.36, 1] as const;
export const SPRING = { type: 'spring' as const, stiffness: 220, damping: 28, mass: 0.6 };
export const CARD_SPRING = { type: 'spring' as const, stiffness: 280, damping: 22, mass: 0.7 };

/**
 * Scroll-reveal trigger.
 *
 * `amount: 0.15` — fire when 15% of the element is on screen — rather than a negative
 * root margin. The margin form was measured against the element's *whole* box, so a
 * tall section (most of these are 600px+) had to be almost fully scrolled past before
 * it counted as in view, and the reveal either happened off-screen or appeared not to
 * happen at all. A fraction is relative to the element, so it behaves the same for a
 * one-line heading and a nine-card grid.
 *
 * `once` stays true: content that re-animates every time you scroll back up is a
 * distraction, not a flourish.
 */
export const viewport = { once: true, amount: 0.15 } as const;

export const stagger = (delayChildren = 0, staggerChildren = 0.08): Variants => ({
  hidden: {},
  show: { transition: { delayChildren, staggerChildren } },
});

export const item: Variants = {
  hidden: { opacity: 0, y: 32, scale: 0.97 },
  show: {
    opacity: 1, y: 0, scale: 1,
    transition: { type: 'spring', stiffness: 170, damping: 22, mass: 0.7 },
  },
};

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 28 },
  show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: EASE_OUT } },
};

export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.92 },
  show: { opacity: 1, scale: 1, transition: { duration: 0.8, ease: EASE_OUT } },
};

/* -------------------------------------------------------------------------- */
/*                          Word-by-word animated heading                      */
/* -------------------------------------------------------------------------- */

const headingContainer: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.07, delayChildren: 0.05 } },
};

const headingWord: Variants = {
  hidden: { opacity: 0, y: 24, filter: 'blur(8px)' },
  show: {
    opacity: 1, y: 0, filter: 'blur(0px)',
    transition: { duration: 0.7, ease: EASE_OUT },
  },
};

export function AnimatedHeading({
  text = '',
  as = 'h2',
  className = '',
  trigger = 'inView',
  lines,
}: {
  text?: string;
  as?: 'h1' | 'h2' | 'h3';
  className?: string;
  /** Trigger on mount instead of on scroll-in. Used for hero headings. */
  trigger?: 'inView' | 'mount';
  /** Manual line breaks; each entry renders as its own block. */
  lines?: string[];
}) {
  const Tag = motion[as] as typeof motion.h2;
  const groupsRaw = lines ?? text.split('\n');
  const groups = groupsRaw.length ? groupsRaw : [text];

  const motionProps = trigger === 'mount'
    ? { initial: 'hidden', animate: 'show' }
    : { initial: 'hidden', whileInView: 'show', viewport };

  return (
    <Tag {...motionProps} variants={headingContainer} className={className}>
      {groups.map((line, lineIdx) => {
        const words = line.split(' ');
        return (
          <span key={lineIdx} className="block">
            {words.map((word, i) => (
              /*
                **The space goes here, between the word wrappers — never inside one.**

                This is the bug that made every heading on the site read
                "AI-PoweredWhatsAppBusinessAutomation". The wrapper is
                `inline-block overflow-hidden` (it has to be, so each word can slide up
                from behind its own clipping edge), and *trailing whitespace inside an
                inline-block is collapsed away by the browser*. So a space written as
                the last child of the animated span exists in `textContent` — which is
                why a test asserting on text passed — and renders as nothing at all.

                As a text node *between* two inline-blocks it is ordinary inter-element
                whitespace, and it renders. `{' '}` rather than a literal space in the
                JSX, because JSX strips whitespace around newlines.
              */
              <Fragment key={`${lineIdx}-${i}`}>
                <span className="inline-block overflow-hidden pb-1 -mb-1">
                  <motion.span variants={headingWord} className="inline-block">
                    {word}
                  </motion.span>
                </span>
                {i < words.length - 1 && ' '}
              </Fragment>
            ))}
            {/*
              And one between the lines — as a **non-breaking** space, U+00A0.

              A plain `' '` here was still wrong, and wrong in a way that looked fine:
              it is the *last* child of a `block`, where the browser collapses trailing
              whitespace. So the words rendered on separate lines and looked correct,
              but the heading's text was one fused run — "Automate Your
              BusinessCommunication on WhatsApp" — which is what a copy-paste, a screen
              reader and a text extraction all see. U+00A0 does not collapse, and it is
              invisible sitting at the end of a line.
            */}
            {lineIdx < groups.length - 1 && '\u00A0'}
          </span>
        );
      })}
    </Tag>
  );
}

/* -------------------------------------------------------------------------- */
/*                                  Layout                                     */
/* -------------------------------------------------------------------------- */

export function Section({
  id, children, className = '', tone = 'white',
}: {
  id?: string;
  children: ReactNode;
  className?: string;
  /** `tinted` gives the band a faint violet wash, for alternating rhythm. */
  tone?: 'white' | 'tinted';
}) {
  const bg = tone === 'tinted' ? 'bg-gradient-to-b from-violet-50/50 to-white' : 'bg-white';
  return (
    <section id={id} className={`py-16 sm:py-20 lg:py-24 ${bg} ${className}`}>
      {/*
        One reveal for the band as a whole, on top of whatever its children do.

        The individual pieces already animate, but each was doing so in isolation, so
        scrolling read as a series of unrelated twitches rather than a section arriving.
        A single 24px lift on the container ties them together — and because it is the
        *container*, it costs one animated element per section rather than thirty.

        `scrollMarginTop` keeps an `#anchor` landing below the sticky header instead of
        underneath it. The header is 64px on mobile, 80px from `lg` up.
      */}
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={viewport}
        transition={{ duration: 0.55, ease: EASE_OUT }}
        className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 scroll-mt-20"
      >
        {children}
      </motion.div>
    </section>
  );
}

/**
 * A hairline progress bar pinned under the header.
 *
 * These pages are long — several screens each — and a reader has no other cue for how
 * much is left. One `scaleX` on a transformed element, so it costs nothing per frame.
 */
export function ScrollProgress() {
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, { stiffness: 140, damping: 30, restDelta: 0.001 });

  return (
    <motion.div
      aria-hidden
      style={{ scaleX }}
      className="fixed top-0 left-0 right-0 z-[60] h-0.5 origin-left bg-violet-600"
    />
  );
}

/**
 * The trail above an `<h1>` on a page nested under a hub.
 *
 * Visible breadcrumbs and the `BreadcrumbList` graph are separate things and Google
 * wants both — the markup for the search result, the links for the person who arrived
 * on a detail page from a search result and needs a way up.
 */
export function Breadcrumbs({ crumbs }: { crumbs: readonly { name: string; path: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-6">
      <ol className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-sm text-slate-600">
        {crumbs.map((crumb, i) => (
          <li key={crumb.path} className="flex items-center gap-2">
            {i < crumbs.length - 1 ? (
              <Link to={crumb.path} className="hover:text-violet-600 transition-colors">
                {crumb.name}
              </Link>
            ) : (
              <span className="text-slate-700 font-medium" aria-current="page">{crumb.name}</span>
            )}
            {i < crumbs.length - 1 && <span aria-hidden className="text-slate-300">/</span>}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/**
 * The heading block that opens most sections.
 *
 * `title` takes an array so the copy controls where the line breaks fall — the
 * headings are set large enough that letting the browser wrap them produces widows.
 */
export function SectionHead({
  eyebrow, title, lead, align = 'center', as = 'h2',
}: {
  eyebrow?: string;
  title: string[];
  lead?: ReactNode;
  align?: 'center' | 'left';
  as?: 'h2' | 'h3';
}) {
  const wrap = align === 'center' ? 'text-center max-w-3xl mx-auto' : 'max-w-3xl';
  return (
    <div className={wrap}>
      {eyebrow && (
        <motion.p
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={viewport}
          transition={{ duration: 0.5, ease: EASE_OUT }}
          className="text-sm font-semibold uppercase tracking-widest text-violet-600"
        >
          {eyebrow}
        </motion.p>
      )}
      <AnimatedHeading
        as={as}
        lines={title}
        className={`${eyebrow ? 'mt-3' : ''} text-3xl sm:text-4xl lg:text-[44px] lg:leading-[1.15] font-extrabold tracking-tight text-slate-900`}
      />
      {lead && (
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={viewport}
          transition={{ duration: 0.6, ease: EASE_OUT }}
          className="mt-4 space-y-3 text-base sm:text-lg text-slate-600 leading-relaxed"
        >
          {lead}
        </motion.div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                              Content blocks                                 */
/* -------------------------------------------------------------------------- */

/** A tick-marked list. Used wherever the copy reads as "you can:" followed by items. */
export function CheckList({
  items, columns = 2, className = '',
}: {
  items: readonly string[];
  columns?: 1 | 2 | 3;
  className?: string;
}) {
  const cols = columns === 1 ? '' : columns === 3
    ? 'sm:grid-cols-2 lg:grid-cols-3'
    : 'sm:grid-cols-2';

  return (
    <motion.ul
      initial="hidden"
      whileInView="show"
      viewport={viewport}
      variants={stagger(0, 0.05)}
      className={`grid grid-cols-1 ${cols} gap-x-8 gap-y-3 ${className}`}
    >
      {items.map((text) => (
        <motion.li key={text} variants={fadeUp} className="flex items-start gap-3">
          <span className="mt-0.5 grid place-items-center h-5 w-5 shrink-0 rounded-full bg-violet-100 text-violet-600">
            <Check className="h-3 w-3" strokeWidth={3} />
          </span>
          <span className="text-[15px] sm:text-base text-slate-700 leading-relaxed">{text}</span>
        </motion.li>
      ))}
    </motion.ul>
  );
}

/**
 * A tick list rendered as cards rather than as rows.
 *
 * `CheckList` is right inside a panel that already has a border. This is for the case
 * where the list *is* the section — eight or nine short capability statements that need
 * to carry a band on their own. Each item gets its own surface, a violet tick that
 * fills on hover, and a staggered reveal, so a long list reads as a grid of things the
 * product does instead of as a wall of bullets.
 */
export function CheckCards({
  items, columns = 2, className = '',
}: {
  items: readonly string[];
  columns?: 2 | 3 | 4;
  className?: string;
}) {
  const cols = columns === 4
    ? 'sm:grid-cols-2 lg:grid-cols-4'
    : columns === 3
      ? 'sm:grid-cols-2 lg:grid-cols-3'
      : 'sm:grid-cols-2';

  return (
    <motion.ul
      initial="hidden"
      whileInView="show"
      viewport={viewport}
      variants={stagger(0, 0.05)}
      className={`grid grid-cols-1 ${cols} gap-3 sm:gap-4 ${className}`}
    >
      {items.map((text) => (
        <motion.li
          key={text}
          variants={item}
          whileHover={{ y: -4, boxShadow: '0 14px 30px -12px rgb(96 73 231 / 0.25)' }}
          transition={CARD_SPRING}
          className="group flex items-start gap-3 rounded-2xl bg-white ring-1 ring-slate-200/80 p-4 sm:p-5"
        >
          <span className="mt-0.5 grid place-items-center h-6 w-6 shrink-0 rounded-full bg-violet-100 text-violet-600 ring-1 ring-violet-200/70 transition-colors group-hover:bg-violet-600 group-hover:text-white">
            <Check className="h-3.5 w-3.5" strokeWidth={3} />
          </span>
          <span className="text-[15px] font-medium text-slate-800 leading-relaxed">{text}</span>
        </motion.li>
      ))}
    </motion.ul>
  );
}

export interface Tile {
  title: string;
  body?: string;
  /**
   * Optional lucide icon, rendered **immediately before the title text** on the same row.
   *
   * It used to sit on its own line above the title. That is the easier layout and the
   * worse one: it pushes the title down, so a grid of cards has its headings at
   * inconsistent heights, and the icon ends up reading as decoration rather than as a
   * label for the thing next to it.
   */
  icon?: ComponentType<{ className?: string }>;
}

/** The card grid used for feature lists, benefit lists and use-case lists. */
export function TileGrid({
  tiles, columns = 3, numbered = false,
}: {
  tiles: readonly Tile[];
  columns?: 2 | 3;
  numbered?: boolean;
}) {
  const cols = columns === 2 ? 'sm:grid-cols-2' : 'sm:grid-cols-2 lg:grid-cols-3';
  return (
    <motion.div
      initial="hidden"
      whileInView="show"
      viewport={viewport}
      variants={stagger(0, 0.07)}
      className={`grid grid-cols-1 ${cols} gap-4 sm:gap-5`}
    >
      {tiles.map((tile, i) => (
        <motion.div
          key={tile.title}
          variants={item}
          whileHover={{ y: -6, boxShadow: '0 18px 40px -14px rgb(96 73 231 / 0.22)' }}
          whileTap={{ scale: 0.99 }}
          transition={CARD_SPRING}
          className="group relative h-full rounded-3xl bg-gradient-to-br from-slate-50 to-slate-100/60 ring-1 ring-slate-200/80 p-6 cursor-default"
        >
          {numbered && (
            <span className="inline-flex items-center justify-center h-8 w-8 rounded-full bg-violet-600 text-white text-sm font-semibold">
              {String(i + 1).padStart(2, '0')}
            </span>
          )}
          {/*
            Icon and title on one row, icon first.

            `items-start` with the badge nudged down by 2px rather than `items-center`,
            because a two-line title with `items-center` drags the icon to the vertical
            middle of the block and it stops looking attached to the first line.
          */}
          <h3
            className={`${numbered ? 'mt-4' : ''} flex items-start gap-3 text-lg font-bold text-slate-900`}
          >
            {tile.icon && (
              <span
                aria-hidden
                className="mt-0.5 inline-grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-violet-50 text-violet-600 ring-1 ring-violet-200/70 transition-colors duration-200 group-hover:bg-violet-600 group-hover:text-white"
              >
                <tile.icon className="h-5 w-5" />
              </span>
            )}
            <span className={tile.icon ? 'min-w-0 pt-1.5' : 'min-w-0'}>{tile.title}</span>
          </h3>
          {tile.body && (
            <p className="mt-2 text-sm text-slate-700 leading-relaxed">{tile.body}</p>
          )}
        </motion.div>
      ))}
    </motion.div>
  );
}

export interface Step {
  index: string;
  kicker?: string;
  title: string;
  body: string;
  /** Optional lucide icon, rendered immediately before the title text. */
  icon?: ComponentType<{ className?: string }>;
}

/** The numbered "how it works" rail. */
export function StepRail({
  steps, columns = 4,
}: {
  steps: readonly Step[];
  /** Four across by default; three when the copy comes in threes. */
  columns?: 3 | 4;
}) {
  const cols = columns === 3 ? 'lg:grid-cols-3' : 'lg:grid-cols-4';
  return (
    <motion.ol
      initial="hidden"
      whileInView="show"
      viewport={viewport}
      variants={stagger(0, 0.09)}
      className={`grid grid-cols-1 sm:grid-cols-2 ${cols} gap-4 sm:gap-5`}
    >
      {steps.map((step) => (
        <motion.li
          key={step.index}
          variants={item}
          whileHover={{ y: -6, boxShadow: '0 20px 44px -20px rgb(96 73 231 / 0.28)' }}
          transition={CARD_SPRING}
          className="group relative h-full rounded-3xl bg-white ring-1 ring-slate-200/80 p-6"
        >
          <p className="text-sm font-semibold text-violet-600 tabular-nums">
            {step.index}
            {step.kicker && <span className="text-slate-400"> — {step.kicker}</span>}
          </p>
          <h3 className="mt-3 flex items-start gap-2.5 text-lg font-bold text-slate-900">
            {step.icon && (
              <span
                aria-hidden
                className="mt-0.5 inline-grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-violet-50 text-violet-600 ring-1 ring-violet-200/70 transition-colors duration-200 group-hover:bg-violet-600 group-hover:text-white"
              >
                <step.icon className="h-4 w-4" />
              </span>
            )}
            <span className={step.icon ? 'min-w-0 pt-1' : 'min-w-0'}>{step.title}</span>
          </h3>
          <p className="mt-2 text-sm text-slate-700 leading-relaxed">{step.body}</p>
        </motion.li>
      ))}
    </motion.ol>
  );
}

/**
 * A vertical chain of stages with arrows between them.
 *
 * The copy uses this shape repeatedly ("Customer sends a message ↓ Automation
 * identifies the workflow ↓ …"), and rendering it as prose loses the sequence.
 */
export function FlowChain({ steps, className = '' }: { steps: readonly string[]; className?: string }) {
  return (
    <motion.ol
      initial="hidden"
      whileInView="show"
      viewport={viewport}
      variants={stagger(0.05, 0.12)}
      className={`relative mx-auto max-w-2xl ${className}`}
    >
      {/*
        **A continuous rail behind the stages, rather than a mark between each pair.**

        The earlier versions put something *between* consecutive cards — first a glyph,
        then a gradient rule with a dot. Both read as punctuation dropped into a gap.
        Drawing one line down the whole column and letting the numbered nodes sit on top of it
        makes the sequence a single object, which is what a flow is.

        The rail is `scaleY` from the top, so it costs one composited property and grows
        as the section arrives.
      */}
      <motion.span
        aria-hidden
        variants={{
          hidden: { scaleY: 0 },
          show: { scaleY: 1, transition: { duration: 0.7, ease: EASE_OUT } },
        }}
        className="pointer-events-none absolute left-[19px] top-6 bottom-6 w-px origin-top bg-gradient-to-b from-violet-200 via-violet-300 to-violet-200"
      />

      {steps.map((step, i) => (
        <motion.li key={step} variants={fadeUp} className="relative pl-14 pb-3 last:pb-0">
          {/* The node. Sits on the rail, so the rail appears to thread through it. */}
          <span className="absolute left-0 top-1 grid h-10 w-10 place-items-center rounded-full bg-white ring-1 ring-violet-200 shadow-sm shadow-violet-100">
            <span className="grid h-7 w-7 place-items-center rounded-full bg-violet-600 text-[11px] font-semibold text-white">
              {String(i + 1).padStart(2, '0')}
            </span>
          </span>

          <motion.div
            whileHover={{ x: 4 }}
            transition={CARD_SPRING}
            className="rounded-2xl bg-white ring-1 ring-slate-200/80 px-5 py-3.5"
          >
            <span className="text-[15px] font-medium text-slate-800">{step}</span>
          </motion.div>

          {/* A small down arrow on the rail between stages — the direction cue. */}
          {i < steps.length - 1 && (
            <motion.span
              aria-hidden
              variants={{
                hidden: { opacity: 0 },
                show: { opacity: 1, transition: { duration: 0.3, delay: 0.15 } },
              }}
              className="absolute left-[13px] -bottom-1 text-violet-400"
            >
              <ArrowDown className="h-3.5 w-3.5" strokeWidth={3} />
            </motion.span>
          )}
        </motion.li>
      ))}
    </motion.ol>
  );
}

/** The two-column "what you want → which page" tables the copy uses. */
export function MatchTable({
  head, rows,
}: {
  head: [string, string];
  rows: readonly (readonly [string, string, string?])[];
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={viewport}
      transition={{ duration: 0.6, ease: EASE_OUT }}
      className="overflow-hidden rounded-3xl ring-1 ring-slate-200"
    >
      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="bg-slate-50">
            <th className="px-5 py-4 text-sm font-semibold text-slate-900">{head[0]}</th>
            <th className="px-5 py-4 text-sm font-semibold text-slate-900">{head[1]}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([left, right, href]) => (
            <tr key={left} className="border-t border-slate-100">
              <td className="px-5 py-4 text-sm text-slate-700 align-top">{left}</td>
              <td className="px-5 py-4 text-sm font-medium text-slate-900 align-top">
                {href
                  ? <Link to={href} className="text-violet-600 hover:text-violet-700 underline underline-offset-4">{right}</Link>
                  : right}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </motion.div>
  );
}

/** The "Explore … →" link that closes most sections. */
export function ArrowLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      className="group inline-flex items-center gap-2 text-[15px] font-semibold text-violet-600 hover:text-violet-700"
    >
      {children}
      <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
    </Link>
  );
}

/**
 * The width every primary CTA button is laid out at, on every page.
 *
 * **Why a fixed width and not padding.** The pair was `px-7` on both buttons, so each
 * one was as wide as its own label — "Get Started" is nine glyphs narrower than
 * "Book a Demo", and the two sat side by side visibly mismatched in the hero, in the
 * CTA band above the footer, and on all nineteen pages that use them. Symmetric padding
 * cannot fix that; only a shared track width can, because the labels differ.
 *
 * `min-w` rather than `w`, so a future longer label grows the button instead of
 * overflowing it — and both buttons in a pair still match, because they share the floor
 * and neither label is near it. Full width below `sm`, where the pair stacks and the
 * question does not arise.
 */
const CTA_WIDTH = 'w-full sm:w-auto sm:min-w-[11.5rem]';

/** The height and shape, shared for the same reason. */
const CTA_SHAPE = `${CTA_WIDTH} h-12 px-7 rounded-full text-base font-semibold`;

/** Solid violet. Exported so the header and one-off CTAs match without restating it. */
export const CTA_PRIMARY = `${CTA_SHAPE} bg-violet-600 hover:bg-violet-700 shadow-lg shadow-violet-300/60`;

/** Outlined. `border-2` is inside the same box, so the two buttons align to the pixel. */
export const CTA_SECONDARY = `${CTA_SHAPE} border-2 border-violet-600 text-violet-600 hover:bg-violet-50 bg-transparent`;

/** Get Started + Book a Demo, the pair that appears in every hero and every CTA band. */
export function CtaPair({ align = 'center' }: { align?: 'center' | 'left' }) {
  const justify = align === 'center' ? 'justify-center' : 'justify-start';
  return (
    <div className={`flex flex-col sm:flex-row gap-3 sm:gap-4 ${justify} items-stretch sm:items-center`}>
      <Link to={SIGNUP_LINK} className="w-full sm:w-auto">
        <motion.div whileHover={{ scale: 1.04, y: -2 }} whileTap={{ scale: 0.97 }} transition={SPRING}>
          <Button className={CTA_PRIMARY}>{CTA_LABEL}</Button>
        </motion.div>
      </Link>
      {/*
        `/contact` with the interest preselected rather than a bare `/contact`. The
        internal-linking plan says "Book a Demo → /contact", and this is that URL — the
        query string only means the enquiry arrives already labelled as a demo request
        instead of the operator having to guess.
      */}
      <Link to={DEMO_REQUEST_LINK} className="w-full sm:w-auto">
        <motion.div whileHover={{ scale: 1.04, y: -2 }} whileTap={{ scale: 0.97 }} transition={SPRING}>
          <Button variant="outline" className={CTA_SECONDARY}>Book a Demo</Button>
        </motion.div>
      </Link>
    </div>
  );
}

/** The hero shared by every page except the home page. */
export function PageHero({
  title, intro, crumbs, children,
}: {
  title: string[];
  intro: readonly string[];
  /** Rendered above the h1 on pages that sit under a hub. */
  crumbs?: readonly { name: string; path: string }[];
  children?: ReactNode;
}) {
  return (
    <section className="relative overflow-hidden isolate bg-gradient-to-b from-violet-50/70 via-white to-white">
      {/* A soft violet bloom behind the headline. Purely decorative, hidden from AT. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-32 left-1/2 h-80 w-[42rem] -translate-x-1/2 rounded-full bg-violet-200/40 blur-3xl"
      />
      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-12 sm:pt-16 pb-14 sm:pb-20">
        <div className="max-w-4xl mx-auto text-center">
          {crumbs && <Breadcrumbs crumbs={crumbs} />}
          <AnimatedHeading
            as="h1"
            trigger="mount"
            lines={title}
            className="text-[32px] leading-[1.15] sm:text-5xl lg:text-[56px] lg:leading-[1.1] font-extrabold tracking-tight text-slate-900"
          />
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.65, delay: 0.25, ease: EASE_OUT }}
            className="mt-6 space-y-4 text-base sm:text-lg text-slate-700 leading-relaxed"
          >
            {intro.map((para) => <p key={para}>{para}</p>)}
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.65, delay: 0.4, ease: EASE_OUT }}
            className="mt-8"
          >
            <CtaPair />
          </motion.div>

          {children}
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/*                                    FAQ                                      */
/* -------------------------------------------------------------------------- */

/**
 * The accordion, and the `FAQPage` structured data for the same questions.
 *
 * One array in, both out — see the header of this file for why they are not allowed
 * to be two arrays.
 */
export function FaqSection({
  faqs, id = 'faq', title = ['Frequently Asked Questions'], lead,
}: {
  faqs: readonly FaqEntry[];
  id?: string;
  title?: string[];
  lead?: ReactNode;
}) {
  useFaqSchema(faqs);
  const [openIdx, setOpenIdx] = useState<number | null>(0);

  return (
    <Section id={id} tone="tinted">
      <SectionHead title={title} lead={lead} />

      <motion.div
        className="mt-10 max-w-3xl mx-auto space-y-3 sm:space-y-4"
        initial="hidden"
        whileInView="show"
        viewport={viewport}
        variants={stagger(0, 0.06)}
      >
        {faqs.map((faq, i) => {
          const isOpen = openIdx === i;
          return (
            <motion.div
              key={faq.question}
              variants={item}
              whileHover={{ y: -2 }}
              transition={CARD_SPRING}
              className="rounded-2xl bg-white ring-1 ring-slate-200/80 overflow-hidden"
            >
              <button
                type="button"
                onClick={() => setOpenIdx(isOpen ? null : i)}
                aria-expanded={isOpen}
                className="w-full flex items-center gap-4 p-4 sm:p-5 text-left"
              >
                <motion.span
                  animate={{ rotate: isOpen ? 45 : 0 }}
                  transition={SPRING}
                  className="grid place-items-center h-8 w-8 rounded-md shrink-0 bg-violet-600"
                >
                  <Plus className="h-4 w-4 text-white" strokeWidth={3} />
                </motion.span>
                <span className="font-semibold text-slate-900 text-sm sm:text-base">{faq.question}</span>
              </button>
              <AnimatePresence initial={false}>
                {isOpen && (
                  <motion.div
                    key="content"
                    initial="collapsed"
                    animate="open"
                    exit="collapsed"
                    variants={{
                      open: { height: 'auto', opacity: 1 },
                      collapsed: { height: 0, opacity: 0 },
                    }}
                    transition={{ duration: 0.28, ease: EASE_OUT }}
                    className="overflow-hidden"
                  >
                    <div className="px-5 sm:px-6 pb-5 sm:pb-6 pl-[60px] sm:pl-[68px] text-sm text-slate-700 leading-relaxed -mt-1">
                      {faq.answer}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          );
        })}
      </motion.div>
    </Section>
  );
}

/* -------------------------------------------------------------------------- */
/*                             Closing call to action                          */
/* -------------------------------------------------------------------------- */

export function CtaBand({
  title, body,
}: {
  title: string[];
  body: readonly string[];
}) {
  return (
    <section className="py-12 sm:py-16 bg-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, scale: 0.94, y: 30 }}
          whileInView={{ opacity: 1, scale: 1, y: 0 }}
          viewport={viewport}
          transition={{ duration: 0.7, ease: EASE_OUT }}
          className="relative overflow-hidden rounded-3xl px-6 sm:px-10 lg:px-16 py-12 sm:py-16 ring-1 ring-slate-200 bg-no-repeat bg-cover bg-center"
          style={{ backgroundImage: "url('/contact-cta-background.png')" }}
        >
          <div className="relative text-center max-w-2xl mx-auto">
            <AnimatedHeading
              lines={title}
              className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight text-slate-900"
            />
            <motion.div
              initial={{ opacity: 0, y: 18 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={viewport}
              transition={{ duration: 0.6, ease: EASE_OUT }}
              className="mt-4 space-y-2 text-sm sm:text-base text-slate-700"
            >
              {body.map((line) => <p key={line}>{line}</p>)}
            </motion.div>
            <div className="mt-8">
              <CtaPair />
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
