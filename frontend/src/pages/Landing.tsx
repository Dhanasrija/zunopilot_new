import { useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  Star, ArrowRight, Check, Building2, GraduationCap, ShoppingBag, Stethoscope,
  UtensilsCrossed, Wrench, AlarmClock, BarChart3, BellRing, Bot, Clock, Contact,
  EyeOff, FileText, HeartHandshake, Headphones, HelpCircle, KeyRound, LayoutGrid,
  Megaphone, MessageSquare, Plug, RefreshCw, Repeat, ShieldCheck, Sparkles, Target,
  TrendingUp, UserPlus, Users, Workflow, Zap,
} from 'lucide-react';
import {
  motion, useScroll, useTransform, useReducedMotion,
} from 'framer-motion';
import { useCountUp } from '@/hooks/useCountUp';
import { useDocumentHead } from '@/lib/document-head';
import { PAGE_HEADS } from '@/lib/page-heads';
import SiteHeader from '@/components/marketing/SiteHeader';
import SiteFooter from '@/components/marketing/SiteFooter';
import {
  AnimatedHeading, ArrowLink, CARD_SPRING, CheckCards, CheckList, CtaBand, CtaPair, EASE_OUT,
  FaqSection, ScrollProgress, Section, SectionHead, StepRail, TileGrid, fadeUp,
  item, scaleIn, stagger, viewport
} from '@/components/marketing/primitives';
import { IconTitle, Reveal } from '@/components/marketing/motion-kit';

/*
 * The home page.
 *
 * **What changed and why the page got longer.** It used to say what the product does
 * in four feature cards — shared inbox, keyword automation, trigger notifications,
 * order management — which described the restaurant-ordering MVP the app started as.
 * The positioning is now "AI-powered WhatsApp business automation", and the four
 * pillars underneath it (AI automation, WhatsApp automation, the shared portal, number
 * masking) each have their own page. So this page's job changed: it is the top of a
 * hub-and-spoke, and every pillar section here ends in a link to the page that covers
 * it properly. Those links are the whole point — a hub with no outbound links is just
 * a long page, and the detail pages are the ones the search terms actually match.
 *
 * **What was deliberately kept.** Stats and Testimonials are not in the supplied copy, but
 * removing them would take the only social proof off the page. They sit between the new bands
 * rather than replacing any of them.
 *
 * **There is no pricing section here any more** — see the note further down where it used to be.
 * `/pricing` is the only page that quotes a price, which is the arrangement that keeps the home
 * page from drifting out of step with what checkout charges.
 */

export default function Landing() {
  useDocumentHead(PAGE_HEADS.landing);

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <ScrollProgress />
      <SiteHeader />
      <Hero />
      <WhyAutomate />
      <AiAutomation />
      <NumberMasking />
      <Workflows />
      <Tools />
      <Stats />
      <HowItWorks />
      <CustomerJourney />
      <Industries />
      <WhyZunoPilot />
      <Testimonials />
      <BusinessApi />
      <FaqSection faqs={HOME_FAQS} />
      <CtaBand
        title={['Ready to Automate Your', 'Business on WhatsApp?']}
        body={[
          'Bring AI-powered automation, customer conversations, team collaboration, and WhatsApp workflows together with ZunoPilot.',
          'Start automating WhatsApp the smarter way.',
        ]}
      />
      <SiteFooter />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                                    Hero                                    */
/* -------------------------------------------------------------------------- */


function Hero() {
  const reduceMotion = useReducedMotion();
  const sectionRef = useRef<HTMLElement>(null);

  // Scroll-linked parallax: the background drifts up slightly, the preview drifts down.
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ['start start', 'end start'],
  });
  const bgY = useTransform(scrollYProgress, [0, 1], ['0%', '-12%']);
  const previewY = useTransform(scrollYProgress, [0, 1], ['0%', '40%']);

  return (
    <section id="home" ref={sectionRef} className="relative overflow-hidden isolate">
      <motion.div
        aria-hidden
        style={reduceMotion ? undefined : { y: bgY }}
        className="absolute inset-0 bg-no-repeat bg-cover bg-center will-change-transform"
      >
        {/* Slight scale so the parallax-up cannot reveal background colour at the edge. */}
        <div
          className="absolute inset-0 bg-no-repeat bg-cover bg-center"
          style={{ backgroundImage: "url('/hero-background.png')", transform: 'scale(1.06)' }}
        />
      </motion.div>

      <motion.div
        className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-12 sm:pt-16 lg:pt-20 pb-12 lg:pb-20"
        initial="hidden"
        animate="show"
        variants={stagger(0.05, 0.14)}
      >
        <div className="text-center max-w-4xl mx-auto">
          <AnimatedHeading
            as="h1"
            trigger="mount"
            className="text-[34px] leading-[1.15] sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-slate-900"
            lines={['AI-Powered WhatsApp', 'Business Automation']}
          />

          <motion.p
            variants={fadeUp}
            className="mt-5 sm:mt-6 text-base sm:text-lg text-slate-700 max-w-2xl mx-auto"
          >
            Automate customer conversations, lead follow-ups, support, campaigns, and
            everyday business communication with ZunoPilot.
          </motion.p>
          <motion.p
            variants={fadeUp}
            className="mt-4 text-base sm:text-lg text-slate-700 max-w-2xl mx-auto"
          >
            Bring AI-powered automation, a shared WhatsApp portal, team collaboration, and
            number masking together in one platform built for business communication.
          </motion.p>

          <motion.div variants={fadeUp} className="mt-8">
            <CtaPair />
          </motion.div>

        </div>

        <motion.div
          variants={scaleIn}
          style={reduceMotion ? undefined : { y: previewY }}
          className="relative mt-12 sm:mt-16 lg:mt-20 max-w-5xl mx-auto"
        >
          <motion.div
            className="rounded-2xl overflow-hidden shadow-2xl shadow-violet-200/60 ring-1 ring-slate-200 bg-white"
            whileHover={{ y: -4 }}
            transition={CARD_SPRING}
          >
            <img
              src="/hero-1.svg"
              alt="ZunoPilot shared WhatsApp portal and automation dashboard"
              className="w-full h-auto block"
              loading="eager"
            />
          </motion.div>
        </motion.div>
      </motion.div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/*                         Why automate — the framing band                     */
/* -------------------------------------------------------------------------- */

const WHAT_YOU_CAN_DO = [
  'Automate customer conversations',
  'Respond to routine enquiries',
  'Automate lead follow-ups',
  'Manage conversations through a shared WhatsApp portal',
  'Use number masking for controlled business communication',
  'Send campaigns and notifications',
  'Organize customer communication',
  'Build automated WhatsApp workflows',
];

function WhyAutomate() {
  return (
    <Section tone="tinted">
      <SectionHead
        eyebrow="Built for business communication"
        title={['Automate Your Business', 'Communication on WhatsApp']}
        lead={(
          <p>
            WhatsApp is an essential communication channel for businesses, but managing
            conversations manually across individual phones becomes difficult as your team and
            customer base grow.
          </p>
        )}
      />

      {/*
        The before/after, side by side.

        This band used to be three paragraphs and a bullet list, which is the same
        information and none of the argument. The problem and the answer are the two
        halves of the pitch, so they are set against each other — the manual column in
        muted slate, the ZunoPilot column in brand violet and visibly lifted. Nothing
        here is new copy; it is the supplied copy given a shape.
      */}
      <div className="mt-12 grid grid-cols-1 lg:grid-cols-2 gap-5 lg:gap-6 items-stretch">
        <motion.div
          initial={{ opacity: 0, x: -24 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={viewport}
          transition={{ duration: 0.6, ease: EASE_OUT }}
          className="rounded-3xl bg-slate-100/80 ring-1 ring-slate-200 p-6 sm:p-8"
        >
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">
            Handled manually
          </p>
          <h3 className="mt-3 text-xl font-bold text-slate-700">
            Conversations spread across phones
          </h3>
          <ul className="mt-6 space-y-3">
            {MANUAL_REALITY.map((line) => (
              <li key={line} className="flex items-start gap-3">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400" />
                <span className="text-[15px] text-slate-700 leading-relaxed">{line}</span>
              </li>
            ))}
          </ul>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, x: 24 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={viewport}
          transition={{ duration: 0.6, ease: EASE_OUT }}
          whileHover={{ y: -6 }}
          className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-violet-600 to-violet-700 p-6 sm:p-8 shadow-xl shadow-violet-300/50"
        >
          <span
            aria-hidden
            className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-white/10 blur-2xl"
          />
          <p className="relative text-xs font-semibold uppercase tracking-widest text-violet-200">
            With ZunoPilot
          </p>
          <h3 className="relative mt-3 text-xl font-bold text-white">
            One organized, automated workflow
          </h3>
          <ul className="relative mt-6 space-y-3">
            {AUTOMATED_REALITY.map((line) => (
              <li key={line} className="flex items-start gap-3">
                <span className="mt-0.5 grid place-items-center h-5 w-5 shrink-0 rounded-full bg-white/20 text-white">
                  <Check className="h-3 w-3" strokeWidth={3} />
                </span>
                <span className="text-[15px] text-violet-50 leading-relaxed">{line}</span>
              </li>
            ))}
          </ul>
        </motion.div>
      </div>

      <p className="mt-12 text-center text-lg font-semibold text-slate-900 max-w-2xl mx-auto">
        ZunoPilot turns WhatsApp conversations into organized, automated business workflows.
      </p>

      <p className="mt-10 text-center text-base font-semibold text-slate-900">
        With ZunoPilot, you can:
      </p>
      <CheckCards items={WHAT_YOU_CAN_DO} columns={2} className="mt-6 max-w-5xl mx-auto" />
    </Section>
  );
}

/** The left-hand column: what the copy says happens without automation. */
const MANUAL_REALITY = [
  'Every message waits for someone to notice it',
  'Follow-ups depend on who remembers them',
  'Customer history lives on one employee\u2019s device',
  'The same questions get answered again and again',
  'Nobody can see which conversations are still open',
];

/** The right-hand column. */
const AUTOMATED_REALITY = [
  'AI and automation handle the repetitive interactions',
  'Conversations are managed from one shared portal',
  'Follow-ups run as workflows, not reminders',
  'Your team keeps full context on every handover',
  'Communication stays with the business as the team changes',
];

/* -------------------------------------------------------------------------- */
/*                              The four pillars                               */
/* -------------------------------------------------------------------------- */

/*
 * Each tile names the icon that represents *its own* subject rather than a generic
 * sparkle six times over. That is the difference between an icon that labels the card and
 * decoration that happens to sit next to a heading.
 */
const AI_TILES = [
  { icon: HelpCircle, title: 'Customer Enquiries', body: 'Handle common questions and routine interactions more efficiently.' },
  { icon: Target, title: 'Lead Engagement', body: 'Respond to new enquiries and support consistent follow-ups.' },
  { icon: Headphones, title: 'Customer Support', body: 'Automate routine interactions while allowing your team to take over when human assistance is needed.' },
  { icon: Repeat, title: 'Follow-Ups', body: 'Create workflows that keep conversations moving after the initial interaction.' },
  { icon: HeartHandshake, title: 'Customer Engagement', body: 'Maintain timely communication with customers through automated workflows.' },
  { icon: Megaphone, title: 'Campaign Communication', body: 'Reach customers with relevant business messages and campaigns.' },
];

function AiAutomation() {
  return (
    <Section id="features">
      <SectionHead
        eyebrow="AI-Powered WhatsApp Automation"
        title={['Let AI Handle the', 'Repetitive Work']}
        lead={(
          <>
            <p>Not every customer conversation needs to be handled manually.</p>
            <p>
              ZunoPilot uses AI-powered automation to help businesses manage routine
              interactions, respond to common enquiries, engage leads, and streamline
              repetitive communication.
            </p>
          </>
        )}
      />
      <p className="mt-10 text-center text-base font-semibold text-slate-900">Automate:</p>
      <div className="mt-5">
        <TileGrid tiles={AI_TILES} />
      </div>
      <div className="mt-10 text-center">
        <ArrowLink to="/features/ai-whatsapp-automation">Explore AI-Powered Automation</ArrowLink>
      </div>
    </Section>
  );
}

const MASKING_TILES = [
  { icon: EyeOff, title: 'Reduce Unnecessary Number Exposure', body: 'Keep business communication within your defined workflow.' },
  { icon: Building2, title: 'Centralize Communication', body: 'Move customer interactions into a business-managed environment.' },
  { icon: KeyRound, title: 'Control Team Access', body: 'Give authorized users access without making individual phones the center of your workflow.' },
  { icon: ShieldCheck, title: 'Maintain Business Continuity', body: 'Keep customer communication connected to your business as your team changes.' },
];

function NumberMasking() {
  return (
    <Section>
      <SectionHead
        eyebrow="WhatsApp Number Masking for Better Business Control"
        title={['Keep Business Communication', 'Under Control']}
        lead={(
          <>
            <p>
              When customers communicate directly with individual employees, managing business
              WhatsApp numbers can become difficult.
            </p>
            <p>
              ZunoPilot&rsquo;s number masking capability helps create a more controlled
              communication environment while allowing authorized team members to manage
              conversations through the shared portal.
            </p>
          </>
        )}
      />
      <p className="mt-10 text-center text-base font-semibold text-slate-900">
        Build a more structured communication process
      </p>
      <div className="mt-5">
        <TileGrid tiles={MASKING_TILES} columns={2} />
      </div>
      <div className="mt-10 text-center">
        <ArrowLink to="/features/whatsapp-number-masking">Explore WhatsApp Number Masking</ArrowLink>
      </div>
    </Section>
  );
}

const WORKFLOW_TILES = [
  { icon: UserPlus, title: 'Lead Follow-Ups', body: 'Stay connected with prospects without relying entirely on manual reminders.' },
  { icon: MessageSquare, title: 'Customer Enquiries', body: 'Streamline responses to common questions and incoming requests.' },
  { icon: BellRing, title: 'Notifications', body: 'Send important business updates through automated workflows.' },
  { icon: AlarmClock, title: 'Reminders', body: 'Keep customers informed about appointments, orders, services, and other activities.' },
  { icon: RefreshCw, title: 'Customer Re-Engagement', body: 'Reconnect with customers through timely communication.' },
  { icon: Megaphone, title: 'Campaigns', body: 'Reach customers with promotions, announcements, and relevant updates.' },
];

function Workflows() {
  return (
    <Section tone="tinted">
      <SectionHead
        eyebrow="Automate WhatsApp Workflows Across Your Business"
        title={['Turn Repetitive Communication', 'Into Automated Workflows']}
        lead={(
          <p>
            From the first customer enquiry to ongoing engagement, ZunoPilot helps businesses
            automate the communication they handle every day.
          </p>
        )}
      />
      <div className="mt-10">
        <TileGrid tiles={WORKFLOW_TILES} />
      </div>
      <div className="mt-10 text-center">
        <ArrowLink to="/features/whatsapp-automation">Build Your WhatsApp Workflow</ArrowLink>
      </div>
    </Section>
  );
}

/* -------------------------------------------------------------------------- */
/*                                   Tools                                     */
/* -------------------------------------------------------------------------- */

/*
 * Nine tools, not eight.
 *
 * **`WhatsApp Business API` is the added one**, and it was the obvious gap: it is the only
 * item here with its own feature page that the home page never named, and it is what the
 * other eight sit on top of. Nine also fills the three-column grid exactly, so the last
 * row is no longer two cards and a hole.
 */
const TOOL_TILES = [
  { icon: Sparkles, title: 'AI-Powered Automation', body: 'Use AI to streamline repetitive customer communication.' },
  { icon: Workflow, title: 'WhatsApp Automation', body: 'Create workflows for everyday business interactions.' },
  { icon: ShieldCheck, title: 'Number Masking', body: 'Create greater control over business number exposure.' },
  { icon: Users, title: 'Team Inbox', body: 'Allow authorized users to manage customer conversations together.' },
  { icon: Contact, title: 'Customer Management', body: 'Keep customer information and communication organized.' },
  { icon: Megaphone, title: 'WhatsApp Campaigns', body: 'Create targeted communication for customer engagement.' },
  { icon: FileText, title: 'Message Templates', body: 'Use structured messages for recurring business communication.' },
  { icon: BarChart3, title: 'Analytics', body: 'Understand communication activity and team performance.' },
  { icon: Plug, title: 'WhatsApp Business API', body: 'Connect WhatsApp with the software and workflows your business already runs on.' },
];

function Tools() {
  return (
    <Section id="tools">
      <SectionHead title={['Powerful Tools for WhatsApp', 'Business Automation']} />
      <div className="mt-10">
        <TileGrid tiles={TOOL_TILES} />
      </div>
      <div className="mt-10 text-center">
        <ArrowLink to="/features">Explore all ZunoPilot features</ArrowLink>
      </div>
    </Section>
  );
}

/* -------------------------------------------------------------------------- */
/*                                   Stats                                     */
/* -------------------------------------------------------------------------- */

const STATS = [
  { numeric: 10, suffix: 'M+', label: 'Messages Sent', highlight: true },
  { numeric: 5000, suffix: '+', label: 'Businesses Connected', highlight: false },
  { numeric: 99.9, suffix: '%', label: 'Uptime SLA', highlight: true },
  { numeric: 0, suffix: '24/7', label: 'Premium Support', highlight: false, raw: '24/7' },
];

function Stats() {
  return (
    <Section tone="tinted">
      <SectionHead
        title={['Driving Business Growth on', 'WhatsApp']}
        lead={(
          <p>
            Empowering brands with seamless communication, intelligent automation, and
            dependable performance.
          </p>
        )}
      />

      <motion.div
        className="mt-12 grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5 lg:gap-6 items-end"
        initial="hidden"
        whileInView="show"
        viewport={viewport}
        variants={stagger(0, 0.1)}
      >
        {STATS.map((s) => (
          <StatCard
            key={s.label}
            numeric={s.numeric}
            suffix={s.suffix}
            raw={s.raw}
            label={s.label}
            highlight={s.highlight}
          />
        ))}
      </motion.div>
    </Section>
  );
}

function StatCard({
  numeric, suffix, raw, label, highlight,
}: {
  numeric: number; suffix: string; raw?: string;
  label: string; highlight: boolean;
}) {
  const bg = highlight
    ? 'bg-[radial-gradient(120%_90%_at_85%_15%,#dbe1ff_0%,#eef0ff_35%,#ffffff_75%)]'
    : 'bg-slate-100';
  const height = highlight
    ? 'min-h-[240px] sm:min-h-[280px]'
    : 'min-h-[180px] sm:min-h-[200px]';

  const { ref, value } = useCountUp(numeric);
  const display = raw
    ? raw
    : Number.isInteger(numeric)
      ? `${Math.floor(value).toLocaleString()}${suffix}`
      : `${value.toFixed(1)}${suffix}`;

  return (
    <motion.div
      variants={item}
      whileHover={{ y: -6, scale: 1.015, boxShadow: '0 18px 36px -10px rgb(96 73 231 / 0.22)' }}
      whileTap={{ scale: 0.99 }}
      transition={CARD_SPRING}
      className={`group relative rounded-2xl ring-1 ring-slate-200/80 p-5 sm:p-6 flex flex-col justify-between cursor-default ${bg} ${height}`}
    >
      <motion.span
        aria-hidden
        className="absolute top-4 right-4 grid place-items-center h-5 w-5 rounded-full bg-white ring-1 ring-violet-200"
        whileHover={{ rotate: 360 }}
        transition={{ duration: 0.6, ease: EASE_OUT }}
      >
        <motion.span
          className="h-2 w-2 rounded-full bg-violet-600"
          animate={{ scale: [1, 1.25, 1] }}
          transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
        />
      </motion.span>
      <div className="text-3xl sm:text-4xl font-extrabold tracking-tight text-slate-900">
        <span ref={ref}>{display}</span>
      </div>
      <div className="text-sm sm:text-base text-slate-600">{label}</div>
    </motion.div>
  );
}

/* -------------------------------------------------------------------------- */
/*                                How it works                                 */
/* -------------------------------------------------------------------------- */

const STEPS = [
  {
    index: '01',
    kicker: 'Connect',
    title: 'Connect Your Business WhatsApp',
    body: 'Set up your WhatsApp communication with ZunoPilot.',
  },
  {
    index: '02',
    kicker: 'Centralize',
    title: 'Bring Your Team Into One Portal',
    body: 'Give authorized team members a shared workspace for customer conversations.',
  },
  {
    index: '03',
    kicker: 'Automate',
    title: 'Create AI-Powered Workflows',
    body: 'Configure workflows for enquiries, follow-ups, notifications, campaigns, and recurring interactions.',
  },
  {
    index: '04',
    kicker: 'Engage',
    title: 'Focus on Customers',
    body: 'Let automation handle repetitive communication while your team focuses on conversations that need personal attention.',
  },
];

function HowItWorks() {
  return (
    <Section>
      <SectionHead title={['From WhatsApp Messages', 'to Automated Workflows']} />
      <div className="mt-12">
        <StepRail steps={STEPS} />
      </div>
    </Section>
  );
}

/* -------------------------------------------------------------------------- */
/*                              Customer journey                               */
/* -------------------------------------------------------------------------- */

const JOURNEY = [
  {
    icon: Target,
    title: 'Lead Management',
    body: 'Capture enquiries, engage prospects, and create consistent follow-up workflows.',
    href: '/solutions/lead-management',
  },
  {
    icon: TrendingUp,
    title: 'Sales',
    body: 'Give sales teams a centralized environment to manage enquiries and customer conversations.',
    href: '/solutions/sales-automation',
  },
  {
    icon: Headphones,
    title: 'Customer Support',
    body: 'Automate routine interactions while giving support teams a shared workspace.',
    href: '/solutions/customer-support',
  },
  {
    icon: Megaphone,
    title: 'Marketing',
    body: 'Engage customers through campaigns, promotions, announcements, and automated communication.',
    href: '/solutions/marketing-automation',
  },
  {
    icon: BellRing,
    title: 'Notifications',
    body: 'Automate confirmations, reminders, alerts, updates, and other important messages.',
    href: '/features/whatsapp-automation',
  },
  {
    icon: HeartHandshake,
    title: 'Customer Engagement',
    body: 'Stay connected with customers through timely and relevant WhatsApp communication.',
    href: '/solutions/customer-engagement',
  },
];

function CustomerJourney() {
  return (
    <Section tone="tinted">
      <SectionHead title={['WhatsApp Automation for', 'Every Customer Journey']} />

      <motion.div
        initial="hidden"
        whileInView="show"
        viewport={viewport}
        variants={stagger(0, 0.07)}
        className="mt-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5"
      >
        {JOURNEY.map((entry) => (
          <motion.div key={entry.title} variants={item} whileHover={{ y: -6 }} transition={CARD_SPRING}>
            <Link
              to={entry.href}
              className="group relative flex h-full flex-col overflow-hidden rounded-3xl bg-white ring-1 ring-slate-200/80 p-6 hover:ring-violet-200 transition-colors"
            >
              {/*
                A sheen that crosses the card on hover. One translated gradient behind
                `overflow-hidden` — no blur, no filter, so it composites on the GPU and the
                card does not repaint every frame.
              */}
              <span
                aria-hidden
                className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-violet-50 to-transparent transition-transform duration-700 group-hover:translate-x-full"
              />
              <IconTitle icon={entry.icon} className="relative text-lg font-bold text-slate-900">
                {entry.title}
              </IconTitle>
              <p className="relative mt-3 text-sm text-slate-700 leading-relaxed">{entry.body}</p>
              <span className="relative mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-violet-600">
                Learn more
                <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1" />
              </span>
            </Link>
          </motion.div>
        ))}
      </motion.div>

      <div className="mt-10 text-center">
        <ArrowLink to="/solutions">Explore all business solutions</ArrowLink>
      </div>
    </Section>
  );
}

/* -------------------------------------------------------------------------- */
/*                                 Industries                                  */
/* -------------------------------------------------------------------------- */

const INDUSTRIES = [
  { icon: UtensilsCrossed, title: 'Restaurants', body: 'Automate enquiries, reservations, order communication, promotions, and customer engagement.' },
  { icon: ShoppingBag, title: 'Ecommerce', body: 'Manage customer enquiries, order updates, promotions, and post-purchase communication.' },
  { icon: Building2, title: 'Real Estate', body: 'Manage property enquiries, lead conversations, follow-ups, and customer communication.' },
  { icon: GraduationCap, title: 'Education', body: 'Streamline enquiries, admissions communication, reminders, and updates.' },
  { icon: Wrench, title: 'Service Businesses', body: 'Automate enquiries, bookings, reminders, notifications, and customer support.' },
  { icon: Stethoscope, title: 'Healthcare & Clinics', body: 'Automate appointment reminders, confirmations, and routine patient communication.' },
];

function Industries() {
  return (
    <Section>
      <SectionHead title={['WhatsApp Automation for', 'Different Industries']} />
      <div className="mt-10">
        <TileGrid tiles={INDUSTRIES} />
      </div>
      <div className="mt-10 text-center">
        <ArrowLink to="/industries">Explore Industry Solutions</ArrowLink>
      </div>
    </Section>
  );
}

/* -------------------------------------------------------------------------- */
/*                            Why choose ZunoPilot                             */
/* -------------------------------------------------------------------------- */

const WHY = [
  { icon: Bot, title: 'AI + Automation', body: 'Combine AI-powered capabilities with business workflows to reduce repetitive communication.' },
  { icon: LayoutGrid, title: 'One Shared Workspace', body: 'Bring WhatsApp conversations and team communication together.' },
  { icon: ShieldCheck, title: 'Better Number Control', body: 'Use number masking to create a more controlled communication process.' },
  { icon: Clock, title: 'Less Manual Work', body: 'Automate recurring interactions and follow-ups.' },
  { icon: Users, title: 'Better Team Collaboration', body: 'Give authorized team members access to the conversations they need.' },
  { icon: TrendingUp, title: 'Built for Business Growth', body: 'Create WhatsApp workflows that can evolve as your team and customer communication grow.' },
];

function WhyZunoPilot() {
  return (
    <Section tone="tinted">
      <SectionHead title={['Why Businesses', 'Choose ZunoPilot']} />
      <div className="mt-10">
        <TileGrid tiles={WHY} />
      </div>
    </Section>
  );
}

/* -------------------------------------------------------------------------- */
/*                                Testimonials                                 */
/* -------------------------------------------------------------------------- */

function Testimonials() {
  return (
    <Section id="testimonial">
      <SectionHead
        title={['Trusted by Fast-Growing Brands']}
        lead={(
          <p>
            Helping businesses automate customer conversations, streamline operations, and
            scale engagement on WhatsApp.
          </p>
        )}
      />

      <motion.div
        className="mt-12 grid grid-cols-1 md:grid-cols-4 gap-4 sm:gap-5"
        initial="hidden"
        whileInView="show"
        viewport={viewport}
        variants={stagger(0, 0.08)}
      >
        <TestimonialCard
          className="md:col-span-2" rating
          quote='"ZunoPilot completely changed how we handle reservations. The keyword automatic replies answered 80% of our FAQs, and order triggers update customers instantly."'
          name="Marco Rossi" role="Owner, Luigi's Italian Kitchen"
        />
        <TestimonialCard
          className="md:col-span-1"
          quote='"Running a multi-seat salon was messy with just one phone. The shared inbox lets our front desk and managers organize bookings seamlessly."'
          name="Sarah Jenkins" role="Founder, Glow & Co. Salon"
        />
        <TestimonialImage src="/testimonial-1.png" alt="Sarah Jenkins" className="md:col-span-1" />

        <TestimonialImage src="/testimonial-2.png" alt="Alex Tan" className="md:col-span-1" />
        <TestimonialCard
          className="md:col-span-1"
          quote='"The Catalog Menu sync and order tracking triggers have dropped our support volumes by 50%. Incredible ROI for our e-commerce boutique!"'
          name="Alex Tan" role="Marketing Director, UrbanThread"
        />
        <TestimonialCard
          className="md:col-span-2" rating
          quote='"Our response time dropped by 70% after switching to ZunoPilot. The shared inbox and automation features helped our support team handle customer queries much faster."'
          name="Priya Sharma" role="Customer Success Manager"
        />
      </motion.div>
    </Section>
  );
}

function TestimonialCard({
  quote, name, role, rating = false, className = '',
}: {
  quote: string; name: string; role: string; rating?: boolean; className?: string;
}) {
  return (
    <motion.div
      variants={item}
      whileHover={{ y: -6, scale: 1.01, boxShadow: '0 16px 40px -12px rgb(15 23 42 / 0.15)' }}
      whileTap={{ scale: 0.99 }}
      transition={CARD_SPRING}
      className={`group h-full rounded-2xl bg-slate-50 ring-1 ring-slate-200/80 px-5 py-4 sm:px-6 sm:py-5 flex flex-col justify-between cursor-default ${className}`}
    >
      <p className="text-[15px] sm:text-base text-slate-700 leading-snug">{quote}</p>
      <div className="mt-3 sm:mt-4 flex items-end justify-between gap-3">
        <div>
          <div className="font-semibold text-slate-900 text-[15px] sm:text-base">{name}</div>
          <div className="text-xs sm:text-sm text-slate-600">{role}</div>
        </div>
        {rating && (
          <div className="text-right shrink-0">
            <motion.div className="flex gap-0.5 text-violet-600" whileHover={{ scale: 1.1 }} transition={CARD_SPRING}>
              {Array.from({ length: 5 }).map((_, i) => (
                <motion.span
                  key={i}
                  initial={{ scale: 1 }}
                  whileHover={{ scale: 1.2, rotate: 10 }}
                  transition={{ ...CARD_SPRING, delay: i * 0.03 }}
                >
                  <Star className="h-3.5 w-3.5 fill-violet-600 text-violet-600" />
                </motion.span>
              ))}
            </motion.div>
            <div className="text-[11px] sm:text-xs text-slate-600 mt-0.5">4.9 out of 5.0</div>
          </div>
        )}
      </div>
    </motion.div>
  );
}

function TestimonialImage({ src, alt, className = '' }: { src: string; alt: string; className?: string }) {
  return (
    <motion.div
      variants={item}
      whileHover={{ y: -6, scale: 1.01 }}
      transition={CARD_SPRING}
      className={`group h-full rounded-2xl overflow-hidden ring-1 ring-slate-200/80 bg-slate-100 ${className}`}
    >
      <motion.img
        src={src}
        alt={alt}
        loading="lazy"
        className="w-full h-full object-cover"
        whileHover={{ scale: 1.06 }}
        transition={CARD_SPRING}
      />
    </motion.div>
  );
}

/* -------------------------------------------------------------------------- */
/*                            WhatsApp Business API                            */
/* -------------------------------------------------------------------------- */

const API_USES = [
  'Customer support',
  'Lead management',
  'Automated follow-ups',
  'Notifications',
  'Campaigns',
  'Customer engagement',
  'Business workflows',
];

function BusinessApi() {
  return (
    <Section tone="tinted">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-16 items-center">
        <div>
          <SectionHead
            align="left"
            eyebrow="Build Scalable WhatsApp Business Workflows"
            title={['Connect WhatsApp With the', 'Way Your Business Works']}
            lead={(
              <p>
                ZunoPilot helps businesses bring WhatsApp communication into a structured
                environment for automation, customer engagement, and team collaboration.
              </p>
            )}
          />
          <div className="mt-8">
            <ArrowLink to="/features/whatsapp-business-api">Explore WhatsApp Business API</ArrowLink>
          </div>
        </div>

        <div className="rounded-3xl bg-white ring-1 ring-slate-200/80 p-6 sm:p-8">
          <p className="text-base font-semibold text-slate-900">Use WhatsApp for:</p>
          <CheckList items={API_USES} columns={1} className="mt-5" />
        </div>
      </div>
    </Section>
  );
}

/* -------------------------------------------------------------------------- */
/*                               Pricing teaser                                */
/* -------------------------------------------------------------------------- */

/*
 * **The pricing section was removed from this page.**
 *
 * It had a billing toggle, plan cards and trust indicators, all driven from the live catalogue —
 * and it is gone at the owner's request, not because it broke. `/pricing` is the single place
 * that quotes a price now, which is also the arrangement the original note here argued for: one
 * page holding the commercial facts, and no second copy to drift out of step with checkout.
 *
 * If it comes back, take it from git rather than rewriting it: `useCatalogue`, `formatRupees` and
 * `formatLimit` are still exported from `lib/pricing.ts`, and the rule that mattered was that
 * every figure came from the catalogue and the section showed *no* amount when the catalogue had
 * not resolved.
 */

/* -------------------------------------------------------------------------- */
/*                                    FAQ                                      */
/* -------------------------------------------------------------------------- */

const HOME_FAQS = [
  {
    question: 'What is ZunoPilot?',
    answer:
      'ZunoPilot is an AI-powered WhatsApp Business Automation Platform that helps businesses '
      + 'automate customer communication, manage shared WhatsApp conversations, and streamline '
      + 'team workflows.',
  },
  {
    question: 'What is WhatsApp Business Automation?',
    answer:
      'WhatsApp Business Automation uses software, workflows, and AI-powered capabilities to '
      + 'automate repetitive customer communication such as enquiries, follow-ups, '
      + 'notifications, reminders, and campaigns.',
  },
  {
    question: 'What can I automate with ZunoPilot?',
    answer:
      'You can automate lead follow-ups, customer enquiries, notifications, reminders, customer '
      + 'engagement, campaigns, and other recurring WhatsApp workflows.',
  },
  {
    question: 'How does AI help with WhatsApp automation?',
    answer:
      'AI can help businesses handle routine customer interactions, respond to common enquiries, '
      + 'support lead engagement, and streamline repetitive communication workflows.',
  },
  {
    question: 'What is WhatsApp Number Masking?',
    answer:
      'WhatsApp Number Masking provides a more controlled approach to business communication by '
      + 'helping reduce unnecessary exposure of business numbers within customer-facing workflows.',
  },
  {
    question: 'Can multiple employees manage WhatsApp conversations?',
    answer:
      'Yes. ZunoPilot provides a shared environment where authorized team members can manage and '
      + 'collaborate on customer conversations.',
  },
  {
    question: 'Can ZunoPilot be used for customer support?',
    answer:
      'Yes. Businesses can use automation for routine interactions while their support team '
      + 'manages conversations that require human assistance.',
  },
  {
    question: 'Can ZunoPilot be used for WhatsApp marketing?',
    answer:
      'Yes. Businesses can use WhatsApp campaigns and automated communication for promotions, '
      + 'announcements, updates, and customer engagement.',
  },
];
