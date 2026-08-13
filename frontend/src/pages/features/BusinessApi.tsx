import type { ComponentType, ReactNode } from 'react';
import { motion } from 'framer-motion';
import {
  ArrowDown, Bell, Bot, Boxes, Building2, CalendarClock, Check, ChevronRight, Gauge,
  Headphones, Megaphone, MessagesSquare, Plug, ShoppingCart, Target, Users,
  Workflow,
} from 'lucide-react';
import { useDocumentHead } from '@/lib/document-head';
import { PAGE_HEADS } from '@/lib/page-heads';
import { useBreadcrumbSchema } from '@/lib/json-ld';
import type { FaqEntry } from '@/lib/json-ld';
import SiteHeader from '@/components/marketing/SiteHeader';
import SiteFooter from '@/components/marketing/SiteFooter';
import {
  ArrowLink, CARD_SPRING, CheckCards, CtaBand, EASE_OUT, FaqSection,
  PageHero, ScrollProgress, Section, SectionHead, item, stagger, viewport,
} from '@/components/marketing/primitives';
import { IconTitle, Reveal } from '@/components/marketing/motion-kit';

/*
 * /features/whatsapp-business-api
 *
 * **The design idea is infrastructure.** This page is not about a feature a person uses;
 * it is about a connection between systems, and it is laid out that way — layered slabs
 * instead of card grids, two dark technical panels where the copy describes an event
 * travelling between systems, a split-screen comparison instead of a table, and the
 * capability set drawn as modules plugged into a rail.
 *
 * That makes it structurally unlike every sibling, which is the point:
 *   • `/features/whatsapp-automation`      — numbered rails and scenario cards
 *   • `/features/ai-whatsapp-automation`   — quoted customer utterances, comparison table
 *   • `/features/whatsapp-number-masking`  — paired contact-path diagrams
 *   • `/features/whatsapp-campaigns`       — a horizontal pipeline and message mockups
 *   • this page                            — layered slabs and dark system flows
 *
 * Nothing below is shared with any of them except the page shell, the FAQ block and the
 * CTA band. The two dark bands are the only dark sections anywhere on the site, and they
 * are here on purpose: this is the one page whose audience is evaluating a technical
 * decision, so the page is allowed to look like a diagram.
 *
 * The hedging in the copy is deliberate and load-bearing. Pricing, template requirements
 * and multi-user behaviour all depend on the WhatsApp Business pricing model and on how a
 * given workspace is set up, so every claim here is scoped to "eligible", "suitable" or
 * "where supported". The messaging-requirements section is not filler — an API page that
 * implies unrestricted outbound messaging is describing something the platform will not
 * deliver.
 */

/* -------------------------------------------------------------------------- */
/*                          Page-local design devices                          */
/* -------------------------------------------------------------------------- */

/**
 * The requirement ledger: what a small business can do by hand on the left, what a
 * growing one needs on the right.
 *
 * The copy is literally a contrast — one sentence against a list of ten — so it is set
 * as one, rather than as a lead paragraph followed by ticks. The left panel is muted and
 * the right is the one that carries weight, which is the argument the section is making.
 */
function Ledger({ manual, needs }: { manual: string; needs: readonly string[] }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 lg:gap-6">
      <motion.div
        initial={{ opacity: 0, x: -20 }}
        whileInView={{ opacity: 1, x: 0 }}
        viewport={viewport}
        transition={{ duration: 0.6, ease: EASE_OUT }}
        className="lg:col-span-2 rounded-3xl bg-slate-50 ring-1 ring-slate-200 p-6 sm:p-8"
      >
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">
          One person, one phone
        </p>
        <p className="mt-4 text-lg font-semibold text-slate-800 leading-relaxed">{manual}</p>
        <p className="mt-4 text-[15px] text-slate-600 leading-relaxed">
          Nothing here needs replacing while that stays true.
        </p>
      </motion.div>

      <motion.div
        initial="hidden"
        whileInView="show"
        viewport={viewport}
        variants={stagger(0.1, 0.05)}
        className="lg:col-span-3 rounded-3xl bg-white ring-1 ring-violet-200 p-6 sm:p-8 shadow-lg shadow-violet-100"
      >
        <motion.p
          variants={item}
          className="text-xs font-semibold uppercase tracking-widest text-violet-600"
        >
          A growing organization may need
        </motion.p>
        <ul className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
          {needs.map((need, i) => (
            <motion.li key={need} variants={item} className="flex items-baseline gap-3">
              <span className="shrink-0 text-[11px] font-semibold tabular-nums text-violet-400">
                {String(i + 1).padStart(2, '0')}
              </span>
              <span className="text-[15px] font-medium text-slate-800 leading-relaxed">{need}</span>
            </motion.li>
          ))}
        </ul>
      </motion.div>
    </div>
  );
}

/**
 * A one-line chain, set inline in the prose where the copy gives a short sequence.
 *
 * Kept deliberately small and monospaced: it is a sentence about systems, not a section
 * of its own, and promoting it to a full diagram would give it more weight than the copy
 * gives it.
 */
function InlineChain({ steps }: { steps: readonly string[] }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={viewport}
      transition={{ duration: 0.55, ease: EASE_OUT }}
      className="flex flex-wrap items-center gap-x-2 gap-y-2 rounded-2xl bg-slate-900 px-5 py-4"
    >
      {steps.map((step, i) => (
        <span key={step} className="flex items-center gap-2">
          <span className="font-mono text-[13px] font-medium text-violet-200">{step}</span>
          {i < steps.length - 1 && (
            <ChevronRight aria-hidden className="h-3.5 w-3.5 text-slate-500" strokeWidth={3} />
          )}
        </span>
      ))}
    </motion.div>
  );
}

/**
 * The system flow: a dark, monospaced panel where an event moves between systems.
 *
 * Dark because it is the only way to make this read as a different *kind* of object from
 * the content around it — every other diagram on the site is a light card. The copy sets
 * these out as lines separated by a down arrow, so the arrow is real rather than
 * decorative, and each stage carries its ordinal so the sequence survives being read out
 * of order on a narrow screen.
 */
function SystemFlow({ steps, caption }: { steps: readonly string[]; caption?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={viewport}
      transition={{ duration: 0.65, ease: EASE_OUT }}
      className="relative overflow-hidden rounded-3xl bg-slate-900 p-6 sm:p-8"
    >
      {/* A violet bloom in the corner, so the panel is not a flat black rectangle. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-16 -right-10 h-48 w-48 rounded-full bg-violet-600/25 blur-3xl"
      />
      <motion.ol
        initial="hidden"
        whileInView="show"
        viewport={viewport}
        variants={stagger(0.05, 0.09)}
        className="relative space-y-1"
      >
        {steps.map((step, i) => (
          <motion.li key={step} variants={item}>
            <div className="flex items-center gap-4 rounded-xl bg-white/5 ring-1 ring-white/10 px-4 py-3">
              <span className="font-mono text-[11px] font-semibold tabular-nums text-violet-300">
                {String(i + 1).padStart(2, '0')}
              </span>
              <span className="text-[15px] font-medium text-slate-100 leading-snug">{step}</span>
            </div>
            {i < steps.length - 1 && (
              <div className="flex justify-start pl-[26px] py-1">
                <ArrowDown aria-hidden className="h-3.5 w-3.5 text-slate-500" strokeWidth={3} />
              </div>
            )}
          </motion.li>
        ))}
      </motion.ol>
      {caption && (
        <p className="relative mt-5 text-[13px] text-slate-400 leading-relaxed">{caption}</p>
      )}
    </motion.div>
  );
}

interface Row { left: string; right: string }

/**
 * The App-versus-API comparison, as two facing columns rather than a table.
 *
 * A table would have been the obvious choice and is what the AI page already uses; doing
 * it again here would make two pages look alike. Facing panels also carry the actual
 * point better: these are not scored rows where one side wins, they are two products for
 * two situations, so both columns get a header of equal size and neither gets a tick.
 */
function SplitCompare({
  left, right, rows,
}: {
  left: { title: string; note: string };
  right: { title: string; note: string };
  rows: readonly Row[];
}) {
  return (
    <motion.div
      initial="hidden"
      whileInView="show"
      viewport={viewport}
      variants={stagger(0, 0.07)}
      className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6"
    >
      <motion.div variants={item} className="rounded-3xl bg-slate-50 ring-1 ring-slate-200 overflow-hidden">
        <div className="px-6 py-5 bg-white border-b border-slate-200">
          <p className="text-base font-bold text-slate-900">{left.title}</p>
          <p className="mt-1 text-[13px] text-slate-600">{left.note}</p>
        </div>
        <ul className="divide-y divide-slate-200">
          {rows.map((row) => (
            <li key={row.left} className="px-6 py-4 text-[15px] text-slate-700 leading-relaxed">
              {row.left}
            </li>
          ))}
        </ul>
      </motion.div>

      <motion.div
        variants={item}
        className="rounded-3xl bg-violet-50/60 ring-1 ring-violet-200 overflow-hidden"
      >
        <div className="px-6 py-5 bg-white border-b border-violet-200">
          <p className="text-base font-bold text-violet-700">{right.title}</p>
          <p className="mt-1 text-[13px] text-slate-600">{right.note}</p>
        </div>
        <ul className="divide-y divide-violet-200/70">
          {rows.map((row) => (
            <li
              key={row.right}
              className="px-6 py-4 text-[15px] font-medium text-slate-800 leading-relaxed"
            >
              {row.right}
            </li>
          ))}
        </ul>
      </motion.div>
    </motion.div>
  );
}

interface Build {
  icon: ComponentType<{ className?: string }>;
  title: string;
  body: string;
  examplesLabel?: string;
  examples?: readonly string[];
}

/**
 * What can be built on the connection: a ladder rather than a grid.
 *
 * One of the five entries carries a sub-list of examples and the others do not, which a
 * card grid handles badly — either every card grows to match the tallest or one card
 * looks broken. A ladder lets each rung be exactly as long as its copy.
 */
function BuildLadder({ builds }: { builds: readonly Build[] }) {
  return (
    <motion.ol
      initial="hidden"
      whileInView="show"
      viewport={viewport}
      variants={stagger(0, 0.08)}
      className="space-y-3 sm:space-y-4"
    >
      {builds.map((build) => (
        <motion.li
          key={build.title}
          variants={item}
          whileHover={{ x: 4 }}
          transition={CARD_SPRING}
          className="group rounded-3xl bg-white ring-1 ring-slate-200/80 p-5 sm:p-6"
        >
          <div className="flex items-start gap-4">
            <span className="mt-0.5 grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-violet-50 text-violet-600 ring-1 ring-violet-200/70 transition-colors group-hover:bg-violet-600 group-hover:text-white">
              <build.icon className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="text-lg font-bold text-slate-900">{build.title}</p>
              <p className="mt-2 text-[15px] text-slate-700 leading-relaxed">{build.body}</p>
              {build.examples && (
                <>
                  <p className="mt-4 text-xs font-semibold uppercase tracking-widest text-slate-500">
                    {build.examplesLabel}
                  </p>
                  <ul className="mt-3 flex flex-wrap gap-2">
                    {build.examples.map((example) => (
                      <li
                        key={example}
                        className="rounded-full bg-slate-50 ring-1 ring-slate-200 px-3 py-1.5 text-[13px] font-medium text-slate-700"
                      >
                        {example}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          </div>
        </motion.li>
      ))}
    </motion.ol>
  );
}

interface Module {
  icon: ComponentType<{ className?: string }>;
  title: string;
  body: string;
  href: string;
  cta: string;
}

/**
 * The capability set as modules plugged into a rail.
 *
 * The copy's own framing is "the API is the foundation, these build on top of it", so the
 * rail is the foundation and each module attaches to it at a socket. It is the same
 * information a card grid would carry, arranged so the dependency is visible.
 */
function Backplane({ modules }: { modules: readonly Module[] }) {
  return (
    <div className="relative">
      {/* The rail. Hidden on mobile, where the cards stack and there is nothing to align to. */}
      <motion.span
        aria-hidden
        initial={{ scaleY: 0 }}
        whileInView={{ scaleY: 1 }}
        viewport={viewport}
        transition={{ duration: 0.7, ease: EASE_OUT }}
        className="hidden sm:block pointer-events-none absolute left-[23px] top-4 bottom-4 w-px origin-top bg-gradient-to-b from-violet-200 via-violet-400 to-violet-200"
      />
      <motion.ul
        initial="hidden"
        whileInView="show"
        viewport={viewport}
        variants={stagger(0.1, 0.08)}
        className="space-y-3 sm:space-y-4"
      >
        {modules.map((module) => (
          <motion.li key={module.title} variants={item} className="relative sm:pl-16">
            {/* The socket where this module meets the rail. */}
            <span
              aria-hidden
              className="hidden sm:grid absolute left-0 top-6 h-12 w-12 place-items-center rounded-2xl bg-white ring-1 ring-violet-200"
            >
              <span className="grid h-8 w-8 place-items-center rounded-xl bg-violet-600 text-white">
                <module.icon className="h-4 w-4" />
              </span>
            </span>
            <motion.div
              whileHover={{ y: -3 }}
              transition={CARD_SPRING}
              className="rounded-3xl bg-white ring-1 ring-slate-200/80 p-5 sm:p-6"
            >
              <div className="flex items-start gap-3 sm:gap-0">
                <span className="sm:hidden grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-violet-600 text-white">
                  <module.icon className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <p className="text-lg font-bold text-slate-900">{module.title}</p>
                  <p className="mt-2 text-[15px] text-slate-700 leading-relaxed">{module.body}</p>
                  <div className="mt-4">
                    <ArrowLink to={module.href}>{module.cta}</ArrowLink>
                  </div>
                </div>
              </div>
            </motion.div>
          </motion.li>
        ))}
      </motion.ul>
    </div>
  );
}

interface Layer {
  label: string;
  body: string;
  icon: ComponentType<{ className?: string }>;
}

/**
 * The four layers, as four cards of equal weight.
 *
 * **What this replaced, and why.** They were stacked slabs, each inset a little further than the
 * one beneath. The idea was to show that the layers sit on each other — but the inset made every
 * card a different width, so "API" was wide and "Team" was narrow, and one row of copy read as
 * more important than another purely because of how much space it got. On a narrow screen the
 * insets collapsed and the whole idea vanished anyway.
 *
 * These are four peers: a business picks how far up the stack it goes, and no layer outranks
 * another. So they are a grid — same width, same height (`h-full` inside a stretch row), same
 * padding — with the *order* carried by a numeral and a rail rather than by size. Nothing here
 * changes width to make a point.
 */
function LayerGrid({ layers }: { layers: readonly Layer[] }) {
  return (
    <motion.ol
      initial="hidden"
      whileInView="show"
      viewport={viewport}
      variants={stagger(0.05, 0.08)}
      className="mx-auto grid max-w-5xl grid-cols-1 items-stretch gap-3 sm:grid-cols-2 lg:grid-cols-4 sm:gap-4"
    >
      {layers.map((layer, i) => (
        <motion.li
          key={layer.label}
          variants={item}
          whileHover={{ y: -5, boxShadow: '0 22px 48px -20px rgb(96 73 231 / 0.28)' }}
          transition={CARD_SPRING}
          className="group relative flex h-full flex-col overflow-hidden rounded-3xl bg-white p-5 sm:p-6 ring-1 ring-slate-200/80"
        >
          {/* The order cue: a rail that fills on hover, and an ordinal. No size difference. */}
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-1 origin-left scale-x-0 bg-gradient-to-r from-violet-400 to-violet-600 transition-transform duration-300 group-hover:scale-x-100"
          />
          <div className="flex items-center justify-between gap-3">
            <span
              aria-hidden
              className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-violet-50 text-violet-600 ring-1 ring-violet-200/70 transition-colors duration-200 group-hover:bg-violet-600 group-hover:text-white"
            >
              <layer.icon className="h-5 w-5" />
            </span>
            <span className="text-[11px] font-bold uppercase tracking-widest text-slate-300 tabular-nums">
              Layer {String(i + 1).padStart(2, '0')}
            </span>
          </div>
          <p className="mt-4 text-sm font-bold uppercase tracking-widest text-violet-700">
            {layer.label}
          </p>
          <p className="mt-2 text-[15px] text-slate-700 leading-relaxed">{layer.body}</p>
        </motion.li>
      ))}
    </motion.ol>
  );
}

/**
 * How four kinds of business shape the same connection differently.
 *
 * **What it replaced.** Four sentences in four grey boxes. Correct, and completely flat — the
 * section is called "build customer communication *around your business*", and four identical
 * boxes say the opposite: that everyone gets the same thing.
 *
 * Each card now shows the actual shape — which system the event starts in, and what WhatsApp is
 * being used for — with the business's own sentence kept verbatim underneath. The little chain in
 * each card is the page's architecture language (system → channel → purpose) applied per case.
 */
function BusinessShapes() {
  const SHAPES = [
    {
      icon: Target,
      kind: 'A sales-driven company',
      chain: ['CRM', 'WhatsApp', 'Prospect conversation'],
      line: 'A sales-driven company may need WhatsApp for prospect conversations.',
    },
    {
      icon: CalendarClock,
      kind: 'A service business',
      chain: ['Scheduling', 'WhatsApp', 'Appointments and updates'],
      line: 'A service business may need it for appointments and updates.',
    },
    {
      icon: ShoppingCart,
      kind: 'An ecommerce business',
      chain: ['Orders', 'WhatsApp', 'Notifications and support'],
      line: 'An ecommerce business may need customer notifications and support.',
    },
    {
      icon: Headphones,
      kind: 'A support organization',
      chain: ['Helpdesk', 'WhatsApp', 'Another service channel'],
      line: 'A support organization may need WhatsApp as another service channel.',
    },
  ];

  return (
    <motion.ul
      initial="hidden"
      whileInView="show"
      viewport={viewport}
      variants={stagger(0, 0.07)}
      className="mx-auto grid max-w-5xl grid-cols-1 items-stretch gap-4 sm:grid-cols-2"
    >
      {SHAPES.map((shape) => (
        <motion.li
          key={shape.kind}
          variants={item}
          whileHover={{ y: -4 }}
          transition={CARD_SPRING}
          className="group flex h-full flex-col rounded-3xl bg-white p-5 sm:p-6 ring-1 ring-slate-200/80 transition-colors duration-200 hover:ring-violet-200"
        >
          <IconTitle icon={shape.icon} as="p" className="text-base font-bold text-slate-900">
            {shape.kind}
          </IconTitle>

          {/* The shape of the connection, in the page's own monospaced architecture language. */}
          <div className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-2xl bg-slate-900 px-4 py-3">
            {shape.chain.map((node, i) => (
              <span key={node} className="flex items-center gap-2">
                <span className="font-mono text-[12px] font-medium text-violet-200">{node}</span>
                {i < shape.chain.length - 1 && (
                  <ChevronRight aria-hidden className="h-3 w-3 text-slate-500" strokeWidth={3} />
                )}
              </span>
            ))}
          </div>

          <p className="mt-4 text-[15px] text-slate-700 leading-relaxed">{shape.line}</p>
        </motion.li>
      ))}
    </motion.ul>
  );
}

/**
 * The "do I need this yet?" checklist.
 *
 * These are not features and they are not benefits — they are conditions a business either
 * recognises in itself or does not, so the mark is a checkbox rather than a tick: a tick asserts
 * "you have this", a checkbox asks. Hovering a row lights its box and its rule, which is enough
 * to make the list feel like something you are reading *against your own situation* rather than a
 * paragraph broken into pieces.
 *
 * The count at the bottom is the honest version of a score: it states the rule of thumb without
 * pretending to evaluate a business it knows nothing about.
 */
function TriggerChecklist({ items }: { items: readonly string[] }) {
  return (
    <div className="mx-auto max-w-3xl">
      <motion.ul
        initial="hidden"
        whileInView="show"
        viewport={viewport}
        variants={stagger(0, 0.06)}
        className="divide-y divide-slate-200 overflow-hidden rounded-3xl bg-white ring-1 ring-slate-200/80"
      >
        {items.map((text, i) => (
          <motion.li
            key={text}
            variants={item}
            className="group flex items-start gap-4 px-5 py-4 transition-colors duration-200 hover:bg-violet-50/50 sm:px-6"
          >
            <span
              aria-hidden
              className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md bg-white text-transparent ring-1 ring-slate-300 transition-all duration-200 group-hover:bg-violet-600 group-hover:text-white group-hover:ring-violet-600"
            >
              <Check className="h-3 w-3" strokeWidth={3} />
            </span>
            <span className="text-[15px] font-medium text-slate-800 leading-relaxed">{text}</span>
            <span
              aria-hidden
              className="ml-auto hidden shrink-0 text-[11px] font-bold tabular-nums text-slate-300 transition-colors duration-200 group-hover:text-violet-500 sm:block"
            >
              {String(i + 1).padStart(2, '0')}
            </span>
          </motion.li>
        ))}
      </motion.ul>

      <Reveal delay={0.1} className="mt-5 flex items-start gap-3 rounded-2xl bg-violet-50/60 px-5 py-4 ring-1 ring-violet-200">
        <Gauge aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-violet-600" />
        <p className="text-[14px] text-slate-800 leading-relaxed">
          Recognising one of these is not a reason to change anything. Recognising several usually
          means the constraint is the setup rather than the team.
        </p>
      </Reveal>
    </div>
  );
}

/**
 * The six things ZunoPilot adds around the connection, as labelled ports.
 *
 * The copy gives each one a single verb and one line, which is a shape a normal feature
 * card handles badly — the title is one word and the body is short, so a card grid reads
 * as mostly empty space. Mono labels in a tight grid keep them looking like what they
 * are: named capabilities on one surface.
 */
function PortGrid({ ports }: { ports: readonly { label: string; body: string }[] }) {
  return (
    <motion.ul
      initial="hidden"
      whileInView="show"
      viewport={viewport}
      variants={stagger(0, 0.06)}
      className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4"
    >
      {ports.map((port, i) => (
        <motion.li
          key={port.label}
          variants={item}
          whileHover={{ y: -4, boxShadow: '0 14px 30px -12px rgb(96 73 231 / 0.25)' }}
          transition={CARD_SPRING}
          className="relative overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200/80 p-5"
        >
          <span
            aria-hidden
            className="absolute right-4 top-3 font-mono text-[11px] font-semibold tabular-nums text-slate-300"
          >
            {String(i + 1).padStart(2, '0')}
          </span>
          <p className="font-mono text-[13px] font-bold uppercase tracking-widest text-violet-700">
            {port.label}
          </p>
          <p className="mt-2 text-[15px] text-slate-700 leading-relaxed">{port.body}</p>
        </motion.li>
      ))}
    </motion.ul>
  );
}

/** A plain reasons block: heading, body, no icon, no box — a rhythm break between figures. */
function ReasonRows({ reasons }: { reasons: readonly { title: string; body: string }[] }) {
  return (
    <motion.ul
      initial="hidden"
      whileInView="show"
      viewport={viewport}
      variants={stagger(0, 0.07)}
      className="mx-auto max-w-4xl space-y-6 sm:space-y-7"
    >
      {reasons.map((reason, i) => (
        <motion.li
          key={reason.title}
          variants={item}
          className="flex items-start gap-4 sm:gap-6 border-l-2 border-violet-200 pl-5 sm:pl-6"
        >
          <span className="shrink-0 font-mono text-[13px] font-semibold tabular-nums text-violet-500 pt-1">
            {String(i + 1).padStart(2, '0')}
          </span>
          <div className="min-w-0">
            <p className="text-lg font-bold text-slate-900">{reason.title}</p>
            <p className="mt-2 text-[15px] text-slate-700 leading-relaxed">{reason.body}</p>
          </div>
        </motion.li>
      ))}
    </motion.ul>
  );
}

/** Who it fits: an icon, a name, a line. Kept flat so it does not compete with the stack. */
function FitGrid({
  fits,
}: {
  fits: readonly { icon: ComponentType<{ className?: string }>; title: string; body: string }[];
}) {
  return (
    <motion.ul
      initial="hidden"
      whileInView="show"
      viewport={viewport}
      variants={stagger(0, 0.06)}
      className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4"
    >
      {fits.map((fit) => (
        <motion.li
          key={fit.title}
          variants={item}
          whileHover={{ y: -4 }}
          transition={CARD_SPRING}
          className="rounded-2xl bg-white ring-1 ring-slate-200/80 p-5"
        >
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-violet-50 text-violet-600 ring-1 ring-violet-200/70">
            <fit.icon className="h-5 w-5" />
          </span>
          <p className="mt-4 text-base font-bold text-slate-900">{fit.title}</p>
          <p className="mt-2 text-[15px] text-slate-700 leading-relaxed">{fit.body}</p>
        </motion.li>
      ))}
    </motion.ul>
  );
}

/* -------------------------------------------------------------------------- */
/*                                    Copy                                     */
/* -------------------------------------------------------------------------- */

const CRUMBS = [
  { name: 'Home', path: '/' },
  { name: 'Features', path: '/features' },
  { name: 'WhatsApp Business API', path: '/features/whatsapp-business-api' },
];

const GROWTH_NEEDS = [
  'Multiple people handling customer conversations',
  'Structured business messaging',
  'Automated communication',
  'Customer notifications',
  'Lead management',
  'Campaign communication',
  'AI-assisted interactions',
  'Controlled access for team members',
  'Connections with business systems',
  'A more scalable communication process',
] as const;

const COMPARE_ROWS: readonly Row[] = [
  {
    left: 'Designed for business messaging through an app',
    right: 'Designed for software-driven business communication',
  },
  {
    left: 'Suited to simpler communication needs',
    right: 'Better suited to more structured and scalable use cases',
  },
  {
    left: 'Primarily app-based management',
    right: 'Can connect with software and business systems',
  },
  {
    left: 'Limited team/workflow requirements',
    right: 'Supports broader integration possibilities',
  },
  {
    left: 'Suitable for smaller communication operations',
    right: 'Suitable for businesses building more advanced communication processes',
  },
];

const BUILDS: readonly Build[] = [
  {
    icon: Bell,
    title: 'Customer Notifications',
    body: 'Send relevant business updates through WhatsApp where the use case and messaging requirements permit.',
    examplesLabel: 'Examples can include',
    examples: [
      'Order-related updates',
      'Appointment communication',
      'Service notifications',
      'Account-related messages',
      'Status updates',
    ],
  },
  {
    icon: Headphones,
    title: 'Customer Support',
    body: 'Connect WhatsApp communication with support processes so customers have a direct channel for assistance.',
  },
  {
    icon: Target,
    title: 'Lead Communication',
    body: 'Use WhatsApp as part of the journey from initial enquiry through qualification and sales follow-up.',
  },
  {
    icon: MessagesSquare,
    title: 'Business Messaging',
    body: 'Create structured communication processes around customer interactions rather than relying entirely on individual manual messages.',
  },
  {
    icon: Megaphone,
    title: 'Campaign Communication',
    body: 'Support eligible customer outreach using appropriate WhatsApp messaging practices and approved message formats where required.',
  },
];

const MODULES: readonly Module[] = [
  {
    icon: Workflow,
    title: 'WhatsApp Automation',
    body: 'Use structured workflows for recurring customer communication.',
    href: '/features/whatsapp-automation',
    cta: 'Explore WhatsApp Automation',
  },
  {
    icon: Bot,
    title: 'AI WhatsApp Automation',
    body: 'Bring AI assistance into suitable customer interactions.',
    href: '/features/ai-whatsapp-automation',
    cta: 'Explore AI WhatsApp Automation',
  },
  {
    icon: Users,
    title: 'WhatsApp Team Inbox',
    body: 'Allow authorized team members to work with customer conversations through a shared environment.',
    href: '/features/whatsapp-team-inbox',
    cta: 'Explore WhatsApp Team Inbox',
  },
  {
    icon: Plug,
    title: 'WhatsApp Number Masking',
    body: 'Support a more controlled approach to customer-facing communication where the configured setup provides this capability.',
    href: '/features/whatsapp-number-masking',
    cta: 'Explore WhatsApp Number Masking',
  },
  {
    icon: Megaphone,
    title: 'WhatsApp Campaigns',
    body: 'Organize appropriate customer outreach through WhatsApp.',
    href: '/features/whatsapp-campaigns',
    cta: 'Explore WhatsApp Campaigns',
  },
];

const REASONS = [
  {
    title: 'Connect Software With Customer Messaging',
    body: 'Instead of keeping WhatsApp communication separate from business systems, API-based messaging can become part of a larger application or workflow.',
  },
  {
    title: 'Support Growing Communication Requirements',
    body: 'As customer communication becomes more complex, businesses may need more than a single-user messaging application.',
  },
  {
    title: 'Create Structured Communication Processes',
    body: 'API-based communication can support business-defined processes for notifications, support, sales, and customer engagement.',
  },
  {
    title: 'Reduce Manual Dependencies',
    body: 'Software-driven messaging can reduce the need for employees to manually initiate every suitable business communication.',
  },
  {
    title: 'Build Around Existing Business Processes',
    body: 'WhatsApp can become another communication layer within the systems and workflows your business already operates.',
  },
] as const;

const FITS = [
  {
    icon: ShoppingCart,
    title: 'Ecommerce',
    body: 'Use WhatsApp as part of customer communication around orders, support, updates, and engagement.',
  },
  {
    icon: Target,
    title: 'Sales Organizations',
    body: 'Connect WhatsApp with lead communication, qualification, and sales processes.',
  },
  {
    icon: Headphones,
    title: 'Customer Service Teams',
    body: 'Provide WhatsApp as a customer communication channel while connecting conversations with support operations.',
  },
  {
    icon: Building2,
    title: 'Service Businesses',
    body: 'Use WhatsApp for customer communication related to appointments, services, updates, and follow-ups.',
  },
  {
    icon: Boxes,
    title: 'Growing Companies',
    body: 'Build a more structured WhatsApp communication environment as customer and team requirements increase.',
  },
  /*
   * **The added need.** Education and enrolment-driven organisations are among the heaviest
   * WhatsApp users in this market, and their communication is exactly the API case: high enquiry
   * volume, several staff answering, and reminders that come from a system rather than a person.
   */
  {
    icon: CalendarClock,
    title: 'Appointment & Enrolment Driven Organizations',
    body: 'Connect WhatsApp with the systems that already hold bookings, schedules and enrolment steps, so reminders and confirmations come from the process rather than from someone remembering.',
  },
] as const;

const TRIGGERS = [
  'Multiple users need to participate in customer communication.',
  'WhatsApp needs to connect with software or business workflows.',
  'You need structured customer notifications.',
  'You want to automate suitable business messages.',
  'Customer communication volumes are increasing.',
  'WhatsApp needs to become part of your sales or support process.',
  'Your business requires more control over how WhatsApp communication is managed.',
] as const;

const LAYERS: readonly Layer[] = [
  { label: 'API', body: 'Provides the connection to WhatsApp.', icon: Plug },
  { label: 'Automation', body: 'Handles suitable predefined processes.', icon: Workflow },
  { label: 'AI', body: 'Assists with suitable natural-language interactions.', icon: Bot },
  { label: 'Team', body: 'Takes over when human expertise is required.', icon: Users },
];

const REQUIREMENTS = [
  'Customer consent',
  'Approved message templates where required',
  'Messaging categories',
  'Business profile requirements',
  'Quality and messaging practices',
  'Customer communication preferences',
  'Applicable WhatsApp Business policies',
  /*
   * **Two added considerations.** Both are things businesses hit in practice and neither was in
   * the list: a sender identity has to be verified before it can be used, and messaging quality
   * is rated continuously rather than approved once. Naming them is more useful than another
   * restatement of "follow the policies".
   */
  'Verification of your business and sender identity where required',
  'Ongoing messaging quality and the rate limits that depend on it',
] as const;

const PORTS = [
  { label: 'Connect', body: 'Use WhatsApp as a business communication channel.' },
  { label: 'Organize', body: 'Manage conversations through team-oriented capabilities.' },
  { label: 'Automate', body: 'Create workflows for suitable recurring communication.' },
  { label: 'Assist', body: 'Use AI for appropriate customer interactions.' },
  { label: 'Engage', body: 'Run relevant customer campaigns.' },
  { label: 'Control', body: 'Manage business-facing communication through configured capabilities.' },
] as const;

/*
 * Nine, not seven. **The last two are added** and both are things a business recognises before it
 * recognises any of the others: wanting the conversations to belong to the company rather than to
 * whoever answered, and wanting WhatsApp to stop being the one channel nothing else can see.
 */
const LOOKING_TO = [
  'Connect WhatsApp with business processes',
  'Support multiple customer-facing users',
  'Automate suitable communication',
  'Add AI-assisted interactions',
  'Manage customer conversations',
  'Send relevant business notifications',
  'Build structured WhatsApp workflows',
  'Keep customer conversations with the business rather than on individual phones',
  'Bring WhatsApp into the same reporting and oversight as your other channels',
] as const;

/**
 * The eleven questions, in the wording supplied for the structured data.
 *
 * One array, rendered visibly and emitted as `FAQPage` markup by `FaqSection` — they are
 * not allowed to be two arrays, because two arrays drift and Google notices.
 */
const FAQS: readonly FaqEntry[] = [
  {
    question: 'What is WhatsApp Business API?',
    answer:
      'WhatsApp Business API is a business communication interface that allows software and '
      + 'business systems to connect with WhatsApp for customer messaging and other eligible '
      + 'business communication use cases.',
  },
  {
    question: 'What is the difference between WhatsApp Business API and WhatsApp Business App?',
    answer:
      'The WhatsApp Business App is designed primarily for app-based business communication, '
      + 'while the WhatsApp Business API is intended for businesses that need to connect WhatsApp '
      + 'with software, workflows, and more structured communication processes.',
  },
  {
    question: 'What can businesses use WhatsApp Business API for?',
    answer:
      'Businesses can use WhatsApp Business API for eligible customer notifications, support '
      + 'communication, lead interactions, business messaging, and other customer communication '
      + 'workflows.',
  },
  {
    question: 'Can WhatsApp Business API be used for automation?',
    answer:
      'Yes. WhatsApp Business API can be connected with business workflows and automation systems '
      + 'to support suitable automated communication processes.',
  },
  {
    question: 'Can AI work with WhatsApp Business API?',
    answer:
      'Yes. AI can be incorporated into suitable WhatsApp customer communication workflows to '
      + 'assist with interactions such as customer questions, lead conversations, and other '
      + 'configured use cases.',
  },
  {
    question: 'Can multiple employees use WhatsApp Business API?',
    answer:
      'API-based WhatsApp communication can support multi-user business operations when combined '
      + 'with suitable software and team-management capabilities. The exact experience depends on '
      + 'the platform and configuration.',
  },
  {
    question: 'Does WhatsApp Business API require a separate application?',
    answer:
      'WhatsApp Business API is designed for software-based integration rather than functioning '
      + 'like the standard WhatsApp mobile application. Businesses typically use a software '
      + 'platform or solution to manage API-based communication.',
  },
  {
    question: 'Is WhatsApp Business API free?',
    answer:
      'WhatsApp Business API costs depend on the applicable WhatsApp Business pricing model, '
      + 'messaging category, platform or provider setup, and other factors. Businesses should '
      + 'check the current pricing that applies to their specific use case.',
  },
  {
    question: 'Do WhatsApp API messages require templates?',
    answer:
      'Certain business-initiated WhatsApp messages may require approved message templates '
      + 'depending on the messaging context and applicable WhatsApp Business requirements.',
  },
  {
    question: 'Is WhatsApp Business API suitable for small businesses?',
    answer:
      'It can be suitable for small businesses that need software integration, structured '
      + 'communication, automation, or multi-user WhatsApp operations. Businesses with simpler '
      + 'requirements may find the WhatsApp Business App sufficient.',
  },
  {
    question: 'How can ZunoPilot help with WhatsApp Business API?',
    answer:
      'ZunoPilot provides a business-focused environment that can combine WhatsApp communication '
      + 'with capabilities such as automation, AI-assisted interactions, team conversation '
      + 'management, campaigns, and customer communication workflows.',
  },
];

/* -------------------------------------------------------------------------- */
/*                                   Page                                      */
/* -------------------------------------------------------------------------- */

/** A short lead paragraph, in the page's body colour. Saves repeating the classes. */
const Lead = ({ children }: { children: ReactNode }) => (
  <p className="text-[15px] sm:text-base text-slate-700 leading-relaxed">{children}</p>
);

export default function BusinessApi() {
  useDocumentHead(PAGE_HEADS.businessApi);
  useBreadcrumbSchema(CRUMBS);

  return (
    <div className="min-h-screen bg-white">
      <ScrollProgress />
      <SiteHeader />

      <PageHero
        crumbs={CRUMBS}
        title={['WhatsApp Business API for', 'Scalable Customer Communication']}
        intro={[
          'Connect your business to WhatsApp and build a more structured way to communicate with customers at scale.',
          'ZunoPilot helps businesses use WhatsApp as part of their customer communication infrastructure, bringing together business messaging, automation, AI-assisted interactions, campaigns, and team-based conversation management.',
          "Whether you're building customer support workflows, communicating with leads, sending business notifications, or connecting WhatsApp with your internal processes, ZunoPilot gives your team a business-focused environment for managing WhatsApp communication.",
        ]}
      />

      {/* ------------------------- Beyond a single app ------------------------ */}
      <Section tone="tinted">
        <SectionHead
          align="left"
          eyebrow="Where the app stops being enough"
          title={['Why Businesses Move Beyond', 'a Single WhatsApp App']}
          lead={(
            <p>
              WhatsApp is familiar to customers, but managing business communication becomes
              different as the organization grows.
            </p>
          )}
        />
        <div className="mt-10">
          <Ledger
            manual="A small business may be able to manage conversations manually."
            needs={GROWTH_NEEDS}
          />
        </div>
        <p className="mt-8 max-w-3xl text-base font-medium text-slate-800 leading-relaxed">
          This is where the WhatsApp Business Platform and API-based communication become
          relevant.
        </p>
      </Section>

      {/* --------------------------- What it is ------------------------------- */}
      <Section>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-14 items-center">
          <div>
            <SectionHead
              align="left"
              title={['What Is WhatsApp', 'Business API?']}
              lead={(
                <>
                  <p>
                    The WhatsApp Business API provides businesses with a way to connect their
                    software and business systems with WhatsApp for customer communication.
                  </p>
                  <p>
                    Unlike using WhatsApp only as an individual communication application, an
                    API-based approach allows WhatsApp messaging to become part of a broader
                    software workflow.
                  </p>
                </>
              )}
            />
            <p className="mt-6 text-base font-medium text-slate-800 leading-relaxed">
              This makes WhatsApp more than a messaging destination. It can become part of the way
              a business communicates with customers.
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">
              For example
            </p>
            <div className="mt-4">
              <InlineChain
                steps={[
                  'Business system',
                  'WhatsApp communication',
                  'Customer response',
                  'Business workflow',
                ]}
              />
            </div>
          </div>
        </div>
      </Section>

      {/* ------------------------- API vs App --------------------------------- */}
      <Section tone="tinted">
        <SectionHead
          eyebrow="Two products, two situations"
          title={['WhatsApp Business API', 'vs WhatsApp Business App']}
          lead={(
            <p>
              These two are often confused, but they serve different business requirements.
            </p>
          )}
        />
        <div className="mt-10">
          <SplitCompare
            left={{ title: 'WhatsApp Business App', note: 'App-based business messaging' }}
            right={{
              title: 'WhatsApp Business API / Platform',
              note: 'Software-driven business communication',
            }}
            rows={COMPARE_ROWS}
          />
        </div>
        <p className="mt-8 mx-auto max-w-3xl text-center text-base font-medium text-slate-800 leading-relaxed">
          The right option depends on your business size, communication volume, workflow
          requirements, team structure, and integration needs.
        </p>
      </Section>

      {/* -------------------------- What you can build ------------------------ */}
      <Section>
        <SectionHead
          title={['What Can Businesses Build', 'With WhatsApp Business API?']}
          lead={<p>The API can become a foundation for different types of business communication.</p>}
        />
        <div className="mt-10 mx-auto max-w-4xl">
          <BuildLadder builds={BUILDS} />
        </div>
      </Section>

      {/* -------------------------- Part of the stack ------------------------- */}
      <Section tone="tinted">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-14 items-start">
          <div>
            <SectionHead
              align="left"
              eyebrow="One event, several systems"
              title={['Turn WhatsApp Into Part', 'of Your Business Stack']}
              lead={(
                <>
                  <p>
                    The value of an API becomes clearer when WhatsApp connects with the systems
                    your business already uses.
                  </p>
                  <p>A customer might submit information through one business process.</p>
                  <p>That event can then become part of a WhatsApp communication flow.</p>
                </>
              )}
            />
            <p className="mt-6 text-base font-medium text-slate-800 leading-relaxed">
              This approach can help businesses make WhatsApp part of a broader customer journey
              rather than keeping it isolated from their other processes.
            </p>
          </div>
          <SystemFlow
            caption="For example — one customer action, carried through the systems already running behind it."
            steps={[
              'Customer action',
              'Business system',
              'WhatsApp message',
              'Customer response',
              'Sales, support, or operational process',
            ]}
          />
        </div>
      </Section>

      {/* -------------------- Built around your business ---------------------- */}
      <Section>
        <SectionHead
          title={['Build Customer Communication', 'Around Your Business']}
          lead={<p>Different organizations use WhatsApp differently.</p>}
        />
        <div className="mt-10">
          <BusinessShapes />
        </div>
        <div className="mt-8 mx-auto max-w-3xl space-y-3 text-center">
          <Lead>
            The API provides the foundation for connecting WhatsApp communication with the business
            processes behind those interactions.
          </Lead>
          <p className="text-base font-medium text-slate-800 leading-relaxed">
            ZunoPilot adds the product layer that helps businesses manage these capabilities in a
            more practical environment.
          </p>
          <div className="pt-2 flex justify-center">
            <ArrowLink to="/features">Explore ZunoPilot Features</ArrowLink>
          </div>
        </div>
      </Section>

      {/* --------------------- Capabilities on the rail ----------------------- */}
      <Section tone="tinted">
        <SectionHead
          eyebrow="The foundation, and what plugs into it"
          title={['Combine WhatsApp API With', 'ZunoPilot Capabilities']}
          lead={(
            <>
              <p>The API is the communication foundation.</p>
              <p>ZunoPilot&rsquo;s capabilities can build on top of that foundation.</p>
            </>
          )}
        />
        <div className="mt-10 mx-auto max-w-4xl">
          <Backplane modules={MODULES} />
        </div>
      </Section>

      {/* ----------------------------- Why API ------------------------------- */}
      <Section>
        <SectionHead title={['Why Businesses Use an', 'API-Based WhatsApp Setup']} />
        <div className="mt-10">
          <ReasonRows reasons={REASONS} />
        </div>
      </Section>

      {/* --------------------------- Who it fits ----------------------------- */}
      <Section tone="tinted">
        <SectionHead title={['WhatsApp Business API for', 'Different Business Needs']} />
        <div className="mt-10">
          <FitGrid fits={FITS} />
        </div>
        <div className="mt-8 flex justify-center">
          <ArrowLink to="/solutions/lead-management">Explore WhatsApp Lead Management</ArrowLink>
        </div>
      </Section>

      {/* ------------------------ When to consider it ------------------------ */}
      <Section>
        <SectionHead
          eyebrow="Signals, not features"
          title={['When Should a Business Consider', 'WhatsApp Business API?']}
          lead={(
            <p>
              You may need an API-based WhatsApp setup when your business starts encountering
              requirements such as:
            </p>
          )}
        />
        <div className="mt-10">
          <TriggerChecklist items={TRIGGERS} />
        </div>
        <div className="mt-8 mx-auto max-w-3xl space-y-3 text-center">
          <Lead>
            If your requirements are limited to simple one-to-one business conversations, the
            WhatsApp Business App may be sufficient.
          </Lead>
          <p className="text-base font-medium text-slate-800 leading-relaxed">
            The API becomes more relevant when software, scale, workflows, and team operations
            become important.
          </p>
        </div>
      </Section>

      {/* --------------------------- The four layers -------------------------- */}
      <Section tone="tinted">
        <SectionHead
          eyebrow="Four layers, one conversation"
          title={['WhatsApp API and', 'Customer Conversations']}
          lead={(
            <>
              <p>
                An API connection doesn&rsquo;t mean every customer conversation should become
                automated.
              </p>
              <p>A business may use different layers for different situations.</p>
            </>
          )}
        />
        <div className="mt-10">
          <LayerGrid layers={LAYERS} />
        </div>
        <p className="mt-8 mx-auto max-w-3xl text-center text-base font-medium text-slate-800 leading-relaxed">
          This gives businesses flexibility to decide how much of the customer journey should be
          automated and where employees should remain involved.
        </p>
      </Section>

      {/* ------------------------ A connected operation ----------------------- */}
      <Section>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-14 items-start">
          <div>
            <SectionHead
              align="left"
              title={['Build a More Connected', 'WhatsApp Operation']}
              lead={(
                <p>
                  A modern WhatsApp communication setup can connect several parts of the customer
                  journey.
                </p>
              )}
            />
            <p className="mt-6 text-base font-medium text-slate-800 leading-relaxed">
              The API provides the underlying communication connection, while ZunoPilot helps
              businesses organize the capabilities around it.
            </p>
          </div>
          <SystemFlow
            caption="For example — discovery through to ongoing communication, with automation and people each doing the part that suits them."
            steps={[
              'Customer discovers your business',
              'Starts a WhatsApp conversation',
              'Business identifies the enquiry',
              'Automation or AI assists where appropriate',
              'Sales or support team takes over',
              'Customer receives ongoing communication',
            ]}
          />
        </div>
      </Section>

      {/* --------------------- Messaging requirements ------------------------- */}
      <Section tone="tinted">
        <SectionHead
          eyebrow="Read this part properly"
          title={['WhatsApp Business API and', 'Business Messaging Requirements']}
          lead={(
            <>
              <p>
                WhatsApp Business communication is subject to applicable platform policies and
                messaging requirements.
              </p>
              <p>
                Depending on the type of communication, businesses may need to consider:
              </p>
            </>
          )}
        />
        <div className="mt-10">
          <CheckCards items={REQUIREMENTS} columns={3} />
        </div>
        <div className="mt-8 mx-auto max-w-3xl space-y-3 text-center">
          <p className="text-base font-medium text-slate-800 leading-relaxed">
            Businesses should always verify the current requirements applicable to their specific
            WhatsApp Business setup before launching messaging programs.
          </p>
          <Lead>
            ZunoPilot should be configured and used in accordance with those requirements.
          </Lead>
        </div>
      </Section>

      {/* --------------------------- The six ports --------------------------- */}
      <Section>
        <SectionHead
          eyebrow="After the connection is made"
          title={['What Makes ZunoPilot Useful', 'With WhatsApp Business API?']}
          lead={(
            <>
              <p>Connecting to WhatsApp is only one part of building a business communication operation.</p>
              <p>
                Teams also need practical ways to manage what happens after the connection is
                established.
              </p>
              <p>
                ZunoPilot brings together capabilities that can help businesses work with WhatsApp
                communication across different stages:
              </p>
            </>
          )}
        />
        <div className="mt-10">
          <PortGrid ports={PORTS} />
        </div>
        <p className="mt-8 mx-auto max-w-3xl text-center text-base font-medium text-slate-800 leading-relaxed">
          This gives businesses a broader environment rather than treating the API connection as an
          isolated technical integration.
        </p>
      </Section>

      {/* --------------------------- Is it right? ---------------------------- */}
      <Section tone="tinted">
        <SectionHead
          title={['Is WhatsApp Business API', 'Right for Your Business?']}
          lead={(
            <>
              <p>There isn&rsquo;t one setup that works for every organization.</p>
              <p>
                The API is particularly relevant when WhatsApp needs to become part of your
                software, customer journey, or operational workflow.
              </p>
              <p>If you&rsquo;re looking to:</p>
            </>
          )}
        />
        <div className="mt-10 mx-auto max-w-5xl">
          <CheckCards items={LOOKING_TO} columns={3} />
        </div>
        <p className="mt-8 mx-auto max-w-3xl text-center text-base font-medium text-slate-800 leading-relaxed">
          then an API-based WhatsApp approach may be worth considering.
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-x-8 gap-y-3">
          <ArrowLink to="/pricing">See pricing</ArrowLink>
          <ArrowLink to="/contact">Book a demo</ArrowLink>
        </div>
      </Section>

      <FaqSection faqs={FAQS} />

      <CtaBand
        title={['Make WhatsApp Part of', 'Your Business Infrastructure']}
        body={[
          'WhatsApp can be more than another place for your team to answer customer messages.',
          'With the right business setup, it can become part of your sales, support, notification, engagement, and customer communication processes.',
          'ZunoPilot helps businesses bring these WhatsApp capabilities together in one environment.',
        ]}
      />

      <SiteFooter />
    </div>
  );
}
