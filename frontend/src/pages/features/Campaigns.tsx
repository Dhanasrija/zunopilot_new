import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import {
  BarChart3, Bot, Building2, CalendarDays, Check, ClipboardList, Filter, Gauge,
  Headphones, Info, Megaphone, MessageSquare, MousePointerClick, Repeat, Rocket,
  Send, ShieldCheck, Sparkles, Target, UserRound, Users, Workflow,
} from 'lucide-react';
import { useDocumentHead } from '@/lib/document-head';
import { PAGE_HEADS } from '@/lib/page-heads';
import { useBreadcrumbSchema } from '@/lib/json-ld';
import SiteHeader from '@/components/marketing/SiteHeader';
import SiteFooter from '@/components/marketing/SiteFooter';
import {
  ArrowLink, CARD_SPRING, CheckCards, CtaBand, EASE_OUT, FaqSection,
  PageHero, ScrollProgress, Section, SectionHead, item, stagger, viewport,
} from '@/components/marketing/primitives';
import { IconTitle, Reveal, useTravellingIndex } from '@/components/marketing/motion-kit';

/*
 * /features/whatsapp-campaigns
 *
 * **The design idea is a campaign being built**, so the page is laid out as a pipeline
 * rather than as bands of cards: a horizontal stepper across the top, then the stages
 * of actually planning one — audience, objective, message, call to action — with the
 * message stage showing a real WhatsApp bubble rather than describing one.
 *
 * That makes it structurally unlike its siblings. `/features/whatsapp-automation` is
 * numbered rails and scenario cards, `/features/ai-whatsapp-automation` is quoted
 * customer utterances and a comparison table, `/features/whatsapp-number-masking` is
 * paired contact-path diagrams. Nothing below is shared with any of them except the page
 * shell, the FAQ block and the CTA band.
 *
 * The compliance section is not boilerplate and should not be trimmed: business-initiated
 * WhatsApp messaging is consent- and template-gated, and a campaigns page that implies
 * otherwise is selling something the platform will not deliver.
 */

/* -------------------------------------------------------------------------- */
/*                          Page-local design devices                          */
/* -------------------------------------------------------------------------- */

/**
 * The pipeline, read left to right on desktop and top to bottom on mobile.
 *
 * The copy states it as `Audience → Campaign → Message → Delivery → Customer Response`,
 * which is a sentence about a sequence. Setting it as a stepper means a visitor gets the
 * shape before they read a word of the sections that follow, each of which is one of
 * these stages.
 */
function Pipeline({ stages }: { stages: readonly string[] }) {
  return (
    <div className="mt-2">
      {/*
        **This was broken and the break is worth naming.** The rule between stages was drawn as
        `absolute right-0 top-8 w-full` *inside each item*, so every segment was a full column
        wide starting at that column's right edge — the lines overshot into the next stage, sat at
        a different height from the nodes they were meant to join, and the last stage rendered
        with a rule pointing off the end of the row.
      *
        The fix is to stop drawing marks between things. One rail spans the row *behind* the
        nodes, inset by half a column at each end so it begins under the first node and stops
        under the last — geometry that cannot produce a trailing connector because there is no
        per-item element to leave behind. The segmented fill is a nod to the campaign dashboard
        this page is styled after.
      */}
      <motion.ol
        initial="hidden"
        whileInView="show"
        viewport={viewport}
        variants={stagger(0.05, 0.09)}
        className="relative hidden md:grid md:grid-cols-5"
      >
        <span aria-hidden className="pointer-events-none absolute left-[10%] right-[10%] top-[15px] flex gap-1">
          {stages.slice(0, -1).map((stage, i) => (
            <motion.span
              key={stage}
              variants={{
                hidden: { scaleX: 0 },
                show: { scaleX: 1, transition: { duration: 0.4, delay: i * 0.12, ease: EASE_OUT } },
              }}
              className="h-1.5 flex-1 origin-left rounded-full bg-gradient-to-r from-violet-300 to-violet-500"
            />
          ))}
        </span>

        {stages.map((stage, i) => (
          <motion.li key={stage} variants={item} className="relative flex flex-col items-center px-2 text-center">
            <span className="relative z-10 grid h-8 w-8 place-items-center rounded-lg bg-violet-600 text-[11px] font-bold text-white ring-4 ring-white tabular-nums">
              {i + 1}
            </span>
            <span className="mt-3 block text-[13px] font-semibold leading-snug text-slate-900">
              {stage}
            </span>
          </motion.li>
        ))}
      </motion.ol>

      {/* Stacked, for narrow screens: the same stages, numbered, no geometry to get wrong. */}
      <motion.ol
        initial="hidden"
        whileInView="show"
        viewport={viewport}
        variants={stagger(0, 0.06)}
        className="space-y-2 md:hidden"
      >
        {stages.map((stage, i) => (
          <motion.li
            key={stage}
            variants={item}
            className="flex items-center gap-3 rounded-2xl bg-white px-4 py-3 ring-1 ring-slate-200"
          >
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-violet-600 text-[11px] font-bold text-white tabular-nums">
              {i + 1}
            </span>
            <span className="text-[15px] font-semibold text-slate-900">{stage}</span>
          </motion.li>
        ))}
      </motion.ol>
    </div>
  );
}

/**
 * A WhatsApp message, as a WhatsApp message.
 *
 * The section it sits in is about what makes a campaign message worth replying to, and
 * a bulleted list of message-writing advice next to an actual bubble is far more use
 * than the list alone. Deliberately *not* WhatsApp green — the brand guidelines reserve
 * that for connection status — so it reads as a message without borrowing Meta's colour.
 */
function MessageMock({
  heading, lines, reply,
}: {
  heading: string;
  lines: readonly string[];
  reply?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 24, scale: 0.98 }}
      whileInView={{ opacity: 1, y: 0, scale: 1 }}
      viewport={viewport}
      transition={{ duration: 0.6, ease: EASE_OUT }}
      className="rounded-3xl bg-slate-100 ring-1 ring-slate-200 p-5 sm:p-6"
    >
      <div className="flex items-center gap-2 pb-4">
        <span className="grid h-8 w-8 place-items-center rounded-full bg-violet-600 text-white">
          <Send className="h-3.5 w-3.5" />
        </span>
        <span className="text-sm font-semibold text-slate-800">{heading}</span>
      </div>

      <div className="max-w-sm rounded-2xl rounded-tl-sm bg-white px-4 py-3 shadow-sm ring-1 ring-slate-200">
        {lines.map((line, i) => (
          <p key={line} className={`text-[15px] text-slate-800 leading-relaxed ${i ? 'mt-2' : ''}`}>
            {line}
          </p>
        ))}
      </div>

      {reply && (
        <motion.div
          initial={{ opacity: 0, x: 16 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={viewport}
          transition={{ duration: 0.5, delay: 0.25, ease: EASE_OUT }}
          className="ml-auto mt-3 max-w-xs rounded-2xl rounded-tr-sm bg-violet-600 px-4 py-3"
        >
          <p className="text-[15px] text-white leading-relaxed">{reply}</p>
        </motion.div>
      )}
    </motion.div>
  );
}


/** One of the five planning questions, set large. */
function Question({ q, label, body, i }: { q: string; label: string; body: string; i: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={viewport}
      transition={{ duration: 0.5, delay: i * 0.06, ease: EASE_OUT }}
      whileHover={{ y: -5 }}
      className="relative overflow-hidden rounded-3xl bg-white ring-1 ring-slate-200/80 p-6"
    >
      <span className="text-3xl font-extrabold tracking-tight text-violet-600">{q}</span>
      <h3 className="mt-3 text-base font-bold text-slate-900">{label}</h3>
      <p className="mt-2 text-sm text-slate-700 leading-relaxed">{body}</p>
    </motion.div>
  );
}

/* -------------------------------------------------------------------------- */
/*                                    Page                                     */
/* -------------------------------------------------------------------------- */

/**
 * Relevance, as a funnel that narrows.
 *
 * **What it replaced.** Four `from → to` rows. They stated the pairing and hid the argument: the
 * section is about *narrowing* — one contact list becoming several audiences, each getting
 * something different. So the five stages run across the top as a funnel that visibly gets
 * tighter, and the four pairings sit underneath as the worked examples of the last stage.
 */
function RelevanceFunnel() {
  /*
   * The highlight travels the funnel instead of sitting on "Engagement".
   *
   * A permanently lit last stage read as the only one that mattered; the section's claim is that
   * relevance is produced by moving through all five. Reduced motion rests it on the last stage,
   * which is where it used to sit permanently.
   */
  const STAGES = [
    { icon: Users, label: 'Audience', body: 'Everyone you could message' },
    { icon: Filter, label: 'Segmentation', body: 'Split by relationship' },
    { icon: UserRound, label: 'Personalization', body: 'Say something that fits' },
    { icon: MessageSquare, label: 'Message', body: 'One audience, one point' },
    { icon: Sparkles, label: 'Engagement', body: 'A reply worth having' },
  ];

  const lit = useTravellingIndex(STAGES.length, 1400, STAGES.length - 1);

  return (
    <div className="mx-auto max-w-5xl">
      <motion.ol
        initial="hidden"
        whileInView="show"
        viewport={viewport}
        variants={stagger(0.05, 0.09)}
        className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-5 sm:gap-4"
      >
        {STAGES.map((stage, i) => (
          <motion.li
            key={stage.label}
            variants={item}
            whileHover={{ y: -4 }}
            transition={CARD_SPRING}
            /* Each card sits a little lower and a little tighter than the last — the funnel is
               in the layout rather than drawn as a shape, so it survives any screen width. */
            style={{ marginTop: `${i * 6}px` }}
            className={`h-full rounded-2xl p-4 text-center ring-1 transition-colors duration-500 ${
              i === lit ? 'bg-violet-600 ring-violet-500' : 'bg-white ring-slate-200'
            }`}
          >
            <span
              aria-hidden
              className={`mx-auto grid h-9 w-9 place-items-center rounded-xl transition-colors duration-500 ${
                i === lit ? 'bg-white/15 text-white' : 'bg-violet-50 text-violet-600'
              }`}
            >
              <stage.icon className="h-4 w-4" />
            </span>
            <p className={`mt-2.5 text-[13px] font-bold transition-colors duration-500 ${i === lit ? 'text-white' : 'text-slate-900'}`}>
              {stage.label}
            </p>
            <p className={`mt-1 text-[12px] leading-relaxed transition-colors duration-500 ${i === lit ? 'text-violet-100' : 'text-slate-600'}`}>
              {stage.body}
            </p>
          </motion.li>
        ))}
      </motion.ol>

      <motion.ul
        initial="hidden"
        whileInView="show"
        viewport={viewport}
        variants={stagger(0.15, 0.06)}
        className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4"
      >
        {RELEVANCE.map(([from, to]) => (
          <motion.li
            key={from}
            variants={item}
            className="flex flex-col gap-2 rounded-2xl bg-white p-4 ring-1 ring-slate-200 sm:flex-row sm:items-center sm:gap-4"
          >
            <span className="shrink-0 rounded-full bg-slate-100 px-3 py-1.5 text-[13px] font-semibold text-slate-700">
              {from}
            </span>
            <Send aria-hidden className="hidden h-3.5 w-3.5 shrink-0 text-violet-400 sm:block" />
            <span className="text-[14px] font-medium text-slate-800 leading-snug">{to}</span>
          </motion.li>
        ))}
      </motion.ul>
    </div>
  );
}

/**
 * The campaign types, as a board of cards.
 *
 * A two-column table made "Campaign" and "Objective" look like fields of a record. They are not:
 * the objective is *why you would run that campaign*, which reads far better as the second line
 * of a card than as a cell beside it. The board framing also matches what the section claims —
 * several campaigns, visible at once, from one place.
 */
function CampaignTypeBoard() {
  const ICONS = [Rocket, Info, CalendarDays, Target, Repeat, Megaphone];
  return (
    <motion.ul
      initial="hidden"
      whileInView="show"
      viewport={viewport}
      variants={stagger(0, 0.06)}
      className="mx-auto grid max-w-5xl grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 sm:gap-4"
    >
      {CAMPAIGN_TYPES.map(([name, objective], i) => {
        const Icon = ICONS[i % ICONS.length];
        return (
          <motion.li
            key={name}
            variants={item}
            whileHover={{ y: -5, boxShadow: '0 22px 48px -20px rgb(96 73 231 / 0.28)' }}
            transition={CARD_SPRING}
            className="group relative h-full overflow-hidden rounded-2xl bg-white p-5 ring-1 ring-slate-200/80"
          >
            <span
              aria-hidden
              className="pointer-events-none absolute inset-x-0 top-0 h-1 origin-left scale-x-0 bg-gradient-to-r from-violet-400 to-violet-600 transition-transform duration-300 group-hover:scale-x-100"
            />
            <div className="flex items-center justify-between gap-3">
              <span
                aria-hidden
                className="grid h-10 w-10 place-items-center rounded-xl bg-violet-50 text-violet-600 ring-1 ring-violet-200/70 transition-colors duration-200 group-hover:bg-violet-600 group-hover:text-white"
              >
                <Icon className="h-5 w-5" />
              </span>
              <span className="text-[11px] font-bold uppercase tracking-widest text-slate-400 tabular-nums">
                {String(i + 1).padStart(2, '0')}
              </span>
            </div>
            <p className="mt-4 text-[15px] font-bold text-slate-900">{name}</p>
            <p className="mt-1.5 text-[14px] text-slate-700 leading-relaxed">{objective}</p>
          </motion.li>
        );
      })}
    </motion.ul>
  );
}

/**
 * The call to action, and what happens after somebody takes it.
 *
 * **What it replaced.** Eight plain pills. The section's title is "give your campaigns a clear
 * call to action", and pills communicated the *list* without communicating that these are things
 * a customer taps. So they are styled as actions now — a pointer mark, a press state — and the
 * three steps that follow a tap are stated beside them, because a CTA with nothing behind it is
 * the actual failure this section is warning about.
 */
function CtaJourney() {
  const AFTER = [
    { icon: MousePointerClick, label: 'Customer responds', body: 'They reply, tap through, or ask a question.' },
    { icon: MessageSquare, label: 'It becomes a conversation', body: 'The reply lands in the shared inbox, not in a report.' },
    { icon: UserRound, label: 'Someone continues it', body: 'Automation, AI, or a person — whichever the workflow says.' },
  ];

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 lg:gap-8">
      <motion.ul
        initial="hidden"
        whileInView="show"
        viewport={viewport}
        variants={stagger(0, 0.05)}
        className="lg:col-span-7 flex flex-wrap gap-2"
      >
        {CALLS_TO_ACTION.map((c) => (
          <motion.li
            key={c}
            variants={item}
            whileHover={{ y: -3, boxShadow: '0 14px 30px -14px rgb(96 73 231 / 0.35)' }}
            whileTap={{ scale: 0.97 }}
            transition={CARD_SPRING}
            /* Tighter than they were: eight of these at `px-4 py-2.5` filled the column and read
               as buttons competing with the page's real CTAs. */
            className="group flex cursor-default items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-[13px] font-semibold text-slate-800 ring-1 ring-slate-200 transition-colors duration-200 hover:ring-violet-300"
          >
            <MousePointerClick
              aria-hidden
              className="h-3 w-3 text-slate-400 transition-colors duration-200 group-hover:text-violet-600"
            />
            {c}
          </motion.li>
        ))}
      </motion.ul>

      <motion.ol
        initial="hidden"
        whileInView="show"
        viewport={viewport}
        variants={stagger(0.1, 0.08)}
        className="lg:col-span-5 space-y-2"
      >
        {AFTER.map((step, i) => (
          <motion.li key={step.label} variants={item}>
            <div className="rounded-2xl bg-white p-4 ring-1 ring-violet-200">
              <IconTitle icon={step.icon} as="p" size="sm" className="text-[15px] font-bold text-slate-900">
                {step.label}
              </IconTitle>
              <p className="mt-2 text-[14px] text-slate-700 leading-relaxed">{step.body}</p>
            </div>
            {i < AFTER.length - 1 && (
              <span aria-hidden className="mx-auto block h-3 w-px bg-violet-200" />
            )}
          </motion.li>
        ))}
      </motion.ol>
    </div>
  );
}

/**
 * The command centre: the five capabilities, and what a campaign looks like while it runs.
 *
 * **What it replaced.** A five-row ruled list. It read as a table of contents for a product,
 * which undersold the actual claim — that all of this is one place.
 *
 * **There are no numbers in the panel on the right, and that is deliberate.** A campaign
 * dashboard is exactly the kind of figure where invented metrics creep in — "2,481 delivered,
 * 38% replied" — and a marketing page that shows a made-up conversion rate is lying in a way
 * nobody can check. So the panel shows the *structure* a live campaign has: which audience,
 * which message, where the replies go. Real figures belong in the product, on real data.
 */
function CommandCentre() {
  const ICONS = [Megaphone, Workflow, Bot, Users, ShieldCheck];
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-12 lg:gap-6">
      {/* The capabilities. */}
      <motion.ul
        initial="hidden"
        whileInView="show"
        viewport={viewport}
        variants={stagger(0, 0.07)}
        className="lg:col-span-7 space-y-3"
      >
        {STACK.map((entry, i) => {
          const Icon = ICONS[i % ICONS.length];
          return (
            <motion.li
              key={entry.title}
              variants={item}
              whileHover={{ x: 4 }}
              transition={CARD_SPRING}
              className="group flex items-start gap-4 rounded-2xl bg-white p-5 ring-1 ring-slate-200/80 transition-colors duration-200 hover:ring-violet-200"
            >
              <span
                aria-hidden
                className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-violet-50 text-violet-600 ring-1 ring-violet-200/70 transition-colors duration-200 group-hover:bg-violet-600 group-hover:text-white"
              >
                <Icon className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <p className="text-[15px] font-bold text-slate-900">{entry.title}</p>
                <p className="mt-1 text-[14px] text-slate-700 leading-relaxed">{entry.body}</p>
              </div>
            </motion.li>
          );
        })}
      </motion.ul>

      {/* What a running campaign looks like. Structure, not statistics. */}
      <Reveal delay={0.1} className="lg:col-span-5">
        <div className="relative h-full overflow-hidden rounded-3xl bg-slate-900 p-6">
          <span
            aria-hidden
            className="pointer-events-none absolute -top-16 -right-12 h-48 w-48 rounded-full bg-violet-500/25 blur-3xl"
          />
          <p className="relative flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-violet-300">
            <Gauge aria-hidden className="h-4 w-4" />
            One campaign, in one place
          </p>

          <div className="relative mt-5 space-y-2.5">
            {[
              { icon: Users, label: 'Audience', body: 'Who this campaign is for' },
              { icon: MessageSquare, label: 'Message', body: 'What they receive, and in what format' },
              { icon: CalendarDays, label: 'Timing', body: 'When it goes out' },
              { icon: Send, label: 'Delivery', body: 'What has been sent so far' },
              { icon: BarChart3, label: 'Responses', body: 'Replies, landing in the shared inbox' },
            ].map((row) => (
              <div key={row.label} className="flex items-center gap-3 rounded-xl bg-white/5 px-4 py-3 ring-1 ring-white/10">
                <span aria-hidden className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-violet-600/90 text-white">
                  <row.icon className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold text-white">{row.label}</p>
                  <p className="text-[12px] text-slate-300 leading-snug">{row.body}</p>
                </div>
              </div>
            ))}
          </div>

          <p className="relative mt-5 text-[12px] text-slate-400 leading-relaxed">
            Figures depend on your own campaigns and audience, so none are shown here.
          </p>
        </div>
      </Reveal>
    </div>
  );
}

const CRUMBS = [
  { name: 'Home', path: '/' },
  { name: 'Features', path: '/features' },
  { name: 'WhatsApp Campaigns', path: '/features/whatsapp-campaigns' },
];

export default function Campaigns() {
  useDocumentHead(PAGE_HEADS.campaigns);
  useBreadcrumbSchema(CRUMBS);

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <ScrollProgress />
      <SiteHeader />

      <PageHero
        crumbs={CRUMBS}
        title={['WhatsApp Campaigns for More', 'Effective Customer Outreach']}
        intro={[
          'Reach customers through WhatsApp with campaigns built around the right audience, message, and business objective.',
          'ZunoPilot helps businesses organize WhatsApp campaign communication so they can plan customer outreach, create relevant messages, and manage campaign activities from a business-focused platform.',
          "Whether you're announcing a new offering, sharing an important update, reconnecting with customers, or promoting a time-sensitive offer, ZunoPilot helps you bring your WhatsApp campaign activities into one place.",
        ]}
      />

      {/* ------------------------------ The pipeline --------------------------- */}
      <Section tone="tinted">
        <SectionHead
          title={['Turn Customer Outreach', 'Into a Planned Campaign']}
          lead={(
            <>
              <p>
                Sending messages individually can become difficult when a business needs to
                communicate with a larger customer audience. Campaign-based communication gives
                your team a more structured way to plan outreach.
              </p>
              <p>
                Instead of treating every message as a separate task, you can organize
                communication around a specific objective:
              </p>
            </>
          )}
        />
        <div className="mt-12 max-w-5xl mx-auto">
          <Pipeline stages={PIPELINE} />
        </div>
        <p className="mt-10 text-center text-base text-slate-700 max-w-2xl mx-auto">
          This makes it easier to think about who should receive the communication, why they
          should receive it, and what action you want them to take.
        </p>
      </Section>

      {/* ------------------------------ Definition ---------------------------- */}
      <Section>
        <SectionHead
          title={['What Are WhatsApp Campaigns?']}
          lead={(
            <p>
              WhatsApp campaigns are organized customer communication activities delivered
              through WhatsApp for a defined business purpose. A campaign might be created to:
            </p>
          )}
        />
        <motion.ul
          initial="hidden"
          whileInView="show"
          viewport={viewport}
          variants={stagger(0, 0.04)}
          className="mt-10 flex flex-wrap justify-center gap-2 sm:gap-3 max-w-4xl mx-auto"
        >
          {PURPOSES.map((purpose) => (
            <motion.li
              key={purpose}
              variants={item}
              whileHover={{ y: -3 }}
              transition={CARD_SPRING}
              className="rounded-full bg-violet-50 ring-1 ring-violet-100 px-4 py-2 text-sm font-medium text-slate-800"
            >
              {purpose}
            </motion.li>
          ))}
        </motion.ul>
        <div className="mt-10 mx-auto max-w-2xl space-y-3 text-center text-base text-slate-700">
          <p>
            With ZunoPilot, businesses can manage campaign communication as part of their broader
            WhatsApp engagement strategy.
          </p>
          <p className="text-sm text-slate-600">
            Campaign functionality and message delivery should always be configured according to
            applicable WhatsApp Business policies and customer consent requirements.
          </p>
        </div>
      </Section>

      {/* --------------------------- Stage 1: audience ------------------------- */}
      <Stage
        n="01"
        tone="tinted"
        eyebrow="Start with the audience, not the message"
        title={['Who Needs to Receive', 'This Communication?']}
        lead={(
          <>
            <p>
              An effective campaign isn’t simply about writing a message and sending it to
              everyone. The first question should be who needs to receive this communication.
            </p>
            <p>
              Different customers may have different interests, purchase histories, requirements,
              or relationships with your business.
            </p>
          </>
        )}
      >
        <CheckCards items={AUDIENCES} columns={3} className="mt-10" />
        <p className="mt-8 text-center text-base text-slate-700 max-w-2xl mx-auto">
          Audience-focused campaign planning helps make the message more relevant to the people
          receiving it.
        </p>
      </Stage>

      {/* --------------------------- Stage 2: objective ------------------------ */}
      <Stage
        n="02"
        eyebrow="Every campaign should have a reason"
        title={['Build Campaigns Around', 'a Clear Objective']}
      >
        <motion.div
          initial="hidden"
          whileInView="show"
          viewport={viewport}
          variants={stagger(0, 0.06)}
          className="mt-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5"
        >
          {OBJECTIVES.map((o) => (
            <motion.div
              key={o.title}
              variants={item}
              whileHover={{ y: -5 }}
              transition={CARD_SPRING}
              className="group h-full rounded-3xl bg-gradient-to-br from-slate-50 to-slate-100/60 ring-1 ring-slate-200/80 p-6 transition-colors duration-200 hover:ring-violet-200"
            >
              <IconTitle icon={o.icon} className="text-base font-bold text-slate-900">
                {o.title}
              </IconTitle>
              <p className="mt-3 text-[15px] text-slate-700 leading-relaxed">{o.body}</p>
            </motion.div>
          ))}
        </motion.div>
        <p className="mt-8 text-center text-base font-semibold text-slate-900 max-w-2xl mx-auto">
          The objective should determine the audience, message, timing, and desired next action.
        </p>
      </Stage>

      {/* --------------------------- Stage 3: the message ---------------------- */}
      <Stage
        n="03"
        tone="tinted"
        eyebrow="Give customers a reason to respond"
        title={['Create Messages That', 'Are Worth Replying To']}
      >
        <div className="mt-10 grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-10 items-start">
          <div className="rounded-3xl bg-white ring-1 ring-slate-200/80 p-6 sm:p-8">
            <p className="text-base font-semibold text-slate-900">Consider including:</p>
            <ul className="mt-5 space-y-3">
              {MESSAGE_PARTS.map((part) => (
                <li key={part} className="flex items-start gap-3">
                  <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-violet-100 text-violet-600">
                    <Check className="h-3 w-3" strokeWidth={3} />
                  </span>
                  <span className="text-[15px] text-slate-800 leading-relaxed">{part}</span>
                </li>
              ))}
            </ul>
            <p className="mt-6 text-sm text-slate-700 leading-relaxed">
              A campaign message should not make the customer work to understand why you’re
              contacting them. Good campaign communication makes the key information easy to
              identify.
            </p>
          </div>

          <MessageMock
            heading="New service announcement"
            lines={[
              'A new service is now available for eligible customers.',
              'Find out what’s included and see whether it’s suitable for your requirements.',
            ]}
          />
        </div>
        <p className="mt-8 text-center text-base text-slate-700 max-w-2xl mx-auto">
          The message is focused on the customer rather than simply announcing that the business
          has something new.
        </p>
      </Stage>

      {/* ---------------------------- Stage 4: relevance ---------------------- */}
      <Stage
        n="04"
        eyebrow="The same message doesn’t work for everyone"
        title={['Make Campaign', 'Communication More Relevant']}
        lead={(
          <p>
            Campaign relevance improves when communication is based on the customer’s
            relationship with the business.
          </p>
        )}
      >
        <div className="mt-10">
          <RelevanceFunnel />
        </div>
        <p className="mt-8 text-center text-base text-slate-700 max-w-2xl mx-auto">
          The objective is to avoid treating every contact as an identical audience.
        </p>
      </Stage>

      {/* ------------------------- Campaign types table ----------------------- */}
      <Section tone="tinted">
        <SectionHead
          title={['Manage Different Campaign', 'Types From One Platform']}
          lead={<p>Businesses may run several WhatsApp campaigns at the same time.</p>}
        />
        <div className="mt-10">
          <CampaignTypeBoard />
        </div>
        <p className="mt-8 text-center text-base text-slate-700 max-w-2xl mx-auto">
          Keeping campaign activity organized makes it easier for teams to understand what
          communication is currently being planned or delivered.
        </p>
      </Section>

      {/* ---------------------------- Stage 5: the CTA ------------------------ */}
      <Stage
        n="05"
        eyebrow="Don’t leave customers wondering"
        title={['Give Your Campaigns', 'a Clear Call to Action']}
        lead={(
          <p>Depending on the objective, the next action could be:</p>
        )}
      >
        <div className="mt-10">
          <CtaJourney />
        </div>
        <div className="mt-8 mx-auto max-w-2xl space-y-2 text-center text-base text-slate-700">
          <p>The right call to action depends on the campaign objective and customer journey.</p>
          <p>
            The simpler the next step is to understand, the easier it is for customers to act on
            the communication.
          </p>
        </div>
      </Stage>

      {/* ------------------- Campaign → conversation (the mock) --------------- */}
      <Section tone="tinted">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-16 items-center">
          <SectionHead
            align="left"
            title={['Connect Campaigns With', 'Customer Conversations']}
            lead={(
              <>
                <p>
                  A WhatsApp campaign is often the beginning of a conversation rather than the end
                  of one. A customer may respond with “Can you tell me more?”. Another may ask “Is
                  this available for me?”. Someone else may want to speak with a salesperson.
                </p>
                <p>
                  This is where campaign communication connects with your broader WhatsApp
                  strategy: campaign outreach leads into a business conversation, and then into a
                  sales or support interaction.
                </p>
              </>
            )}
          />
          <div>
            <MessageMock
              heading="Campaign, then conversation"
              lines={['A new service is now available for eligible customers.']}
              reply="Can you tell me more?"
            />
            <div className="mt-6">
              <ArrowLink to="/features/whatsapp-team-inbox">Explore WhatsApp Team Inbox</ArrowLink>
            </div>
          </div>
        </div>
      </Section>

      {/* --------------------- Automation + AI companions --------------------- */}
      <Section>
        <SectionHead
          title={['Campaigns Start the Outreach.', 'Automation Handles What Follows.']}
          lead={(
            <>
              <p>
                Campaign communication and automation serve different purposes. A campaign is
                organized around planned outreach to an audience; automation focuses on handling
                recurring communication or business processes. They complement each other.
              </p>
              <p>
                AI can then support the conversations that happen after a campaign reaches
                customers — a customer may respond with a question that isn’t written exactly the
                way your business expected.
              </p>
            </>
          )}
        />
        <div className="mt-10 mx-auto max-w-3xl">
          <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-3">
            {['Campaign', 'Customer responds', 'Automated assistance', 'Team conversation'].map((s, i, a) => (
              <motion.div
                key={s}
                initial={{ opacity: 0, scale: 0.95 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={viewport}
                transition={{ duration: 0.4, delay: i * 0.1, ease: EASE_OUT }}
                className="flex items-center gap-2"
              >
                <span className="rounded-full bg-violet-600 px-4 py-2 text-sm font-semibold text-white">
                  {s}
                </span>
                {i < a.length - 1 && <span aria-hidden className="text-violet-300">&rarr;</span>}
              </motion.div>
            ))}
          </div>
        </div>
        <div className="mt-10 flex flex-wrap justify-center gap-x-8 gap-y-3">
          <ArrowLink to="/features/whatsapp-automation">Explore WhatsApp Automation</ArrowLink>
          <ArrowLink to="/features/ai-whatsapp-automation">Explore AI WhatsApp Automation</ArrowLink>
        </div>
      </Section>

      {/* ------------------------------- Teams -------------------------------- */}
      <Section tone="tinted">
        <SectionHead title={['Campaign Communication', 'for Different Business Teams']} />
        <motion.div
          initial="hidden"
          whileInView="show"
          viewport={viewport}
          variants={stagger(0, 0.06)}
          className="mt-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5"
        >
          {TEAMS.map((t) => (
            <motion.div
              key={t.title}
              variants={item}
              whileHover={{ y: -5 }}
              transition={CARD_SPRING}
              className="group h-full rounded-3xl bg-white ring-1 ring-slate-200/80 p-6 transition-colors duration-200 hover:ring-violet-200"
            >
              <IconTitle icon={t.icon} className="text-base font-bold text-slate-900">
                {t.title}
              </IconTitle>
              <p className="mt-3 text-[15px] text-slate-700 leading-relaxed">{t.body}</p>
            </motion.div>
          ))}
        </motion.div>
      </Section>

      {/* ------------------------------ Examples ------------------------------ */}
      <Section>
        <SectionHead title={['Examples of', 'WhatsApp Campaigns']} />
        <motion.div
          initial="hidden"
          whileInView="show"
          viewport={viewport}
          variants={stagger(0, 0.08)}
          className="mt-10 grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-5"
        >
          {EXAMPLES.map((ex) => (
            <motion.article
              key={ex.title}
              variants={item}
              whileHover={{ y: -5 }}
              transition={CARD_SPRING}
              className="h-full rounded-3xl bg-slate-50 ring-1 ring-slate-200/80 p-6 sm:p-7"
            >
              <h3 className="text-lg font-bold text-slate-900">{ex.title}</h3>
              <p className="mt-2 text-sm text-slate-700 leading-relaxed">{ex.body}</p>
              <ol className="mt-5 flex flex-wrap items-center gap-x-2 gap-y-2">
                {ex.chain.map((stage, i) => (
                  <li key={stage} className="flex items-center gap-2">
                    <span className="rounded-full bg-white ring-1 ring-violet-100 px-3 py-1 text-xs font-medium text-violet-700">
                      {stage}
                    </span>
                    {i < ex.chain.length - 1 && (
                      <span aria-hidden className="text-slate-300">&rarr;</span>
                    )}
                  </li>
                ))}
              </ol>
            </motion.article>
          ))}
        </motion.div>
        <p className="mt-8 text-center text-base text-slate-700 max-w-2xl mx-auto">
          These examples demonstrate how campaigns can support different stages of customer
          communication without treating every WhatsApp message as the same type of interaction.
        </p>
      </Section>

      {/* --------------------------- The five questions ----------------------- */}
      <Section tone="tinted">
        <SectionHead
          title={['Build a More Organized', 'WhatsApp Campaign Process']}
          lead={<p>A practical campaign process can be organized around five questions:</p>}
        />
        <div className="mt-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
          {PLANNER.map((p, i) => <Question key={p.q} {...p} i={i} />)}
        </div>
        <p className="mt-8 text-center text-base text-slate-700 max-w-2xl mx-auto">
          This keeps the campaign connected to the broader customer journey rather than treating
          message delivery as the final objective.
        </p>
      </Section>

      {/* --------------------------------- Why ------------------------------- */}
      <Section>
        <SectionHead title={['Why Businesses Use', 'WhatsApp Campaigns']} />
        <motion.div
          initial="hidden"
          whileInView="show"
          viewport={viewport}
          variants={stagger(0, 0.06)}
          className="mt-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5"
        >
          {WHY.map((w) => (
            <motion.div
              key={w.title}
              variants={item}
              whileHover={{ y: -5 }}
              transition={CARD_SPRING}
              className="h-full rounded-3xl bg-gradient-to-br from-violet-50/70 to-white ring-1 ring-violet-100 p-6"
            >
              <span className="grid h-10 w-10 place-items-center rounded-2xl bg-white text-violet-600 ring-1 ring-violet-200/70">
                <Sparkles className="h-5 w-5" />
              </span>
              <h3 className="mt-4 text-base font-bold text-slate-900">{w.title}</h3>
              <p className="mt-2 text-sm text-slate-700 leading-relaxed">{w.body}</p>
            </motion.div>
          ))}
        </motion.div>
      </Section>

      {/* ---------------------------- Responsible messaging ------------------- */}
      <Section tone="tinted">
        <SectionHead
          title={['Campaigns and Responsible', 'Business Messaging']}
          lead={(
            <>
              <p>
                Business messaging should be based on relevance, appropriate consent, and
                applicable platform requirements. Businesses should avoid sending unwanted or
                excessive communication.
              </p>
              <p>Before launching a campaign, consider:</p>
            </>
          )}
        />
        <CheckCards items={COMPLIANCE} columns={2} className="mt-10 max-w-5xl mx-auto" />
        <div className="mt-10 mx-auto max-w-2xl space-y-2 text-center">
          <p className="text-base text-slate-700">
            A good campaign is not simply one that reaches a large audience.
          </p>
          <p className="text-lg font-semibold text-slate-900">
            It is one that reaches the right audience with a relevant reason to communicate.
          </p>
        </div>
      </Section>

      {/* --------------------------- With ZunoPilot --------------------------- */}
      <Section>
        <SectionHead
          title={['WhatsApp Campaigns', 'With ZunoPilot']}
          lead={(
            <p>
              ZunoPilot brings campaign communication together with other capabilities that can
              support the customer journey.
            </p>
          )}
        />
        <div className="mt-10">
          <CommandCentre />
        </div>
        <p className="mt-8 text-center text-base text-slate-700 max-w-2xl mx-auto">
          This allows campaign communication to become part of a broader customer engagement
          strategy.
        </p>
      </Section>

      {/* ------------------------------- Who for ------------------------------ */}
      <Section tone="tinted">
        <SectionHead
          title={['Who Can Use', 'WhatsApp Campaigns?']}
          lead={(
            <p>
              WhatsApp campaigns can be useful for businesses that have an established customer
              relationship and a legitimate reason to communicate with their audience.
            </p>
          )}
        />
        <motion.ul
          initial="hidden"
          whileInView="show"
          viewport={viewport}
          variants={stagger(0, 0.04)}
          className="mt-10 flex flex-wrap justify-center gap-2 sm:gap-3 max-w-4xl mx-auto"
        >
          {INDUSTRIES.map((i) => (
            <motion.li
              key={i}
              variants={item}
              whileHover={{ y: -3 }}
              transition={CARD_SPRING}
              className="rounded-full bg-white ring-1 ring-slate-200 px-4 py-2 text-sm font-medium text-slate-800"
            >
              {i}
            </motion.li>
          ))}
        </motion.ul>
        <p className="mt-8 text-center text-sm text-slate-600 max-w-2xl mx-auto">
          The appropriate campaign strategy depends on the business model, audience, customer
          relationship, consent, and applicable WhatsApp requirements.
        </p>
      </Section>

      <FaqSection faqs={FAQS} />

      <CtaBand
        title={['Turn WhatsApp Outreach Into', 'Meaningful Customer Engagement']}
        body={[
          'A successful WhatsApp campaign is more than sending a message. It’s about reaching the right audience with a relevant reason to communicate and giving customers a clear next step.',
          'With ZunoPilot, businesses can organize WhatsApp campaigns and connect customer responses with the communication processes that follow.',
        ]}
      />

      <SiteFooter />
    </div>
  );
}

/**
 * A numbered stage of the campaign pipeline.
 *
 * The big ghosted numeral is what ties the five stages together visually and to the
 * stepper at the top of the page — without it, they are just five more bands.
 */
function Stage({
  n, eyebrow, title, lead, children, tone = 'white',
}: {
  n: string;
  eyebrow: string;
  title: string[];
  lead?: ReactNode;
  children: ReactNode;
  tone?: 'white' | 'tinted';
}) {
  return (
    <Section tone={tone}>
      <div className="relative">
        <span
          aria-hidden
          className="pointer-events-none absolute -top-6 left-0 text-7xl font-extrabold text-slate-100 select-none sm:text-8xl"
        >
          {n}
        </span>
        <div className="relative">
          <SectionHead eyebrow={eyebrow} title={title} lead={lead} />
          {children}
        </div>
      </div>
    </Section>
  );
}

/* -------------------------------------------------------------------------- */
/*                                    Copy                                     */
/* -------------------------------------------------------------------------- */

const PIPELINE = ['Audience', 'Campaign', 'Message', 'Delivery', 'Customer Response'];

const PURPOSES = [
  'Announce a product or service',
  'Promote an eligible offer',
  'Share business updates',
  'Reconnect with existing customers',
  'Invite customers to an event',
  'Promote a new launch',
  'Send relevant customer information',
  'Encourage customers to take a specific action',
];

const AUDIENCES = [
  'New prospects',
  'Existing customers',
  'Previous customers',
  'Customers interested in a particular offering',
  'Customers who requested information',
  'Customers eligible for a specific communication',
];

const OBJECTIVES = [
  { icon: Rocket, title: 'Product Announcement', body: 'Introduce a new product, service, feature, or business offering to an appropriate audience.' },
  { icon: Megaphone, title: 'Promotional Communication', body: 'Share an eligible promotion or offer with customers who have the appropriate consent and relationship with your business.' },
  { icon: Repeat, title: 'Customer Re-Engagement', body: 'Reconnect with customers when there is a legitimate and relevant reason to communicate.' },
  { icon: CalendarDays, title: 'Event Invitations', body: 'Invite customers to webinars, launches, appointments, events, or other business activities.' },
  { icon: Info, title: 'Business Updates', body: 'Deliver important information that customers need to know.' },
  { icon: Target, title: 'Lead Nurturing', body: 'Continue relevant communication with prospects as they move through the customer journey.' },
];

const MESSAGE_PARTS = [
  'A clear reason for the message',
  'Relevant customer context',
  'The main benefit or information',
  'A straightforward next step',
  'Appropriate business identification',
  'A clear call to action where applicable',
];

const RELEVANCE: readonly (readonly [string, string])[] = [
  ['New customer', 'Welcome or introductory communication'],
  ['Existing customer', 'Relevant product or service update'],
  ['Interested prospect', 'Information related to their previous enquiry'],
  ['Returning customer', 'Relevant re-engagement communication'],
];

const CAMPAIGN_TYPES: readonly (readonly [string, string, string?])[] = [
  ['New Product Launch', 'Introduce an offering'],
  ['Customer Update', 'Share important information'],
  ['Event Invitation', 'Encourage registrations'],
  ['Lead Follow-Up', 'Continue prospect communication'],
  ['Re-Engagement', 'Reconnect with relevant customers'],
  ['Promotional Campaign', 'Communicate an eligible offer'],
];

const CALLS_TO_ACTION = [
  'Learn more',
  'Contact the business',
  'Request information',
  'Book an appointment',
  'Visit a relevant page',
  'Respond to the message',
  'Speak with a sales representative',
  'Register for an event',
];

/*
 * Six teams, not five. **"Support Teams" is the added one** — every campaign produces replies,
 * and the team that answers them is the one the list left out.
 */
const TEAMS = [
  { icon: Megaphone, title: 'Marketing Teams', body: 'Plan customer outreach around launches, announcements, promotions, and engagement activities.' },
  { icon: Target, title: 'Sales Teams', body: 'Use relevant campaigns to support prospect communication and follow-up activities.' },
  { icon: Users, title: 'Customer Success Teams', body: 'Share useful updates and maintain communication with existing customers.' },
  { icon: ClipboardList, title: 'Operations Teams', body: 'Communicate relevant business information to appropriate customer groups.' },
  { icon: Headphones, title: 'Support Teams', body: 'Handle the replies a campaign produces, in the same shared inbox as every other conversation.' },
  { icon: Building2, title: 'Business Owners', body: 'Bring customer outreach into a more organized WhatsApp communication process.' },
];

const EXAMPLES = [
  {
    title: 'Product Launch Campaign',
    body: 'A business introduces a new offering.',
    chain: ['Audience', 'Product announcement', 'Customer interest', 'Follow-up conversation'],
  },
  {
    title: 'Event Campaign',
    body: 'A business wants to invite relevant customers to an upcoming event.',
    chain: ['Audience', 'Invitation', 'Customer response', 'Registration or team follow-up'],
  },
  {
    title: 'Customer Update',
    body: 'A business needs to communicate an important update to existing customers.',
    chain: ['Relevant audience', 'Business update', 'Customer response', 'Assistance if required'],
  },
  {
    title: 'Re-Engagement Campaign',
    body: 'A business wants to reconnect with customers where there is a legitimate and relevant reason to communicate.',
    chain: ['Relevant audience', 'Re-engagement message', 'Customer response', 'Continue conversation'],
  },
];

const PLANNER = [
  { q: 'Who?', label: 'Identify the audience', body: 'Identify the appropriate customer audience.' },
  { q: 'Why?', label: 'Define the purpose', body: 'Define the purpose of the communication.' },
  { q: 'What?', label: 'Write the message', body: 'Create a message that provides relevant information.' },
  { q: 'When?', label: 'Choose the timing', body: 'Choose an appropriate campaign timing based on the audience and business objective.' },
  { q: 'What Next?', label: 'Plan the response', body: 'Determine what should happen when customers respond.' },
  /*
   * **The added question, and the one most often skipped.** Frequency is the difference between
   * a campaign programme customers tolerate and one they mute — and unlike the other five, getting
   * it wrong costs the channel rather than the campaign.
   */
  { q: 'How Often?', label: 'Decide the frequency', body: 'Decide how often this audience should hear from you, so campaigns stay welcome rather than becoming noise.' },
];

const WHY = [
  { title: 'Reach Customers Through a Familiar Channel', body: 'WhatsApp can be an effective communication channel for businesses that already interact with customers through the platform.' },
  { title: 'Organize Customer Outreach', body: 'Campaigns provide a structured way to plan communication around specific objectives.' },
  { title: 'Improve Message Relevance', body: 'Audience-focused communication helps businesses avoid sending identical messages to unrelated customer groups.' },
  { title: 'Support Customer Engagement', body: 'Campaigns can create opportunities for customers to respond and continue conversations.' },
  { title: 'Connect Marketing With Sales', body: 'Campaign responses can become opportunities for sales teams to engage with interested customers.' },
  { title: 'Create Repeatable Campaign Processes', body: 'A structured campaign approach can make future customer outreach easier to plan and manage.' },
];

const COMPLIANCE = [
  'Whether the recipient has provided the required consent',
  'Whether the communication is relevant to the recipient',
  'Whether the message follows applicable WhatsApp requirements',
  'Whether the appropriate message format or template is required',
  'Whether customers have appropriate ways to manage their communication preferences',
  // Added: having a preference mechanism and acting on it are two different things, and it is
  // the second one the platform's requirements are actually about.
  'Whether opt-out requests are honoured promptly and recorded',
];

const STACK = [
  { title: 'WhatsApp Campaigns', body: 'For planned customer outreach.' },
  { title: 'WhatsApp Automation', body: 'For recurring business communication.' },
  { title: 'AI WhatsApp Automation', body: 'For AI-assisted customer interactions.' },
  { title: 'WhatsApp Team Inbox', body: 'For conversations that require team involvement.' },
  { title: 'WhatsApp Number Masking', body: 'For controlled business-facing communication where supported.' },
];

const INDUSTRIES = [
  'Ecommerce businesses',
  'Service providers',
  'Restaurants',
  'Education businesses',
  'Real estate businesses',
  'Travel businesses',
  'Professional services',
  'Subscription businesses',
  'Growing customer-facing companies',
];

const FAQS = [
  {
    question: 'What are WhatsApp campaigns?',
    answer:
      'WhatsApp campaigns are planned customer communication activities delivered through '
      + 'WhatsApp for a defined business objective, such as product announcements, customer '
      + 'updates, event invitations, lead nurturing, or relevant promotional communication.',
  },
  {
    question: 'What can businesses use WhatsApp campaigns for?',
    answer:
      'Businesses can use WhatsApp campaigns for appropriate customer outreach such as product '
      + 'launches, business announcements, event invitations, customer engagement, lead '
      + 'communication, and eligible promotional messages.',
  },
  {
    question: 'How are WhatsApp campaigns different from WhatsApp automation?',
    answer:
      'WhatsApp campaigns are generally designed around planned communication to a defined '
      + 'audience, while WhatsApp automation focuses on recurring processes and automated '
      + 'customer interactions. The two can work together.',
  },
  {
    question: 'Can WhatsApp campaigns generate leads?',
    answer:
      'Campaigns can encourage interested customers to respond or take a relevant action, which '
      + 'may create opportunities for sales teams to continue the conversation and qualify '
      + 'prospects.',
  },
  {
    question: 'Can WhatsApp campaigns be personalized?',
    answer:
      'Campaign personalization depends on the available platform capabilities, customer '
      + 'information, audience setup, and message configuration. Businesses should use customer '
      + 'information appropriately and only for permitted purposes.',
  },
  {
    question: 'Can AI be used with WhatsApp campaigns?',
    answer:
      'Yes. AI can assist with suitable customer conversations that occur after campaign '
      + 'communication. For example, AI may help with routine questions or other configured '
      + 'interactions while complex conversations can involve a team member.',
  },
  {
    question: 'Can WhatsApp campaigns be combined with automation?',
    answer:
      'Yes. A campaign can initiate customer outreach while automation handles suitable '
      + 'follow-up processes or recurring communication.',
  },
  {
    question: 'Can multiple team members manage campaign responses?',
    answer:
      'Where supported by the configured ZunoPilot setup, campaign responses can be handled '
      + 'through team communication capabilities such as the WhatsApp Team Inbox.',
  },
  {
    question: 'Are WhatsApp marketing campaigns allowed?',
    answer:
      'Businesses must comply with applicable WhatsApp Business policies, messaging '
      + 'requirements, consent rules, and template requirements where applicable. Campaigns '
      + 'should only be sent to appropriate recipients under the applicable requirements.',
  },
  {
    question: 'How should businesses plan a WhatsApp campaign?',
    answer:
      'Start by defining the campaign objective, identifying the appropriate audience, creating '
      + 'relevant communication, determining the desired customer action, choosing suitable '
      + 'timing, and planning how responses will be handled.',
  },
];
