import type { ComponentType } from 'react';
import { Link } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import {
  Bot, Building2, ClipboardCheck, Clock, Eye, Headphones, Megaphone, MessageSquare,
  NotebookPen, Plug, Repeat, ShieldCheck, Target, TrendingUp, UserCheck, Users, Workflow,
} from 'lucide-react';
import { useDocumentHead } from '@/lib/document-head';
import { PAGE_HEADS } from '@/lib/page-heads';
import { useBreadcrumbSchema } from '@/lib/json-ld';
import type { FaqEntry } from '@/lib/json-ld';
import SiteHeader from '@/components/marketing/SiteHeader';
import SiteFooter from '@/components/marketing/SiteFooter';
import {
  ArrowLink, CARD_SPRING, CtaBand, EASE_OUT, FaqSection, PageHero, ScrollProgress,
  Section, SectionHead, item, stagger, viewport,
} from '@/components/marketing/primitives';
import { IconTitle, Reveal } from '@/components/marketing/motion-kit';

/*
 * /features/whatsapp-team-inbox
 *
 * **The design idea is people working on the same thing at once.** Every other feature page
 * draws a system: a pipeline, a stack, a routing path. This page is the one whose subject is
 * *humans*, so its figures have named agents in them — a live roster with presence, one
 * conversation card that visibly belongs to somebody, and a handover drawn as two lanes with
 * the conversation crossing between them.
 *
 * Where its siblings sit:
 *   • whatsapp-automation      — numbered rails and scenario cards
 *   • ai-whatsapp-automation   — quoted utterances, comparison table
 *   • whatsapp-number-masking  — paired contact-path diagrams
 *   • whatsapp-campaigns       — a horizontal pipeline and message mockups
 *   • whatsapp-business-api    — layered slabs and dark system flows
 *   • this page                — agent lanes, presence, and an assignment board
 *
 * The two people in the figures are named Priya and Arjun and are the same two people
 * throughout, which is not decoration: "someone else already replied" only lands if the
 * reader can see it is a *specific* someone. They are illustrative staff, not customers, and
 * no claim is attached to them.
 *
 * The related-pages section at the bottom is a deliberate exception to how the rest of the
 * site links out. Team Inbox is the page the other five converge on — automation and AI hand
 * conversations *to* people — so it is drawn as a hub with real links on every spoke rather
 * than as a list of two "see also" chips.
 */

/* -------------------------------------------------------------------------- */
/*                          Page-local design devices                          */
/* -------------------------------------------------------------------------- */

interface Agent { name: string; initials: string; role: string; online: boolean }

const AGENTS: readonly Agent[] = [
  { name: 'Priya', initials: 'PR', role: 'Support', online: true },
  { name: 'Arjun', initials: 'AR', role: 'Support', online: true },
  { name: 'Meera', initials: 'ME', role: 'Sales', online: true },
  { name: 'Dev', initials: 'DV', role: 'Service', online: false },
];

/**
 * The roster: who is on, drawn as overlapping avatars.
 *
 * Presence is the one thing a shared inbox has that four phones do not, so it is stated
 * first and stated visually. The "on" dot pulses; the off-shift one does not, which is the
 * whole distinction the figure is making.
 */
function Roster({ agents }: { agents: readonly Agent[] }) {
  const reduce = useReducedMotion();
  return (
    <div className="flex items-center gap-3">
      <ul className="flex -space-x-2">
        {agents.map((agent, i) => (
          <motion.li
            key={agent.name}
            initial={{ opacity: 0, scale: 0.8 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={viewport}
            transition={{ duration: 0.4, delay: i * 0.07, ease: EASE_OUT }}
            whileHover={{ y: -3, zIndex: 10 }}
            className="relative"
          >
            <span
              title={`${agent.name} — ${agent.role}`}
              className="grid h-10 w-10 place-items-center rounded-full bg-violet-100 text-[12px] font-bold text-violet-700 ring-2 ring-white"
            >
              {agent.initials}
            </span>
            <span
              aria-hidden
              className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full ring-2 ring-white ${
                agent.online ? 'bg-violet-600' : 'bg-slate-300'
              }`}
            />
            {agent.online && !reduce && (
              <motion.span
                aria-hidden
                initial={{ opacity: 0.6, scale: 1 }}
                animate={{ opacity: 0, scale: 2.2 }}
                transition={{ duration: 1.8, repeat: Infinity, ease: 'easeOut', delay: i * 0.4 }}
                className="pointer-events-none absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-violet-500"
              />
            )}
          </motion.li>
        ))}
      </ul>
      <p className="text-[13px] font-medium text-slate-700">
        <span className="font-bold text-slate-900">3 agents on</span>
        {' · '}
        1 off shift
      </p>
    </div>
  );
}

/**
 * One customer conversation, as the team sees it.
 *
 * The point of the figure is the *chrome around* the message, not the message: who owns it,
 * that somebody is typing, that there is a note nobody outside the team can read. A screenshot
 * of a chat would have shown none of that, because none of it is in the chat.
 */
function ConversationCard() {
  const reduce = useReducedMotion();
  return (
    <Reveal className="rounded-3xl bg-white ring-1 ring-slate-200 shadow-lg shadow-violet-100/60 overflow-hidden">
      {/* Header: the customer, and who has it. */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/80 px-5 py-3.5">
        <div className="flex items-center gap-3">
          <span aria-hidden className="grid h-9 w-9 place-items-center rounded-full bg-slate-200 text-[11px] font-bold text-slate-600">
            RK
          </span>
          <div>
            <p className="text-sm font-bold text-slate-900">Ravi Kumar</p>
            <p className="text-[12px] text-slate-600">WhatsApp · returning customer</p>
          </div>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-violet-600 px-3 py-1.5 text-[12px] font-semibold text-white">
          <UserCheck aria-hidden className="h-3.5 w-3.5" />
          Assigned to Priya
        </span>
      </div>

      {/* The conversation. Two bubbles, deliberately not WhatsApp green. */}
      <div className="space-y-3 px-5 py-5">
        <div className="max-w-[85%] rounded-2xl rounded-tl-sm bg-slate-100 px-4 py-3">
          <p className="text-[14px] text-slate-800">Hi, I still haven&rsquo;t received my order from Tuesday.</p>
        </div>
        <div className="ml-auto max-w-[85%] rounded-2xl rounded-tr-sm bg-violet-600 px-4 py-3">
          <p className="text-[14px] text-white">
            Thanks for checking in, Ravi — let me pull up that order now.
          </p>
        </div>

        {/* Typing indicator: the thing that stops a second agent starting a duplicate reply. */}
        <div className="flex items-center gap-2 pl-1">
          <span aria-hidden className="flex gap-1">
            {[0, 1, 2].map((d) => (
              <motion.span
                key={d}
                animate={reduce ? undefined : { opacity: [0.25, 1, 0.25] }}
                transition={{ duration: 1.1, repeat: Infinity, delay: d * 0.18 }}
                className="h-1.5 w-1.5 rounded-full bg-violet-400"
              />
            ))}
          </span>
          <p className="text-[12px] font-medium text-slate-600">Priya is replying</p>
        </div>
      </div>

      {/* The internal note. Dashed, because it is the one thing that never leaves the team. */}
      <div className="border-t border-dashed border-violet-200 bg-violet-50/50 px-5 py-3.5">
        <p className="flex items-start gap-2 text-[13px] text-slate-700">
          <NotebookPen aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-violet-500" />
          <span>
            <span className="font-semibold text-slate-900">Internal note · Arjun:</span>
            {' '}
            Courier delay on this route — offer the replacement dispatch.
            <span className="ml-1.5 rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-violet-700 ring-1 ring-violet-200">
              not sent to customer
            </span>
          </span>
        </p>
      </div>
    </Reveal>
  );
}

/**
 * The handover, as two lanes with the conversation crossing between them.
 *
 * A left-to-right arrow would have said "then Arjun replied". Lanes say something more
 * specific and more useful: the conversation is one object, it was in one person's lane and
 * is now in another's, and its history came with it.
 */
function HandoverLanes() {
  const reduce = useReducedMotion();
  const lanes = [
    {
      agent: 'Priya · Support',
      stage: 'Picks up the enquiry',
      body: 'Answers the first question and records what the customer actually wants.',
      icon: MessageSquare,
    },
    {
      agent: 'Arjun · Senior support',
      stage: 'Takes it from here',
      body: 'Opens the same conversation with the full history and the internal note already attached.',
      icon: Repeat,
    },
  ];

  return (
    <div className="relative grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-8">
      {/* The crossing. Only drawn where there are two columns to cross between. */}
      <span
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/2 hidden h-px w-8 -translate-x-1/2 -translate-y-1/2 overflow-hidden bg-gradient-to-r from-violet-300 via-violet-500 to-violet-300 md:block"
      >
        <motion.span
          animate={reduce ? undefined : { x: ['-30%', '130%'] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: 'linear' }}
          className="absolute top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-violet-600"
        />
      </span>

      {lanes.map((lane, i) => (
        <Reveal key={lane.agent} delay={i * 0.12} className="h-full">
          <div
            className={`h-full rounded-3xl p-6 ring-1 ${
              i === 1 ? 'bg-violet-50/70 ring-violet-200' : 'bg-white ring-slate-200'
            }`}
          >
            <p className="text-[11px] font-bold uppercase tracking-widest text-violet-600">
              Lane {i + 1}
            </p>
            <p className="mt-2 text-sm font-bold text-slate-900">{lane.agent}</p>
            <IconTitle icon={lane.icon} as="p" className="mt-4 text-base font-bold text-slate-900">
              {lane.stage}
            </IconTitle>
            <p className="mt-3 text-[15px] text-slate-700 leading-relaxed">{lane.body}</p>
          </div>
        </Reveal>
      ))}
    </div>
  );
}

/**
 * The ecosystem: Team Inbox in the middle, the five sibling features around it.
 *
 * Replaces a "Related pages" list of chips. The reason it is worth the extra markup is that
 * it says something true about the product — automation, AI and campaigns all end up handing
 * a conversation to a person, and this is the page about that person. Every spoke is a real
 * link with descriptive anchor text, so it is navigation first and a diagram second.
 */
function Ecosystem({
  spokes,
}: {
  spokes: readonly { label: string; href: string; blurb: string; icon: ComponentType<{ className?: string }> }[];
}) {
  const reduce = useReducedMotion();
  return (
    <div className="relative mx-auto max-w-5xl">
      <motion.ul
        initial="hidden"
        whileInView="show"
        viewport={viewport}
        variants={stagger(0.05, 0.07)}
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 sm:gap-4"
      >
        {/* The hub, sitting in the middle cell on a three-column grid. */}
        <motion.li variants={item} className="lg:order-2">
          <div className="relative h-full overflow-hidden rounded-3xl bg-slate-900 p-6 text-center ring-1 ring-white/10">
            <span
              aria-hidden
              className="pointer-events-none absolute -top-12 left-1/2 h-40 w-40 -translate-x-1/2 rounded-full bg-violet-500/25 blur-3xl"
            />
            {!reduce && (
              <motion.span
                aria-hidden
                initial={{ opacity: 0.35, scale: 0.9 }}
                animate={{ opacity: 0, scale: 1.5 }}
                transition={{ duration: 2.4, repeat: Infinity, ease: 'easeOut' }}
                className="pointer-events-none absolute inset-6 rounded-full ring-1 ring-violet-400"
              />
            )}
            <span aria-hidden className="relative mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-violet-600 text-white">
              <Users className="h-6 w-6" />
            </span>
            <p className="relative mt-4 text-base font-bold text-white">WhatsApp Team Inbox</p>
            <p className="relative mt-2 text-[13px] text-slate-300 leading-relaxed">
              Where the other five end up: a person, holding one conversation, with the context
              already attached.
            </p>
            <div className="relative mt-4">
              <Roster agents={AGENTS.slice(0, 3)} />
            </div>
          </div>
        </motion.li>

        {spokes.map((spoke, i) => (
          <motion.li
            key={spoke.href}
            variants={item}
            className={i < 2 ? 'lg:order-1' : 'lg:order-3'}
          >
            <Link to={spoke.href} className="group block h-full">
              <motion.div
                whileHover={{ y: -4, boxShadow: '0 20px 44px -20px rgb(96 73 231 / 0.3)' }}
                transition={CARD_SPRING}
                className="h-full rounded-3xl bg-white p-5 ring-1 ring-slate-200/80"
              >
                <IconTitle icon={spoke.icon} as="p" size="sm" className="text-[15px] font-bold text-slate-900">
                  {spoke.label}
                </IconTitle>
                <p className="mt-3 text-[14px] text-slate-700 leading-relaxed">{spoke.blurb}</p>
                <p className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-semibold text-violet-600">
                  Explore {spoke.label}
                  <span aria-hidden className="transition-transform duration-200 group-hover:translate-x-1">&rarr;</span>
                </p>
              </motion.div>
            </Link>
          </motion.li>
        ))}
      </motion.ul>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                                    Copy                                     */
/* -------------------------------------------------------------------------- */

const CRUMBS = [
  { name: 'Home', path: '/' },
  { name: 'Features', path: '/features' },
  { name: 'WhatsApp Team Inbox', path: '/features/whatsapp-team-inbox' },
];

/** What the inbox gives agents. Kept as the copy had it, one icon added per line. */
const GIVES = [
  { text: 'One place where every customer conversation is visible', icon: Eye },
  { text: 'Clear ownership, so two people do not answer the same message', icon: UserCheck },
  { text: 'Internal notes that stay internal', icon: NotebookPen },
  { text: 'Handover with the conversation history intact', icon: Repeat },
  { text: 'A way to escalate what needs a more senior person', icon: TrendingUp },
  { text: 'Coverage across shifts without losing the thread', icon: Clock },
] as const;

const CHANGES = [
  {
    icon: UserCheck,
    title: 'No Duplicate Replies',
    body: 'A conversation someone is already handling is visible as such to everyone else.',
  },
  {
    icon: Eye,
    title: 'Nothing Falls Through',
    body: 'An unanswered conversation is a state the team can see rather than something someone has to remember.',
  },
  {
    icon: NotebookPen,
    title: 'Internal Notes',
    body: 'Context for the next agent, recorded on the conversation and never sent to the customer.',
  },
  {
    icon: ShieldCheck,
    title: 'Human Takeover',
    body: 'An agent can step into an automated conversation the moment judgment is needed.',
  },
  {
    icon: Clock,
    title: 'Shift Handover',
    body: 'The next shift picks up conversations mid-flight instead of starting from the customer’s last message.',
  },
  {
    icon: TrendingUp,
    title: 'Team Performance in View',
    body: 'Analytics show how conversations are being handled across the team.',
  },
] as const;

/**
 * Who it is for.
 *
 * Five of these came from the existing copy; **"Shift-Based Teams" is the sixth**, added
 * because the capability list already promises coverage across shifts and the audience list
 * did not name the teams that need it. It claims nothing the page did not already claim.
 */
const DESIGNED_FOR = [
  {
    icon: Headphones,
    title: 'Customer Support Teams',
    body: 'Multiple agents answering the same queue of incoming requests.',
  },
  {
    icon: Target,
    title: 'Sales Teams',
    body: 'Representatives sharing inbound enquiries and passing qualified ones on.',
  },
  {
    icon: ClipboardCheck,
    title: 'Service Teams',
    body: 'Coordinating bookings, visits and follow-ups across staff.',
  },
  {
    icon: Users,
    title: 'Multi-Agent Operations',
    body: 'Any business where more than two people answer customers.',
  },
  {
    icon: Clock,
    title: 'Shift-Based Teams',
    body: 'Teams working in rotations, where the conversation has to outlive the shift that started it.',
  },
  {
    icon: Building2,
    title: 'Growing Businesses',
    body: 'Teams adding agents faster than they can add process.',
  },
] as const;

const SPOKES = [
  {
    label: 'WhatsApp Automation',
    href: '/features/whatsapp-automation',
    blurb: 'Handles the routine exchanges, then hands anything that needs a decision to the inbox.',
    icon: Workflow,
  },
  {
    label: 'AI WhatsApp Automation',
    href: '/features/ai-whatsapp-automation',
    blurb: 'Reads what the customer actually asked, so the agent who picks it up starts with context.',
    icon: Bot,
  },
  {
    label: 'WhatsApp Campaigns',
    href: '/features/whatsapp-campaigns',
    blurb: 'Starts the outreach; the replies arrive here as conversations rather than as a report.',
    icon: Megaphone,
  },
  {
    label: 'WhatsApp Number Masking',
    href: '/features/whatsapp-number-masking',
    blurb: 'Keeps the business number the customer-facing one, whichever agent is replying.',
    icon: ShieldCheck,
  },
  {
    label: 'WhatsApp Business API',
    href: '/features/whatsapp-business-api',
    blurb: 'The connection underneath, so conversations reach the systems the rest of the business runs on.',
    icon: Plug,
  },
] as const;

const FAQS: readonly FaqEntry[] = [
  {
    question: 'What is a WhatsApp team inbox?',
    answer:
      'A WhatsApp team inbox is a shared environment where multiple authorized agents manage '
      + 'customer conversations together, with visibility over who is handling what.',
  },
  {
    question: 'Can multiple agents reply from the same WhatsApp number?',
    answer:
      'Yes. Authorized team members can manage and collaborate on conversations connected to your '
      + 'business WhatsApp from one shared workspace.',
  },
  {
    question: 'How do you stop two agents answering the same customer?',
    answer:
      'Conversations are managed in one shared view, so a conversation another agent is already '
      + 'handling is visible to the rest of the team rather than hidden on their device.',
  },
  {
    question: 'Can a human take over from automation?',
    answer:
      'Yes. Automated and AI-assisted conversations can be handed to a team member when a '
      + 'customer needs judgment, negotiation or detailed help.',
  },
  {
    question: 'Are internal notes visible to customers?',
    answer:
      'No. Internal notes are for your team and are not sent to the customer.',
  },
];

/* -------------------------------------------------------------------------- */
/*                                   Page                                      */
/* -------------------------------------------------------------------------- */

export default function TeamInbox() {
  useDocumentHead(PAGE_HEADS.teamInbox);
  useBreadcrumbSchema(CRUMBS);

  return (
    <div className="min-h-screen bg-white">
      <ScrollProgress />
      <SiteHeader />

      <PageHero
        crumbs={CRUMBS}
        title={['A WhatsApp Team Inbox That', 'Keeps Agents Out of Each Other’s Way']}
        intro={[
          'As your business grows, multiple employees need to respond to customers through WhatsApp. Without a structured approach, conversations get missed, answered twice, or handled by the wrong person.',
          'The ZunoPilot Team Inbox gives authorized users a shared environment for managing customer conversations and coordinating who is responding to what.',
        ]}
      />

      {/* --------------- The board: one conversation, a whole team ------------- */}
      <Section tone="tinted">
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-2 lg:gap-14 items-start">
          <div>
            <SectionHead
              align="left"
              eyebrow="One conversation, seen by everyone"
              title={['What Your Team Sees', 'Instead of Four Phones']}
              lead={(
                <p>
                  The conversation is the same one the customer is having. What changes is
                  everything around it — who owns it, who is already typing, and what the last
                  agent knew.
                </p>
              )}
            />
            <div className="mt-6">
              <Roster agents={AGENTS} />
            </div>
            <ul className="mt-8 space-y-3">
              {GIVES.map((give) => (
                <Reveal as="li" key={give.text} className="flex items-start gap-3">
                  <span
                    aria-hidden
                    className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white text-violet-600 ring-1 ring-violet-200"
                  >
                    <give.icon className="h-4 w-4" />
                  </span>
                  <span className="text-[15px] font-medium text-slate-800 leading-relaxed">
                    {give.text}
                  </span>
                </Reveal>
              ))}
            </ul>
          </div>
          <ConversationCard />
        </div>
      </Section>

      {/* ----------------- What changes when agents share one ------------------ */}
      <Section>
        <SectionHead
          title={['What Changes When Agents', 'Share an Inbox']}
          lead={(
            <p>
              Six things stop being somebody&rsquo;s job to remember and start being a state the
              team can see.
            </p>
          )}
        />
        <motion.ul
          initial="hidden"
          whileInView="show"
          viewport={viewport}
          variants={stagger(0, 0.07)}
          className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 sm:gap-5"
        >
          {CHANGES.map((change) => (
            <motion.li
              key={change.title}
              variants={item}
              whileHover={{ y: -6, boxShadow: '0 22px 48px -20px rgb(96 73 231 / 0.3)' }}
              transition={CARD_SPRING}
              className="group h-full rounded-3xl bg-white p-6 ring-1 ring-slate-200/80"
            >
              <IconTitle icon={change.icon} className="text-lg font-bold text-slate-900">
                {change.title}
              </IconTitle>
              <p className="mt-3 text-[15px] text-slate-700 leading-relaxed">{change.body}</p>
            </motion.li>
          ))}
        </motion.ul>
      </Section>

      {/* --------------------------- The handover ----------------------------- */}
      <Section tone="tinted">
        <SectionHead
          eyebrow="Handover without starting again"
          title={['A Conversation Can Change Hands', 'Without Changing Story']}
          lead={(
            <p>
              Escalation and shift change are the same problem: somebody new has to continue a
              conversation they did not start.
            </p>
          )}
        />
        <div className="mt-10">
          <HandoverLanes />
        </div>
        <p className="mt-8 mx-auto max-w-3xl text-center text-base font-medium text-slate-800 leading-relaxed">
          The customer is not asked to repeat anything, because nothing about the conversation
          was ever stored on one agent&rsquo;s phone.
        </p>
      </Section>

      {/* ---------------------------- Designed for ---------------------------- */}
      <Section>
        <SectionHead title={['Designed For']} />
        <motion.ul
          initial="hidden"
          whileInView="show"
          viewport={viewport}
          variants={stagger(0, 0.06)}
          className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 sm:gap-5"
        >
          {DESIGNED_FOR.map((who) => (
            <motion.li
              key={who.title}
              variants={item}
              whileHover={{ y: -5 }}
              transition={CARD_SPRING}
              className="group h-full rounded-3xl bg-gradient-to-br from-violet-50 via-white to-white p-6 ring-1 ring-violet-200/70"
            >
              <IconTitle icon={who.icon} className="text-base font-bold text-slate-900">
                {who.title}
              </IconTitle>
              <p className="mt-3 text-[15px] text-slate-700 leading-relaxed">{who.body}</p>
            </motion.li>
          ))}
        </motion.ul>
      </Section>

      {/* --------------------------- The ecosystem ---------------------------- */}
      <Section tone="tinted">
        <SectionHead
          eyebrow="Where the other features hand off"
          title={['The Team Inbox Is Where', 'Everything Else Lands']}
          lead={(
            <p>
              Automation, AI and campaigns all reach a point where a person should take over.
              This is that point — so these five pages are worth reading next.
            </p>
          )}
        />
        <div className="mt-10">
          <Ecosystem spokes={SPOKES} />
        </div>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-x-8 gap-y-3">
          <ArrowLink to="/solutions/customer-support">WhatsApp customer support</ArrowLink>
          <ArrowLink to="/pricing">See pricing</ArrowLink>
        </div>
      </Section>

      <FaqSection faqs={FAQS} />

      <CtaBand
        title={['Give Your Agents', 'One Inbox']}
        body={['Coordinate customer conversations across your team instead of across their phones.']}
      />

      <SiteFooter />
    </div>
  );
}
