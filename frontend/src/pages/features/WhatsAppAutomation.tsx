import { motion } from 'framer-motion';
import {
  AlarmClock, AlertTriangle, ArrowRight, BellRing, Bot, Building2, ClipboardList,
  Clock, Filter, HeartHandshake, Headphones, HelpCircle, Megaphone, MessageSquare,
  Repeat, Rocket, Send, Target, TrendingUp, UserRound, Users, Workflow, Zap,
} from 'lucide-react';
import { useDocumentHead } from '@/lib/document-head';
import { PAGE_HEADS } from '@/lib/page-heads';
import SiteHeader from '@/components/marketing/SiteHeader';
import SiteFooter from '@/components/marketing/SiteFooter';
import {
  ArrowLink, CARD_SPRING, CheckList, CtaBand, EASE_OUT, FaqSection, FlowChain,
  PageHero, ScrollProgress, Section, SectionHead, StepRail, TileGrid, item,
  stagger, viewport
} from '@/components/marketing/primitives';
import { Flow, IconTitle, Reveal } from '@/components/marketing/motion-kit';

/*
 * /features/whatsapp-automation
 *
 * The workhorse page of the site: "whatsapp automation" is the head term the whole
 * feature tree is built under, and this is the page that has to answer it properly —
 * what it is, where it helps, what a workflow actually looks like, and where a human
 * still belongs.
 *
 * It links sideways rather than repeating: the sales and support sections point at
 * /solutions rather than restating them, and the AI section points at the AI page. A
 * detail page that re-explains its neighbours competes with them for the same query.
 */

/** A scenario: the situation in prose, then the workflow as a chain of stages. */
function ScenarioCard({
  title, body, chain,
}: {
  title: string;
  body: string;
  chain: readonly string[];
}) {
  return (
    <motion.div
      variants={item}
      whileHover={{ y: -6, boxShadow: '0 18px 40px -14px rgb(96 73 231 / 0.22)' }}
      transition={CARD_SPRING}
      className="h-full rounded-3xl bg-white ring-1 ring-slate-200/80 p-6 sm:p-7"
    >
      <h3 className="text-lg font-bold text-slate-900">{title}</h3>
      <p className="mt-2 text-sm text-slate-600 leading-relaxed">{body}</p>
      <ol className="mt-5 flex flex-wrap items-center gap-x-2 gap-y-2">
        {chain.map((stage, i) => (
          <li key={stage} className="flex items-center gap-2">
            <span className="rounded-full bg-violet-50 ring-1 ring-violet-100 px-3 py-1 text-xs font-medium text-violet-700">
              {stage}
            </span>
            {i < chain.length - 1 && <span aria-hidden className="text-slate-300">&rarr;</span>}
          </li>
        ))}
      </ol>
    </motion.div>
  );
}

export default function WhatsAppAutomation() {
  useDocumentHead(PAGE_HEADS.whatsappAutomation);

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <ScrollProgress />
      <SiteHeader />

      <PageHero
        title={['WhatsApp Automation That', 'Keeps Your Business Moving']}
        intro={[
          "Your customers shouldn't have to wait for someone on your team to manually handle every WhatsApp message.",
          'ZunoPilot helps businesses automate repetitive WhatsApp communication, create structured workflows, manage follow-ups, and connect automated interactions with human conversations.',
          'From a new customer enquiry to sales follow-ups, support requests, reminders, and ongoing engagement, build WhatsApp processes that work consistently while your team focuses on conversations that need their attention.',
        ]}
      />

      {/* ---------------------------- The manual task -------------------------- */}
      <Section tone="tinted">
        <SectionHead
          title={['When WhatsApp Communication', 'Becomes a Manual Task']}
          lead={(
            <>
              <p>A customer sends a message.</p>
              <p>
                Someone has to notice it. Someone has to respond. Someone has to remember the
                follow-up. Someone has to send the next update.
              </p>
              <p>
                This may work when conversation volume is low. As a business grows, however, the
                same process can become difficult to maintain.
              </p>
            </>
          )}
        />
        <div className="mt-10">
          <ManualBottleneck />
        </div>
        <p className="mt-8 text-center text-base text-slate-700 max-w-2xl mx-auto">
          ZunoPilot helps businesses turn predictable communication into structured WhatsApp
          workflows.
        </p>
      </Section>

      {/* ------------------------------ Definition ----------------------------- */}
      <Section>
        <SectionHead
          title={['What Is WhatsApp Automation?']}
          lead={(
            <>
              <p>
                WhatsApp automation uses software and predefined workflows to perform recurring
                communication or business actions on WhatsApp without requiring an employee to
                manually initiate every step.
              </p>
              <p>
                A workflow can determine what should happen after a particular customer
                interaction or business event. For example:
              </p>
            </>
          )}
        />
        {/*
          Five stages across, not down. This is the page about *workflows*, so its defining
          diagram should read the way a workflow does — and five short labels fit a row
          comfortably where the hub's six did not.
        */}
        <Flow
          variant="horizontal"
          className="mt-10"
          cycle
          nodes={[
            { icon: MessageSquare, label: 'Customer enquiry' },
            { icon: Zap, label: 'Automated response' },
            { icon: ClipboardList, label: 'Information collection' },
            { icon: UserRound, label: 'Team handoff', active: true },
            { icon: Repeat, label: 'Follow-up' },
          ]}
        />
        <div className="mt-8 max-w-2xl mx-auto space-y-3 text-center text-base text-slate-700">
          <p>
            The automated process handles the repeatable stages, while your team remains
            available for conversations that require human involvement.
          </p>
          <p>
            ZunoPilot brings these workflows together in a business-focused WhatsApp automation
            environment.
          </p>
        </div>
      </Section>

      {/* ------------------------- Where it helps most ------------------------- */}
      <Section tone="tinted">
        <SectionHead
          title={['Where WhatsApp Automation', 'Makes the Biggest Difference']}
          lead={(
            <p>
              The best automation opportunities are usually activities that happen frequently and
              follow a recognizable process.
            </p>
          )}
        />
        <div className="mt-10">
          <TileGrid tiles={OPPORTUNITIES} />
        </div>
      </Section>

      {/* -------------------------- Message to workflow ------------------------ */}
      <Section>
        <SectionHead
          title={['Turn a WhatsApp Message', 'Into a Business Workflow']}
          lead={(
            <>
              <p>
                WhatsApp automation becomes more valuable when it is connected to what your
                business needs to accomplish.
              </p>
              <p>A typical workflow can follow a sequence such as:</p>
            </>
          )}
        />
        <div className="mt-12 space-y-4 sm:space-y-5">
          <StepRail steps={WORKFLOW_STEPS.slice(0, 3)} columns={3} />
          <StepRail steps={WORKFLOW_STEPS.slice(3)} columns={3} />
        </div>
        <p className="mt-8 text-center text-base text-slate-700 max-w-2xl mx-auto">
          This allows your team to work with a repeatable process rather than manually
          coordinating every stage.
        </p>
      </Section>

      {/* -------------------------- Sales and leads ---------------------------- */}
      <Section tone="tinted">
        <SectionHead
          eyebrow="WhatsApp Automation for Sales and Lead Management"
          title={['Respond to Opportunities', 'Without Letting Follow-Ups Slip']}
          lead={(
            <>
              <p>
                A WhatsApp enquiry can become a valuable sales opportunity, but only if the
                conversation continues.
              </p>
              <p>
                ZunoPilot can help businesses structure communication around the lead journey.
                For example:
              </p>
            </>
          )}
        />
        <FlowChain
          className="mt-8"
          steps={[
            'New enquiry',
            'Initial response',
            'Requirement collection',
            'Lead qualification',
            'Sales team involvement',
            'Follow-up',
            'Conversion',
          ]}
        />
        <p className="mt-8 text-center text-base text-slate-700 max-w-2xl mx-auto">
          This approach helps sales teams spend less time repeating routine messages and more
          time having meaningful conversations with qualified prospects.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-x-8 gap-y-3">
          <ArrowLink to="/solutions/lead-management">Explore WhatsApp Lead Management</ArrowLink>
          <ArrowLink to="/solutions/sales-automation">Explore Sales Automation</ArrowLink>
        </div>
      </Section>

      {/* ----------------------------- Support --------------------------------- */}
      <Section>
        <SectionHead
          eyebrow="WhatsApp Automation for Customer Support"
          title={['Handle Routine Requests While', 'Your Team Handles the Difficult Ones']}
          lead={(
            <>
              <p>
                Customer support teams often receive questions that have predictable answers.
              </p>
              <p>
                Instead of manually responding to every routine request, businesses can use
                automation for repeatable parts of the interaction. A typical support workflow
                could be:
              </p>
            </>
          )}
        />
        <div className="mt-10">
          <SupportRouting />
        </div>
        <p className="mt-8 text-center text-base text-slate-700 max-w-2xl mx-auto">
          This gives support teams more time to focus on complex problems where human expertise
          matters.
        </p>
        <div className="mt-8 text-center">
          <ArrowLink to="/solutions/customer-support">Explore Customer Support</ArrowLink>
        </div>
      </Section>

      {/* ------------------------ Notifications and reminders ------------------ */}
      <Section tone="tinted">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-16 items-center">
          <SectionHead
            align="left"
            title={['Automate Notifications,', 'Reminders and Updates']}
            lead={(
              <>
                <p>Not every WhatsApp interaction starts with a customer question.</p>
                <p>Businesses also need to proactively communicate important information.</p>
                <p>
                  The objective is to make important communication part of a defined business
                  process rather than an item employees have to remember manually.
                </p>
              </>
            )}
          />
          <div className="rounded-3xl bg-white ring-1 ring-slate-200/80 p-6 sm:p-8">
            <p className="text-base font-semibold text-slate-900">
              Depending on the business workflow, WhatsApp automation can support:
            </p>
            <CheckList
              columns={1}
              className="mt-5"
              items={[
                'Appointment reminders',
                'Service updates',
                'Customer notifications',
                'Status communication',
                'Scheduled reminders',
                'Follow-up messages',
              ]}
            />
          </div>
        </div>
      </Section>

      {/* -------------------------------- AI ----------------------------------- */}
      <Section>
        <SectionHead
          title={['Bring AI Into', 'WhatsApp Automation']}
          lead={(
            <>
              <p>Traditional automation follows predefined rules.</p>
              <p>
                AI can make automated communication more flexible by helping systems handle
                different ways customers express similar requests.
              </p>
              <p>
                For example, customers may ask the same question using completely different
                wording. AI can assist with interpreting the request and supporting an
                appropriate response.
              </p>
              <p>
                ZunoPilot combines AI capabilities with WhatsApp automation so businesses can
                build workflows that are structured while remaining more responsive to natural
                customer conversations.
              </p>
            </>
          )}
        />
        <div className="mt-8 text-center">
          <ArrowLink to="/features/ai-whatsapp-automation">Explore AI WhatsApp Automation</ArrowLink>
        </div>
      </Section>

      {/* ------------------------------- Humans -------------------------------- */}
      <Section tone="tinted">
        <SectionHead
          title={['Keep Humans at the Right', 'Point in the Conversation']}
          lead={(
            <>
              <p>Automation should not mean removing people from customer communication.</p>
              <p>Some conversations are predictable and can be automated. Others need a person.</p>
            </>
          )}
        />
        <div className="mt-10">
          <HandoffPoint />
        </div>
        <p className="mt-8 text-center text-lg font-semibold text-slate-900 max-w-2xl mx-auto">
          Automate the repeatable work. Keep your people involved where they add the most value.
        </p>
      </Section>

      {/* -------------------------- Team communication ------------------------- */}
      <Section>
        <SectionHead
          title={['Connect Automation With', 'Team Communication']}
          lead={(
            <>
              <p>
                Automation works best when it connects naturally with the people responsible for
                customer relationships.
              </p>
              <p>
                For businesses with multiple users, ZunoPilot provides capabilities that allow
                automated interactions to work alongside shared team communication.
              </p>
              <p>
                For teams handling conversations across multiple agents, the WhatsApp Team Inbox
                gives authorized users a shared environment for managing customer communication
                and coordinating who is responding to what.
              </p>
            </>
          )}
        />
        <div className="mt-8 flex flex-wrap justify-center gap-x-8 gap-y-3">
          <ArrowLink to="/features/whatsapp-team-inbox">Explore WhatsApp Team Inbox</ArrowLink>
        </div>
      </Section>

      {/* ------------------------------ Scenarios ------------------------------ */}
      <Section tone="tinted">
        <SectionHead title={['Real-World WhatsApp', 'Automation Scenarios']} />
        <motion.div
          initial="hidden"
          whileInView="show"
          viewport={viewport}
          variants={stagger(0, 0.08)}
          className="mt-10 grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-5"
        >
          {SCENARIOS.map((s) => <ScenarioCard key={s.title} {...s} />)}
        </motion.div>
        <p className="mt-8 text-center text-base text-slate-700 max-w-2xl mx-auto">
          These are examples of how WhatsApp automation can connect communication with the
          business process behind it.
        </p>
      </Section>

      {/* -------------------------- What can you automate ---------------------- */}
      <Section>
        <SectionHead title={['What Can You Automate', 'With ZunoPilot?']} />
        <div className="mt-10">
          <AutomatableGrid />
        </div>
      </Section>

      {/* ------------------------------- Benefits ------------------------------ */}
      <Section tone="tinted">
        <SectionHead title={['Business Benefits of', 'WhatsApp Automation']} />
        <div className="mt-10">
          <TileGrid tiles={BENEFITS} />
        </div>
      </Section>

      {/* --------------------------------- Who --------------------------------- */}
      <Section>
        <SectionHead title={['Who Can Benefit From', 'WhatsApp Automation?']} />
        <div className="mt-10">
          <TileGrid tiles={AUDIENCES} />
        </div>
      </Section>

      {/* ------------------------------ Before/after --------------------------- */}
      <Section tone="tinted">
        <SectionHead title={['From Manual Messaging to', 'Structured Communication']} />
        <div className="mt-10 grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="rounded-3xl bg-white ring-1 ring-slate-200/80 p-6 sm:p-8">
            <p className="text-base font-semibold text-slate-900">Without automation:</p>
            <FlowChain
              className="mt-5"
              steps={[
                'Customer message',
                'Employee notices',
                'Employee responds',
                'Employee remembers follow-up',
              ]}
            />
          </div>
          <div className="rounded-3xl bg-white ring-1 ring-slate-200/80 p-6 sm:p-8">
            <p className="text-base font-semibold text-slate-900">With a structured workflow:</p>
            <FlowChain
              className="mt-5"
              steps={['Customer event', 'Automation', 'Response', 'Team action', 'Follow-up']}
            />
          </div>
        </div>
        <div className="mt-8 max-w-2xl mx-auto space-y-3 text-center text-base text-slate-700">
          <p>The difference isn&rsquo;t simply fewer messages for your employees to send.</p>
          <p>
            It&rsquo;s a more consistent way to connect customer communication with the processes
            that drive your business.
          </p>
        </div>
      </Section>

      <FaqSection faqs={AUTOMATION_FAQS} />

      <CtaBand
        title={['Automate the Work.', 'Focus on the Conversation.']}
        body={[
          "Your team shouldn't have to spend its day repeating the same WhatsApp tasks.",
          'Use ZunoPilot to create structured automation workflows, assist customers faster, and keep your team focused on the conversations that matter.',
        ]}
      />

      <SiteFooter />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                                    Copy                                     */
/* -------------------------------------------------------------------------- */

/* -------------------------------------------------------------------------- */
/*                          Page-local design devices                          */
/* -------------------------------------------------------------------------- */

/**
 * The manual process, drawn as the bottleneck it is.
 *
 * **What this replaced.** A white box containing a seven-item tick list headed "Manual
 * WhatsApp communication can result in". Ticks were exactly the wrong mark: a tick means
 * "you get this", and every item in that list is something going wrong.
 *
 * The figure states the actual shape of the problem instead — four separate duties, all
 * funnelling through one person, and the seven ways that fails coming out the other side. The
 * copy is unchanged; `MANUAL_COSTS` still drives the right-hand column.
 */
function ManualBottleneck() {
  const DUTIES = [
    { icon: MessageSquare, text: 'Someone has to notice it' },
    { icon: Send, text: 'Someone has to respond' },
    { icon: AlarmClock, text: 'Someone has to remember the follow-up' },
    { icon: BellRing, text: 'Someone has to send the next update' },
  ];

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-12 lg:gap-6 items-start">
      {/* The four duties. */}
      {/*
        The two sides arrive from their own sides.

        The figure is an argument about direction — four duties on the left funnelling into one
        person, failures coming out on the right — so the entrance says the same thing the layout
        does. `x` only, no scale, and framer drops it entirely under reduced motion.
      */}
      <motion.ul
        initial="hidden"
        whileInView="show"
        viewport={viewport}
        variants={{
          hidden: { opacity: 0, x: -28 },
          show: { opacity: 1, x: 0, transition: { duration: 0.55, ease: EASE_OUT, staggerChildren: 0.07 } },
        }}
        className="lg:col-span-5 space-y-2.5"
      >
        {DUTIES.map((duty) => (
          <motion.li
            key={duty.text}
            variants={item}
            className="flex items-center gap-3 rounded-2xl bg-white px-4 py-3.5 ring-1 ring-slate-200"
          >
            <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-600">
              <duty.icon className="h-4 w-4" />
            </span>
            <span className="text-[15px] font-medium text-slate-800">{duty.text}</span>
          </motion.li>
        ))}
      </motion.ul>

      {/* The bottleneck. One person, every time — which is the whole argument. */}
      <Reveal className="lg:col-span-2 flex flex-col items-center justify-center py-2">
        <span aria-hidden className="hidden lg:block h-8 w-px bg-slate-200" />
        <div className="flex flex-col items-center rounded-2xl bg-slate-900 px-4 py-4 text-center">
          <span aria-hidden className="grid h-10 w-10 place-items-center rounded-full bg-white/10 text-white">
            <UserRound className="h-5 w-5" />
          </span>
          <p className="mt-2 text-[12px] font-bold uppercase tracking-widest text-violet-300">
            One person
          </p>
          <p className="mt-1 text-[12px] text-slate-300">every time</p>
        </div>
        <span aria-hidden className="hidden lg:block h-8 w-px bg-slate-200" />
        <ArrowRight aria-hidden className="mt-1 hidden h-4 w-4 text-slate-300 lg:block" strokeWidth={3} />
      </Reveal>

      {/* What comes out. No ticks — these are failures, not features. */}
      <motion.div
        initial="hidden"
        whileInView="show"
        viewport={viewport}
        variants={{
          hidden: { opacity: 0, x: 28 },
          show: { opacity: 1, x: 0, transition: { duration: 0.55, delay: 0.1, ease: EASE_OUT, staggerChildren: 0.05 } },
        }}
        className="lg:col-span-5 rounded-3xl bg-white p-6 ring-1 ring-slate-200"
      >
        <p className="flex items-center gap-2 text-[13px] font-bold uppercase tracking-widest text-slate-500">
          <AlertTriangle aria-hidden className="h-4 w-4 text-violet-500" />
          Manual WhatsApp communication can result in
        </p>
        <ul className="mt-4 divide-y divide-slate-100">
          {MANUAL_COSTS.map((cost) => (
            <motion.li key={cost} variants={item} className="py-2.5 text-[15px] font-medium text-slate-800">
              {cost}
            </motion.li>
          ))}
        </ul>
      </motion.div>
    </div>
  );
}

/**
 * The support workflow, as a horizontal track that forks at the escalation check.
 *
 * The copy's five stages include a *decision* — "determine whether escalation is required" —
 * and a straight chain renders that as just another box, which loses the only interesting part.
 * Here the first three stages run across, then the check splits: resolved by automation, or
 * connected to the support team.
 */
function SupportRouting() {
  return (
    <div className="mx-auto max-w-5xl">
      <Flow
        variant="horizontal"
        nodes={[
          { icon: HelpCircle, label: 'Customer question' },
          { icon: Filter, label: 'Identify request' },
          { icon: Zap, label: 'Provide relevant response' },
        ]}
      />

      <Reveal className="mt-6 text-center">
        <p className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-[14px] font-semibold text-slate-900 ring-1 ring-slate-200">
          <Filter aria-hidden className="h-4 w-4 text-violet-600" />
          Determine whether escalation is required
        </p>
      </Reveal>

      <div aria-hidden className="relative mx-auto h-9 w-full max-w-xl">
        <span className="absolute left-1/2 top-0 h-4 w-px -translate-x-1/2 bg-slate-300" />
        <span className="absolute left-1/4 right-1/4 top-4 h-px bg-slate-300" />
        <span className="absolute left-1/4 top-4 h-5 w-px bg-slate-300" />
        <span className="absolute right-1/4 top-4 h-5 w-px bg-violet-300" />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6">
        <Reveal className="h-full">
          <div className="h-full rounded-3xl bg-slate-50/70 p-6 ring-1 ring-slate-200">
            <p className="text-[11px] font-bold uppercase tracking-widest text-slate-500">
              No escalation needed
            </p>
            <IconTitle icon={Zap} as="p" tone="slate" className="mt-3 text-lg font-bold text-slate-900">
              Answered on the spot
            </IconTitle>
            <p className="mt-3 text-[15px] text-slate-700 leading-relaxed">
              The routine request is handled by the workflow and the customer is not queued behind
              anyone.
            </p>
          </div>
        </Reveal>
        <Reveal delay={0.1} className="h-full">
          <div className="h-full rounded-3xl bg-white p-6 ring-1 ring-violet-300 shadow-lg shadow-violet-100">
            <p className="text-[11px] font-bold uppercase tracking-widest text-violet-600">
              Escalation required
            </p>
            <IconTitle icon={Users} as="p" className="mt-3 text-lg font-bold text-slate-900">
              Connect customer with support team
            </IconTitle>
            <p className="mt-3 text-[15px] text-slate-700 leading-relaxed">
              The conversation moves to an agent with everything already gathered, so the customer
              repeats nothing.
            </p>
          </div>
        </Reveal>
      </div>
    </div>
  );
}

/**
 * Where the handover happens, as four stages with the handover marked.
 *
 * **What this replaced.** Two tick lists side by side — "automation can assist with" and
 * "your team can handle". The lists are still here in full, but they now sit *under* the stage
 * they belong to, so the section answers its own title: the human comes in at stage three, and
 * you can see it.
 */
function HandoffPoint() {
  const AUTOMATION = [
    'Routine questions',
    'Initial enquiries',
    'Common information requests',
    'Follow-up workflows',
    'Reminders',
    'Notifications',
  ];
  const TEAM = [
    'Complex questions',
    'High-value sales opportunities',
    'Negotiations',
    'Sensitive customer issues',
    'Detailed support requests',
    'Conversations requiring judgment',
  ];

  return (
    <div className="mx-auto max-w-5xl">
      <Flow
        variant="horizontal"
        cycle
        nodes={[
          { icon: Bot, label: 'Automation', detail: 'Handles the predictable part' },
          { icon: Filter, label: 'Detection', detail: 'Spots what needs a person' },
          { icon: ArrowRight, label: 'Human handoff', detail: 'With the history attached', active: true },
          { icon: UserRound, label: 'Human resolution', detail: 'Judgment, tone, decision' },
        ]}
      />

      <div className="mt-8 grid grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-6">
        <Reveal className="rounded-3xl bg-slate-50/70 p-6 sm:p-7 ring-1 ring-slate-200">
          <IconTitle icon={Bot} as="p" tone="slate" className="text-base font-bold text-slate-900">
            Automation can assist with:
          </IconTitle>
          <ul className="mt-4 flex flex-wrap gap-2">
            {AUTOMATION.map((entry) => (
              <li key={entry} className="rounded-full bg-white px-3.5 py-2 text-[14px] font-medium text-slate-700 ring-1 ring-slate-200">
                {entry}
              </li>
            ))}
          </ul>
        </Reveal>
        <Reveal delay={0.1} className="rounded-3xl bg-white p-6 sm:p-7 ring-1 ring-violet-300 shadow-lg shadow-violet-100">
          <IconTitle icon={UserRound} as="p" className="text-base font-bold text-slate-900">
            Your team can handle:
          </IconTitle>
          <ul className="mt-4 flex flex-wrap gap-2">
            {TEAM.map((entry) => (
              <li key={entry} className="rounded-full bg-violet-50 px-3.5 py-2 text-[14px] font-semibold text-violet-700 ring-1 ring-violet-200">
                {entry}
              </li>
            ))}
          </ul>
        </Reveal>
      </div>
    </div>
  );
}

/**
 * What can be automated — cards rather than a two-column table.
 *
 * A table was the wrong instrument: both columns are content of the same kind (an activity and
 * what automation does with it), so ruling them apart made it look like a specification. As
 * pairs on a card, the second line reads as the answer to the first.
 */
function AutomatableGrid() {
  const ICONS = [Target, Repeat, HelpCircle, AlarmClock, BellRing, Headphones, Megaphone, HeartHandshake];
  return (
    <motion.ul
      initial="hidden"
      whileInView="show"
      viewport={viewport}
      variants={stagger(0, 0.05)}
      className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 sm:gap-4"
    >
      {AUTOMATABLE.map(([activity, opportunity], i) => {
        const Icon = ICONS[i % ICONS.length];
        return (
          <motion.li
            key={activity}
            variants={item}
            whileHover={{ y: -5, boxShadow: '0 20px 44px -20px rgb(96 73 231 / 0.28)' }}
            transition={CARD_SPRING}
            className="group relative h-full overflow-hidden rounded-2xl bg-white p-5 ring-1 ring-slate-200/80"
          >
            {/* A sheen on hover: one translated gradient, no blur. */}
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-violet-50 to-transparent transition-transform duration-700 group-hover:translate-x-full"
            />
            <span
              aria-hidden
              className="relative grid h-10 w-10 place-items-center rounded-xl bg-violet-50 text-violet-600 ring-1 ring-violet-200/70 transition-colors duration-200 group-hover:bg-violet-600 group-hover:text-white"
            >
              <Icon className="h-5 w-5" />
            </span>
            <p className="relative mt-4 text-[15px] font-bold text-slate-900">{activity}</p>
            <p className="relative mt-1.5 text-[14px] text-slate-700 leading-relaxed">{opportunity}</p>
          </motion.li>
        );
      })}
    </motion.ul>
  );
}

const MANUAL_COSTS = [
  'Delayed responses',
  'Missed enquiries',
  'Forgotten follow-ups',
  'Repetitive work',
  'Inconsistent replies',
  'Limited team visibility',
  'Too much dependence on individual employees',
];

const OPPORTUNITIES = [
  { icon: Target, title: 'Lead Enquiries', body: 'Respond to new prospects, gather relevant information, and move conversations toward the appropriate sales workflow.' },
  { icon: Repeat, title: 'Follow-Ups', body: 'Create structured follow-up processes instead of relying entirely on employees to remember when to contact a prospect or customer.' },
  { icon: HelpCircle, title: 'Customer Questions', body: 'Use predefined responses or AI-assisted communication for routine enquiries.' },
  { icon: AlarmClock, title: 'Reminders', body: 'Create communication workflows around appointments, services, payments, or other business activities where reminders are appropriate.' },
  { icon: BellRing, title: 'Notifications', body: 'Keep customers informed about relevant business events and updates.' },
  { icon: HeartHandshake, title: 'Customer Re-Engagement', body: 'Create appropriate communication workflows for customers who need another touchpoint.' },
];

const WORKFLOW_STEPS = [
  { index: '01', kicker: 'Customer Interaction', title: 'A conversation begins', body: 'A customer starts a conversation or triggers a relevant business event.' },
  { index: '02', kicker: 'Workflow Recognition', title: 'The type is identified', body: 'The system identifies the type of interaction and determines the next action.' },
  { index: '03', kicker: 'Automated Response', title: 'The workflow starts', body: 'The appropriate message or workflow step is initiated.' },
  { index: '04', kicker: 'Information Collection', title: 'Details are gathered', body: 'The workflow can gather relevant information when required.' },
  { index: '05', kicker: 'Team Handoff', title: 'A person takes over', body: 'If the conversation requires human attention, it can move to the appropriate team member.' },
  { index: '06', kicker: 'Follow-Up', title: 'The process continues', body: 'The next communication step can continue according to the defined business process.' },
];

const SCENARIOS = [
  {
    title: 'New Lead Enquiry',
    body: 'A prospect asks about a product or service.',
    chain: ['Enquiry', 'Automated acknowledgement', 'Requirement collection', 'Sales handoff', 'Follow-up'],
  },
  {
    title: 'Customer Support Request',
    body: 'A customer needs assistance.',
    chain: ['Customer message', 'Request identification', 'Automated assistance', 'Escalation when required'],
  },
  {
    title: 'Appointment Reminder',
    body: 'A customer has an upcoming appointment.',
    chain: ['Business event', 'Reminder workflow', 'WhatsApp notification', 'Customer response', 'Team action if needed'],
  },
  {
    title: 'Customer Re-Engagement',
    body: 'A customer needs another communication touchpoint.',
    chain: ['Customer segment', 'Appropriate message', 'Customer response', 'Continue conversation or team handoff'],
  },
];

const AUTOMATABLE: readonly (readonly [string, string, string?])[] = [
  ['Lead enquiries', 'Initial responses and qualification workflows'],
  ['Sales follow-ups', 'Triggered or scheduled communication'],
  ['Customer questions', 'Automated or AI-assisted responses'],
  ['Reminders', 'Scheduled customer communication'],
  ['Notifications', 'Business-event communication'],
  ['Support requests', 'Initial assistance and routing'],
  ['Campaign communication', 'Structured outreach workflows'],
  ['Re-engagement', 'Customer follow-up workflows'],
];

const BENEFITS = [
  { icon: Clock, title: 'Reduce Repetitive Work', body: 'Automate communication that follows predictable patterns.' },
  { icon: Repeat, title: 'Improve Follow-Up Consistency', body: 'Create structured processes around important customer touchpoints.' },
  { icon: Zap, title: 'Support Faster Responses', body: 'Automated workflows can assist with routine communication without waiting for manual action.' },
  { icon: TrendingUp, title: 'Handle More Conversations', body: 'Create processes that can support growing communication volumes without relying entirely on additional manual effort.' },
  { icon: Target, title: 'Improve Team Focus', body: 'Give employees more time for sales conversations, complex support requests, and customer relationships.' },
  { icon: Workflow, title: 'Create Consistent Customer Journeys', body: 'Connect enquiries, responses, follow-ups, support, and engagement into a more organized process.' },
];

const AUDIENCES = [
  { icon: Target, title: 'Sales Teams', body: 'Automate initial responses and recurring follow-ups so sales representatives can focus on qualified opportunities.' },
  { icon: Headphones, title: 'Customer Support Teams', body: 'Reduce repetitive interactions and route complex requests to the right people.' },
  { icon: Megaphone, title: 'Marketing Teams', body: 'Build structured WhatsApp communication around campaigns and customer engagement.' },
  { icon: ClipboardList, title: 'Operations Teams', body: 'Automate recurring reminders, updates, and notifications.' },
  { icon: Building2, title: 'Service Businesses', body: 'Keep customers informed before, during, and after service interactions.' },
  { icon: Rocket, title: 'Growing Businesses', body: 'Create repeatable communication workflows that can evolve as customer and message volumes increase.' },
];

const AUTOMATION_FAQS = [
  {
    question: 'What is WhatsApp automation for business?',
    answer:
      'WhatsApp automation for business uses software and predefined workflows to automate '
      + 'recurring customer communication, including responses, follow-ups, reminders, '
      + 'notifications, and other messaging processes.',
  },
  {
    question: 'How does WhatsApp automation work?',
    answer:
      'A WhatsApp automation workflow generally begins with a customer interaction or business '
      + 'trigger, determines the appropriate next action, sends or supports communication, and '
      + 'can continue with additional steps or hand the conversation to a team member.',
  },
  {
    question: 'What can businesses automate on WhatsApp?',
    answer:
      'Businesses can automate lead responses, follow-ups, reminders, notifications, routine '
      + 'customer enquiries, support workflows, campaign communication, and customer '
      + 're-engagement processes.',
  },
  {
    question: 'Can WhatsApp automation handle customer questions?',
    answer:
      'Yes. Predictable questions can be addressed through predefined workflows, while AI can '
      + 'assist with more flexible customer interactions. Conversations that require human '
      + 'judgment can be transferred to a team member.',
  },
  {
    question: 'Can WhatsApp automation help with lead generation?',
    answer:
      'Yes. Businesses can use WhatsApp workflows to respond to enquiries, collect information, '
      + 'qualify prospects, initiate follow-ups, and connect potential customers with sales teams.',
  },
  {
    question: 'Can AI be combined with WhatsApp automation?',
    answer:
      'Yes. AI can work alongside WhatsApp automation to assist with understanding customer '
      + 'requests, supporting responses, handling variations in questions, and improving '
      + 'automated interactions.',
  },
  {
    question: 'Does WhatsApp automation replace customer support agents?',
    answer:
      'No. Automation is primarily useful for predictable and repetitive interactions. Support '
      + 'agents can continue handling complex issues, sensitive requests, and conversations that '
      + 'require human judgment.',
  },
  {
    question: 'Is WhatsApp automation suitable for small businesses?',
    answer:
      'Yes. Small businesses can begin with a limited number of repetitive workflows and expand '
      + 'their automation as customer communication grows.',
  },
  {
    question: 'Can large teams use WhatsApp automation?',
    answer:
      'Yes. Businesses with multiple users can combine automated workflows with shared '
      + 'conversation management to create a more organized communication process.',
  },
  {
    question: 'Is WhatsApp automation allowed on WhatsApp?',
    answer:
      'Businesses need to use approved WhatsApp business products and comply with applicable '
      + 'WhatsApp policies, messaging requirements, consent rules, and template requirements '
      + 'where applicable. ZunoPilot should be configured and used according to those '
      + 'requirements.',
  },
];
