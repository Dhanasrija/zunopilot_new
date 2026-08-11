import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { useDocumentHead } from '@/lib/document-head';
import { PAGE_HEADS } from '@/lib/page-heads';
import SiteHeader from '@/components/marketing/SiteHeader';
import SiteFooter from '@/components/marketing/SiteFooter';
import {
  ArrowLink, CheckList, CtaBand, EASE_OUT, FaqSection, FlowChain, MatchTable, PageHero,
  ScrollProgress, Section, SectionHead, TileGrid, viewport
} from '@/components/marketing/primitives';

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
        id="shared-whatsapp-portal"
        tone="tinted"
        eyebrow="Shared WhatsApp Portal"
        title={['Give Your Entire Team', 'a Central Workspace']}
        body={(
          <>
            <p>
              When several employees handle WhatsApp communication independently, businesses can
              lose visibility into conversations and follow-ups.
            </p>
            <p>
              ZunoPilot&rsquo;s Shared WhatsApp Portal provides a centralized environment where
              authorized team members can work with business conversations.
            </p>
            <p>
              Instead of customer communication being dependent on one employee&rsquo;s device,
              teams can work from a shared business environment.
            </p>
          </>
        )}
        listLabel="Useful for:"
        list={[
          'Sales teams',
          'Customer support',
          'Service businesses',
          'Multi-user operations',
          'Businesses handling high conversation volumes',
          'Teams covering different shifts',
          'Businesses where more than one person answers the same number',
          'Owners who need visibility without reading every chat',
          'Handing a conversation over without losing its history',
          'Keeping customer relationships with the business, not a device',
        ]}
        href="/features/shared-whatsapp-portal"
        cta="Explore Shared WhatsApp Portal"
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
        href="/whatsapp-business-api"
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
        <FlowChain className="mt-10" steps={CONNECTED_FLOW} />
        <p className="mt-8 text-center text-base text-slate-600 max-w-2xl mx-auto">
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
        <div className="mt-10 grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="rounded-3xl bg-white ring-1 ring-slate-200/80 p-6 sm:p-8">
            <p className="text-base font-semibold text-slate-900">ZunoPilot can automate:</p>
            <CheckList
              columns={1}
              className="mt-5"
              items={[
                'Recurring messages',
                'Routine enquiries',
                'Follow-up workflows',
                'Notifications',
                'Reminders',
                'Campaign communication',
              ]}
            />
          </div>
          <div className="rounded-3xl bg-white ring-1 ring-slate-200/80 p-6 sm:p-8">
            <p className="text-base font-semibold text-slate-900">Your team can focus on:</p>
            <CheckList
              columns={1}
              className="mt-5"
              items={[
                'Complex enquiries',
                'Sales discussions',
                'Customer issues',
                'Negotiations',
                'High-value opportunities',
                'Human support',
              ]}
            />
          </div>
        </div>
        <p className="mt-8 text-center text-base text-slate-600 max-w-2xl mx-auto">
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
  ['Give multiple employees access to conversations', 'Shared WhatsApp Portal', '/features/shared-whatsapp-portal'],
  ['Control customer-facing business numbers', 'WhatsApp Number Masking', '/features/whatsapp-number-masking'],
  ['Communicate with customers through campaigns', 'WhatsApp Campaigns', '/features/whatsapp-campaigns'],
  ['Let multiple agents manage conversations', 'WhatsApp Team Inbox', '/features/whatsapp-team-inbox'],
  ['Connect WhatsApp with business systems', 'WhatsApp Business API', '/whatsapp-business-api'],
];

const CONNECTED_FLOW = [
  'Customer sends a WhatsApp message',
  'Automation identifies the required workflow',
  'AI assists with routine communication',
  'Conversation reaches the appropriate team member',
  'Team manages the customer interaction through the shared environment',
  'Follow-up or another business action is triggered',
];

const TEAMS = [
  { title: 'Sales Teams', body: 'Use automation and shared conversations to manage enquiries, follow-ups, and customer interactions.' },
  { title: 'Customer Support', body: 'Combine automated responses with team-based conversation management.' },
  { title: 'Marketing Teams', body: 'Use campaigns and customer communication to support promotions and engagement.' },
  { title: 'Operations', body: 'Automate recurring notifications, reminders, and operational communication.' },
  { title: 'Business Owners', body: 'Create a more centralized approach to customer communication and team collaboration.' },
  { title: 'Service & Field Teams', body: 'Keep customers informed before, during and after a visit without swapping personal numbers.' },
];


const WHY_FEATURES = [
  { title: 'Reduce Manual Work', body: "Automate repetitive communication that would otherwise consume your team's time." },
  { title: 'Improve Response Consistency', body: 'Use structured workflows to create a more predictable customer communication experience.' },
  { title: 'Support Team Collaboration', body: 'Give multiple users a shared environment for managing business conversations.' },
  { title: 'Maintain Business Control', body: 'Move customer communication toward a centralized business-managed process.' },
  { title: 'Prepare for Growth', body: 'Create workflows that can evolve as your customer base, team, and communication volume increase.' },
  { title: 'Keep Customer Relationships', body: 'Conversations belong to the business, so a customer relationship survives a change of staff.' },
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
