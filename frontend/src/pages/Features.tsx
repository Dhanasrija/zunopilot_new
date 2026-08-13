import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import {
  ArrowRight, Bot, Building2, ClipboardList, Clock, HeartHandshake, Headphones,
  LayoutGrid, Megaphone, MessageSquare, Repeat, ShieldCheck, Target, TrendingUp,
  UserRound, Users, Workflow, Wrench,
} from 'lucide-react';
import { useDocumentHead } from '@/lib/document-head';
import { PAGE_HEADS } from '@/lib/page-heads';
import SiteHeader from '@/components/marketing/SiteHeader';
import SiteFooter from '@/components/marketing/SiteFooter';
import {
  ArrowLink, CARD_SPRING, CheckList, CtaBand, EASE_OUT, FaqSection, MatchTable, PageHero,
  ScrollProgress, Section, SectionHead, TileGrid, viewport
} from '@/components/marketing/primitives';
import { IconTitle, Reveal, useTravellingIndex } from '@/components/marketing/motion-kit';
import type { FlowNode } from '@/components/marketing/motion-kit';

/*
 * /features — the hub.
 *
 * Seven capabilities, each with a short section here and a page of its own. The hub
 * carries the overview and the disambiguation ("which of these do I actually want?");
 * the detail pages carry the depth. Splitting it that way is what keeps this page from
 * becoming a nine-thousand-word wall that ranks for nothing in particular — each
 * detail page can target its own term, and this one targets the category.
 *
 * All seven have a page. The two longest have components of their own; the rest are
 * rendered by `pages/DetailPage.tsx` from the copy in `lib/marketing-content.ts`. Every
 * one is indexable and in the sitemap — there are no placeholder routes in this tree.
 */

interface FeatureBlockProps {
  id: string;
  eyebrow: string;
  title: string[];
  body: ReactNode;
  listLabel: string;
  list: readonly string[];
  href: string;
  cta: string;
  tone?: 'white' | 'tinted';
  flip?: boolean;
}

/** One capability: heading, prose, a labelled list, and the link to its own page. */
function FeatureBlock({
  id, eyebrow, title, body, listLabel, list, href, cta, tone = 'white', flip = false,
}: FeatureBlockProps) {
  return (
    <Section id={id} tone={tone}>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-16 items-start">
        <div className={flip ? 'lg:order-2' : ''}>
          <SectionHead align="left" eyebrow={eyebrow} title={title} lead={body} />
          <div className="mt-8">
            <ArrowLink to={href}>{cta}</ArrowLink>
          </div>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={viewport}
          transition={{ duration: 0.6, ease: EASE_OUT }}
          className={`rounded-3xl bg-white ring-1 ring-slate-200/80 p-6 sm:p-8 ${flip ? 'lg:order-1' : ''}`}
        >
          <p className="text-base font-semibold text-slate-900">{listLabel}</p>
          <CheckList items={list} columns={1} className="mt-5" />
        </motion.div>
      </div>
    </Section>
  );
}

export default function Features() {
  useDocumentHead(PAGE_HEADS.features);

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <ScrollProgress />
      <SiteHeader />

      <PageHero
        title={['Powerful WhatsApp Automation', 'Features for Your Business']}
        intro={[
          'ZunoPilot gives businesses the tools to manage customer communication, automate repetitive WhatsApp activities, collaborate across teams, and build more connected communication workflows.',
          'From AI-assisted interactions and shared conversations to number masking and campaigns, ZunoPilot brings the capabilities businesses need to manage WhatsApp more effectively.',
        ]}
      />

      {/* ------------------------------ Overview ------------------------------ */}
      <Section tone="tinted">
        <SectionHead
          title={['Everything You Need to', 'Work Smarter on WhatsApp']}
          lead={(
            <>
              <p>
                Business communication can quickly become difficult to manage when messages,
                follow-ups, campaigns, and customer conversations are handled manually.
              </p>
              <p>
                ZunoPilot brings these activities into a structured environment where teams can
                combine automation with human interaction.
              </p>
              <p>
                Whether you&rsquo;re managing leads, answering customers, following up on
                enquiries, or running campaigns, the platform provides features designed around
                real business communication needs.
              </p>
            </>
          )}
        />
        <div className="mt-10 max-w-4xl mx-auto rounded-3xl bg-white ring-1 ring-slate-200/80 p-6 sm:p-8">
          <p className="text-base font-semibold text-slate-900">With ZunoPilot, you can:</p>
          <CheckList items={CAPABILITIES} className="mt-5" />
        </div>
      </Section>

      <Section>
        <SectionHead title={["Explore ZunoPilot's WhatsApp", 'Automation Features']} />
      </Section>

      {/* --------------------------- The seven blocks -------------------------- */}
      <FeatureBlock
        id="whatsapp-automation"
        tone="tinted"
        eyebrow="WhatsApp Business Automation"
        title={['Turn Repetitive Communication', 'Into Automated Workflows']}
        body={(
          <>
            <p>
              Many businesses spend valuable time sending follow-ups, answering recurring
              questions, sharing updates, and managing routine customer communication.
            </p>
            <p>
              ZunoPilot helps convert these repetitive activities into structured WhatsApp
              workflows.
            </p>
            <p>
              Create processes around the communication your business performs regularly,
              allowing your team to spend less time on repetitive tasks and more time on
              customer interactions that require attention.
            </p>
          </>
        )}
        listLabel="Use it for:"
        list={[
          'Lead follow-ups',
          'Customer enquiries',
          'Reminders',
          'Notifications',
          'Recurring communication',
          'Workflow-based responses',
          'Appointment and booking confirmations',
          'Order and status updates',
          'Post-purchase follow-up',
          'Repeat-customer re-engagement',
          'Internal handover between team members',
        ]}
        href="/features/whatsapp-automation"
        cta="Explore WhatsApp Automation"
      />

      <FeatureBlock
        id="ai-whatsapp-automation"
        flip
        eyebrow="AI-Powered WhatsApp Automation"
        title={['Make Customer Communication', 'More Intelligent']}
        body={(
          <>
            <p>
              AI adds another layer to WhatsApp automation by helping businesses handle routine
              interactions more efficiently.
            </p>
            <p>
              ZunoPilot&rsquo;s AI capabilities can assist with customer conversations, common
              enquiries, responses, and lead engagement while allowing human team members to
              step in when conversations require judgment or personal attention.
            </p>
            <p>This creates a balance between automated communication and human support.</p>
          </>
        )}
        listLabel="AI can help with:"
        list={[
          'Routine customer interactions',
          'Common enquiries',
          'Response assistance',
          'Lead engagement',
          'Automated communication workflows',
          'Interpreting the same question asked in different words',
          'Collecting requirements before a person takes over',
          'Early-stage lead qualification',
          'Deciding when a conversation needs a human',
          'Keeping answers consistent with approved business information',
        ]}
        href="/features/ai-whatsapp-automation"
        cta="Explore AI WhatsApp Automation"
      />

      <FeatureBlock
        id="whatsapp-number-masking"
        flip
        eyebrow="WhatsApp Number Masking"
        title={['Keep Greater Control Over', 'Customer-Facing Communication']}
        body={(
          <>
            <p>
              When customers communicate directly with individual employees, business
              relationships can become closely tied to personal or employee-managed numbers.
            </p>
            <p>
              ZunoPilot&rsquo;s number masking capability helps businesses create a more
              controlled communication model while allowing authorized users to manage
              conversations through the platform.
            </p>
            <p>
              This can be particularly useful for businesses where multiple employees interact
              with the same customer base.
            </p>
          </>
        )}
        listLabel="Useful for:"
        list={[
          'Centralized business communication',
          'Multi-user teams',
          'Customer-facing operations',
          'Greater control over business numbers',
          'Reducing exposure of employees\u2019 personal numbers',
          'Keeping conversations inside a defined workflow',
          'Field and service staff who meet customers in person',
          'Roles where the person handling a customer changes often',
          'Clean handover when staff change role or leave',
          'A consistent customer-facing identity for your business',
        ]}
        href="/features/whatsapp-number-masking"
        cta="Explore WhatsApp Number Masking"
      />

      <FeatureBlock
        id="whatsapp-campaigns"
        tone="tinted"
        eyebrow="WhatsApp Campaigns"
        title={['Turn WhatsApp Into a', 'Customer Engagement Channel']}
        body={(
          <>
            <p>WhatsApp can play an important role in marketing and customer engagement.</p>
            <p>
              ZunoPilot&rsquo;s campaign capabilities allow businesses to organize customer
              communication for promotions, announcements, updates, and other outreach
              activities.
            </p>
            <p>
              Instead of treating campaigns separately from your customer conversations,
              businesses can make WhatsApp part of a broader engagement strategy.
            </p>
          </>
        )}
        listLabel="Use campaigns for:"
        list={[
          'Promotions',
          'Announcements',
          'Customer updates',
          'Re-engagement',
          'Marketing communication',
          'Customer engagement',
          'Seasonal and event-driven outreach',
          'Restock and back-in-stock notices',
          'Post-purchase and repeat-order prompts',
          'Reusable approved message templates',
          'Targeted sends to a defined audience',
        ]}
        href="/features/whatsapp-campaigns"
        cta="Explore WhatsApp Campaigns"
      />

      <FeatureBlock
        id="whatsapp-team-inbox"
        flip
        eyebrow="WhatsApp Team Inbox"
        title={['Keep Multi-Agent', 'Conversations Organized']}
        body={(
          <>
            <p>
              As your business grows, multiple employees may need to respond to customers
              through WhatsApp.
            </p>
            <p>
              Without a structured approach, conversations can be missed, duplicated, or handled
              by the wrong person.
            </p>
            <p>
              The ZunoPilot Team Inbox gives authorized users a shared environment for managing
              customer conversations and coordinating team responses.
            </p>
          </>
        )}
        listLabel="Designed for:"
        list={[
          'Customer support teams',
          'Sales teams',
          'Service teams',
          'Multi-agent operations',
          'Growing businesses',
          'Avoiding two agents answering the same customer',
          'Internal notes that are never sent to the customer',
          'Escalating a conversation to a more senior colleague',
          'Taking over from automation the moment judgment is needed',
        ]}
        href="/features/whatsapp-team-inbox"
        cta="Explore WhatsApp Team Inbox"
      />

      <FeatureBlock
        id="whatsapp-business-api"
        tone="tinted"
        eyebrow="WhatsApp Business API"
        title={['Connect WhatsApp With', 'Your Business Workflows']}
        body={(
          <>
            <p>
              Businesses with more advanced communication requirements may need WhatsApp to work
              alongside their applications and operational processes.
            </p>
            <p>
              The WhatsApp Business API enables businesses to build scalable messaging
              experiences and connect WhatsApp with software, workflows, integrations, and
              automated communication.
            </p>
            <p>
              ZunoPilot provides a platform for incorporating WhatsApp into broader business
              processes.
            </p>
          </>
        )}
        listLabel="Suitable for:"
        list={[
          'Scalable messaging',
          'Business notifications',
          'Automated communication',
          'Software integrations',
          'Customer communication workflows',
          'Messaging triggered by events in your own systems',
          'Multi-agent access to one business number',
          'Approved templates for recurring operational messages',
          'Consent and messaging-policy compliance',
        ]}
        href="/features/whatsapp-business-api"
        cta="Explore WhatsApp Business API"
      />

      {/* ------------------------------- Chooser ------------------------------ */}
      <Section>
        <SectionHead title={['Which ZunoPilot Feature', 'Fits Your Need?']} />
        <div className="mt-10 max-w-4xl mx-auto">
          <MatchTable head={['What you want to accomplish', 'Feature']} rows={CHOOSER} />
        </div>
      </Section>

      {/* ---------------------------- Connected flow -------------------------- */}
      <Section tone="tinted">
        <SectionHead
          title={['Build a Connected', 'WhatsApp Workflow']}
          lead={(
            <p>
              ZunoPilot&rsquo;s features can work together rather than operating as isolated
              tools. For example:
            </p>
          )}
        />
        <ConnectedWorkflow stages={CONNECTED_FLOW} />
        <p className="mt-8 text-center text-base text-slate-700 max-w-2xl mx-auto">
          This creates a more connected communication process from the first customer message
          through ongoing engagement.
        </p>
      </Section>

      {/* -------------------------------- Teams ------------------------------- */}
      <Section>
        <SectionHead title={['Features Designed Around', 'Real Business Teams']} />
        <div className="mt-10">
          <TileGrid tiles={TEAMS} />
        </div>
      </Section>

      {/* --------------------------- Automate vs people ----------------------- */}
      <Section tone="tinted">
        <SectionHead
          title={['Automate the Routine.', 'Keep People in Control.']}
          lead={(
            <>
              <p>
                The purpose of automation is not to remove people from customer communication.
              </p>
              <p>
                It is to reduce repetitive work so your team can concentrate on conversations
                where human involvement adds the most value.
              </p>
            </>
          )}
        />
        <div className="mt-10">
          <Handoff />
        </div>

        <div className="mt-12">
          <RoutingSplit />
        </div>

        <p className="mt-8 text-center text-base text-slate-700 max-w-2xl mx-auto">
          Let automation handle repeatable tasks while your team handles meaningful conversations.
        </p>
      </Section>

      {/* ------------------------------- Why need ----------------------------- */}
      <Section>
        <SectionHead title={['Why Businesses Need', 'WhatsApp Automation Features']} />
        <div className="mt-10">
          <TileGrid tiles={WHY_FEATURES} />
        </div>
      </Section>

      <FaqSection faqs={FEATURES_FAQS} />

      <CtaBand
        title={['Ready to Make WhatsApp', 'Work Smarter?']}
        body={['Bring automation, AI, team collaboration, and customer communication together with ZunoPilot.']}
      />

      <SiteFooter />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                          Page-local design devices                          */
/* -------------------------------------------------------------------------- */

/**
 * The connected workflow: a stepper across the top, roomy cards underneath.
 *
 * **Why it is not six cards in a row.** It was, and it looked cramped — six stages across a
 * 1280px container is about 190px each, which is not enough width for a sentence, so every
 * card wrapped to four or five lines of small text and the row read as clutter rather than as
 * a sequence.
 *
 * Splitting the job fixes it. The **stepper** carries the sequence: one continuous rail, six
 * numbered nodes, short labels, and a fill that sweeps left to right as the section arrives —
 * that is the "horizontal flow" the section needs, and short labels genuinely fit at that
 * width. The **cards** carry the content, three across, so each sentence gets roughly 400px
 * and sits on two comfortable lines.
 *
 * Nothing is duplicated between the two: the stepper shows the label, the card shows the
 * sentence.
 */
function ConnectedWorkflow({ stages }: { stages: readonly FlowNode[] }) {
  /*
   * The highlight walks the six stages rather than sitting on one.
   *
   * It used to mark "Shared workspace" as the active stage and leave it violet forever, which
   * read as *that stage matters most* — the opposite of the point. One index, one timer, and the
   * node and its card light together so the eye follows a single object down the section. Anyone
   * with reduced motion turned on gets the resting stage lit and nothing moving.
   */
  const lit = useTravellingIndex(stages.length, 1400, Math.max(0, stages.findIndex((s) => s.active)));

  return (
    <div className="mt-10">
      {/* ------------------------------- The stepper ------------------------------ */}
      <motion.ol
        initial="hidden"
        whileInView="show"
        viewport={viewport}
        variants={{ hidden: {}, show: { transition: { staggerChildren: 0.08 } } }}
        className="relative hidden md:grid md:grid-cols-6"
      >
        {/*
          The rail, drawn once behind every node rather than as a mark between each pair.
          `scaleX` from the left edge, so it costs one composited property and reads as the
          flow filling in. Inset by half a column at each end so it starts and stops at the
          first and last node instead of running off into the margin.
        */}
        <span aria-hidden className="pointer-events-none absolute left-[8.333%] right-[8.333%] top-5 h-0.5 overflow-hidden rounded-full bg-slate-200">
          <motion.span
            variants={{
              hidden: { scaleX: 0 },
              show: { scaleX: 1, transition: { duration: 1.1, ease: EASE_OUT } },
            }}
            className="block h-full w-full origin-left rounded-full bg-gradient-to-r from-violet-400 via-violet-600 to-violet-400"
          />
        </span>

        {stages.map((stage, i) => (
          <motion.li
            key={stage.label}
            variants={{
              hidden: { opacity: 0, y: 10 },
              show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: EASE_OUT } },
            }}
            className="relative flex flex-col items-center px-2 text-center"
          >
            <span
              className={`relative z-10 grid h-10 w-10 place-items-center rounded-full text-[12px] font-bold tabular-nums ring-4 ring-white transition-colors duration-500 ${
                i === lit ? 'bg-violet-600 text-white' : 'bg-white text-violet-700 shadow-sm ring-4'
              }`}
            >
              <span className={i === lit ? '' : 'grid h-10 w-10 place-items-center rounded-full ring-1 ring-violet-200'}>
                {String(i + 1).padStart(2, '0')}
              </span>
            </span>
            <span className="mt-3 text-[13px] font-semibold leading-snug text-slate-900">
              {stage.label}
            </span>
          </motion.li>
        ))}
      </motion.ol>

      {/* -------------------------------- The cards ------------------------------- */}
      <motion.ol
        initial="hidden"
        whileInView="show"
        viewport={viewport}
        variants={{ hidden: {}, show: { transition: { staggerChildren: 0.07 } } }}
        className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 md:mt-8"
      >
        {stages.map((stage, i) => (
          <motion.li
            key={stage.label}
            variants={{
              hidden: { opacity: 0, y: 18 },
              show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: EASE_OUT } },
            }}
            whileHover={{ y: -4 }}
            transition={CARD_SPRING}
            className={`group relative h-full rounded-3xl p-5 sm:p-6 ring-1 transition-all duration-500 ${
              i === lit
                ? 'bg-gradient-to-br from-violet-50 via-white to-white ring-violet-200 shadow-lg shadow-violet-100'
                : 'bg-white ring-slate-200/80'
            }`}
          >
            <div className="flex items-center gap-3">
              {stage.icon && (
                <span
                  aria-hidden
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-violet-50 text-violet-600 ring-1 ring-violet-200/70 transition-colors duration-200 group-hover:bg-violet-600 group-hover:text-white"
                >
                  <stage.icon className="h-5 w-5" />
                </span>
              )}
              <span className="text-[12px] font-bold uppercase tracking-widest text-violet-600 tabular-nums">
                Step {String(i + 1).padStart(2, '0')}
              </span>
            </div>
            <p className="mt-3 text-[15px] font-medium text-slate-800 leading-relaxed">
              {stage.detail}
            </p>
          </motion.li>
        ))}
      </motion.ol>
    </div>
  );
}

/**
 * The routing rule: one message in, two ways out.
 *
 * **What this replaced.** A generic decision diagram with a violet question node and
 * yes/no branches. It was unreadable — the colour said "this box is important" while the
 * shape said "this is a flowchart", and neither said what the actual rule was. The words
 * "Yes" and "No" made it worse, because the reader has to hold the question in their head to
 * know what yes *means*.
 *
 * So the condition is written out on each branch instead ("If it is routine…", "If it needs
 * judgment…"), the colour is spent on exactly one thing — the human track, which is the point
 * of the section — and everything else is plain white with a hairline. No pulsing node, no
 * filled violet block.
 */
function RoutingSplit() {
  const TRACKS = [
    {
      icon: Bot,
      when: 'If it is routine',
      title: 'Automation replies',
      body: 'A workflow you configured — or AI, where you have enabled it — answers and the customer is not left waiting.',
      accent: false,
    },
    {
      icon: UserRound,
      when: 'If it needs judgment',
      title: 'Your team takes over',
      body: 'The conversation moves to a person with its history intact, so nobody asks the customer to start again.',
      accent: true,
    },
  ];

  return (
    <div className="mx-auto max-w-4xl">
      {/* The single input. Deliberately plain: it is the thing that happens, not the point. */}
      <Reveal className="mx-auto max-w-md rounded-2xl bg-white ring-1 ring-slate-200 px-5 py-4 text-center">
        <p className="flex items-center justify-center gap-2.5 text-[15px] font-semibold text-slate-900">
          <MessageSquare aria-hidden className="h-4 w-4 text-violet-600" />
          A customer message arrives
        </p>
      </Reveal>

      {/* The fork, drawn as two short legs rather than a curve — legible at any width. */}
      <div aria-hidden className="relative mx-auto h-10 w-full max-w-2xl">
        <span className="absolute left-1/2 top-0 h-4 w-px -translate-x-1/2 bg-slate-300" />
        <span className="absolute left-1/4 right-1/4 top-4 h-px bg-slate-300" />
        <span className="absolute left-1/4 top-4 h-6 w-px bg-slate-300" />
        <span className="absolute right-1/4 top-4 h-6 w-px bg-violet-300" />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6">
        {TRACKS.map((track, i) => (
          <Reveal key={track.title} delay={i * 0.1} className="h-full">
            <div
              className={`h-full rounded-3xl p-6 ring-1 ${
                track.accent
                  ? 'bg-white ring-violet-300 shadow-lg shadow-violet-100'
                  : 'bg-slate-50/70 ring-slate-200'
              }`}
            >
              <p
                className={`text-[11px] font-bold uppercase tracking-widest ${
                  track.accent ? 'text-violet-600' : 'text-slate-500'
                }`}
              >
                {track.when}
              </p>
              <IconTitle
                icon={track.icon}
                as="p"
                tone={track.accent ? 'violet' : 'slate'}
                className="mt-3 text-lg font-bold text-slate-900"
              >
                {track.title}
              </IconTitle>
              <p className="mt-3 text-[15px] text-slate-700 leading-relaxed">{track.body}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </div>
  );
}

const AUTOMATES = [
  'Recurring messages',
  'Routine enquiries',
  'Follow-up workflows',
  'Notifications',
  'Reminders',
  'Campaign communication',
] as const;

const PEOPLE = [
  'Complex enquiries',
  'Sales discussions',
  'Customer issues',
  'Negotiations',
  'High-value opportunities',
  'Human support',
] as const;

/**
 * Automation on one side, people on the other, and a visible boundary between them.
 *
 * **What this replaced and why.** It was two white boxes each containing a tick list. The
 * lists were correct and the section still failed to make its point, because the point is
 * not "here are twelve things" — it is that there is a *line*, that automation stops at it,
 * and that crossing it is deliberate. So the boundary is now a real element with the
 * handover drawn on it, the two sides are visually different weights, and the items are
 * chips rather than ticks (a tick implies a feature you get; these are categories of work).
 *
 * Both lists are the original copy, unchanged and complete.
 */
function Handoff() {
  return (
    <div className="relative grid grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-16">
      {/* The boundary. Only drawn where there are two columns for it to sit between. */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-0 bottom-0 hidden -translate-x-1/2 lg:flex lg:flex-col lg:items-center"
      >
        <span className="flex-1 w-px bg-gradient-to-b from-transparent via-slate-200 to-slate-200" />
        <motion.span
          initial={{ scale: 0.6, opacity: 0 }}
          whileInView={{ scale: 1, opacity: 1 }}
          viewport={viewport}
          transition={{ duration: 0.5, ease: EASE_OUT }}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white text-violet-600 ring-1 ring-violet-200 shadow-sm"
        >
          <ArrowRight className="h-4 w-4" strokeWidth={3} />
        </motion.span>
        <span className="flex-1 w-px bg-gradient-to-b from-slate-200 via-slate-200 to-transparent" />
      </div>

      <Reveal className="rounded-3xl bg-white ring-1 ring-slate-200 p-6 sm:p-8">
        <IconTitle icon={Bot} as="p" tone="slate" className="text-lg font-bold text-slate-900">
          ZunoPilot can automate:
        </IconTitle>
        <ul className="mt-5 flex flex-wrap gap-2">
          {AUTOMATES.map((entry) => (
            <li
              key={entry}
              className="rounded-full bg-slate-50 px-3.5 py-2 text-[14px] font-medium text-slate-700 ring-1 ring-slate-200"
            >
              {entry}
            </li>
          ))}
        </ul>
        <p className="mt-6 text-[14px] text-slate-600 leading-relaxed">
          Work that is the same every time, so a person adding nothing to it is a person
          being wasted on it.
        </p>
      </Reveal>

      <Reveal
        delay={0.1}
        className="rounded-3xl bg-gradient-to-br from-violet-50 via-white to-white ring-1 ring-violet-200 p-6 sm:p-8 shadow-lg shadow-violet-100"
      >
        <IconTitle icon={UserRound} as="p" className="text-lg font-bold text-slate-900">
          Your team can focus on:
        </IconTitle>
        <ul className="mt-5 flex flex-wrap gap-2">
          {PEOPLE.map((entry) => (
            <li
              key={entry}
              className="rounded-full bg-white px-3.5 py-2 text-[14px] font-semibold text-violet-700 ring-1 ring-violet-200"
            >
              {entry}
            </li>
          ))}
        </ul>
        <p className="mt-6 text-[14px] text-slate-700 leading-relaxed">
          Conversations where judgment, tone or a decision is the actual product — the ones
          worth having a person on.
        </p>
      </Reveal>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                                    Copy                                     */
/* -------------------------------------------------------------------------- */

const CAPABILITIES = [
  'Automate repetitive WhatsApp tasks',
  'Use AI to assist customer interactions',
  'Manage conversations with multiple team members',
  'Create structured communication workflows',
  'Keep business communication centralized',
  'Control customer-facing number exposure',
  'Run WhatsApp campaigns',
  'Organize customer conversations',
  'Scale your WhatsApp operations as your business grows',
];

const CHOOSER: readonly (readonly [string, string, string?])[] = [
  ['Automate repetitive WhatsApp communication', 'WhatsApp Business Automation', '/features/whatsapp-automation'],
  ['Add AI to customer interactions', 'AI WhatsApp Automation', '/features/ai-whatsapp-automation'],
  ['Control customer-facing business numbers', 'WhatsApp Number Masking', '/features/whatsapp-number-masking'],
  ['Communicate with customers through campaigns', 'WhatsApp Campaigns', '/features/whatsapp-campaigns'],
  ['Let multiple agents manage conversations', 'WhatsApp Team Inbox', '/features/whatsapp-team-inbox'],
  ['Connect WhatsApp with business systems', 'WhatsApp Business API', '/features/whatsapp-business-api'],
];

/*
 * The hub's headline diagram, and the one place on the site that reads left to right.
 *
 * It was a vertical chain, which is the right shape for "here are the stages of one thing"
 * but the wrong one here: this section's claim is that the features are *connected*, and a
 * column of cards with arrows between them reads as a checklist. A pipeline reads as a
 * pipeline.
 *
 * Each node keeps the original sentence as its `detail`, so nothing was shortened to make
 * the layout work — the short label is added above it, not instead of it.
 */
const CONNECTED_FLOW: readonly FlowNode[] = [
  { icon: MessageSquare, label: 'Customer message', detail: 'Customer sends a WhatsApp message' },
  { icon: Workflow, label: 'Workflow match', detail: 'Automation identifies the required workflow' },
  { icon: Bot, label: 'AI assist', detail: 'AI assists with routine communication' },
  { icon: UserRound, label: 'Right person', detail: 'Conversation reaches the appropriate team member' },
  { icon: LayoutGrid, label: 'Shared workspace', detail: 'Team manages the customer interaction through the shared environment', active: true },
  { icon: Repeat, label: 'Next action', detail: 'Follow-up or another business action is triggered' },
];

const TEAMS = [
  { icon: Target, title: 'Sales Teams', body: 'Use automation and shared conversations to manage enquiries, follow-ups, and customer interactions.' },
  { icon: Headphones, title: 'Customer Support', body: 'Combine automated responses with team-based conversation management.' },
  { icon: Megaphone, title: 'Marketing Teams', body: 'Use campaigns and customer communication to support promotions and engagement.' },
  { icon: ClipboardList, title: 'Operations', body: 'Automate recurring notifications, reminders, and operational communication.' },
  { icon: Building2, title: 'Business Owners', body: 'Create a more centralized approach to customer communication and team collaboration.' },
  { icon: Wrench, title: 'Service & Field Teams', body: 'Keep customers informed before, during and after a visit without swapping personal numbers.' },
];


const WHY_FEATURES = [
  { icon: Clock, title: 'Reduce Manual Work', body: "Automate repetitive communication that would otherwise consume your team's time." },
  { icon: Repeat, title: 'Improve Response Consistency', body: 'Use structured workflows to create a more predictable customer communication experience.' },
  { icon: Users, title: 'Support Team Collaboration', body: 'Give multiple users a shared environment for managing business conversations.' },
  { icon: ShieldCheck, title: 'Maintain Business Control', body: 'Move customer communication toward a centralized business-managed process.' },
  { icon: TrendingUp, title: 'Prepare for Growth', body: 'Create workflows that can evolve as your customer base, team, and communication volume increase.' },
  { icon: HeartHandshake, title: 'Keep Customer Relationships', body: 'Conversations belong to the business, so a customer relationship survives a change of staff.' },
];

const FEATURES_FAQS = [
  {
    question: 'What are WhatsApp automation features?',
    answer:
      'WhatsApp automation features are capabilities that help businesses automate, organize, and '
      + 'manage customer communication through WhatsApp. They can include automated workflows, AI '
      + 'assistance, team inboxes, campaigns, shared communication, and business messaging tools.',
  },
  {
    question: 'What features does ZunoPilot provide?',
    answer:
      'ZunoPilot provides WhatsApp automation, AI-powered automation, a Shared WhatsApp Portal, '
      + 'number masking, WhatsApp campaigns, Team Inbox capabilities, and WhatsApp Business API '
      + 'solutions.',
  },
  {
    question: 'How does WhatsApp automation help businesses?',
    answer:
      'WhatsApp automation can reduce repetitive manual communication, improve workflow '
      + 'consistency, support faster customer interactions, and help teams manage larger volumes '
      + 'of conversations.',
  },
  {
    question: 'What is AI WhatsApp automation?',
    answer:
      'AI WhatsApp automation combines AI capabilities with WhatsApp workflows to assist with '
      + 'routine customer interactions, enquiries, responses, lead engagement, and other '
      + 'communication tasks.',
  },
  {
    question: 'What is a Shared WhatsApp Portal?',
    answer:
      'A Shared WhatsApp Portal provides a centralized environment where authorized team members '
      + 'can access and manage business WhatsApp conversations.',
  },
  {
    question: 'What is WhatsApp number masking?',
    answer:
      'WhatsApp number masking is a capability that can help businesses maintain greater control '
      + 'over customer-facing numbers while allowing authorized team members to manage '
      + 'conversations through a business communication system.',
  },
  {
    question: 'Can multiple employees manage WhatsApp conversations?',
    answer:
      'Yes. ZunoPilot provides shared conversation capabilities that allow authorized team members '
      + 'to participate in managing business WhatsApp communication.',
  },
  {
    question: 'Can WhatsApp automation be used for marketing?',
    answer:
      'Yes. WhatsApp automation can support campaigns, promotions, announcements, customer '
      + 'updates, and re-engagement workflows, subject to applicable messaging rules and the '
      + "business's configured capabilities.",
  },
  {
    question: 'Can ZunoPilot features work together?',
    answer:
      'Yes. The different capabilities can be combined to create connected workflows involving '
      + 'automation, AI assistance, team collaboration, customer conversations, and business '
      + 'communication.',
  },
];
