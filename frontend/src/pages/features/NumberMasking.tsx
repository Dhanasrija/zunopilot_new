import { motion } from 'framer-motion';
import {
  ArrowRight, Building2, CalendarClock, Headphones, Lock, ShieldCheck, ShieldOff,
  ShoppingBag, Target, Truck, UserRound, Users, Wrench,
} from 'lucide-react';
import { useDocumentHead } from '@/lib/document-head';
import { PAGE_HEADS } from '@/lib/page-heads';
import { useBreadcrumbSchema } from '@/lib/json-ld';
import SiteHeader from '@/components/marketing/SiteHeader';
import SiteFooter from '@/components/marketing/SiteFooter';
import {
  ArrowLink, CARD_SPRING, CheckCards, CtaBand, EASE_OUT, FaqSection, PageHero,
  ScrollProgress, Section, SectionHead, item, stagger, viewport,
} from '@/components/marketing/primitives';
import { IconTitle, Reveal } from '@/components/marketing/motion-kit';

/*
 * /features/whatsapp-number-masking
 *
 * **The design idea is a boundary**, because that is what the page is about: the line
 * between an employee's personal communication and the business's customer
 * communication. So this page is built out of *pairs* — two contact paths set against
 * each other, an employee column beside a business column, a before/after of the same
 * relationship — where the other feature pages are built out of grids and rails. A
 * visitor who has just come from /features/whatsapp-automation should be able to tell
 * they are somewhere else without reading a word.
 *
 * It shares only the page shell and the FAQ block with its siblings. The contact-path
 * diagram, the split panel and the numbered concern list are local to this file, and
 * deliberately so — a component used once belongs next to its use.
 */

/* -------------------------------------------------------------------------- */
/*                        The contact path, drawn twice                        */
/* -------------------------------------------------------------------------- */

/**
 * `Customer → Employee's number` against `Customer → Business → Employee`.
 *
 * The whole argument of the page in one figure. Rendered as labelled nodes with arrows
 * rather than as prose, because the difference *is* the shape of the path — one hop
 * versus two, with the business sitting in the middle of the second.
 */
function ContactPath({
  label, nodes, tone,
}: {
  label: string;
  nodes: readonly { icon: typeof UserRound; text: string }[];
  tone: 'muted' | 'brand';
}) {
  const brand = tone === 'brand';
  return (
    <motion.figure
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={viewport}
      transition={{ duration: 0.6, ease: EASE_OUT }}
      className={`rounded-3xl p-6 sm:p-8 ${
        brand
          ? 'bg-gradient-to-br from-violet-600 to-violet-700 shadow-xl shadow-violet-300/50'
          : 'bg-slate-100/80 ring-1 ring-slate-200'
      }`}
    >
      <figcaption
        className={`text-xs font-semibold uppercase tracking-widest ${brand ? 'text-violet-200' : 'text-slate-500'}`}
      >
        {label}
      </figcaption>

      <ol className="mt-6 flex flex-col gap-2">
        {nodes.map(({ icon: Icon, text }, i) => (
          <li key={text}>
            <div
              className={`flex items-center gap-3 rounded-2xl px-4 py-3 ${
                brand ? 'bg-white/15 backdrop-blur-sm' : 'bg-white ring-1 ring-slate-200'
              }`}
            >
              <Icon className={`h-4 w-4 shrink-0 ${brand ? 'text-white' : 'text-slate-500'}`} />
              <span className={`text-sm font-medium ${brand ? 'text-white' : 'text-slate-700'}`}>
                {text}
              </span>
            </div>
            {i < nodes.length - 1 && (
              <div aria-hidden className="flex justify-center py-1">
                <span className={brand ? 'text-violet-200' : 'text-slate-400'}>
                  <ArrowRight className="h-3.5 w-3.5 rotate-90" strokeWidth={3} />
                </span>
              </div>
            )}
          </li>
        ))}
      </ol>
    </motion.figure>
  );
}

/* -------------------------------------------------------------------------- */
/*                                   Page                                      */
/* -------------------------------------------------------------------------- */

const CRUMBS = [
  { name: 'Home', path: '/' },
  { name: 'Features', path: '/features' },
  { name: 'WhatsApp Number Masking', path: '/features/whatsapp-number-masking' },
];

export default function NumberMasking() {
  useDocumentHead(PAGE_HEADS.numberMasking);
  useBreadcrumbSchema(CRUMBS);

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <ScrollProgress />
      <SiteHeader />

      <PageHero
        crumbs={CRUMBS}
        title={['WhatsApp Number Masking', 'for Business']}
        intro={[
          'When employees communicate with customers through personal or directly exposed phone numbers, the customer relationship can become tied to an individual rather than the organization.',
          'ZunoPilot’s WhatsApp Number Masking capability helps businesses create a more controlled customer communication experience by reducing unnecessary exposure of employee contact information.',
          'Keep business conversations connected to your organization while authorized employees continue handling the customers they are responsible for.',
        ]}
      />

      {/* ------------------------ The boundary, as a figure -------------------- */}
      <Section tone="tinted">
        <SectionHead
          title={['Protect the Line Between Work', 'and Personal Communication']}
          lead={(
            <>
              <p>
                Customer-facing employees may need to communicate with prospects, customers,
                vendors, or service users throughout the working day. Using personal contact
                details for those interactions can create unnecessary complications.
              </p>
              <p>
                Customers may save an employee’s number, continue contacting them directly, or
                associate an important business relationship with one person’s personal contact
                information.
              </p>
            </>
          )}
        />

        <div className="mt-12 grid grid-cols-1 lg:grid-cols-2 gap-5 lg:gap-6 items-stretch">
          <ContactPath
            label="Employee-led communication"
            tone="muted"
            nodes={[
              { icon: UserRound, text: 'Customer' },
              { icon: UserRound, text: 'Employee’s personal number' },
            ]}
          />
          <ContactPath
            label="Business-controlled communication"
            tone="brand"
            nodes={[
              { icon: UserRound, text: 'Customer' },
              { icon: Building2, text: 'Business communication environment' },
              { icon: UserRound, text: 'Authorized employee' },
            ]}
          />
        </div>

        <div className="mt-10 mx-auto max-w-2xl space-y-2 text-center text-base text-slate-700">
          <p>The employee remains responsible for serving the customer.</p>
          <p>The business remains responsible for the communication relationship.</p>
          <p className="font-semibold text-slate-900">
            That separation becomes particularly valuable as customer volume and team size
            increase.
          </p>
        </div>
      </Section>

      {/* ---------------------------- What it is ------------------------------- */}
      <Section>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-16 items-start">
          <SectionHead
            align="left"
            title={['What Is WhatsApp', 'Number Masking?']}
            lead={(
              <>
                <p>
                  WhatsApp number masking is a business communication capability that helps limit
                  the exposure of personal or internal contact numbers during customer-facing
                  interactions.
                </p>
                <p>
                  Instead of making an employee’s personal number the primary contact point,
                  businesses can use a controlled WhatsApp communication setup for customer
                  interactions.
                </p>
                <p className="text-sm text-slate-600">
                  The exact behaviour of number masking depends on the configured ZunoPilot and
                  WhatsApp Business environment.
                </p>
              </>
            )}
          />
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={viewport}
            transition={{ duration: 0.6, ease: EASE_OUT }}
            className="rounded-3xl bg-slate-50 ring-1 ring-slate-200/80 p-6 sm:p-8"
          >
            <p className="text-base font-semibold text-slate-900">
              This can help organizations manage:
            </p>
            <ul className="mt-6 space-y-4">
              {MANAGES.map((line, i) => (
                <motion.li
                  key={line}
                  initial={{ opacity: 0, x: -12 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={viewport}
                  transition={{ duration: 0.4, delay: i * 0.06, ease: EASE_OUT }}
                  className="flex items-baseline gap-4"
                >
                  <span className="w-6 shrink-0 text-sm font-semibold tabular-nums text-violet-500">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <span className="text-[15px] text-slate-800">{line}</span>
                </motion.li>
              ))}
            </ul>
          </motion.div>
        </div>
      </Section>

      {/* --------------------- Why control matters — the five ------------------ */}
      <Section tone="tinted">
        <SectionHead
          title={['Why Businesses Need More', 'Control Over Customer Numbers']}
          lead={(
            <>
              <p>
                Consider a business where five sales representatives communicate with hundreds of
                customers.
              </p>
              <p>
                If every conversation is tied directly to individual employee numbers, several
                things can happen:
              </p>
            </>
          )}
        />
        {/*
          What happens without a boundary, as cards with a broken-shield mark.

          It was a divided ledger — one line per consequence, ruled apart. Correct, and it read
          as a receipt. These are the *stakes* of the section, so each one gets its own surface,
          its own reveal, and a mark that says "this is a gap", not "this is a feature".
        */}
        <motion.ul
          initial="hidden"
          whileInView="show"
          viewport={viewport}
          variants={stagger(0.05, 0.07)}
          className="mt-10 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 sm:gap-4"
        >
          {CONSEQUENCES.map((line) => (
            <motion.li
              key={line}
              variants={item}
              whileHover={{ y: -5, boxShadow: '0 20px 44px -22px rgb(15 23 42 / 0.22)' }}
              transition={CARD_SPRING}
              className="group relative h-full overflow-hidden rounded-2xl bg-white p-5 ring-1 ring-slate-200/80"
            >
              {/* A slow violet wash on hover — the section is about exposure, so the cards
                  should feel like they are being looked at. One gradient, transform only. */}
              <span
                aria-hidden
                className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-violet-50 to-transparent transition-transform duration-700 group-hover:translate-x-full"
              />
              <span
                aria-hidden
                className="relative grid h-9 w-9 place-items-center rounded-xl bg-slate-100 text-slate-500 transition-colors duration-200 group-hover:bg-violet-600 group-hover:text-white"
              >
                <ShieldOff className="h-4 w-4" />
              </span>
              <p className="relative mt-3 text-[15px] font-medium text-slate-800 leading-relaxed">
                {line}
              </p>
            </motion.li>
          ))}
        </motion.ul>
        <p className="mt-8 text-center text-base text-slate-700 max-w-2xl mx-auto">
          Number masking provides a way to approach customer communication from a business-first
          perspective.
        </p>
      </Section>

      {/* --------------------- The four narrative arguments -------------------- */}
      <Section>
        <SectionHead title={['More Than Hiding a Number']} />
        <div className="mt-10 grid grid-cols-1 lg:grid-cols-2 gap-5">
          {ARGUMENTS.map((arg, i) => (
            <motion.article
              key={arg.title}
              initial={{ opacity: 0, y: 28 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={viewport}
              transition={{ duration: 0.55, delay: (i % 2) * 0.08, ease: EASE_OUT }}
              whileHover={{ y: -6, boxShadow: '0 26px 56px -24px rgb(96 73 231 / 0.34)' }}
              className="group relative overflow-hidden rounded-3xl bg-white ring-1 ring-slate-200/80 p-6 sm:p-8 transition-colors duration-300 hover:ring-violet-200"
            >
              {/*
                The glow this section asked for, and the reason it is a *static* gradient that
                fades in on hover rather than an animated one: a blur that animates repaints the
                whole card every frame, and four of these on screen is how a page starts
                dropping frames on a mid-range phone.
              */}
              <span
                aria-hidden
                className="pointer-events-none absolute -top-24 -right-16 h-56 w-56 rounded-full bg-violet-300/25 blur-3xl opacity-0 transition-opacity duration-500 group-hover:opacity-100"
              />
              <span
                aria-hidden
                className="absolute right-5 top-4 text-5xl font-extrabold text-slate-100 select-none transition-colors duration-300 group-hover:text-violet-100"
              >
                {String(i + 1).padStart(2, '0')}
              </span>
              <h3 className="relative text-lg font-bold text-slate-900">{arg.title}</h3>
              <div className="relative mt-3 space-y-3 text-[15px] text-slate-700 leading-relaxed">
                {arg.body.map((line) => <p key={line}>{line}</p>)}
              </div>
            </motion.article>
          ))}
        </div>
      </Section>

      {/* ------------------------ Where it is useful -------------------------- */}
      <Section tone="tinted">
        <SectionHead title={['Where WhatsApp Number', 'Masking Can Be Useful']} />
        <motion.div
          initial="hidden"
          whileInView="show"
          viewport={viewport}
          variants={stagger(0, 0.06)}
          className="mt-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5"
        >
          {USE_CASES.map((c) => (
            <motion.div
              key={c.title}
              variants={item}
              transition={CARD_SPRING}
              whileHover={{ y: -5, boxShadow: '0 22px 48px -20px rgb(96 73 231 / 0.28)' }}
              className="group h-full rounded-3xl bg-white ring-1 ring-slate-200/80 p-6 transition-colors duration-200 hover:ring-violet-200"
            >
              <IconTitle icon={c.icon} className="text-base font-bold text-slate-900">
                {c.title}
              </IconTitle>
              <p className="mt-3 text-[15px] text-slate-700 leading-relaxed">{c.body}</p>
            </motion.div>
          ))}
        </motion.div>
      </Section>

      {/* ------------------------ The operational questions ------------------- */}
      <Section>
        <SectionHead
          title={['The Questions It Helps', 'Your Business Answer']}
          lead={(
            <p>
              Number masking should not be viewed simply as a privacy feature. For businesses, it
              can also support communication ownership and continuity.
            </p>
          )}
        />
        <motion.ul
          initial="hidden"
          whileInView="show"
          viewport={viewport}
          variants={stagger(0.05, 0.08)}
          className="mt-10 mx-auto max-w-3xl space-y-3"
        >
          {QUESTIONS.map((q) => (
            <motion.li
              key={q}
              variants={item}
              whileHover={{ x: 5 }}
              transition={CARD_SPRING}
              className="flex items-start gap-4 rounded-2xl bg-violet-50/70 ring-1 ring-violet-100 px-5 py-4"
            >
              <span aria-hidden className="mt-0.5 text-lg font-bold leading-none text-violet-400">?</span>
              <span className="text-[15px] font-medium text-slate-800">{q}</span>
            </motion.li>
          ))}
        </motion.ul>
        <p className="mt-8 text-center text-base text-slate-700 max-w-2xl mx-auto">
          A business-controlled WhatsApp environment provides a foundation for addressing these
          concerns.
        </p>
      </Section>

      {/* ------------------------------ Companions ---------------------------- */}
      <Section tone="tinted">
        <SectionHead
          title={['Use Number Masking', 'Alongside Team Communication']}
          lead={(
            <p>
              Together, these capabilities can help businesses manage who communicates, how
              communication happens, and how customer relationships remain connected to the
              organization.
            </p>
          )}
        />
        <div className="mt-10 grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-5">
          {COMPANIONS.map((c) => (
            <motion.div
              key={c.href}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={viewport}
              transition={{ duration: 0.5, ease: EASE_OUT }}
              whileHover={{ y: -5 }}
              className="rounded-3xl bg-white ring-1 ring-slate-200/80 p-6"
            >
              <h3 className="text-base font-bold text-slate-900">{c.title}</h3>
              <p className="mt-2 text-sm text-slate-700 leading-relaxed">{c.body}</p>
              <div className="mt-4">
                <ArrowLink to={c.href}>{c.cta}</ArrowLink>
              </div>
            </motion.div>
          ))}
        </div>
      </Section>

      {/* ------------------------------- Gains -------------------------------- */}
      <Section>
        <SectionHead title={['What Businesses Can Gain', 'From Number Masking']} />
        <motion.div
          initial="hidden"
          whileInView="show"
          viewport={viewport}
          variants={stagger(0, 0.06)}
          className="mt-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5"
        >
          {GAINS.map((g) => (
            <motion.div
              key={g.title}
              variants={item}
              whileHover={{ y: -5 }}
              transition={CARD_SPRING}
              className="h-full rounded-3xl bg-gradient-to-br from-slate-50 to-slate-100/60 ring-1 ring-slate-200/80 p-6"
            >
              <span className="grid h-10 w-10 place-items-center rounded-2xl bg-violet-100 text-violet-600 ring-1 ring-violet-200/70">
                <ShieldCheck className="h-5 w-5" />
              </span>
              <h3 className="mt-4 text-base font-bold text-slate-900">{g.title}</h3>
              <p className="mt-2 text-sm text-slate-700 leading-relaxed">{g.body}</p>
            </motion.div>
          ))}
        </motion.div>
      </Section>

      {/* ------------------------------ Is it right --------------------------- */}
      <Section tone="tinted">
        <SectionHead
          title={['Is WhatsApp Number Masking', 'Right for Your Business?']}
          lead={<p>Number masking can be especially relevant if:</p>}
        />
        <CheckCards items={FIT} columns={2} className="mt-10 max-w-5xl mx-auto" />
        <p className="mt-8 text-center text-base text-slate-700 max-w-2xl mx-auto">
          If your business has these challenges, a controlled WhatsApp communication model may be
          worth considering.
        </p>
      </Section>

      <FaqSection faqs={FAQS} />

      <CtaBand
        title={['Keep Customer Relationships', 'Connected to Your Business']}
        body={[
          'Your customers should be able to communicate with your company without making an employee’s personal contact information the foundation of the relationship.',
          'ZunoPilot helps businesses create a more controlled WhatsApp communication environment while giving authorized employees the ability to serve customers.',
        ]}
      />

      <SiteFooter />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                                    Copy                                     */
/* -------------------------------------------------------------------------- */

const MANAGES = [
  'Employee contact privacy',
  'Customer-facing communication',
  'Business ownership of conversations',
  'Communication continuity',
  'Team access to customer relationships',
];

const CONSEQUENCES = [
  'Customers save personal contact details.',
  'Conversations become difficult to transfer.',
  'Customer relationships can become dependent on individual employees.',
  'New employees may have difficulty taking over existing relationships.',
  'Managers have less control over customer communication.',
  'Employees may need to use personal contact information for work.',
];

const ARGUMENTS = [
  {
    title: 'Keep the Business Relationship With the Business',
    body: [
      'A customer may initially speak with one employee, but the relationship belongs to the company.',
      'A prospect may spend several weeks discussing a service with a sales representative. If that employee changes roles, moves department, or leaves, the business should still be able to maintain the customer relationship.',
      'A controlled model helps separate who is handling the conversation from who owns the customer relationship.',
    ],
  },
  {
    title: 'Protect Employee Contact Information',
    body: [
      'Employees should not necessarily have to expose their personal contact details simply because their job involves customer communication.',
      'Instead of customers relying on an employee’s personal number, the communication can remain associated with the business’s configured WhatsApp environment.',
    ],
  },
  {
    title: 'Maintain Communication When Employees Change',
    body: [
      'Businesses change constantly. Employees join. People move between departments. Responsibilities are reassigned. Employees leave.',
      'Customer communication shouldn’t have to become disconnected every time the person responsible for a conversation changes. A business-managed approach makes responsibility transitions easier to manage.',
    ],
  },
  {
    title: 'Give Customers a Consistent Contact Experience',
    body: [
      'A customer should be able to recognize that they are communicating with your business, even when different employees participate in the relationship.',
      'The objective is to make the business the consistent point of contact, rather than an individual employee.',
    ],
  },
];

const USE_CASES = [
  { icon: Target, title: 'Sales Organizations', body: 'Representatives can communicate with prospects without making personal contact details the foundation of the customer relationship.' },
  { icon: Headphones, title: 'Customer Service', body: 'Support teams can interact with customers through a business-controlled communication environment.' },
  { icon: Wrench, title: 'Field Service Teams', body: 'Employees working directly with customers can communicate without unnecessarily exposing personal contact information.' },
  { icon: CalendarClock, title: 'Appointment-Based Businesses', body: 'Maintain a consistent customer channel even when different staff members coordinate appointments.' },
  { icon: Truck, title: 'Delivery and Operations', body: 'Teams responsible for customer-facing updates can communicate through a controlled business setup.' },
  { icon: Users, title: 'Multi-Employee Businesses', body: 'Create clearer boundaries around how customer communication is handled across several customer-facing employees.' },
];

const QUESTIONS = [
  'Who should customers contact?',
  'Which communication belongs to the business?',
  'What happens when an employee changes roles?',
  'How can customer relationships remain connected to the organization?',
  'How can personal and professional communication remain separate?',
];

const COMPANIONS = [
  {
    title: 'WhatsApp Team Inbox',
    body: 'Allow authorized team members to participate in customer conversations through a shared communication environment.',
    cta: 'Explore WhatsApp Team Inbox',
    href: '/features/whatsapp-team-inbox',
  },
  {
    title: 'WhatsApp Automation',
    body: 'Automate suitable recurring communication while maintaining the business-controlled environment.',
    cta: 'Explore WhatsApp Automation',
    href: '/features/whatsapp-automation',
  },
  {
    title: 'AI WhatsApp Automation',
    body: 'Use AI-assisted communication for suitable customer interactions.',
    cta: 'Explore AI WhatsApp Automation',
    href: '/features/ai-whatsapp-automation',
  },
];

const GAINS = [
  { title: 'Better Contact Privacy', body: 'Reduce unnecessary exposure of employee contact information.' },
  { title: 'Stronger Business Ownership', body: 'Keep customer communication associated with the organization.' },
  { title: 'Easier Responsibility Transfers', body: 'Make customer communication easier to continue when employees change roles.' },
  { title: 'Clearer Work Boundaries', body: 'Help separate professional communication from employees’ personal contact information.' },
  { title: 'More Consistent Customer Experience', body: 'Give customers a recognizable business communication channel.' },
  { title: 'Better Operational Control', body: 'Create a more deliberate structure around customer-facing WhatsApp communication.' },
];

const FIT = [
  'Employees regularly communicate directly with customers',
  'Customers currently save employees’ personal numbers',
  'Customer relationships are heavily dependent on individual employees',
  'You need clearer separation between personal and business communication',
  'Multiple employees may eventually need to handle the same customer',
  'You want greater control over customer-facing WhatsApp communication',
];

const FAQS = [
  {
    question: 'What is WhatsApp number masking for business?',
    answer:
      'WhatsApp number masking is a business communication capability designed to limit unnecessary '
      + 'exposure of personal or internal contact numbers during customer interactions and help '
      + 'businesses maintain a more controlled communication environment.',
  },
  {
    question: 'Why should businesses use WhatsApp number masking?',
    answer:
      'Businesses may use number masking to protect employee contact information, maintain stronger '
      + 'ownership of customer relationships, establish clearer work boundaries, and make customer '
      + 'communication easier to manage when responsibilities change.',
  },
  {
    question: 'Does WhatsApp number masking hide an employee’s personal number?',
    answer:
      'The exact behavior depends on the configured WhatsApp Business setup and ZunoPilot '
      + 'implementation. The purpose is to reduce unnecessary exposure of personal contact '
      + 'information during business communication.',
  },
  {
    question: 'Can employees still communicate directly with customers?',
    answer:
      'Yes. Authorized employees can continue handling customer conversations according to the '
      + 'configured business communication setup. Number masking is intended to control the contact '
      + 'information exposed during those interactions.',
  },
  {
    question: 'Can multiple employees use a business communication setup?',
    answer:
      'Yes, where supported by the configured ZunoPilot and WhatsApp Business environment, multiple '
      + 'authorized users can participate in customer communication.',
  },
  {
    question: 'Is WhatsApp number masking useful for sales teams?',
    answer:
      'Yes. It can help sales organizations keep customer relationships connected to the business '
      + 'rather than making individual employee contact numbers the primary communication point.',
  },
  {
    question: 'What happens when an employee leaves the company?',
    answer:
      'A business-controlled communication setup can make it easier to transfer customer '
      + 'responsibilities to another authorized team member without relying entirely on the former '
      + 'employee’s personal contact number.',
  },
  {
    question: 'Is number masking the same as WhatsApp automation?',
    answer:
      'No. They address different needs. Number masking focuses on contact privacy and business '
      + 'communication control, while WhatsApp automation focuses on automating recurring '
      + 'communication and processes.',
  },
  {
    question: 'Can number masking work with a WhatsApp Team Inbox?',
    answer:
      'Where supported by the configured setup, number management can work alongside team inbox '
      + 'functionality so authorized employees can participate in business conversations without '
      + 'making individual personal numbers the center of the customer relationship.',
  },
  {
    question: 'Is WhatsApp number masking suitable for small businesses?',
    answer:
      'It can be useful for small businesses where employees communicate directly with customers and '
      + 'the business wants a clearer separation between personal contact information and '
      + 'customer-facing communication.',
  },
  {
    question: 'Does number masking provide complete privacy?',
    answer:
      'No technology should be treated as an absolute privacy guarantee. Businesses should configure '
      + 'their WhatsApp Business environment appropriately and comply with applicable privacy, '
      + 'messaging, and platform requirements.',
  },
];
