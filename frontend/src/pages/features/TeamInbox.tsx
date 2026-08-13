import { Link } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import {
  AlertTriangle, ArrowRight, Bot, Building2, CalendarClock, CheckCheck, ClipboardList,
  Eye, Headphones, Megaphone, MessageSquare, Search, ShieldCheck, Sparkles, Target,
  UserCheck, UserRound, Users, UsersRound, Workflow,
} from 'lucide-react';
import { useDocumentHead } from '@/lib/document-head';
import { PAGE_HEADS } from '@/lib/page-heads';
import SiteHeader from '@/components/marketing/SiteHeader';
import SiteFooter from '@/components/marketing/SiteFooter';
import {
  ArrowLink, CARD_SPRING, CheckList, CtaBand, EASE_OUT, FaqSection, MatchTable, PageHero,
  ScrollProgress, Section, SectionHead, TileGrid, item, stagger, viewport,
} from '@/components/marketing/primitives';
import { ChipRow, GlowCard, IconTitle, Reveal } from '@/components/marketing/motion-kit';

/*
 * /features/whatsapp-team-inbox
 *
 * **The copy is supplied and reproduced exactly.** Every heading, paragraph, list item,
 * table row and FAQ answer on this page is the client's text, unedited. Where it is broken
 * across `title={['…', '…']}` arrays that is a line-break decision only — the words and
 * their order are untouched. Two deliberate deviations, both to keep the site consistent
 * with itself rather than with the brief:
 *
 *   • The CTAs read "Get Started", not "Start Free". The site standardised on one label in
 *     `lib/marketing-nav.ts` after "Start Free" / "Start free trial" / "Start Free Trial"
 *     were found on the same site; `CtaPair` renders `CTA_LABEL` and this page uses
 *     `CtaPair`, so it cannot drift back.
 *   • Internal links carry no trailing slash. The brief writes `/solutions/lead-management/`;
 *     every route, canonical and `<loc>` on this site is slash-free, and mixing the two
 *     creates a redirect on an internal link. `ScrollToTop` normalises either form, so the
 *     brief's links would work — they just would not match the canonical.
 *
 * **The argument the page has to carry, and how the figures carry it.** The whole pitch is
 * one shape: a conversation that belongs to *a person* versus a conversation that belongs to
 * *the business*. Prose can assert that; it is much more convincing drawn. So the four
 * custom figures below are all the same before/after in different clothes —
 * `OwnershipSwitch` (individual vs team), `DuplicateReply` (what goes wrong without shared
 * visibility), `HandoffTimeline` (a conversation surviving three owners), and
 * `StructureShift` (the two topologies side by side). Everything else uses the shared
 * primitives, so this reads as the same site as its five sibling pages.
 *
 * Hedged throughout — "can", "where supported", "depending on your configuration" — because
 * that is how the supplied copy is written, and correctly so: what this feature does depends
 * on how a workspace is set up, and a product page is the wrong place to promise otherwise.
 */

const FAQS = [
  {
    question: 'What is a WhatsApp Team Inbox?',
    answer:
      'A WhatsApp Team Inbox is a shared workspace that allows multiple authorized employees '
      + 'to manage business WhatsApp conversations from a common environment.',
  },
  {
    question: 'Can multiple employees use a WhatsApp Team Inbox?',
    answer:
      'Yes. A WhatsApp Team Inbox is designed for multiple authorized users who need to '
      + 'participate in managing business WhatsApp conversations. Available access and '
      + 'capabilities depend on the configured ZunoPilot and WhatsApp Business setup.',
  },
  {
    question:
      'What is the difference between a WhatsApp Team Inbox and a personal WhatsApp account?',
    answer:
      'A personal WhatsApp account is primarily designed around an individual user, while a '
      + 'WhatsApp Team Inbox provides a business-oriented environment where multiple '
      + 'authorized team members can participate in customer conversation management.',
  },
  {
    question: 'Can WhatsApp conversations be assigned to team members?',
    answer:
      'Where supported by the configured ZunoPilot functionality, conversations can be '
      + 'assigned or routed to appropriate team members so responsibility is clearer.',
  },
  {
    question: 'How does a WhatsApp Team Inbox help customer support?',
    answer:
      'It gives support teams a shared environment for handling customer conversations, '
      + 'coordinating responsibility, continuing existing discussions, and transferring '
      + 'conversations when another employee needs to assist.',
  },
  {
    question: 'Can sales teams use a WhatsApp Team Inbox?',
    answer:
      'Yes. Sales teams can use a shared inbox to manage incoming enquiries, coordinate '
      + 'customer conversations, and allow another authorized representative to continue a '
      + 'conversation when necessary.',
  },
  {
    question: 'Can a customer conversation be transferred to another employee?',
    answer:
      'Where the configured workflow supports conversation assignment or handoff, another '
      + 'authorized team member can take responsibility for continuing the customer '
      + 'interaction.',
  },
  {
    question: 'Does a shared WhatsApp inbox prevent duplicate replies?',
    answer:
      'Shared visibility can help reduce duplicate responses because team members can see '
      + 'conversations and their handling status. The exact behavior depends on the features '
      + 'available in the ZunoPilot setup.',
  },
  {
    question: 'Can team members see previous WhatsApp conversations?',
    answer:
      'The conversation history available to team members depends on the configured ZunoPilot '
      + 'and WhatsApp Business environment. The shared workspace is designed to help '
      + 'authorized users work with relevant conversation context.',
  },
  {
    question: 'Can managers monitor team conversations?',
    answer:
      'Where supported by the configured access and permissions, managers can have visibility '
      + 'into business conversations to help coordinate customer communication and team '
      + 'responsibilities.',
  },
  {
    question: 'Is a WhatsApp Team Inbox the same as WhatsApp automation?',
    answer:
      'No. A Team Inbox is focused on people working together on customer conversations, '
      + 'while WhatsApp automation is focused on automating suitable business processes and '
      + 'recurring communication.',
  },
  {
    question: 'Can AI work with a WhatsApp Team Inbox?',
    answer:
      'Yes. AI-assisted interactions can complement team-based communication where the '
      + 'relevant ZunoPilot functionality is configured. AI can assist with suitable '
      + 'conversations while employees handle interactions requiring human judgment.',
  },
];

export default function TeamInbox() {
  useDocumentHead(PAGE_HEADS.teamInbox);

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <ScrollProgress />
      <SiteHeader />

      <PageHero
        title={['Give Your Team One Place to Work', 'on WhatsApp Conversations']}
        intro={[
          'Customer conversations become harder to manage when they are spread across individual employees.',
          "ZunoPilot's WhatsApp Team Inbox gives customer-facing teams a shared workspace where authorized users can work with business WhatsApp conversations, coordinate responsibility, and keep customer interactions connected to the organization.",
          'Instead of asking who has the customer chat, your team can work from a common inbox designed for collaborative WhatsApp communication.',
        ]}
      >
        {/*
          The hub link the internal-linking plan asks for in the introduction. Inside the hero
          rather than in a paragraph of its own, so it is the first outbound link on the page
          without interrupting the three-paragraph pitch above it.
        */}
        <p className="mt-8">
          <ArrowLink to="/features">Explore all ZunoPilot Features</ArrowLink>
        </p>
      </PageHero>

      {/* ------------------- When WhatsApp becomes a team job ------------------ */}
      <Section tone="tinted">
        <SectionHead
          eyebrow="The problem"
          title={['When WhatsApp Becomes', 'a Team Responsibility']}
          lead={(
            <>
              <p>A business may begin with one person answering WhatsApp messages.</p>
              <p>As enquiries increase, more people become involved.</p>
              <p>
                Sales may need to handle prospects. Support may need to resolve customer
                issues. Operations may need to take over specific requests.
              </p>
              <p>Without a shared working environment, teams can face situations such as:</p>
            </>
          )}
        />

        <div className="mt-10">
          <FrictionGrid />
        </div>

        <p className="mt-8 text-center text-base text-slate-700 max-w-2xl mx-auto">
          A WhatsApp Team Inbox gives the organization a way to manage these challenges from a
          shared workspace.
        </p>
      </Section>

      {/* --------------------------- One shared view --------------------------- */}
      <Section>
        <SectionHead
          title={['One Shared View for', 'Customer Conversations']}
          lead={(
            <>
              <p>
                Instead of keeping customer chats tied to individual employees, ZunoPilot
                brings eligible business conversations into a team-oriented inbox.
              </p>
              <p>
                Authorized users can work with the conversations relevant to their
                responsibilities while maintaining visibility across the customer
                communication process.
              </p>
              <p>This creates a simple distinction:</p>
            </>
          )}
        />

        <div className="mt-10">
          <OwnershipSwitch />
        </div>

        <p className="mt-8 text-center text-base text-slate-700 max-w-2xl mx-auto">
          That difference becomes increasingly valuable as customer communication grows.
        </p>
      </Section>

      {/* ------------------------------ Definition ---------------------------- */}
      <Section tone="tinted">
        <SectionHead
          title={['What Is a WhatsApp Team Inbox?']}
          lead={(
            <>
              <p>
                A WhatsApp Team Inbox is a shared workspace that allows multiple authorized
                team members to manage business WhatsApp conversations.
              </p>
              <p>
                It provides a common environment for teams that need to see, organize, and
                respond to customer messages.
              </p>
              <p>
                Depending on the configured ZunoPilot setup, teams can use the inbox to
                support activities such as:
              </p>
            </>
          )}
        />

        <div className="mt-10 max-w-3xl mx-auto rounded-3xl bg-white ring-1 ring-slate-200/80 p-6 sm:p-8">
          <CheckList
            items={[
              'Viewing customer conversations',
              'Managing conversation ownership',
              'Assigning conversations',
              'Coordinating team responses',
              'Handling customer handoffs',
              'Reviewing conversation context',
              'Managing conversations across customer-facing teams',
            ]}
          />
        </div>

        <p className="mt-8 text-center text-base text-slate-700 max-w-2xl mx-auto">
          The exact capabilities depend on your ZunoPilot configuration and connected WhatsApp
          Business environment.
        </p>
      </Section>

      {/* ---------------------------- Clear owner ----------------------------- */}
      <Section>
        <SectionHead
          title={['Give Every Conversation', 'a Clear Owner']}
          lead={(
            <>
              <p>
                One of the simplest ways to improve team coordination is to make
                responsibility clear.
              </p>
            </>
          )}
        />

        <div className="mt-10">
          <OwnerRouting />
        </div>

        <div className="mt-8 max-w-2xl mx-auto space-y-3 text-center text-base text-slate-700">
          <p>
            Instead of leaving responsibility unclear, your team can organize conversations
            around the people or teams responsible for handling them.
          </p>
          <p>This helps reduce the question:</p>
          <p className="text-lg font-semibold text-slate-900">
            &ldquo;Is anyone taking care of this customer?&rdquo;
          </p>
        </div>
      </Section>

      {/* ------------------------------ Handoffs ------------------------------ */}
      <Section tone="tinted">
        <SectionHead
          title={['Make Customer', 'Handoffs Easier']}
          lead={(
            <>
              <p>
                A customer conversation doesn&rsquo;t always remain with the same employee.
              </p>
              <p>A sales enquiry may become a support issue.</p>
              <p>A support request may need help from operations.</p>
              <p>
                An employee may be unavailable and another team member may need to continue
                the conversation.
              </p>
            </>
          )}
        />

        <div className="mt-10">
          <HandoffTimeline />
        </div>

        <div className="mt-8 max-w-2xl mx-auto space-y-3 text-center text-base text-slate-700">
          <p>
            A shared inbox provides a common place for the conversation to remain accessible
            to authorized users during these transitions.
          </p>
          <p>
            The customer can continue the discussion while the responsibility changes
            internally.
          </p>
        </div>
      </Section>

      {/* -------------------------- Duplicate replies ------------------------- */}
      <Section>
        <SectionHead
          title={['Reduce Duplicate Replies']}
          lead={(
            <>
              <p>
                Team communication becomes difficult when employees don&rsquo;t know what
                others are doing.
              </p>
              <p>For example:</p>
            </>
          )}
        />

        <div className="mt-10">
          <DuplicateReply />
        </div>

        <div className="mt-8 max-w-2xl mx-auto space-y-3 text-center text-base text-slate-700">
          <p>
            Shared visibility can help teams coordinate their responses and understand which
            conversations are already being handled.
          </p>
          <p>
            This is especially useful when several employees work during the same period or
            when customer enquiry volumes are high.
          </p>
        </div>
      </Section>

      {/* ------------------------------- Context ------------------------------ */}
      <Section tone="tinted">
        <SectionHead
          title={['Keep the Conversation', 'Context With the Business']}
          lead={(
            <>
              <p>
                A customer may initially speak with a salesperson and later need help from
                support.
              </p>
              <p>
                The next employee shouldn&rsquo;t have to begin by asking the customer to
                explain everything again.
              </p>
            </>
          )}
        />

        <div className="mt-10">
          <ContextCarry />
        </div>

        <div className="mt-8 max-w-2xl mx-auto space-y-3 text-center text-base text-slate-700">
          <p>
            When relevant conversation history is available within the team&rsquo;s working
            environment, authorized users can understand the previous discussion before
            continuing.
          </p>
          <p>
            This can make internal handoffs smoother and help create a more consistent
            customer experience.
          </p>
        </div>
      </Section>

      {/* ------------------------- Organize around teams ---------------------- */}
      <Section>
        <SectionHead
          title={['Organize Conversations', 'Around Your Teams']}
          lead={(
            <>
              <p>Different businesses organize customer communication differently.</p>
              <p>A company may have:</p>
            </>
          )}
        />

        <div className="mt-10 max-w-3xl mx-auto">
          <ChipRow
            className="justify-center"
            chips={[
              'Sales representatives',
              'Customer support agents',
              'Account managers',
              'Operations staff',
              'Service coordinators',
              'Customer success teams',
            ]}
          />
        </div>

        <div className="mt-8 max-w-2xl mx-auto space-y-3 text-center text-base text-slate-700">
          <p>
            The Team Inbox can support a team-based approach to customer conversations,
            allowing the organization to determine who should handle different types of
            enquiries.
          </p>
          <p>
            Instead of building the customer relationship around one employee, the business
            can build a process around the team.
          </p>
        </div>
      </Section>

      {/* -------------------------------- Sales ------------------------------- */}
      <Section tone="tinted">
        <SectionHead
          eyebrow="For sales teams"
          title={['WhatsApp Team Inbox for Sales']}
          lead={(
            <>
              <p>
                Sales teams often receive enquiries from customers at different stages of the
                buying journey.
              </p>
              <p>
                One person may be unavailable. Another may specialize in a particular product.
                A manager may need to review an important opportunity.
              </p>
              <p>
                A shared inbox can give the sales team a common environment for managing these
                conversations.
              </p>
              <p>For example:</p>
            </>
          )}
        />

        <div className="mt-10">
          <SalesRelay />
        </div>

        <div className="mt-8 text-center">
          <p className="mx-auto max-w-2xl text-base text-slate-700">
            This can make incoming WhatsApp enquiries easier to coordinate.
          </p>
          <p className="mt-5">
            <ArrowLink to="/solutions/lead-management">Explore WhatsApp Lead Management</ArrowLink>
          </p>
        </div>
      </Section>

      {/* ------------------------------- Support ------------------------------ */}
      <Section>
        <SectionHead
          eyebrow="For support teams"
          title={['WhatsApp Team Inbox', 'for Customer Support']}
          lead={(
            <>
              <p>Customer support conversations can involve multiple stages.</p>
              <p>
                A customer may start with a general question and later require assistance from
                another team.
              </p>
              <p>
                A shared inbox can help support teams work through these interactions without
                requiring every customer conversation to remain with one person.
              </p>
              <p>
                Teams can use the shared environment to organize customer requests, continue
                existing discussions, and involve the appropriate person when additional
                expertise is required.
              </p>
            </>
          )}
        />

        <div className="mt-10 text-center">
          <ArrowLink to="/solutions/customer-support">Explore Customer Support</ArrowLink>
        </div>
      </Section>

      {/* --------------------- Fewer internal status pings -------------------- */}
      <Section tone="tinted">
        <SectionHead
          title={['Keep Your Team Informed Without', 'Constant Internal Messages']}
          lead={<p>Without shared visibility, employees may spend time asking each other:</p>}
        />

        <div className="mt-10">
          <InternalPings />
        </div>

        <div className="mt-8 max-w-2xl mx-auto space-y-3 text-center text-base text-slate-700">
          <p>
            A shared inbox can reduce some of this internal coordination by putting relevant
            conversation information in the same working environment.
          </p>
          <p>
            Your team can spend more time dealing with customers and less time figuring out who
            is responsible for each conversation.
          </p>
        </div>
      </Section>

      {/* ----------------------------- Continuity ----------------------------- */}
      <Section>
        <SectionHead
          title={['Support Business Continuity', 'When People Change']}
          lead={<p>Customer relationships shouldn&rsquo;t disappear when an employee changes roles.</p>}
        />

        <div className="mt-10">
          <TileGrid
            columns={2}
            tiles={[
              { icon: CalendarClock, title: 'People take leave.', body: '' },
              { icon: Workflow, title: 'Responsibilities move between departments.', body: '' },
              { icon: UsersRound, title: 'Teams grow.', body: '' },
              { icon: UserRound, title: 'Employees leave.', body: '' },
            ]}
          />
        </div>

        <div className="mt-8 max-w-2xl mx-auto space-y-3 text-center text-base text-slate-700">
          <p>
            A team inbox can help reduce dependence on one person being the only holder of a
            customer conversation.
          </p>
          <p>
            When the business maintains access to the appropriate conversation context, another
            authorized team member can take responsibility when required.
          </p>
        </div>
      </Section>

      {/* ------------------------- Manager visibility ------------------------- */}
      <Section tone="tinted">
        <SectionHead
          title={['Give Managers', 'Better Visibility']}
          lead={(
            <>
              <p>
                Team leaders often need to understand the state of customer communication
                without asking every employee for individual updates.
              </p>
              <p>
                A shared inbox can provide a common environment for authorized managers and
                team members to understand which conversations are active and where attention
                may be required.
              </p>
              <p>This can help businesses identify:</p>
            </>
          )}
        />

        <div className="mt-10 max-w-3xl mx-auto rounded-3xl bg-white ring-1 ring-slate-200/80 p-6 sm:p-8">
          <CheckList
            items={[
              'Conversations waiting for a response',
              'Active customer discussions',
              'Handoffs between team members',
              'Areas where additional support may be needed',
              'Customer communication that requires attention',
            ]}
          />
        </div>

        <p className="mt-8 text-center text-base text-slate-700 max-w-2xl mx-auto">
          The goal is better visibility without turning every customer conversation into a
          manual reporting exercise.
        </p>
      </Section>

      {/* ------------------------- The structural shift ----------------------- */}
      <Section>
        <SectionHead
          title={['From Individual Chats to', 'Team-Based Communication']}
          lead={<p>A traditional approach may look like:</p>}
        />

        <div className="mt-10">
          <StructureShift />
        </div>

        <div className="mt-8 max-w-2xl mx-auto space-y-3 text-center text-base text-slate-700">
          <p>The employee still provides the personal interaction.</p>
          <p>
            But the organization has a stronger communication framework around that
            interaction.
          </p>
          <p>
            This can be particularly valuable for businesses where WhatsApp is an important
            customer service or sales channel.
          </p>
        </div>
      </Section>

      {/* --------------------------- Works alongside -------------------------- */}
      <Section tone="tinted">
        <SectionHead
          title={['Connect Your Team Inbox', 'With Other ZunoPilot Features']}
          lead={(
            <p>
              The Team Inbox can work alongside other ZunoPilot capabilities without changing
              its primary purpose.
            </p>
          )}
        />

        <div className="mt-10">
          <CompanionFeatures />
        </div>
      </Section>

      {/* ------------------------------ The table ----------------------------- */}
      <Section>
        <SectionHead
          title={['What a WhatsApp Team Inbox', 'Can Help Your Business Manage']}
        />

        <div className="mt-10 max-w-4xl mx-auto">
          <MatchTable
            head={['Challenge', 'Team Inbox approach']}
            rows={[
              ['Several employees handle WhatsApp', 'Shared access for authorized users'],
              ['Nobody knows who owns a conversation', 'Clearer responsibility'],
              ['Two employees answer the same customer', 'Better team visibility'],
              ['Employee becomes unavailable', 'Easier handoff'],
              ['Customer repeats previous information', 'Conversation context can remain available'],
              ['Managers need visibility', 'Common working environment'],
              ['Customer volume increases', 'More structured conversation management'],
              ['Sales and support need to collaborate', 'Conversations can move between responsible teams'],
            ]}
          />
        </div>
      </Section>

      {/* ------------------------------ Is it for you ------------------------- */}
      <Section tone="tinted">
        <SectionHead
          title={['Is a WhatsApp Team Inbox', 'Right for Your Business?']}
          lead={(
            <>
              <p>
                A shared inbox becomes particularly useful when WhatsApp is no longer a
                one-person communication channel.
              </p>
              <p>Consider a team inbox if:</p>
            </>
          )}
        />

        <div className="mt-10 max-w-3xl mx-auto rounded-3xl bg-white ring-1 ring-slate-200/80 p-6 sm:p-8">
          <CheckList
            items={[
              'Multiple employees answer customer WhatsApp messages.',
              'Customers are contacting different employees about the same business.',
              'Your team struggles to identify conversation ownership.',
              'Customers sometimes receive duplicate responses.',
              'Conversations need to move between departments.',
              'Managers need better visibility into customer interactions.',
              'Employees need to take over conversations from one another.',
              'WhatsApp is becoming an important sales or support channel.',
            ]}
          />
        </div>

        <div className="mt-8 max-w-2xl mx-auto space-y-3 text-center text-base text-slate-700">
          {/*
            The copy tells some readers this is not for them. Kept verbatim, and worth keeping:
            a product page that names who should not buy is the reason the rest of it is
            believed. It is also the honest answer for a one-person business.
          */}
          <p>
            For a business with only one person managing a small number of conversations, a
            team inbox may not be necessary.
          </p>
          <p>For growing customer-facing teams, it can provide a more organized way to work.</p>
        </div>

        <div className="mt-8 text-center">
          <ArrowLink to="/pricing">See ZunoPilot Pricing</ArrowLink>
        </div>
      </Section>

      {/* ------------------------ Connected experience ------------------------ */}
      <Section>
        <SectionHead
          title={['WhatsApp Team Inbox for a More', 'Connected Customer Experience']}
          lead={(
            <>
              <p>Customers don&rsquo;t see your internal team structure.</p>
              <p>
                They simply expect the business to know what they previously discussed and
                provide a useful response.
              </p>
              <p>
                A shared inbox helps your organization work toward that experience by giving
                authorized employees a common environment for managing customer conversations.
              </p>
            </>
          )}
        />

        <div className="mt-10">
          <ClosingTriad />
        </div>

        <p className="mt-8 text-center text-base text-slate-700 max-w-2xl mx-auto">
          That&rsquo;s the purpose of a team-based WhatsApp inbox.
        </p>
      </Section>

      <FaqSection faqs={FAQS} />

      <CtaBand
        title={['Bring Your WhatsApp', 'Team Together']}
        body={[
          'Give your sales, support, and customer-facing employees a shared environment for '
          + 'managing business WhatsApp conversations.',
          "With ZunoPilot's WhatsApp Team Inbox, your team can work with greater visibility, "
          + 'clearer responsibility, and easier conversation handoffs.',
        ]}
      />

      <SiteFooter />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                                  Figures                                    */
/* -------------------------------------------------------------------------- */

/**
 * The five things that go wrong without a shared workspace.
 *
 * A `TileGrid` would have been the cheap choice, but these are *symptoms*, not features —
 * so they get the warning tone and an amber icon rather than the violet capability styling
 * used everywhere else on the page. Reading the page top to bottom, the colour flips from
 * amber to violet exactly where the problem section ends, which does more than another
 * heading would.
 */
function FrictionGrid() {
  const PROBLEMS = [
    { icon: CheckCheck, text: 'Two employees responding to the same customer' },
    { icon: AlertTriangle, text: 'Messages waiting because nobody knows who owns them' },
    { icon: Search, text: 'Employees searching for previous conversation details' },
    { icon: MessageSquare, text: 'Customers repeating information after a handoff' },
    { icon: Eye, text: 'Managers having limited visibility into active conversations' },
  ];

  return (
    <motion.ul
      initial="hidden"
      whileInView="show"
      viewport={viewport}
      variants={stagger(0, 0.08)}
      className="mx-auto grid max-w-5xl grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
    >
      {PROBLEMS.map((problem) => (
        <motion.li
          key={problem.text}
          variants={item}
          whileHover={{ y: -4 }}
          transition={CARD_SPRING}
          className="flex h-full items-start gap-3 rounded-2xl bg-white px-5 py-4 ring-1 ring-amber-200/80"
        >
          <span
            aria-hidden
            className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-amber-50 text-amber-600 ring-1 ring-amber-200"
          >
            <problem.icon className="h-[18px] w-[18px]" />
          </span>
          <span className="text-[15px] leading-snug text-slate-800">{problem.text}</span>
        </motion.li>
      ))}
    </motion.ul>
  );
}

/**
 * Individual messaging versus a team inbox, as two panels.
 *
 * The copy states the distinction in four lines and the distinction is the page's entire
 * thesis, so it gets a figure rather than a paragraph. Left panel muted and singular, right
 * panel violet with three avatars — the asymmetry *is* the argument, and it survives being
 * screenshotted without the surrounding prose.
 */
function OwnershipSwitch() {
  return (
    <div className="mx-auto grid max-w-4xl grid-cols-1 items-stretch gap-5 md:grid-cols-2">
      <Reveal>
        <div className="flex h-full flex-col rounded-3xl bg-slate-50 p-6 ring-1 ring-slate-200">
          <p className="text-[11px] font-bold uppercase tracking-widest text-slate-500">
            Individual messaging
          </p>
          <div aria-hidden className="mt-5 flex items-center gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-full bg-slate-200 text-slate-600">
              <UserRound className="h-5 w-5" />
            </span>
            <span className="h-px flex-1 bg-slate-300" />
            <span className="grid h-11 w-11 place-items-center rounded-full bg-white text-slate-500 ring-1 ring-slate-200">
              <MessageSquare className="h-5 w-5" />
            </span>
          </div>
          <p className="mt-5 text-[15px] leading-relaxed text-slate-700">
            &rarr; One employee manages the conversation.
          </p>
        </div>
      </Reveal>

      <Reveal delay={0.12}>
        <div className="flex h-full flex-col rounded-3xl bg-white p-6 ring-1 ring-violet-300 shadow-lg shadow-violet-100">
          <p className="text-[11px] font-bold uppercase tracking-widest text-violet-600">
            Team inbox
          </p>
          <div aria-hidden className="mt-5 flex items-center gap-3">
            <span className="flex -space-x-2">
              {[Users, Headphones, Building2].map((Icon, i) => (
                <motion.span
                  key={i}
                  initial={{ opacity: 0, scale: 0.7 }}
                  whileInView={{ opacity: 1, scale: 1 }}
                  viewport={viewport}
                  transition={{ delay: 0.2 + i * 0.09, ...CARD_SPRING }}
                  className="grid h-11 w-11 place-items-center rounded-full bg-violet-600 text-white ring-2 ring-white"
                >
                  <Icon className="h-5 w-5" />
                </motion.span>
              ))}
            </span>
            <span className="h-px flex-1 bg-violet-200" />
            <span className="grid h-11 w-11 place-items-center rounded-full bg-violet-50 text-violet-600 ring-1 ring-violet-200">
              <MessageSquare className="h-5 w-5" />
            </span>
          </div>
          <p className="mt-5 text-[15px] leading-relaxed text-slate-700">
            &rarr; The business can coordinate who manages the conversation.
          </p>
        </div>
      </Reveal>
    </div>
  );
}

/**
 * Three kinds of conversation, three owners.
 *
 * The copy is three "might belong to" pairs. Rendered as three cards with the conversation
 * type above and the owning team below, so the mapping is read in one pass instead of three.
 */
function OwnerRouting() {
  const ROUTES = [
    { icon: Target, when: 'A new conversation might belong to:', owner: 'Sales' },
    { icon: Headphones, when: 'An existing customer issue might belong to:', owner: 'Support' },
    { icon: ClipboardList, when: 'A service-related request might belong to:', owner: 'Operations' },
  ];

  return (
    <motion.ul
      initial="hidden"
      whileInView="show"
      viewport={viewport}
      variants={stagger(0, 0.1)}
      className="mx-auto grid max-w-5xl grid-cols-1 gap-5 md:grid-cols-3"
    >
      {ROUTES.map((route) => (
        <motion.li key={route.owner} variants={item} className="h-full">
          <GlowCard className="flex h-full flex-col rounded-3xl bg-white p-6 ring-1 ring-slate-200">
            <p className="text-[15px] leading-snug text-slate-600">{route.when}</p>
            <span aria-hidden className="mt-4 block h-px w-full bg-slate-100" />
            <IconTitle
              icon={route.icon}
              as="p"
              className="mt-4 text-xl font-bold text-slate-900"
            >
              {route.owner}
            </IconTitle>
          </GlowCard>
        </motion.li>
      ))}
    </motion.ul>
  );
}

/**
 * One conversation, three owners, one thread.
 *
 * A vertical rail rather than the shared `FlowChain`, because the point is not that these
 * are sequential steps in a process — it is that the *same* conversation stays put while the
 * label on the left changes. So the thread is a continuous line down the middle and the
 * owners hang off it; nothing about the conversation moves.
 */
function HandoffTimeline() {
  const STAGES = [
    { owner: 'Sales', icon: Target, note: 'A sales enquiry may become a support issue.' },
    { owner: 'Support', icon: Headphones, note: 'A support request may need help from operations.' },
    { owner: 'Operations', icon: ClipboardList, note: 'Another team member may need to continue the conversation.' },
  ];

  return (
    <div className="mx-auto max-w-3xl">
      <Reveal>
        <p className="mb-5 text-center text-[13px] font-semibold uppercase tracking-widest text-violet-600">
          One conversation
        </p>
      </Reveal>

      <motion.ol
        initial="hidden"
        whileInView="show"
        viewport={viewport}
        variants={stagger(0.1, 0.14)}
        className="relative space-y-4 pl-10"
      >
        {/*
          The thread itself. `scaleY` from the top so it draws downward as the section
          arrives — the one animation on this figure that carries meaning rather than
          decoration, because a line being drawn reads as continuity.
        */}
        <motion.span
          aria-hidden
          initial={{ scaleY: 0 }}
          whileInView={{ scaleY: 1 }}
          viewport={viewport}
          transition={{ duration: 0.9, ease: EASE_OUT }}
          style={{ originY: 0 }}
          className="absolute left-[15px] top-2 bottom-2 w-0.5 rounded-full bg-gradient-to-b from-violet-400 to-violet-200"
        />

        {STAGES.map((stage) => (
          <motion.li key={stage.owner} variants={item} className="relative">
            <span
              aria-hidden
              className="absolute -left-10 top-4 grid h-8 w-8 place-items-center rounded-full bg-violet-600 text-white ring-4 ring-white"
            >
              <stage.icon className="h-4 w-4" />
            </span>
            <div className="rounded-2xl bg-white px-5 py-4 ring-1 ring-slate-200">
              <p className="text-[11px] font-bold uppercase tracking-widest text-violet-600">
                Now with {stage.owner}
              </p>
              <p className="mt-1.5 text-[15px] leading-snug text-slate-700">{stage.note}</p>
            </div>
          </motion.li>
        ))}
      </motion.ol>
    </div>
  );
}

/**
 * The duplicate-reply failure, played out.
 *
 * Two employees, one customer, two messages. Shown as an actual thread because the harm is
 * something the *customer* experiences — a diagram of internal state would describe the
 * cause and hide the consequence. The second bubble is the one that should not exist, so it
 * is the only element on the page outlined in amber.
 */
function DuplicateReply() {
  const reduce = useReducedMotion();

  return (
    <div className="mx-auto grid max-w-5xl grid-cols-1 items-center gap-5 lg:grid-cols-[1fr_auto_1fr]">
      {/* What each employee sees. */}
      <motion.ul
        initial="hidden"
        whileInView="show"
        viewport={viewport}
        variants={stagger(0, 0.12)}
        className="space-y-4"
      >
        {[
          { who: 'Employee A', act: 'replies to the customer.', icon: UserCheck },
          { who: 'Employee B', act: 'sees the same unanswered message and sends another response.', icon: UserRound },
        ].map((row) => (
          <motion.li
            key={row.who}
            variants={item}
            className="flex items-start gap-3 rounded-2xl bg-white px-5 py-4 ring-1 ring-slate-200"
          >
            <span
              aria-hidden
              className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-600"
            >
              <row.icon className="h-[18px] w-[18px]" />
            </span>
            <p className="text-[15px] leading-snug text-slate-800">
              <span className="font-semibold text-slate-900">{row.who}:</span> {row.act}
            </p>
          </motion.li>
        ))}
      </motion.ul>

      <Reveal delay={0.2}>
        <span
          aria-hidden
          className="mx-auto grid h-10 w-10 place-items-center rounded-full bg-amber-50 text-amber-600 ring-1 ring-amber-200 lg:rotate-0"
        >
          <ArrowRight className="h-5 w-5" />
        </span>
      </Reveal>

      {/* What the customer gets. */}
      <Reveal delay={0.3}>
        <div className="rounded-3xl bg-white p-5 ring-1 ring-amber-300">
          <p className="text-[11px] font-bold uppercase tracking-widest text-amber-600">
            What the customer sees
          </p>
          <div className="mt-4 space-y-2">
            <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-slate-100 px-3.5 py-2.5">
              <p className="text-[14px] leading-snug text-slate-800">
                Thanks for getting in touch — happy to help with that.
              </p>
            </div>
            <motion.div
              initial={{ opacity: 0, x: -8 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={viewport}
              transition={{ delay: 0.45, duration: 0.4 }}
              className="max-w-[85%] rounded-2xl rounded-br-sm bg-amber-50 px-3.5 py-2.5 ring-1 ring-amber-200"
            >
              <p className="text-[14px] leading-snug text-slate-800">
                Hi! Thanks for getting in touch — how can I help?
              </p>
            </motion.div>
          </div>
          <p className="mt-4 text-[13px] font-medium text-amber-700">
            {/* A gentle pulse, because this is the line the figure exists to deliver. */}
            <motion.span
              animate={reduce ? undefined : { opacity: [0.65, 1, 0.65] }}
              transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
            >
              The customer now receives two messages from the same business.
            </motion.span>
          </p>
        </div>
      </Reveal>
    </div>
  );
}

/**
 * The context that travels with the conversation instead of with the employee.
 *
 * A single panel listing what the *next* person can already see. Deliberately understated —
 * the copy around it is hedged ("depends on the configured environment") and a triumphant
 * figure here would overclaim.
 */
function ContextCarry() {
  const CARRIED = [
    { icon: MessageSquare, title: 'What was already discussed' },
    { icon: ClipboardList, title: 'What the customer asked for' },
    { icon: UserCheck, title: 'Who handled it before' },
    { icon: ShieldCheck, title: 'What the business agreed to' },
  ];

  return (
    <Reveal>
      <div className="mx-auto max-w-3xl overflow-hidden rounded-3xl bg-white ring-1 ring-slate-200">
        <div className="flex items-center gap-3 border-b border-slate-100 bg-slate-50/80 px-6 py-4">
          <span
            aria-hidden
            className="grid h-9 w-9 place-items-center rounded-xl bg-violet-600 text-white"
          >
            <Users className="h-[18px] w-[18px]" />
          </span>
          <p className="text-[15px] font-semibold text-slate-900">
            The next team member opens the conversation and can see
          </p>
        </div>

        <motion.ul
          initial="hidden"
          whileInView="show"
          viewport={viewport}
          variants={stagger(0.1, 0.09)}
          className="divide-y divide-slate-100"
        >
          {CARRIED.map((row) => (
            <motion.li
              key={row.title}
              variants={item}
              className="flex items-center gap-3 px-6 py-4"
            >
              <span aria-hidden className="text-violet-600"><row.icon className="h-[18px] w-[18px]" /></span>
              <span className="text-[15px] text-slate-800">{row.title}</span>
            </motion.li>
          ))}
        </motion.ul>

        <p className="border-t border-slate-100 bg-white px-6 py-4 text-[14px] text-slate-600">
          Rather than: &ldquo;Could you explain the whole thing again?&rdquo;
        </p>
      </div>
    </Reveal>
  );
}

/**
 * The sales relay, as the copy's four-arrow sequence.
 *
 * Horizontal on desktop, stacked on mobile, with the connector rotating rather than
 * disappearing — an arrow that points right in a vertical stack is the small wrongness that
 * makes a diagram feel machine-generated.
 */
function SalesRelay() {
  const STEPS = [
    'New enquiry',
    'Sales team sees the conversation',
    'Appropriate representative takes responsibility',
    'Customer receives a response',
    'Another representative can continue when required',
  ];

  return (
    <motion.ol
      initial="hidden"
      whileInView="show"
      viewport={viewport}
      variants={stagger(0, 0.09)}
      className="mx-auto flex max-w-6xl flex-col items-stretch gap-3 lg:flex-row lg:items-center"
    >
      {STEPS.map((step, i) => (
        <motion.li key={step} variants={item} className="flex flex-1 items-center gap-3">
          <div className="flex h-full w-full flex-col justify-center rounded-2xl bg-white px-4 py-4 text-center ring-1 ring-slate-200">
            <span className="text-[11px] font-bold text-violet-600">
              {String(i + 1).padStart(2, '0')}
            </span>
            <span className="mt-1.5 text-[14px] font-medium leading-snug text-slate-800">
              {step}
            </span>
          </div>
          {i < STEPS.length - 1 && (
            <ArrowRight
              aria-hidden
              className="h-5 w-5 shrink-0 rotate-90 text-violet-300 lg:rotate-0"
            />
          )}
        </motion.li>
      ))}
    </motion.ol>
  );
}

/**
 * The four questions a team stops having to ask each other.
 *
 * Rendered as internal chat bubbles, because that is literally where these questions get
 * asked — and showing them as messages makes the point that they are themselves work.
 */
function InternalPings() {
  const QUESTIONS = [
    'Did you reply to this customer?',
    'Who is handling this?',
    'Can you send me the previous messages?',
    'Has this issue been resolved?',
  ];

  return (
    <motion.ul
      initial="hidden"
      whileInView="show"
      viewport={viewport}
      variants={stagger(0, 0.1)}
      className="mx-auto grid max-w-3xl grid-cols-1 gap-3 sm:grid-cols-2"
    >
      {QUESTIONS.map((q, i) => (
        <motion.li
          key={q}
          variants={item}
          className={`rounded-2xl bg-slate-100 px-5 py-3.5 ${
            i % 2 === 0 ? 'rounded-tl-sm' : 'rounded-tr-sm sm:ml-4'
          }`}
        >
          <p className="text-[15px] text-slate-700">&ldquo;{q}&rdquo;</p>
        </motion.li>
      ))}
    </motion.ul>
  );
}

/**
 * The two topologies, one above the other.
 *
 * The copy gives two arrow chains — `Customer → Employee → Customer` and
 * `Customer → Business WhatsApp → Team Inbox → Responsible employee`. Set as monospaced
 * chains so the difference in *length* is visible before either is read, which is the
 * fastest way to make the structural point.
 */
function StructureShift() {
  const Chain = ({ nodes, tone }: { nodes: readonly string[]; tone: 'muted' | 'brand' }) => (
    <div className="flex flex-wrap items-center gap-2">
      {nodes.map((node, i) => (
        <span key={node} className="flex items-center gap-2">
          <span
            className={`rounded-xl px-3.5 py-2 text-[13px] font-semibold ring-1 ${
              tone === 'brand'
                ? 'bg-violet-50 text-violet-700 ring-violet-200'
                : 'bg-slate-100 text-slate-600 ring-slate-200'
            }`}
          >
            {node}
          </span>
          {i < nodes.length - 1 && (
            <ArrowRight
              aria-hidden
              className={`h-4 w-4 ${tone === 'brand' ? 'text-violet-400' : 'text-slate-300'}`}
            />
          )}
        </span>
      ))}
    </div>
  );

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Reveal>
        <div className="rounded-3xl bg-slate-50 p-6 ring-1 ring-slate-200">
          <p className="text-[11px] font-bold uppercase tracking-widest text-slate-500">
            A traditional approach
          </p>
          <div className="mt-4">
            <Chain nodes={['Customer', 'Employee', 'Customer']} tone="muted" />
          </div>
          <p className="mt-4 text-[15px] leading-relaxed text-slate-700">
            The entire relationship depends heavily on that employee.
          </p>
        </div>
      </Reveal>

      <Reveal delay={0.14}>
        <div className="rounded-3xl bg-white p-6 ring-1 ring-violet-300 shadow-lg shadow-violet-100">
          <p className="text-[11px] font-bold uppercase tracking-widest text-violet-600">
            A team-based approach
          </p>
          <div className="mt-4">
            <Chain
              nodes={['Customer', 'Business WhatsApp', 'Team Inbox', 'Responsible employee']}
              tone="brand"
            />
          </div>
        </div>
      </Reveal>
    </div>
  );
}

/**
 * The four companion features, with their internal links.
 *
 * Cards rather than the shared `TileGrid`, because each one has to carry a link and
 * `TileGrid`'s tiles are `cursor-default` by design. These are the page's main outbound
 * links to its siblings, which is the reason the internal-linking plan lists them.
 */
function CompanionFeatures() {
  const COMPANIONS = [
    {
      icon: Workflow,
      title: 'WhatsApp Automation',
      body: 'Use automation for suitable recurring processes while your team handles conversations that need human involvement.',
      label: 'WhatsApp Automation',
      href: '/features/whatsapp-automation',
    },
    {
      icon: Bot,
      title: 'AI WhatsApp Automation',
      body: 'Add AI assistance to appropriate customer interactions while keeping human team members available when required.',
      label: 'AI WhatsApp Automation',
      href: '/features/ai-whatsapp-automation',
    },
    {
      icon: Megaphone,
      title: 'WhatsApp Campaigns',
      body: "When customers respond to campaign communication, those conversations can become part of the team's customer communication workflow.",
      label: 'WhatsApp Campaigns',
      href: '/features/whatsapp-campaigns',
    },
    {
      icon: ShieldCheck,
      title: 'WhatsApp Number Masking',
      body: 'Use number-management capabilities alongside team communication where supported by your ZunoPilot setup.',
      label: 'WhatsApp Number Masking',
      href: '/features/whatsapp-number-masking',
    },
  ];

  return (
    <motion.ul
      initial="hidden"
      whileInView="show"
      viewport={viewport}
      variants={stagger(0, 0.08)}
      className="mx-auto grid max-w-5xl grid-cols-1 gap-5 sm:grid-cols-2"
    >
      {COMPANIONS.map((c) => (
        <motion.li key={c.href} variants={item} className="h-full">
          <Link to={c.href} className="group block h-full">
            <motion.div
              whileHover={{ y: -6, boxShadow: '0 18px 40px -14px rgb(96 73 231 / 0.22)' }}
              whileTap={{ scale: 0.99 }}
              transition={CARD_SPRING}
              className="flex h-full flex-col rounded-3xl bg-white p-6 ring-1 ring-slate-200"
            >
              <IconTitle icon={c.icon} as="h3" className="text-lg font-bold text-slate-900">
                {c.title}
              </IconTitle>
              <p className="mt-3 flex-1 text-[15px] leading-relaxed text-slate-700">{c.body}</p>
              <span className="mt-5 inline-flex items-center gap-2 text-[15px] font-semibold text-violet-600">
                {c.label}
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </span>
            </motion.div>
          </Link>
        </motion.li>
      ))}

      {/*
        The API page is not one of the four the copy names, but the internal-linking plan asks
        for it "if relevant" — and on a page about several people sharing one business number,
        how that number connects to the rest of the business is relevant. One line, not a fifth
        card, so it does not compete with the four the copy chose.
      */}
      <motion.li variants={item} className="sm:col-span-2">
        <p className="rounded-2xl bg-slate-50 px-5 py-4 text-[15px] text-slate-700 ring-1 ring-slate-200">
          Connecting WhatsApp to your own systems and integrations?{' '}
          <Link
            to="/features/whatsapp-business-api"
            className="font-semibold text-violet-600 underline underline-offset-4 hover:text-violet-700"
          >
            WhatsApp Business API
          </Link>
        </p>
      </motion.li>
    </motion.ul>
  );
}

/**
 * "One customer. One conversation. The right team member."
 *
 * Three short lines, so they get three panels and nothing else. The copy is already the
 * figure; the only job here is to stop the browser setting it as one run of prose.
 */
function ClosingTriad() {
  const LINES = [
    { icon: UserRound, text: 'One customer.' },
    { icon: MessageSquare, text: 'One conversation.' },
    { icon: Sparkles, text: 'The right team member.' },
  ];

  return (
    <motion.ul
      initial="hidden"
      whileInView="show"
      viewport={viewport}
      variants={stagger(0.05, 0.14)}
      className="mx-auto grid max-w-4xl grid-cols-1 gap-4 sm:grid-cols-3"
    >
      {LINES.map((line) => (
        <motion.li
          key={line.text}
          variants={item}
          whileHover={{ y: -4 }}
          transition={CARD_SPRING}
          className="rounded-3xl bg-gradient-to-br from-violet-50 to-white p-6 text-center ring-1 ring-violet-200/80"
        >
          <span
            aria-hidden
            className="mx-auto grid h-11 w-11 place-items-center rounded-2xl bg-violet-600 text-white"
          >
            <line.icon className="h-5 w-5" />
          </span>
          <p className="mt-4 text-lg font-bold text-slate-900">{line.text}</p>
        </motion.li>
      ))}
    </motion.ul>
  );
}
