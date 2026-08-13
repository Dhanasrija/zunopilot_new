import { Link } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import {
  AlarmClock, Bot, Brain, Building2, ClipboardList, Headphones, Languages, Megaphone,
  MessageSquare, MoonStar, Plug, Rocket, Send, ShoppingCart, Target,
  TrendingUp, UserRound, Users, Workflow, Zap,
} from 'lucide-react';
import { ArrowRight } from 'lucide-react';
import { useDocumentHead } from '@/lib/document-head';
import { PAGE_HEADS } from '@/lib/page-heads';
import SiteHeader from '@/components/marketing/SiteHeader';
import SiteFooter from '@/components/marketing/SiteFooter';
import {
  ArrowLink, CARD_SPRING, CheckList, CtaBand, FaqSection, FlowChain,
  PageHero, ScrollProgress, Section, SectionHead, TileGrid, item, stagger, viewport
} from '@/components/marketing/primitives';
import { Flow, IconTitle, Reveal } from '@/components/marketing/motion-kit';

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

      {/* ------------------------------ The chatbot ---------------------------- */}
      <Section tone="tinted">
        <SectionHead
          eyebrow="A chatbot that reads the question"
          title={['Three Ways to Ask', 'One Thing. One Answer.']}
          lead={(
            <>
              <p>
                Traditional WhatsApp automation replies when a message matches a keyword it was
                given. Real customers do not type keywords — they ask in their own words, leave
                things out, and change their mind halfway through.
              </p>
              <p>
                Here is the same question arriving three ways, and the same chatbot handling all
                three:
              </p>
            </>
          )}
        />

        <div className="mt-10">
          <ChatbotDemo />
        </div>

        <div className="mt-8 max-w-2xl mx-auto space-y-3 text-center text-base text-slate-700">
          <p>
            No keyword was configured for &ldquo;cost?&rdquo; The chatbot worked out what was being
            asked and answered from what your business has told it about pricing.
          </p>
          <p>
            You stay in control of the boundary: which questions the chatbot may answer, what it
            is allowed to say, and the point at which the conversation should go to a person
            instead.
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
        <div className="mt-10">
          <UnderstandingPipeline />
        </div>
        <p className="mt-8 text-center text-base text-slate-700 max-w-2xl mx-auto">
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
        <div className="mt-10">
          <IntentRows />
        </div>        <div className="mt-8 max-w-2xl mx-auto space-y-3 text-center text-base text-slate-700">
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
        <div className="mt-10">
          <ContextBuild />
        </div>
        <p className="mt-8 text-center text-base text-slate-700 max-w-2xl mx-auto">
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
        {/*
          Vertical here, where the other diagrams on this page run across.

          These five stages are a *sequence a single question goes through*, and the last two are
          conditional — a vertical rail can carry that ("…if additional help is needed") without
          the cramping a five-across row would need, and it keeps this section visually separate
          from the pipeline further up the page.
        */}
        <Flow
          variant="vertical"
          className="mt-10"
          nodes={[
            { label: 'Customer question', detail: 'Asked in whatever words the customer uses' },
            { label: 'Identify the request', detail: 'AI assists with working out what is being asked' },
            { label: 'Provide relevant assistance', detail: 'From the business information you have configured' },
            { label: 'Determine whether additional help is needed', detail: 'The workflow decides, not the customer' },
            { label: 'Connect with support when appropriate', detail: 'An agent continues with the conversation intact' },
          ]}
        />
        <p className="mt-8 text-center text-base text-slate-700 max-w-2xl mx-auto">
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
            <p className="mt-3 text-sm text-slate-700 leading-relaxed">A business defines:</p>
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
        <p className="mt-8 text-center text-base text-slate-700 max-w-2xl mx-auto">
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
        <p className="mt-8 text-center text-base text-slate-700 max-w-2xl mx-auto">
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
              <p className="mt-4 text-sm text-slate-600 leading-relaxed">{c.body}</p>
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
        <div className="mt-10">
          <VersusRows />
        </div>
        <div className="mt-8 max-w-2xl mx-auto space-y-2 text-center text-base text-slate-700">
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
                <p className="mt-2 text-sm text-slate-600 leading-relaxed">{c.body}</p>
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
        <p className="mt-8 text-center text-base text-slate-700 max-w-2xl mx-auto">
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

/* -------------------------------------------------------------------------- */
/*                          Page-local design devices                          */
/* -------------------------------------------------------------------------- */

/**
 * The page's showpiece: three ways of asking the same thing, one layer, one intent.
 *
 * **What it replaced.** Three quoted lines in a stack, followed by a paragraph explaining that
 * they mean the same thing. The words were doing all the work, which on the page whose subject
 * is *understanding* is the wrong way round — a reader should see the collapse happen.
 *
 * So the three phrasings sit on the left, a scanning band crosses them, and one resolved intent
 * comes out on the right. The scan is a single translated gradient (transform only) and it stops
 * for anyone who asks for reduced motion — the resolved state is still fully readable without
 * it, because the animation is never what carries the meaning.
 */
/**
 * The chatbot, shown as a chat.
 *
 * **Why this replaced a diagram.** The previous figure was three quoted phrasings, a dark
 * panel labelled "The AI layer" listing Language / Intent / Context, and a card reading
 * "One intent". It was an architecture diagram for a feature nobody buys architecturally:
 * "AI layer" is a phrase from a slide deck, and a visitor arriving from a search for
 * "whatsapp chatbot" had to translate it before they could tell whether the product does
 * the thing they came for. The concept — one chatbot, many phrasings, the same correct
 * answer — is best explained by showing the conversation, because the conversation is
 * literally the product.
 *
 * So: three WhatsApp threads side by side, each opening with a different wording of the
 * same question, each answered by the same bot with the same information. The wording
 * varies down the left; the answer does not. That is the whole claim, made without
 * asserting it.
 *
 * The bubbles are styled after WhatsApp — inbound white on the left, outbound tinted on
 * the right, with the tail on the outer corner — because the visitor already knows how to
 * read that layout and spends no attention learning this one. Deliberately *not* the
 * WhatsApp green: this is an illustration of ZunoPilot's product, and dressing it in
 * Meta's brand colour would imply an endorsement that does not exist.
 */
function ChatbotDemo() {
  const reduce = useReducedMotion();

  /**
   * The three exchanges.
   *
   * Same answer text in all three on purpose — a different reply per thread would make
   * the figure about the *variety* of the answers, which is the opposite of the point.
   */
  const THREADS = [
    { ask: 'How much is it?', note: 'Plain question' },
    { ask: "What's the price for this?", note: 'Different words, same want' },
    { ask: 'Cost?', note: 'One word, no context' },
  ];

  /*
   * **No figure in the reply, deliberately.**
   *
   * A first draft had the bot quoting a monthly price. Prices live in the database and are
   * changed by an operator — the same reason `index.html` carries no `offers` block and
   * `/pricing` reads from the catalogue. A number written into an illustration on a feature
   * page goes stale in silence, and a stale price in a picture of a chatbot answering a
   * pricing question is a uniquely bad place for one. The reply demonstrates the behaviour
   * without asserting a fact this file cannot keep true.
   */
  const REPLY =
    'Happy to help. I can share the plan comparison and what each one includes — '
    + 'shall I send it across?';

  return (
    <div className="mx-auto max-w-5xl">
      <motion.ul
        initial="hidden"
        whileInView="show"
        viewport={viewport}
        variants={stagger(0, 0.15)}
        className="grid grid-cols-1 gap-5 md:grid-cols-3"
      >
        {THREADS.map((thread, i) => (
          <motion.li
            key={thread.ask}
            variants={item}
            className="flex h-full flex-col overflow-hidden rounded-3xl bg-white ring-1 ring-slate-200 shadow-sm"
          >
            {/* Thread header — an avatar and a name, so it reads as a conversation. */}
            <div className="flex items-center gap-3 border-b border-slate-100 bg-slate-50/80 px-4 py-3">
              <span
                aria-hidden
                className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-violet-600 text-white"
              >
                <Bot className="h-4 w-4" />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-slate-900">
                  ZunoPilot assistant
                </span>
                <span className="block text-[11px] font-medium text-emerald-600">online</span>
              </span>
            </div>

            {/* The exchange. */}
            <div className="flex flex-1 flex-col gap-3 px-4 py-5">
              <div className="max-w-[85%] self-start rounded-2xl rounded-tl-sm bg-slate-100 px-3.5 py-2.5">
                <p className="text-[15px] leading-snug text-slate-800">{thread.ask}</p>
                <p className="mt-1 text-right text-[10px] text-slate-500">10:2{i} AM</p>
              </div>

              {/*
                A typing indicator between the two bubbles, so the reply reads as a response
                rather than as a caption. It loops forever, which `MotionConfig` cannot
                shorten — hence the explicit `useReducedMotion()` check. See the header of
                `components/marketing/motion-kit.tsx`.
              */}
              <div className="flex items-center gap-1 self-start pl-1" aria-hidden>
                {[0, 1, 2].map((dot) => (
                  <motion.span
                    key={dot}
                    className="block h-1.5 w-1.5 rounded-full bg-slate-300"
                    animate={reduce ? undefined : { opacity: [0.3, 1, 0.3] }}
                    transition={{
                      duration: 1.2,
                      repeat: Infinity,
                      ease: 'easeInOut',
                      delay: dot * 0.18 + i * 0.1,
                    }}
                  />
                ))}
              </div>

              <div className="max-w-[92%] self-end rounded-2xl rounded-br-sm bg-violet-600 px-3.5 py-2.5 shadow-sm shadow-violet-200">
                <p className="text-[15px] leading-snug text-white">{REPLY}</p>
                <p className="mt-1 text-right text-[10px] text-violet-200">10:2{i} AM</p>
              </div>
            </div>

            {/* What was different about this one. */}
            <p className="border-t border-slate-100 px-4 py-3 text-[13px] font-medium text-slate-500">
              {thread.note}
            </p>
          </motion.li>
        ))}
      </motion.ul>

      {/*
        The takeaway, stated once under all three rather than repeated in each card. It is
        the only sentence in the figure that is an assertion, so it gets the emphasis and
        the other twelve strings stay as evidence.
      */}
      <Reveal delay={0.2}>
        <p className="mx-auto mt-6 max-w-2xl rounded-2xl bg-white px-5 py-4 text-center text-[15px] leading-relaxed text-slate-700 ring-1 ring-violet-200">
          <span className="font-semibold text-slate-900">Same intent, three phrasings.</span>{' '}
          The chatbot answers the request rather than the wording — and hands over to your team
          the moment the conversation needs a person.
        </p>
      </Reveal>
    </div>
  );
}

/**
 * What happens between a message arriving and something being done about it.
 *
 * Set as a stack inside one dark panel rather than as a row of cards, because these are *layers
 * of the same pass* over a single message, not stages a conversation travels between. The two
 * outcomes at the bottom are the only place the panel forks, which is the honest shape: every
 * message goes through all of it, and only the last step differs.
 */
function UnderstandingPipeline() {
  const LAYERS = [
    { icon: MessageSquare, label: 'Customer message', body: 'Whatever the customer actually typed' },
    { icon: Languages, label: 'Language understanding', body: 'The wording is read rather than matched' },
    { icon: Brain, label: 'Intent detection', body: 'What is being asked for' },
    { icon: ClipboardList, label: 'Context', body: 'What your business has configured about this' },
    { icon: Workflow, label: 'AI decision', body: 'Which configured step comes next' },
  ];

  return (
    <div className="mx-auto max-w-3xl">
      <motion.ol
        initial="hidden"
        whileInView="show"
        viewport={viewport}
        variants={stagger(0.05, 0.08)}
        className="relative overflow-hidden rounded-3xl bg-slate-900 p-5 sm:p-7 space-y-2"
      >
        <span
          aria-hidden
          className="pointer-events-none absolute -top-20 left-1/2 h-56 w-72 -translate-x-1/2 rounded-full bg-violet-500/20 blur-3xl"
        />
        {LAYERS.map((layer, i) => (
          <motion.li key={layer.label} variants={item} className="relative">
            <div className="flex items-center gap-4 rounded-2xl bg-white/5 px-4 py-3.5 ring-1 ring-white/10">
              <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-violet-600/90 text-white">
                <layer.icon className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <p className="text-[14px] font-semibold text-white">{layer.label}</p>
                <p className="text-[13px] text-slate-300">{layer.body}</p>
              </div>
              <span aria-hidden className="ml-auto text-[11px] font-bold tabular-nums text-violet-300">
                {String(i + 1).padStart(2, '0')}
              </span>
            </div>
          </motion.li>
        ))}
      </motion.ol>

      {/* The fork. Two outcomes, equal weight — neither is a failure state. */}
      <div aria-hidden className="relative mx-auto h-8 w-full max-w-lg">
        <span className="absolute left-1/2 top-0 h-3 w-px -translate-x-1/2 bg-slate-300" />
        <span className="absolute left-1/4 right-1/4 top-3 h-px bg-slate-300" />
        <span className="absolute left-1/4 top-3 h-5 w-px bg-slate-300" />
        <span className="absolute right-1/4 top-3 h-5 w-px bg-violet-300" />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-5">
        <Reveal className="rounded-2xl bg-slate-50/70 px-5 py-4 ring-1 ring-slate-200">
          <IconTitle icon={Zap} as="p" tone="slate" size="sm" className="text-[15px] font-bold text-slate-900">
            Automated response
          </IconTitle>
        </Reveal>
        <Reveal delay={0.08} className="rounded-2xl bg-white px-5 py-4 ring-1 ring-violet-300">
          <IconTitle icon={UserRound} as="p" size="sm" className="text-[15px] font-bold text-slate-900">
            Human handoff
          </IconTitle>
        </Reveal>
      </div>
    </div>
  );
}

/**
 * Five real customer sentences, each carried through to what a business would do about it.
 *
 * **What it replaced.** The same five sentences as a plain list, followed by a paragraph saying
 * AI can interpret them. The list left the reader to imagine the interpretation; these rows show
 * it — message, then the intent, then the action the configured workflow would take.
 *
 * The intents and actions are deliberately generic ("wants an overview", "route to the right
 * workflow"): what a given workspace actually does depends on how it is set up, and putting a
 * specific promise in a diagram is how a marketing page ends up describing a product nobody
 * shipped.
 */
function IntentRows() {
  const ROWS = [
    { intent: 'Wants an overview', action: 'Send configured service information' },
    { intent: 'Wants an explanation', action: 'Answer, or offer a person' },
    { intent: 'Buying for a business', action: 'Begin qualification' },
    { intent: 'Wants details in writing', action: 'Share the approved details' },
    { intent: 'Checking availability', action: 'Continue the configured workflow' },
  ];

  return (
    <motion.ul
      initial="hidden"
      whileInView="show"
      viewport={viewport}
      variants={stagger(0, 0.07)}
      className="mx-auto max-w-5xl space-y-3"
    >
      {UTTERANCES.map((text, i) => (
        <motion.li
          key={text}
          variants={item}
          whileHover={{ y: -3 }}
          transition={CARD_SPRING}
          className="group grid grid-cols-1 items-stretch gap-2 sm:grid-cols-12 sm:gap-3"
        >
          {/* What the customer said. */}
          <div className="sm:col-span-5 rounded-2xl rounded-tl-sm bg-white px-5 py-3.5 ring-1 ring-slate-200">
            <p className="text-[15px] text-slate-800">&ldquo;{text}&rdquo;</p>
          </div>

          {/* Read as… */}
          <div className="sm:col-span-3 flex items-center gap-2 rounded-2xl bg-violet-50/70 px-4 py-3 ring-1 ring-violet-200">
            <Brain aria-hidden className="h-4 w-4 shrink-0 text-violet-600" />
            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-widest text-violet-600">Read as</p>
              <p className="text-[14px] font-semibold text-slate-900 leading-snug">{ROWS[i].intent}</p>
            </div>
          </div>

          {/* Then… */}
          <div className="sm:col-span-4 flex items-center gap-2 rounded-2xl bg-white px-4 py-3 ring-1 ring-slate-200">
            <Send aria-hidden className="h-4 w-4 shrink-0 text-slate-400 transition-colors group-hover:text-violet-600" />
            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-widest text-slate-500">Then</p>
              <p className="text-[14px] font-medium text-slate-800 leading-snug">{ROWS[i].action}</p>
            </div>
          </div>
        </motion.li>
      ))}
    </motion.ul>
  );
}

/**
 * The sales conversation, with the context visibly accumulating beside it.
 *
 * The copy's point is not the seven steps — it is that by the end of them a salesperson has
 * something they did not have at the start. A chain of seven cards shows the steps and hides the
 * accumulation, so the steps run down the left and what has been gathered stacks up on the
 * right, each item arriving with the stage that produces it.
 */
function ContextBuild() {
  const STAGES = [
    'Customer enquiry',
    'Understand the request',
    'Ask relevant questions',
    'Gather requirements',
    'Identify potential opportunity',
    'Route to sales',
    'Continue the conversation',
  ];
  const GATHERED = [
    'What the customer is asking about',
    'Answers to the questions your process asks',
    'Stated requirements',
    'Whether this looks like an opportunity',
    'The full conversation so far',
  ];

  /*
   * Equal halves, both stretched to the taller side — the two panels are peers, and a 7/5 split
   * made the stage list look like the section and the context card like an aside.
   */
  return (
    <div className="grid grid-cols-1 items-stretch gap-5 lg:grid-cols-2 lg:gap-6">
      <motion.ol
        initial="hidden"
        whileInView="show"
        viewport={viewport}
        variants={stagger(0, 0.06)}
        className="space-y-2"
      >
        {STAGES.map((stage, i) => (
          <motion.li
            key={stage}
            variants={item}
            className="flex items-center gap-3 rounded-2xl bg-white px-4 py-3 ring-1 ring-slate-200"
          >
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-violet-50 text-[11px] font-bold tabular-nums text-violet-700 ring-1 ring-violet-200">
              {String(i + 1).padStart(2, '0')}
            </span>
            <span className="text-[15px] font-medium text-slate-800">{stage}</span>
          </motion.li>
        ))}
      </motion.ol>

      <motion.div
        initial="hidden"
        whileInView="show"
        viewport={viewport}
        variants={stagger(0.2, 0.09)}
        className="h-full rounded-3xl bg-gradient-to-br from-violet-50 via-white to-white p-6 ring-1 ring-violet-200 shadow-lg shadow-violet-100"
      >
        <IconTitle icon={ClipboardList} as="p" className="text-base font-bold text-slate-900">
          What sales starts with
        </IconTitle>
        <ul className="mt-4 space-y-2">
          {GATHERED.map((entry) => (
            <motion.li
              key={entry}
              variants={item}
              className="rounded-xl bg-white px-4 py-2.5 text-[14px] font-medium text-slate-800 ring-1 ring-violet-200/70"
            >
              {entry}
            </motion.li>
          ))}
        </ul>
        <p className="mt-5 text-[13px] text-slate-600 leading-relaxed">
          None of it asked twice.
        </p>
      </motion.div>
    </div>
  );
}

/**
 * Traditional automation against AI-assisted, as facing rows rather than a table.
 *
 * **Why not the table it was.** A `<table>` implies a specification — two columns of values for
 * the same fields — and invites the reader to score one side. That is the wrong reading: the copy
 * is not claiming rules are obsolete, and the section closes by saying the strongest approach
 * combines both. Facing rows keep the pairing without the scoreboard, and the whole row lifts on
 * hover so the two halves are read together.
 *
 * Colour does the only ranking that belongs here: the AI column is the page's subject, so it gets
 * the violet; the rules column is muted, not crossed out.
 */
function VersusRows() {
  return (
    <div className="mx-auto max-w-5xl">
      <div className="grid grid-cols-2 gap-3 sm:gap-5">
        <p className="rounded-2xl bg-slate-100 px-5 py-3 text-center text-[13px] font-bold uppercase tracking-widest text-slate-600">
          Traditional automation
        </p>
        <p className="rounded-2xl bg-violet-600 px-5 py-3 text-center text-[13px] font-bold uppercase tracking-widest text-white">
          AI WhatsApp automation
        </p>
      </div>

      <motion.ul
        initial="hidden"
        whileInView="show"
        viewport={viewport}
        variants={stagger(0.05, 0.07)}
        className="mt-3 space-y-3"
      >
        {COMPARISON.map(([traditional, ai]) => (
          <motion.li
            key={traditional}
            variants={item}
            whileHover={{ y: -3 }}
            transition={CARD_SPRING}
            className="group grid grid-cols-2 gap-3 sm:gap-5"
          >
            <div className="h-full rounded-2xl bg-slate-50/70 px-5 py-4 ring-1 ring-slate-200">
              <p className="text-[14px] text-slate-600 leading-relaxed">{traditional}</p>
            </div>
            <div className="h-full rounded-2xl bg-white px-5 py-4 ring-1 ring-violet-200 transition-shadow duration-200 group-hover:shadow-lg group-hover:shadow-violet-100">
              <p className="flex items-start gap-2.5 text-[14px] font-semibold text-slate-900 leading-relaxed">
                <Bot aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-violet-600" />
                {ai}
              </p>
            </div>
          </motion.li>
        ))}
      </motion.ul>
    </div>
  );
}

const UTTERANCES = [
  'I want to know more about your service.',
  'Can someone explain how this works?',
  'I need this for my company.',
  'Can you send me the details?',
  'Is this available?',
];

const AI_HELPS = [
  { icon: Brain, title: 'Understanding Enquiries', body: 'Help identify what a customer is asking about and determine the appropriate next step.' },
  { icon: MessageSquare, title: 'Answering Routine Questions', body: 'Assist with frequently requested information using approved business content and configured responses.' },
  { icon: ClipboardList, title: 'Collecting Requirements', body: 'Help gather relevant information from prospects before a sales or service team takes over.' },
  { icon: Target, title: 'Qualifying Leads', body: 'Support early-stage conversations by identifying requirements and collecting qualification information.' },
  { icon: Headphones, title: 'Supporting Customer Service', body: 'Assist with common customer questions before escalating conversations that require human expertise.' },
  { icon: Workflow, title: 'Maintaining Conversation Flow', body: 'Help customers move through an interaction without requiring an employee to manually manage every routine step.' },
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

/*
 * Six business functions, not five.
 *
 * **`Ecommerce` is the added one.** It is the function whose WhatsApp traffic is most obviously
 * natural-language — "where's my order", "is this in stock", "can I change the size" — which is
 * exactly the case this page argues AI is for, and it was the one missing from the list.
 */
const FUNCTIONS = [
  { icon: Target, title: 'Sales', body: 'Assist with enquiries, qualification, and early-stage prospect conversations.' },
  { icon: Headphones, title: 'Customer Support', body: 'Provide assistance for suitable routine questions and help route complex requests.' },
  { icon: Megaphone, title: 'Marketing', body: 'Support customer engagement and relevant conversational interactions around campaigns.' },
  { icon: ClipboardList, title: 'Operations', body: 'Assist with recurring customer communication connected to business workflows.' },
  { icon: Building2, title: 'Service Businesses', body: 'Help customers with enquiries, requirements, scheduling-related conversations, and follow-up communication.' },
  { icon: ShoppingCart, title: 'Ecommerce', body: 'Assist with order-related questions, product enquiries and post-purchase communication where the workflow allows it.' },
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
  { icon: Languages, title: 'Handle Natural Customer Language', body: 'Customers can communicate in their own words instead of having to follow rigid commands.' },
  { icon: Zap, title: 'Reduce Routine Work', body: "AI can assist with recurring interactions that don't always require an employee." },
  { icon: Target, title: 'Improve Initial Lead Conversations', body: 'Relevant information can be gathered before a salesperson takes over.' },
  { icon: ClipboardList, title: 'Support Consistent Responses', body: 'AI-assisted workflows can work from approved business information and defined processes.' },
  { icon: Users, title: 'Give Teams Better Conversation Context', body: 'When a conversation reaches an employee, information gathered during the interaction can help the team continue from where the customer left off.' },
  { icon: TrendingUp, title: 'Scale Customer Communication', body: 'AI can assist businesses as the volume of customer conversations increases, while human teams remain available for interactions that require judgment.' },
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
  /*
   * **The added companion.** AI has to run on top of a connection to WhatsApp, and the API page
   * is where that connection is explained — so it belongs in this list more than anything else
   * that was already in it.
   */
  {
    title: 'WhatsApp Business API',
    body: 'The connection underneath, so AI-assisted conversations can reach the systems your business already runs on.',
    cta: 'Explore WhatsApp Business API',
    href: '/features/whatsapp-business-api',
  },
];

/*
 * Six audiences, not five. **"Businesses That Get Messages Out of Hours" is the added one** —
 * the case where AI assistance changes the customer's experience most obviously, because the
 * alternative is not a slower reply, it is no reply until morning.
 */
const AI_AUDIENCES = [
  { icon: TrendingUp, title: 'Businesses With High Enquiry Volumes', body: 'Use AI assistance to handle suitable routine interactions as conversation volumes grow.' },
  { icon: Target, title: 'Sales Teams', body: 'Use AI to assist with initial enquiries and qualification before conversations reach sales representatives.' },
  { icon: Headphones, title: 'Customer Support Teams', body: 'Use AI for suitable repetitive questions while keeping agents available for complex cases.' },
  { icon: Megaphone, title: 'Marketing Teams', body: 'Use AI-assisted communication to support customer engagement around appropriate campaigns.' },
  { icon: MoonStar, title: 'Businesses That Get Messages Out of Hours', body: 'Let suitable enquiries receive an appropriate response before anyone is back at a desk, with the conversation waiting for a person where one is needed.' },
  { icon: Rocket, title: 'Growing Businesses', body: 'Build an AI-assisted communication process that can expand as customer interactions increase.' },
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
