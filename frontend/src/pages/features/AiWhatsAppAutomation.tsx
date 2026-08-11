import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight } from 'lucide-react';
import { useDocumentHead } from '@/lib/document-head';
import { PAGE_HEADS } from '@/lib/page-heads';
import SiteHeader from '@/components/marketing/SiteHeader';
import SiteFooter from '@/components/marketing/SiteFooter';
import {
  ArrowLink, CARD_SPRING, CheckList, CtaBand, FaqSection, FlowChain, MatchTable,
  PageHero, ScrollProgress, Section, SectionHead, TileGrid, item, stagger, viewport
} from '@/components/marketing/primitives';

/*
 * /features/ai-whatsapp-automation
 *
 * The page that has to draw a line between "automation" and "AI automation", because
 * the two terms are used interchangeably everywhere else and a visitor arriving here
 * from /features/whatsapp-automation should be able to tell what they just clicked
 * into. The distinction the copy settles on — rules control the process, AI makes the
 * *interaction* flexible — is carried by two devices: the "same question, three
 * phrasings" block near the top, and the side-by-side comparison table further down.
 *
 * Every claim about what AI does is hedged to "can assist with", deliberately and
 * throughout. This is a product page for a capability whose behaviour depends on how a
 * given workspace configures it, and promising a specific outcome here is a promise
 * the configuration may not keep.
 */

/** A customer's own words, quoted. Used to show natural-language variation. */
function Utterance({ text }: { text: string }) {
  return (
    <motion.li
      variants={item}
      className="rounded-2xl bg-white ring-1 ring-slate-200/80 px-5 py-3 text-[15px] text-slate-700"
    >
      &ldquo;{text}&rdquo;
    </motion.li>
  );
}

export default function AiWhatsAppAutomation() {
  useDocumentHead(PAGE_HEADS.aiWhatsappAutomation);

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <ScrollProgress />
      <SiteHeader />

      <PageHero
        title={['AI WhatsApp Automation for', 'Smarter Customer Conversations']}
        intro={[
          "Customers don't always ask questions in the same way. They use different words, provide incomplete information, change their requirements, and expect businesses to understand the context of their conversation.",
          'ZunoPilot combines AI with WhatsApp automation to help businesses handle customer communication more intelligently.',
          'Use AI-assisted conversations for routine enquiries, customer questions, lead qualification, and other suitable interactions while connecting important conversations to the right business workflow or team member.',
        ]}
      />

      {/* ------------------------------- AI layer ------------------------------ */}
      <Section tone="tinted">
        <SectionHead
          title={['Give Your WhatsApp', 'Conversations an AI Layer']}
          lead={(
            <>
              <p>
                Traditional WhatsApp automation works well when a business can clearly define
                every possible path. Real customer conversations are less predictable.
              </p>
              <p>A customer might ask:</p>
            </>
          )}
        />

        <motion.ul
          initial="hidden"
          whileInView="show"
          viewport={viewport}
          variants={stagger(0, 0.08)}
          className="mt-8 mx-auto max-w-xl space-y-3"
        >
          <Utterance text="How much is it?" />
          <Utterance text="What's the price for this?" />
          <Utterance text="Cost?" />
        </motion.ul>

        <div className="mt-8 max-w-2xl mx-auto space-y-3 text-center text-base text-slate-600">
          <p>
            The words are different, but the customer may be looking for the same information.
          </p>
          <p>
            AI can help businesses work with these natural variations instead of relying entirely
            on rigid message patterns.
          </p>
          <p>
            With ZunoPilot, AI can become part of your WhatsApp communication workflow, helping
            your business respond to suitable customer interactions while maintaining control
            over when automation should take over and when a person should step in.
          </p>
        </div>
      </Section>

      {/* ------------------------------ Definition ----------------------------- */}
      <Section>
        <SectionHead
          title={['What Is AI WhatsApp Automation?']}
          lead={(
            <>
              <p>
                AI WhatsApp automation combines artificial intelligence with automated WhatsApp
                business workflows to assist with customer communication.
              </p>
              <p>
                Instead of relying only on fixed rules, AI can be used to assist with
                understanding customer messages, identifying the nature of an enquiry, supporting
                responses, and determining the next step within a configured workflow.
              </p>
              <p>A simplified interaction can look like:</p>
            </>
          )}
        />
        <FlowChain
          className="mt-8"
          steps={[
            'Customer message',
            'AI assistance',
            'Relevant action',
            'Workflow',
            'Human support when needed',
          ]}
        />
        <p className="mt-8 text-center text-base text-slate-600 max-w-2xl mx-auto">
          The exact automation depends on the business process, information available to the AI,
          and how the workflow is configured.
        </p>
      </Section>

      {/* -------------------------- Keywords to intent ------------------------- */}
      <Section tone="tinted">
        <SectionHead
          title={['From Keywords to', 'Customer Intent']}
          lead={(
            <>
              <p>Customers rarely communicate using perfectly structured commands.</p>
              <p>They might say:</p>
            </>
          )}
        />
        <motion.ul
          initial="hidden"
          whileInView="show"
          viewport={viewport}
          variants={stagger(0, 0.06)}
          className="mt-8 mx-auto max-w-2xl space-y-3"
        >
          {UTTERANCES.map((text) => <Utterance key={text} text={text} />)}
        </motion.ul>
        <div className="mt-8 max-w-2xl mx-auto space-y-3 text-center text-base text-slate-600">
          <p>
            AI-assisted communication can help interpret the meaning behind different types of
            customer requests and connect them with the appropriate response or workflow.
          </p>
          <p>
            This makes AI particularly useful for businesses receiving a high volume of
            natural-language WhatsApp enquiries.
          </p>
        </div>
      </Section>

      {/* ------------------------- What AI can help with ----------------------- */}
      <Section>
        <SectionHead
          title={['What Can AI Help With', 'on WhatsApp?']}
          lead={(
            <p>
              AI should be applied where it provides a genuine business benefit. Depending on
              your configuration, AI-assisted WhatsApp workflows can support areas such as:
            </p>
          )}
        />
        <div className="mt-10">
          <TileGrid tiles={AI_HELPS} />
        </div>
      </Section>

      {/* ---------------------------- Business context ------------------------- */}
      <Section tone="tinted">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-16 items-center">
          <SectionHead
            align="left"
            title={['Make AI Useful With', 'Business Context']}
            lead={(
              <>
                <p>
                  AI becomes more valuable when it works with information that is relevant to
                  your business.
                </p>
                <p>
                  This helps create a more focused AI experience for customer communication. The
                  objective isn&rsquo;t simply to make AI generate messages — it&rsquo;s to make
                  AI useful within a defined business context.
                </p>
              </>
            )}
          />
          <div className="rounded-3xl bg-white ring-1 ring-slate-200/80 p-6 sm:p-8">
            <p className="text-base font-semibold text-slate-900">
              Instead of treating AI as a generic chatbot, businesses can build AI-assisted
              communication around information such as:
            </p>
            <CheckList items={AI_CONTEXT} columns={1} className="mt-5" />
          </div>
        </div>
      </Section>

      {/* ------------------------------ Lead convos ---------------------------- */}
      <Section>
        <SectionHead
          eyebrow="AI for Lead Conversations"
          title={['Help Sales Teams Start', 'With Better Context']}
          lead={(
            <>
              <p>
                A prospect&rsquo;s first WhatsApp message may contain only a small amount of
                information.
              </p>
              <p>
                AI can assist with the early conversation by helping identify the customer&rsquo;s
                requirement and collecting relevant details according to the configured sales
                process. For example:
              </p>
            </>
          )}
        />
        <FlowChain
          className="mt-8"
          steps={[
            'Customer enquiry',
            'Understand the request',
            'Ask relevant questions',
            'Gather requirements',
            'Identify potential opportunity',
            'Route to sales',
            'Continue the conversation',
          ]}
        />
        <p className="mt-8 text-center text-base text-slate-600 max-w-2xl mx-auto">
          This can help sales representatives begin with more context instead of asking customers
          to repeat information already provided during the initial interaction.
        </p>
        <div className="mt-8 text-center">
          <ArrowLink to="/solutions/lead-management">Explore WhatsApp Lead Management</ArrowLink>
        </div>
      </Section>

      {/* -------------------------------- Support ------------------------------ */}
      <Section tone="tinted">
        <SectionHead
          eyebrow="AI-Assisted Customer Support"
          title={['Help Customers Find Answers Without', 'Making Every Interaction Manual']}
          lead={(
            <>
              <p>Customer support teams often receive similar questions throughout the day.</p>
              <p>
                AI can assist with suitable routine enquiries using the information and workflows
                configured for the business. For example:
              </p>
            </>
          )}
        />
        <FlowChain
          className="mt-8"
          steps={[
            'Customer question',
            'Identify the request',
            'Provide relevant assistance',
            'Determine whether additional help is needed',
            'Connect with support when appropriate',
          ]}
        />
        <p className="mt-8 text-center text-base text-slate-600 max-w-2xl mx-auto">
          This allows support teams to spend more time on complex cases instead of manually
          handling every basic enquiry.
        </p>
        <div className="mt-8 text-center">
          <ArrowLink to="/solutions/customer-support">Explore Customer Support</ArrowLink>
        </div>
      </Section>

      {/* -------------------------- AI + automation ---------------------------- */}
      <Section>
        <SectionHead
          title={['AI and Automation', 'Work Better Together']}
          lead={(
            <>
              <p>AI and automation aren&rsquo;t the same thing.</p>
              <p>Automation controls the process. AI helps make the interaction more flexible.</p>
            </>
          )}
        />
        <div className="mt-10 grid grid-cols-1 lg:grid-cols-2 gap-5 max-w-4xl mx-auto">
          <div className="rounded-3xl bg-slate-50 ring-1 ring-slate-200/80 p-6 sm:p-8">
            <h3 className="text-lg font-bold text-slate-900">Automation</h3>
            <p className="mt-3 text-sm text-slate-600 leading-relaxed">A business defines:</p>
            <p className="mt-2 text-sm text-slate-700 leading-relaxed">
              If a customer asks about a particular service &rarr; provide information &rarr;
              collect requirements &rarr; continue to the next step.
            </p>
          </div>
          <div className="rounded-3xl bg-violet-50/70 ring-1 ring-violet-100 p-6 sm:p-8">
            <h3 className="text-lg font-bold text-slate-900">AI-assisted automation</h3>
            <p className="mt-3 text-sm text-slate-700 leading-relaxed">
              The customer can express the requirement naturally, and AI can assist in
              interpreting the message before the configured workflow determines what should
              happen next.
            </p>
          </div>
        </div>
        <p className="mt-8 text-center text-base text-slate-600 max-w-2xl mx-auto">
          This combination allows businesses to maintain structured processes without forcing
          every customer into rigid conversation paths.
        </p>
      </Section>

      {/* ------------------------------- Control ------------------------------- */}
      <Section tone="tinted">
        <SectionHead
          title={['Keep Your Team in Control']}
          lead={(
            <>
              <p>AI should assist your business, not operate without boundaries.</p>
              <p>
                A well-designed AI WhatsApp workflow should define when automation is appropriate
                and when a conversation should be handled by a person.
              </p>
            </>
          )}
        />
        <div className="mt-10 grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="rounded-3xl bg-white ring-1 ring-slate-200/80 p-6 sm:p-8">
            <p className="text-base font-semibold text-slate-900">Suitable for AI assistance</p>
            <CheckList
              columns={1}
              className="mt-5"
              items={[
                'Routine enquiries',
                'Frequently requested information',
                'Initial lead conversations',
                'Basic qualification',
                'Common support questions',
                'Repetitive communication',
              ]}
            />
          </div>
          <div className="rounded-3xl bg-white ring-1 ring-slate-200/80 p-6 sm:p-8">
            <p className="text-base font-semibold text-slate-900">Better handled by people</p>
            <CheckList
              columns={1}
              className="mt-5"
              items={[
                'Complex requirements',
                'Negotiations',
                'Sensitive customer situations',
                'High-value sales discussions',
                'Detailed technical issues',
                'Decisions requiring business judgment',
              ]}
            />
          </div>
        </div>
        <p className="mt-8 text-center text-base text-slate-600 max-w-2xl mx-auto">
          This creates a practical AI + human workflow rather than trying to automate every
          conversation.
        </p>
      </Section>

      {/* ------------------------ Across business functions -------------------- */}
      <Section>
        <SectionHead title={['AI WhatsApp Automation Across', 'Different Business Functions']} />
        <div className="mt-10">
          <TileGrid tiles={FUNCTIONS} />
        </div>
      </Section>

      {/* --------------------------- Real conversations ------------------------ */}
      <Section tone="tinted">
        <SectionHead title={['See AI WhatsApp Automation', 'in Real Conversations']} />
        <motion.div
          initial="hidden"
          whileInView="show"
          viewport={viewport}
          variants={stagger(0, 0.08)}
          className="mt-10 grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-5"
        >
          {CONVERSATIONS.map((c) => (
            <motion.div
              key={c.title}
              variants={item}
              whileHover={{ y: -6 }}
              transition={CARD_SPRING}
              className="h-full rounded-3xl bg-white ring-1 ring-slate-200/80 p-6 sm:p-7"
            >
              <h3 className="text-lg font-bold text-slate-900">{c.title}</h3>
              <p className="mt-4 text-xs font-semibold uppercase tracking-widest text-slate-400">
                Customer
              </p>
              <p className="mt-2 rounded-2xl bg-violet-50/70 ring-1 ring-violet-100 px-4 py-3 text-[15px] text-slate-800">
                &ldquo;{c.quote}&rdquo;
              </p>
              <p className="mt-4 text-sm text-slate-500 leading-relaxed">{c.body}</p>
            </motion.div>
          ))}
        </motion.div>
      </Section>

      {/* --------------------------------- Why --------------------------------- */}
      <Section>
        <SectionHead title={['Why Businesses Add AI to', 'WhatsApp Communication']} />
        <div className="mt-10">
          <TileGrid tiles={WHY_AI} />
        </div>
      </Section>

      {/* ------------------------------ Comparison ----------------------------- */}
      <Section tone="tinted">
        <SectionHead title={['AI WhatsApp Automation vs', 'Traditional Automation']} />
        <div className="mt-10 max-w-4xl mx-auto">
          <MatchTable
            head={['Traditional WhatsApp Automation', 'AI WhatsApp Automation']}
            rows={COMPARISON}
          />
        </div>
        <div className="mt-8 max-w-2xl mx-auto space-y-2 text-center text-base text-slate-600">
          <p>AI doesn&rsquo;t replace the importance of business rules.</p>
          <p>
            The strongest approach combines structured automation with appropriate AI assistance.
          </p>
        </div>
      </Section>

      {/* ----------------------------- Connect with ---------------------------- */}
      <Section>
        <SectionHead
          title={['Connect AI With Your', 'ZunoPilot Workflow']}
          lead={(
            <>
              <p>AI works best when it is part of a larger communication system.</p>
              <p>
                Depending on your business requirements, AI-assisted conversations can work
                alongside other ZunoPilot capabilities.
              </p>
            </>
          )}
        />
        <motion.div
          initial="hidden"
          whileInView="show"
          viewport={viewport}
          variants={stagger(0, 0.07)}
          className="mt-10 grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-5"
        >
          {COMPANIONS.map((c) => (
            <motion.div key={c.title} variants={item} whileHover={{ y: -6 }} transition={CARD_SPRING}>
              <Link
                to={c.href}
                className="group flex h-full flex-col rounded-3xl bg-white ring-1 ring-slate-200/80 p-6 hover:ring-violet-200 transition-colors"
              >
                <h3 className="text-lg font-bold text-slate-900">{c.title}</h3>
                <p className="mt-2 text-sm text-slate-500 leading-relaxed">{c.body}</p>
                <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-violet-600">
                  {c.cta}
                  <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1" />
                </span>
              </Link>
            </motion.div>
          ))}
        </motion.div>
      </Section>

      {/* ---------------------------- Practical flow --------------------------- */}
      <Section tone="tinted">
        <SectionHead
          title={['A Practical AI-Powered', 'WhatsApp Workflow']}
          lead={(
            <>
              <p>A useful AI workflow doesn&rsquo;t need to make every decision automatically.</p>
              <p>Instead, businesses can define where AI provides assistance.</p>
            </>
          )}
        />
        <FlowChain
          className="mt-10"
          steps={[
            'Customer starts a conversation',
            'AI helps interpret the request',
            'Business workflow determines the next action',
            'AI assists with suitable communication',
            'Customer continues the conversation',
            'Human team takes over when required',
          ]}
        />
        <p className="mt-8 text-center text-base text-slate-600 max-w-2xl mx-auto">
          This approach combines the speed of automation with the judgment of your team.
        </p>
      </Section>

      {/* --------------------------------- Who --------------------------------- */}
      <Section>
        <SectionHead title={['Who Should Use AI', 'WhatsApp Automation?']} />
        <div className="mt-10">
          <TileGrid tiles={AI_AUDIENCES} />
        </div>
      </Section>

      {/* ------------------------------- Closing ------------------------------- */}
      <Section tone="tinted">
        <SectionHead
          title={['Build More Intelligent WhatsApp', 'Customer Experiences']}
          lead={(
            <>
              <p>AI doesn&rsquo;t need to replace your customer service or sales team. It can help them work more efficiently.</p>
              <p>
                Use AI for conversations that benefit from intelligent assistance, automation for
                repeatable processes, and people for situations that require expertise or
                judgment.
              </p>
              <p>
                With ZunoPilot, businesses can bring these elements together into a more connected
                WhatsApp communication experience.
              </p>
            </>
          )}
        />
      </Section>

      <FaqSection faqs={AI_FAQS} />

      <CtaBand
        title={['Make WhatsApp Conversations', 'Work Smarter']}
        body={[
          'Give your customers a more responsive way to communicate while keeping your team in control.',
          'ZunoPilot combines AI assistance, WhatsApp automation, and human collaboration to help businesses build more intelligent customer communication workflows.',
        ]}
      />

      <SiteFooter />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                                    Copy                                     */
/* -------------------------------------------------------------------------- */

const UTTERANCES = [
  'I want to know more about your service.',
  'Can someone explain how this works?',
  'I need this for my company.',
  'Can you send me the details?',
  'Is this available?',
];

const AI_HELPS = [
  { title: 'Understanding Enquiries', body: 'Help identify what a customer is asking about and determine the appropriate next step.' },
  { title: 'Answering Routine Questions', body: 'Assist with frequently requested information using approved business content and configured responses.' },
  { title: 'Collecting Requirements', body: 'Help gather relevant information from prospects before a sales or service team takes over.' },
  { title: 'Qualifying Leads', body: 'Support early-stage conversations by identifying requirements and collecting qualification information.' },
  { title: 'Supporting Customer Service', body: 'Assist with common customer questions before escalating conversations that require human expertise.' },
  { title: 'Maintaining Conversation Flow', body: 'Help customers move through an interaction without requiring an employee to manually manage every routine step.' },
];

const AI_CONTEXT = [
  'Products and services',
  'Frequently asked questions',
  'Business information',
  'Service details',
  'Customer communication guidelines',
  'Policies',
  'Approved responses',
  'Lead qualification requirements',
];

const FUNCTIONS = [
  { title: 'Sales', body: 'Assist with enquiries, qualification, and early-stage prospect conversations.' },
  { title: 'Customer Support', body: 'Provide assistance for suitable routine questions and help route complex requests.' },
  { title: 'Marketing', body: 'Support customer engagement and relevant conversational interactions around campaigns.' },
  { title: 'Operations', body: 'Assist with recurring customer communication connected to business workflows.' },
  { title: 'Service Businesses', body: 'Help customers with enquiries, requirements, scheduling-related conversations, and follow-up communication.' },
];

const CONVERSATIONS = [
  {
    title: 'Product Enquiry',
    quote: "I'm looking for something suitable for a small business. What would you recommend?",
    body: "AI can help identify the customer's requirement and provide an appropriate configured response or continue the workflow. If the conversation becomes a sales opportunity, it can move toward the appropriate team.",
  },
  {
    title: 'Service Enquiry',
    quote: 'I need your service next week. Can you tell me what I need to do?',
    body: 'AI-assisted communication can help understand the request, provide relevant information, and guide the customer toward the next configured step.',
  },
  {
    title: 'Support Request',
    quote: "I've already contacted you about this but still need help.",
    body: 'The workflow can identify that the customer needs support and direct the conversation toward the appropriate support process.',
  },
  {
    title: 'Lead Qualification',
    quote: 'We need this for a team of around 30 people.',
    body: 'AI can assist with recognizing relevant qualification information and continuing according to the configured sales workflow.',
  },
];

const WHY_AI = [
  { title: 'Handle Natural Customer Language', body: 'Customers can communicate in their own words instead of having to follow rigid commands.' },
  { title: 'Reduce Routine Work', body: "AI can assist with recurring interactions that don't always require an employee." },
  { title: 'Improve Initial Lead Conversations', body: 'Relevant information can be gathered before a salesperson takes over.' },
  { title: 'Support Consistent Responses', body: 'AI-assisted workflows can work from approved business information and defined processes.' },
  { title: 'Give Teams Better Conversation Context', body: 'When a conversation reaches an employee, information gathered during the interaction can help the team continue from where the customer left off.' },
  { title: 'Scale Customer Communication', body: 'AI can assist businesses as the volume of customer conversations increases, while human teams remain available for interactions that require judgment.' },
];

const COMPARISON: readonly (readonly [string, string, string?])[] = [
  ['Primarily rule-based', 'Rules combined with AI assistance'],
  ['Fixed conversation paths', 'More flexible natural-language interactions'],
  ['Relies heavily on predefined triggers', 'Can assist with interpreting customer requests'],
  ['Predetermined responses', 'AI-assisted response support'],
  ['Suitable for predictable workflows', 'Useful for more varied customer conversations'],
  ['Human escalation can be configured', 'AI can work within human-handoff workflows'],
];

const COMPANIONS = [
  {
    title: 'WhatsApp Automation',
    body: 'Create structured processes for recurring communication.',
    cta: 'Explore WhatsApp Automation',
    href: '/features/whatsapp-automation',
  },
  {
    title: 'Shared WhatsApp Portal',
    body: 'Give authorized team members a centralized environment for managing business conversations.',
    cta: 'Explore Shared WhatsApp Portal',
    href: '/features/shared-whatsapp-portal',
  },
  {
    title: 'WhatsApp Team Inbox',
    body: 'Help teams manage conversations that need human attention.',
    cta: 'Explore WhatsApp Team Inbox',
    href: '/features/whatsapp-team-inbox',
  },
  {
    title: 'WhatsApp Campaigns',
    body: 'Connect customer engagement activities with broader WhatsApp communication workflows.',
    cta: 'Explore WhatsApp Campaigns',
    href: '/features/whatsapp-campaigns',
  },
];

const AI_AUDIENCES = [
  { title: 'Businesses With High Enquiry Volumes', body: 'Use AI assistance to handle suitable routine interactions as conversation volumes grow.' },
  { title: 'Sales Teams', body: 'Use AI to assist with initial enquiries and qualification before conversations reach sales representatives.' },
  { title: 'Customer Support Teams', body: 'Use AI for suitable repetitive questions while keeping agents available for complex cases.' },
  { title: 'Marketing Teams', body: 'Use AI-assisted communication to support customer engagement around appropriate campaigns.' },
  { title: 'Growing Businesses', body: 'Build an AI-assisted communication process that can expand as customer interactions increase.' },
];

const AI_FAQS = [
  {
    question: 'What is AI WhatsApp automation?',
    answer:
      'AI WhatsApp automation combines artificial intelligence with WhatsApp business workflows '
      + 'to assist with customer conversations, interpret enquiries, support responses, qualify '
      + 'leads, and automate suitable communication processes.',
  },
  {
    question: 'How is AI WhatsApp automation different from regular WhatsApp automation?',
    answer:
      'Regular WhatsApp automation generally follows predefined rules and workflows. AI WhatsApp '
      + 'automation adds AI capabilities that can assist with interpreting natural-language '
      + 'messages, identifying customer intent, and supporting more flexible interactions.',
  },
  {
    question: 'Can AI respond to WhatsApp customer messages?',
    answer:
      'AI can assist with customer responses when it has been configured for the relevant '
      + 'business use case, information, and workflow. Businesses should define appropriate '
      + 'knowledge sources, response rules, and escalation processes.',
  },
  {
    question: 'Can AI WhatsApp automation qualify leads?',
    answer:
      'Yes. AI can assist with identifying customer requirements, asking configured qualification '
      + 'questions, collecting relevant information, and directing suitable conversations toward '
      + 'a sales workflow.',
  },
  {
    question: 'Can AI WhatsApp automation be used for customer support?',
    answer:
      'Yes. AI can assist with suitable routine customer questions, provide configured '
      + 'information, and help route conversations that require human support.',
  },
  {
    question: 'Does AI WhatsApp automation replace human agents?',
    answer:
      'No. AI is intended to assist with suitable interactions while human agents remain '
      + 'important for complex, sensitive, high-value, or judgment-based conversations.',
  },
  {
    question: 'Can AI understand different ways of asking the same question?',
    answer:
      'AI can help interpret variations in natural-language requests and identify similar '
      + 'underlying intents, depending on the AI capabilities, configuration, and information '
      + 'available to the system.',
  },
  {
    question: 'Can businesses control what AI communicates?',
    answer:
      'AI-powered business communication should be configured with appropriate information, '
      + 'workflows, permissions, and escalation rules so that responses remain aligned with the '
      + 'intended customer experience.',
  },
  {
    question: 'Is AI WhatsApp automation useful for small businesses?',
    answer:
      'Yes. Small businesses can use AI assistance for recurring enquiries, lead conversations, '
      + 'customer questions, and other suitable communication tasks without manually handling '
      + 'every interaction.',
  },
  {
    question: 'Can large teams use AI WhatsApp automation?',
    answer:
      'Yes. Larger teams can combine AI-assisted conversations with shared communication and team '
      + 'workflows, allowing AI to assist with suitable interactions while employees handle '
      + 'conversations requiring human attention.',
  },
  {
    question: 'Is AI WhatsApp automation allowed on WhatsApp?',
    answer:
      'Businesses need to use approved WhatsApp business products and comply with applicable '
      + 'WhatsApp policies, messaging requirements, consent rules, and template requirements '
      + 'where applicable. ZunoPilot should be configured and used according to those '
      + 'requirements.',
  },
];
