import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import {
  ArrowRight, LifeBuoy, Megaphone, MessageSquare, Repeat,
} from 'lucide-react';
import { useDocumentHead } from '@/lib/document-head';
import { PAGE_HEADS } from '@/lib/page-heads';
import SiteHeader from '@/components/marketing/SiteHeader';
import SiteFooter from '@/components/marketing/SiteFooter';
import {
  ArrowLink, CARD_SPRING, CheckList, CtaBand, EASE_OUT, FaqSection, MatchTable, PageHero,
  ScrollProgress, Section, SectionHead, StepRail, TileGrid, item, stagger, viewport
} from '@/components/marketing/primitives';

/*
 * /solutions — the hub.
 *
 * The distinction this page has to carry, and the one visitors get wrong: **features
 * are what the product does, solutions are what you are trying to achieve.** The same
 * shared inbox appears under sales, support and engagement; what changes is the
 * outcome someone came looking for. So this page is organised by objective and links
 * *sideways* into /features rather than repeating the capability list — a visitor who
 * arrives on "whatsapp lead management" should land on a page about leads, not on a
 * feature tour they have to translate themselves.
 *
 * Each of the five sections here summarises a page of its own under /solutions, and
 * links to it. The summary is not filler: a visitor who only reads this page should
 * still come away knowing which solution matches their problem.
 */

interface SolutionBlockProps {
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

function SolutionBlock({
  id, eyebrow, title, body, listLabel, list, href, cta, tone = 'white', flip = false,
}: SolutionBlockProps) {
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

export default function Solutions() {
  useDocumentHead(PAGE_HEADS.solutions);

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <ScrollProgress />
      <SiteHeader />

      <PageHero
        title={['WhatsApp Business Solutions for', 'Sales, Support & Customer Engagement']}
        intro={[
          'Turn everyday WhatsApp conversations into organized business processes. ZunoPilot helps businesses manage leads, support customers, improve sales follow-ups, engage audiences, and coordinate communication across teams.',
          "Whether you're looking to respond faster, reduce repetitive work, or create a more consistent customer journey, choose the ZunoPilot solution that matches your business goal.",
        ]}
      />

      {/* ------------------------------ The problem --------------------------- */}
      <Section tone="tinted">
        <SectionHead
          title={['Turn Customer Conversations', 'Into Business Opportunities']}
          lead={(
            <>
              <p>
                For many businesses, a WhatsApp message is the starting point of a customer
                journey.
              </p>
              <p>
                A prospect may ask about a product. A customer may need support. Someone may
                respond to a promotion. Another customer may need a reminder or update.
              </p>
              <p>
                The challenge is making sure every conversation leads to the right next action.
              </p>
              <p>
                ZunoPilot helps businesses create structured WhatsApp processes around these
                interactions, so teams can move from individual messages to organized customer
                workflows.
              </p>
            </>
          )}
        />
        <div className="mt-10 max-w-4xl mx-auto rounded-3xl bg-white ring-1 ring-slate-200/80 p-6 sm:p-8">
          <p className="text-base font-semibold text-slate-900">
            Common business challenges ZunoPilot can help address
          </p>
          <CheckList items={CHALLENGES} className="mt-5" />
        </div>
      </Section>

      <Section>
        <SectionHead title={['Solutions Designed Around', 'Your Business Goals']} />
      </Section>

      {/* ---------------------------- The five blocks ------------------------- */}
      <SolutionBlock
        id="lead-management"
        tone="tinted"
        eyebrow="Lead Management"
        title={['Capture and Follow Up', 'With More WhatsApp Leads']}
        body={(
          <>
            <p>
              Every customer enquiry represents a potential opportunity. But when leads arrive
              through WhatsApp, manually tracking every conversation and follow-up can become
              difficult as enquiry volume increases.
            </p>
            <p>
              ZunoPilot helps businesses create a more organized approach to WhatsApp lead
              management.
            </p>
            <p>
              From initial enquiries to follow-up conversations, teams can create structured
              processes that help keep prospects engaged and move them toward the next stage.
            </p>
          </>
        )}
        listLabel="Use WhatsApp for:"
        list={[
          'New lead enquiries',
          'Prospect communication',
          'Lead follow-ups',
          'Qualification conversations',
          'Sales handoffs',
          'Re-engagement',
          'First-response acknowledgement',
          'Requirement collection before handoff',
          'Reminders for prospects who go quiet',
          'Routing an enquiry to the right salesperson',
        ]}
        href="/solutions/lead-management"
        cta="Explore Lead Management"
      />

      <SolutionBlock
        id="sales-automation"
        flip
        eyebrow="Sales Automation"
        title={['Keep Sales Conversations', 'Moving']}
        body={(
          <>
            <p>
              Sales teams often spend a significant amount of time answering similar questions,
              checking on prospects, and sending follow-up messages.
            </p>
            <p>
              ZunoPilot helps businesses structure these recurring communication activities
              around WhatsApp.
            </p>
            <p>
              Automated processes can handle repeatable parts of the customer journey while
              sales representatives focus on conversations that require product knowledge,
              negotiation, or personal attention.
            </p>
          </>
        )}
        listLabel="Support your sales process with:"
        list={[
          'Automated follow-ups',
          'Prospect engagement',
          'Sales enquiries',
          'Qualification workflows',
          'Customer communication',
          'Opportunity follow-up',
          'Scheduled and triggered follow-ups',
          'Answering recurring product questions',
          'Quote and proposal follow-through',
          'Shared visibility of live opportunities',
        ]}
        href="/solutions/sales-automation"
        cta="Explore Sales Automation"
      />

      <SolutionBlock
        id="customer-support"
        tone="tinted"
        eyebrow="Customer Support"
        title={['Give Customers a More', 'Connected Support Experience']}
        body={(
          <>
            <p>
              Customers expect businesses to be accessible when they need help. But managing
              support conversations through individual phones or disconnected processes can make
              it harder for teams to maintain consistency.
            </p>
            <p>ZunoPilot helps businesses create a more organized WhatsApp support workflow.</p>
            <p>
              Routine interactions can follow predefined processes, while support agents can take
              over when a customer needs detailed assistance.
            </p>
          </>
        )}
        listLabel="Support customer communication through:"
        list={[
          'Customer enquiries',
          'Service requests',
          'Frequently asked questions',
          'Status updates',
          'Follow-ups',
          'Support conversations',
          'Order and delivery status questions',
          'Routing to the right agent',
          'Escalation with the full conversation history',
          'Post-resolution follow-up',
        ]}
        href="/solutions/customer-support"
        cta="Explore Customer Support"
      />

      <SolutionBlock
        id="marketing-automation"
        flip
        eyebrow="Marketing Automation"
        title={['Turn WhatsApp Into a', 'Customer Engagement Channel']}
        body={(
          <>
            <p>Marketing doesn&rsquo;t stop when a customer first discovers your business.</p>
            <p>
              Businesses may need to communicate promotions, announcements, product updates,
              offers, and other relevant information throughout the customer relationship.
            </p>
            <p>
              ZunoPilot helps businesses incorporate WhatsApp into their customer engagement
              strategy through structured campaign and communication workflows.
            </p>
          </>
        )}
        listLabel="Marketing use cases include:"
        list={[
          'Promotions',
          'Product announcements',
          'Customer updates',
          'Re-engagement',
          'Campaign communication',
          'Audience engagement',
          'Seasonal and event-driven offers',
          'Approved message templates for recurring sends',
          'Targeted sends to a defined audience',
          'Turning a campaign reply into a lead',
        ]}
        href="/solutions/marketing-automation"
        cta="Explore Marketing Automation"
      />

      <SolutionBlock
        id="customer-engagement"
        tone="tinted"
        eyebrow="Customer Engagement"
        title={['Stay Connected Beyond', 'the First Conversation']}
        body={(
          <>
            <p>A successful customer relationship often involves multiple interactions.</p>
            <p>
              A customer may need a reminder after an enquiry, an update after a purchase, or
              useful information after becoming a customer.
            </p>
            <p>
              ZunoPilot helps businesses build ongoing WhatsApp communication around these
              customer moments. Instead of treating every message as an isolated interaction,
              businesses can create a more connected customer communication journey.
            </p>
          </>
        )}
        listLabel="Customer engagement can support:"
        list={[
          'Follow-up communication',
          'Customer updates',
          'Reminders',
          'Re-engagement',
          'Relationship building',
          'Repeat interactions',
          'Appointment and booking reminders',
          'Post-purchase check-ins',
          'Renewal and repeat-order prompts',
          'Win-back messages for lapsed customers',
        ]}
        href="/solutions/customer-engagement"
        cta="Explore Customer Engagement"
      />

      {/* ----------------------------- The journey ---------------------------- */}
      <Section>
        <SectionHead
          title={['One WhatsApp Conversation Can Support', 'the Entire Customer Journey']}
          lead={(
            <>
              <p>A customer doesn&rsquo;t always follow a straight path.</p>
              <p>
                They might discover your business today, ask questions tomorrow, make a purchase
                later, and return for support weeks afterward.
              </p>
              <p>ZunoPilot helps businesses build communication processes around these different stages.</p>
            </>
          )}
        />
        {/*
          Two rails of three rather than one of six: `StepRail` lays out four across,
          and six items in a four-column grid leaves an orphaned pair on the second row.
        */}
        <div className="mt-12 space-y-4 sm:space-y-5">
          <StepRail steps={JOURNEY_STAGES.slice(0, 3)} columns={3} />
          <StepRail steps={JOURNEY_STAGES.slice(3)} columns={3} />
        </div>
        <p className="mt-8 text-center text-base text-slate-600 max-w-2xl mx-auto">
          This creates a more connected communication experience instead of treating every
          WhatsApp message as a separate task.
        </p>
      </Section>

      {/* ------------------------------- Chooser ------------------------------ */}
      <Section tone="tinted">
        <SectionHead title={['Match the Solution to', 'Your Business Objective']} />
        <div className="mt-10 max-w-4xl mx-auto">
          <MatchTable head={['Your business goal', 'Recommended solution']} rows={CHOOSER} />
        </div>
      </Section>

      {/* --------------------------- Combine with features -------------------- */}
      <Section>
        <SectionHead
          title={['Combine Business Solutions', 'With ZunoPilot Features']}
          lead={(
            <p>
              Your business objective determines what you want to achieve. ZunoPilot&rsquo;s
              features provide the capabilities that help you build the workflow.
            </p>
          )}
        />
        <div className="mt-10 grid grid-cols-1 lg:grid-cols-3 gap-5">
          {COMBINATIONS.map((combo) => (
            <div key={combo.title} className="rounded-3xl bg-white ring-1 ring-slate-200/80 p-6 sm:p-8">
              <p className="text-base font-semibold text-slate-900">{combo.title}</p>
              <CheckList items={combo.items} columns={1} className="mt-5" />
            </div>
          ))}
        </div>
        <div className="mt-10 text-center">
          <ArrowLink to="/features">Explore all ZunoPilot Features</ArrowLink>
        </div>
      </Section>

      {/* -------------------------------- Teams ------------------------------- */}
      <Section tone="tinted">
        <SectionHead title={['Solutions for Different', 'Business Teams']} />
        <div className="mt-10">
          <TileGrid tiles={TEAMS} />
        </div>
      </Section>

      {/* ----------------------------- The next step -------------------------- */}
      {/*
        Rebuilt. This band was a centred heading, a centred question, then a
        left-aligned tick list inside a narrower container and a trailing paragraph
        that lined up with neither — four different alignments stacked on top of each
        other, which is what made it read as broken.

        It is now one centred column throughout, and the four statements are the point
        of the section rather than a footnote to it: each is a trigger and an outcome
        with an arrow between them, because "a customer enquiry can lead to a sales
        workflow" *is* a two-part statement and setting it as a sentence hides that.
      */}
      <Section>
        <SectionHead
          title={['Build More Efficient', 'WhatsApp Workflows']}
          lead={(
            <p>
              A business WhatsApp strategy should be more than sending and receiving messages.
              It should help your team answer an important question:
            </p>
          )}
        />

        {/* The question, given the weight the copy gives it. */}
        <motion.figure
          initial={{ opacity: 0, y: 24, scale: 0.97 }}
          whileInView={{ opacity: 1, y: 0, scale: 1 }}
          viewport={viewport}
          transition={{ duration: 0.6, ease: EASE_OUT }}
          className="relative mt-10 mx-auto max-w-3xl overflow-hidden rounded-3xl bg-gradient-to-br from-violet-600 to-violet-700 px-6 py-10 sm:px-12 sm:py-12 text-center shadow-xl shadow-violet-300/50"
        >
          <span
            aria-hidden
            className="pointer-events-none absolute -right-20 -top-20 h-56 w-56 rounded-full bg-white/10 blur-2xl"
          />
          <blockquote className="relative text-2xl sm:text-3xl font-extrabold tracking-tight text-white leading-snug">
            What should happen after this customer sends a message?
          </blockquote>
          <figcaption className="relative mt-5 text-sm font-medium text-violet-100">
            ZunoPilot helps businesses structure that next step.
          </figcaption>
        </motion.figure>

        {/* Trigger → outcome, four ways. */}
        <motion.ul
          initial="hidden"
          whileInView="show"
          viewport={viewport}
          variants={stagger(0.05, 0.09)}
          className="mt-10 grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-5 max-w-5xl mx-auto"
        >
          {NEXT_STEPS.map(({ icon: Icon, trigger, outcome }) => (
            <motion.li
              key={trigger}
              variants={item}
              whileHover={{ y: -4 }}
              transition={CARD_SPRING}
              className="flex h-full items-center gap-4 rounded-3xl bg-white ring-1 ring-slate-200/80 p-5 sm:p-6"
            >
              <span className="grid place-items-center h-11 w-11 shrink-0 rounded-2xl bg-violet-100 text-violet-600 ring-1 ring-violet-200/70">
                <Icon className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <p className="text-[15px] font-semibold text-slate-900">{trigger}</p>
                <p className="mt-1 flex items-center gap-1.5 text-sm text-slate-500">
                  <ArrowRight aria-hidden className="h-3.5 w-3.5 shrink-0 text-violet-500" />
                  {outcome}
                </p>
              </div>
            </motion.li>
          ))}
        </motion.ul>

        <motion.p
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={viewport}
          transition={{ duration: 0.5, ease: EASE_OUT }}
          className="mt-10 text-center text-base text-slate-600 max-w-2xl mx-auto"
        >
          This makes WhatsApp a more useful part of your overall business process.
        </motion.p>
      </Section>

      {/* --------------------------------- Why -------------------------------- */}
      <Section tone="tinted">
        <SectionHead title={['Why Businesses Choose', 'WhatsApp-Based Solutions']} />
        <div className="mt-10">
          <TileGrid tiles={WHY_SOLUTIONS} />
        </div>
      </Section>

      <FaqSection faqs={SOLUTIONS_FAQS} />

      <CtaBand
        title={['Find the Right WhatsApp', 'Solution for Your Business']}
        body={[
          'Whether your priority is generating leads, improving sales follow-ups, organizing customer support, running campaigns, or strengthening customer relationships, ZunoPilot helps you build a WhatsApp workflow around your business objectives.',
        ]}
      />

      <SiteFooter />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                                    Copy                                     */
/* -------------------------------------------------------------------------- */

const CHALLENGES = [
  "Leads that don't receive timely follow-ups",
  'Repetitive customer enquiries',
  'Conversations spread across different users',
  'Manual sales communication',
  'Support teams handling recurring questions',
  'Disconnected marketing communication',
  'Customers becoming inactive after the first interaction',
];

const JOURNEY_STAGES = [
  { index: '01', title: 'Discover', body: 'A customer starts a conversation with your business.' },
  { index: '02', title: 'Respond', body: 'The initial enquiry receives an appropriate response.' },
  { index: '03', title: 'Qualify', body: "The business understands the customer's requirement." },
  { index: '04', title: 'Convert', body: 'The conversation moves toward a purchase, booking, or other business outcome.' },
  { index: '05', title: 'Support', body: 'Customers can return through WhatsApp when they need assistance.' },
  { index: '06', title: 'Re-engage', body: 'Businesses can continue appropriate communication after the initial interaction.' },
];

/** The four "what happens next" pairs, split into trigger and outcome. */
const NEXT_STEPS = [
  { icon: MessageSquare, trigger: 'A customer enquiry', outcome: 'can lead to a sales workflow' },
  { icon: LifeBuoy, trigger: 'A support request', outcome: 'can reach the appropriate team' },
  { icon: Megaphone, trigger: 'A campaign response', outcome: 'can become a new lead' },
  { icon: Repeat, trigger: 'A customer interaction', outcome: 'can trigger a follow-up' },
];

const CHOOSER: readonly (readonly [string, string, string?])[] = [
  ['Manage incoming prospects', 'Lead Management', '/solutions/lead-management'],
  ['Improve follow-ups and conversions', 'Sales Automation', '/solutions/sales-automation'],
  ['Organize customer assistance', 'Customer Support', '/solutions/customer-support'],
  ['Run customer outreach', 'Marketing Automation', '/solutions/marketing-automation'],
  ['Maintain ongoing relationships', 'Customer Engagement', '/solutions/customer-engagement'],
];

const COMBINATIONS = [
  {
    title: 'A business focused on lead management may combine:',
    items: [
      'WhatsApp automation',
      'AI assistance',
      'Shared WhatsApp Portal',
      'Team Inbox',
      'Follow-up workflows',
    ],
  },
  {
    title: 'A customer support team may combine:',
    items: [
      'AI-powered interactions',
      'Shared conversations',
      'Team Inbox',
      'Automated workflows',
    ],
  },
  {
    title: 'A marketing team may combine:',
    items: [
      'WhatsApp campaigns',
      'Customer engagement workflows',
      'Automated communication',
    ],
  },
];

const TEAMS = [
  { title: 'Sales Teams', body: 'Spend less time managing repetitive follow-ups and more time engaging qualified prospects.' },
  { title: 'Customer Support Teams', body: 'Create a more organized environment for handling customer conversations and support requests.' },
  { title: 'Marketing Teams', body: 'Use WhatsApp as part of a broader customer engagement and campaign strategy.' },
  { title: 'Operations Teams', body: 'Create repeatable communication processes for reminders, updates, and notifications.' },
  { title: 'Business Owners', body: 'Bring customer communication into a more structured business-managed process.' },
  { title: 'Founders & Small Teams', body: 'Stop being the person who personally answers every enquiry that comes in.' },
];

const WHY_SOLUTIONS = [
  { title: 'Reach Customers Where They Communicate', body: 'WhatsApp provides a familiar communication channel for conversations between businesses and customers.' },
  { title: 'Reduce Repetitive Work', body: 'Structured workflows can reduce the amount of manual communication your team needs to perform.' },
  { title: 'Improve Follow-Up Consistency', body: 'Create processes that help your team stay connected with prospects and customers.' },
  { title: 'Support Team Collaboration', body: 'Give authorized team members a more organized way to work with customer conversations.' },
  { title: 'Create Connected Customer Journeys', body: 'Link enquiries, follow-ups, support, engagement, and other interactions into a broader communication process.' },
  { title: 'Scale Your Communication', body: 'Build workflows that can evolve as customer interactions and team requirements increase.' },
];

const SOLUTIONS_FAQS = [
  {
    question: 'What are WhatsApp business solutions?',
    answer:
      'WhatsApp business solutions help companies use WhatsApp for specific business objectives '
      + 'such as lead management, sales communication, customer support, marketing, and customer '
      + 'engagement.',
  },
  {
    question: 'What business problems can ZunoPilot solve?',
    answer:
      'ZunoPilot helps businesses address challenges such as repetitive communication, '
      + 'inconsistent follow-ups, fragmented team conversations, manual support processes, and '
      + 'disconnected customer engagement.',
  },
  {
    question: 'How can ZunoPilot help with lead management?',
    answer:
      'ZunoPilot helps businesses structure WhatsApp communication for new enquiries, prospect '
      + 'engagement, follow-ups, qualification, and sales handoffs.',
  },
  {
    question: 'Can WhatsApp be used for sales automation?',
    answer:
      'Yes. WhatsApp can support sales activities such as prospect engagement, follow-ups, '
      + 'qualification, customer communication, and other repeatable sales processes.',
  },
  {
    question: 'How can businesses use WhatsApp for customer support?',
    answer:
      'Businesses can use WhatsApp for enquiries, support requests, updates, and follow-ups. '
      + 'ZunoPilot can add structured workflows, AI assistance, and team-based conversation '
      + 'management to these processes.',
  },
  {
    question: 'Can ZunoPilot support WhatsApp marketing?',
    answer:
      'Yes. ZunoPilot can support WhatsApp campaigns and customer engagement workflows for '
      + 'promotions, announcements, updates, and re-engagement, subject to applicable messaging '
      + 'requirements and configured capabilities.',
  },
  {
    question: 'What is the difference between Features and Solutions?',
    answer:
      'Features describe what ZunoPilot can do, such as AI automation, shared conversations, '
      + 'campaigns, and Team Inbox. Solutions explain how those capabilities can be applied to '
      + 'business objectives such as sales, lead management, customer support, and marketing.',
  },
  {
    question: 'Can a business use multiple ZunoPilot solutions?',
    answer:
      'Yes. Businesses can combine different solutions according to their customer journey. For '
      + 'example, a company can use lead management and sales automation for prospects and '
      + 'customer support and engagement workflows for existing customers.',
  },
];
