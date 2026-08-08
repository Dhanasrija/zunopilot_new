import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Menu as MenuIcon, X, Plus, Check, Star, ArrowRight,
  Facebook, Instagram, Linkedin,
} from 'lucide-react';
import {
  motion,
  AnimatePresence,
  useScroll,
  useTransform,
  useReducedMotion,
  type Variants,
} from 'framer-motion';
import { Button } from '@/components/ui/button';
import { useCountUp } from '@/hooks/useCountUp';
import { useAuthStore } from '@/stores/auth.store';
import { formatRupees, useCatalogue } from '@/lib/pricing';
import { DEMO_REQUEST_LINK } from '@/lib/enquiry';
import { useDocumentHead } from '@/lib/document-head';
import { PAGE_HEADS } from '@/lib/page-heads';

/* -------------------------------------------------------------------------- */
/*                          Shared animation variants                          */
/* -------------------------------------------------------------------------- */

const EASE_OUT = [0.22, 0.61, 0.36, 1] as const;
const SPRING = { type: 'spring' as const, stiffness: 220, damping: 28, mass: 0.6 };

// Container — staggers its children when it scrolls into view.
const stagger = (delayChildren = 0, staggerChildren = 0.08): Variants => ({
  hidden: {},
  show: { transition: { delayChildren, staggerChildren } },
});

// Generic item: fades up + slight scale, spring landing.
const item: Variants = {
  hidden: { opacity: 0, y: 28, scale: 0.96 },
  show: {
    opacity: 1, y: 0, scale: 1,
    transition: { type: 'spring', stiffness: 180, damping: 24, mass: 0.7 },
  },
};

// Card-specific spring used for hover/tap interactions across the page.
const CARD_SPRING = { type: 'spring' as const, stiffness: 280, damping: 22, mass: 0.7 };

const fadeUp: Variants = {
  hidden: { opacity: 0, y: 24 },
  show: { opacity: 1, y: 0, transition: { duration: 0.65, ease: EASE_OUT } },
};

const fadeIn: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: 0.6, ease: EASE_OUT } },
};

const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.92 },
  show: { opacity: 1, scale: 1, transition: { duration: 0.8, ease: EASE_OUT } },
};

// Standard viewport options for scroll-revealed sections.
const viewport = { once: true, margin: '-80px' };

/**
 * Scroll-spy hook — observes each section by id and returns the id of whichever
 * one is closest to the top of the viewport (under the sticky header). Used to
 * highlight the matching nav link in violet as the user scrolls.
 */
function useActiveSection(ids: string[]): string {
  const [active, setActive] = useState<string>(ids[0] ?? '');

  useEffect(() => {
    const els = ids
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => !!el);
    if (!els.length || typeof IntersectionObserver === 'undefined') return;

    // We trigger when a section crosses the top ~30% of the viewport.
    const io = new IntersectionObserver(
      (entries) => {
        // Pick the entry closest to the top that's currently intersecting.
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: '-30% 0px -60% 0px', threshold: 0 }
    );

    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [ids.join('|')]);

  return active;
}

/* -------------------------------------------------------------------------- */
/*                       Word-by-word animated heading                         */
/* -------------------------------------------------------------------------- */

const headingContainer: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.07, delayChildren: 0.05 } },
};

const headingWord: Variants = {
  hidden: { opacity: 0, y: 24, filter: 'blur(8px)' },
  show: {
    opacity: 1, y: 0, filter: 'blur(0px)',
    transition: { duration: 0.7, ease: EASE_OUT },
  },
};

type AnimatedHeadingProps = {
  text?: string;
  as?: 'h1' | 'h2' | 'h3';
  className?: string;
  /** Trigger on mount instead of on scroll-in. Used for the hero h1. */
  trigger?: 'inView' | 'mount';
  /** Optional manual line breaks (renders each `lines` entry as a separate block) */
  lines?: string[];
};

function AnimatedHeading({
  text = '',
  as = 'h2',
  className = '',
  trigger = 'inView',
  lines,
}: AnimatedHeadingProps) {
  const Tag = motion[as] as typeof motion.h2;
  const groupsRaw = lines ?? text.split('\n');
  const groups = groupsRaw.length ? groupsRaw : [text];

  const motionProps =
    trigger === 'mount'
      ? { initial: 'hidden', animate: 'show' }
      : { initial: 'hidden', whileInView: 'show', viewport };

  return (
    <Tag {...motionProps} variants={headingContainer} className={className}>
      {groups.map((line, lineIdx) => (
        <span key={lineIdx} className="block">
          {line.split(' ').map((word, i) => (
            <span key={`${lineIdx}-${i}`} className="inline-block overflow-hidden pb-1 -mb-1">
              <motion.span variants={headingWord} className="inline-block">
                {word}
                {i < line.split(' ').length - 1 && ' '}
              </motion.span>
            </span>
          ))}
        </span>
      ))}
    </Tag>
  );
}

/* -------------------------------------------------------------------------- */
/*                                    Page                                    */
/* -------------------------------------------------------------------------- */

const NAV = [
  { label: 'Home', href: '#home' },
  { label: 'Features', href: '#features' },
  { label: 'Pricing', href: '/pricing', route: true },
  { label: 'Testimonial', href: '#testimonial' },
  { label: 'FAQ', href: '#faq' },
  { label: 'Contact Us', href: '/contact', route: true },
];

export default function Landing() {
  useDocumentHead(PAGE_HEADS.landing);
  const [open, setOpen] = useState(false);

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <Header open={open} setOpen={setOpen} />
      <Hero />
      {/*
        The partner strip is hidden until there are real partners to name.
        It shipped with placeholder art — "LOGO", "IPSUM", "Logoips" — under the line
        "Endorsed by the globe's leading innovative enterprises", which is a claim about
        endorsements that do not exist, on the public home page.

        <Partners /> is left intact rather than deleted: restoring it is putting real files in
        PARTNER_LOGOS and uncommenting one line. Do not put it back with placeholders.
      */}
      {/* <Partners /> */}
      <Features />
      <Stats />
      <Testimonials />
      <PricingTeaser />
      <FAQ />
      <ContactCTA />
      <Footer />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                                   Header                                   */
/* -------------------------------------------------------------------------- */

function Header({ open, setOpen }: { open: boolean; setOpen: (v: boolean) => void }) {
  // Only scroll-spy anchor-based nav entries (route links never become "active" via scroll).
  const activeId = useActiveSection(
    NAV.filter((n) => !n.route).map((n) => n.href.replace('#', ''))
  );
  const token = useAuthStore((s) => s.token);

  const linkClass = (isActive: boolean) =>
    `px-4 text-[15px] font-medium transition-colors ${isActive ? 'text-violet-600' : 'text-slate-500 hover:text-slate-900'
    }`;

  return (
    <motion.header
      initial={{ y: -16, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.6, ease: EASE_OUT }}
      className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-slate-100"
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 lg:h-20 flex items-center justify-between">
        <Logo />

        <nav className="hidden lg:flex items-center">
          {NAV.map((item, i) => {
            const id = item.href.replace('#', '');
            const isActive = !item.route && activeId === id;
            return (
              <div key={item.href} className="flex items-center">
                {item.route ? (
                  <Link to={item.href} className={linkClass(false)}>
                    {item.label}
                  </Link>
                ) : (
                  <a href={item.href} className={linkClass(isActive)}>
                    {item.label}
                  </a>
                )}
                {i < NAV.length - 1 && (
                  <span
                    aria-hidden
                    className="h-6 w-px"
                    style={{
                      backgroundImage:
                        'linear-gradient(to bottom, #cbd5e1 50%, transparent 50%)',
                      backgroundSize: '1px 4px',
                    }}
                  />
                )}
              </div>
            );
          })}
        </nav>

        <div className="hidden lg:flex items-center gap-3">
          {token ? (
            <Link to="/dashboard">
              <motion.div whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.97 }} transition={SPRING}>
                <Button className="rounded-full bg-violet-600 hover:bg-violet-700 px-5 h-10 text-sm shadow-md shadow-violet-200">
                  Go to Dashboard
                </Button>
              </motion.div>
            </Link>
          ) : (
            <>
              <Link to="/login" className="text-[15px] font-medium text-slate-700 hover:text-slate-900 px-3">
                Sign in
              </Link>
              <Link to="/signup">
                <motion.div whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.97 }} transition={SPRING}>
                  <Button className="rounded-full bg-violet-600 hover:bg-violet-700 px-5 h-10 text-sm shadow-md shadow-violet-200">
                    Start Free Trial
                  </Button>
                </motion.div>
              </Link>
            </>
          )}
        </div>

        <button
          aria-label="Menu"
          onClick={() => setOpen(!open)}
          className="lg:hidden p-2 -mr-2 text-slate-700"
        >
          {open ? <X className="h-6 w-6" /> : <MenuIcon className="h-6 w-6" />}
        </button>
      </div>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: EASE_OUT }}
            className="lg:hidden border-t border-slate-100 bg-white overflow-hidden"
          >
            <nav className="px-4 py-4 space-y-1">
              {NAV.map((item) => {
                const id = item.href.replace('#', '');
                const isActive = !item.route && activeId === id;
                const cls = `block px-3 py-2 rounded-md hover:bg-slate-50 ${isActive ? 'text-violet-600 font-semibold' : 'text-slate-700'
                  }`;
                return item.route ? (
                  <Link
                    key={item.href}
                    to={item.href}
                    onClick={() => setOpen(false)}
                    className={cls}
                  >
                    {item.label}
                  </Link>
                ) : (
                  <a
                    key={item.href}
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className={cls}
                  >
                    {item.label}
                  </a>
                );
              })}
              <div className="pt-3 border-t border-slate-100 flex flex-col gap-2">
                {token ? (
                  <Link to="/dashboard" onClick={() => setOpen(false)}>
                    <Button className="w-full rounded-full bg-violet-600 hover:bg-violet-700">
                      Go to Dashboard
                    </Button>
                  </Link>
                ) : (
                  <>
                    <Link to="/login" onClick={() => setOpen(false)} className="px-3 py-2 text-slate-700">
                      Sign in
                    </Link>
                    <Link to="/signup" onClick={() => setOpen(false)}>
                      <Button className="w-full rounded-full bg-violet-600 hover:bg-violet-700">
                        Start Free Trial
                      </Button>
                    </Link>
                  </>
                )}
              </div>
            </nav>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.header>
  );
}

function Logo() {
  return (
    <Link to="/" className="flex items-center gap-2">
      <img src="/app-logo.png" alt="ZunoPilot" className="h-9 w-auto" />
      <span className="text-xl font-bold tracking-tight text-slate-900">ZunoPilot</span>
    </Link>
  );
}

/* -------------------------------------------------------------------------- */
/*                                    Hero                                    */
/* -------------------------------------------------------------------------- */

function Hero() {
  const reduceMotion = useReducedMotion();
  const sectionRef = useRef<HTMLElement>(null);

  // Scroll-linked parallax: background drifts up slightly, badges drift down.
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ['start start', 'end start'],
  });
  const bgY = useTransform(scrollYProgress, [0, 1], ['0%', '-12%']);
  const badgeY = useTransform(scrollYProgress, [0, 1], ['0%', '40%']);

  return (
    <section id="home" ref={sectionRef} className="relative overflow-hidden isolate">
      <motion.div
        aria-hidden
        style={reduceMotion ? undefined : { y: bgY }}
        className="absolute inset-0 bg-no-repeat bg-cover bg-center will-change-transform"
      // Slight scale so the parallax-up doesn't reveal background colour at the edge.
      // eslint-disable-next-line react/forbid-dom-props
      >
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
            lines={['Automate Your Customer', 'Interactions on WhatsApp']}
          />
          <motion.p
            variants={fadeUp}
            className="mt-5 sm:mt-6 text-base sm:text-lg text-slate-600 max-w-2xl mx-auto"
          >
            ZunoPilot helps retail, salon, and restaurant businesses connect WABA, manage customer
            chats in a unified shared inbox, and automate ordering and order updates.
          </motion.p>

          <motion.div
            variants={fadeUp}
            className="mt-8 flex flex-col sm:flex-row gap-3 sm:gap-4 justify-center items-center"
          >
            <Link to="/signup" className="w-full sm:w-auto">
              <motion.div whileHover={{ scale: 1.04, y: -2 }} whileTap={{ scale: 0.97 }} transition={SPRING}>
                <Button className="w-full sm:w-auto h-12 px-7 rounded-full bg-violet-600 hover:bg-violet-700 text-base font-semibold shadow-lg shadow-violet-300/60">
                  Get Started for Free
                </Button>
              </motion.div>
            </Link>
            {/* Was `href="#contact"`, which scrolled to the CTA band further down
                this page. That band's email box does not send anywhere (see the note
                on `ContactCTA`), so the demo path ended in a dead form. It now goes
                to the real enquiry form with "Demo Request" already chosen. */}
            <Link to={DEMO_REQUEST_LINK} className="w-full sm:w-auto">
              <motion.div whileHover={{ scale: 1.04, y: -2 }} whileTap={{ scale: 0.97 }} transition={SPRING}>
                <Button
                  variant="outline"
                  className="w-full sm:w-auto h-12 px-7 rounded-full border-2 border-violet-600 text-violet-600 hover:bg-violet-50 text-base font-semibold bg-transparent"
                >
                  Request a Demo
                </Button>
              </motion.div>
            </Link>
          </motion.div>
        </div>

        <motion.div
          variants={scaleIn}
          style={reduceMotion ? undefined : { y: badgeY }}
          className="relative mt-12 sm:mt-16 lg:mt-20 max-w-5xl mx-auto"
        >
          <FloatingBadge
            icon={<span className="text-base leading-none">🚀</span>}
            label="Grow Faster"
            className="hidden md:block left-0 top-12 lg:top-16 -translate-x-[85%]"
          />
          <FloatingBadge
            icon={<span className="text-base leading-none">⚡</span>}
            label="Automated Workflows"
            className="hidden md:block right-0 top-12 lg:top-16 translate-x-[85%]"
          />
          <FloatingBadge
            icon={
              <span className="grid place-items-center h-6 w-6 rounded-full bg-emerald-500 text-white">
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor" aria-hidden>
                  <path d="M20.52 3.48A11.93 11.93 0 0012.06 0C5.5 0 .14 5.36.14 11.93c0 2.1.55 4.14 1.6 5.95L0 24l6.27-1.64a11.92 11.92 0 005.79 1.47h.01c6.56 0 11.92-5.36 11.92-11.93 0-3.18-1.24-6.17-3.47-8.42zM12.07 21.8h-.01a9.9 9.9 0 01-5.04-1.38l-.36-.22-3.72.98 1-3.63-.24-.37a9.86 9.86 0 01-1.52-5.25c0-5.46 4.45-9.91 9.91-9.91 2.65 0 5.13 1.03 7 2.9a9.83 9.83 0 012.9 7c-.01 5.46-4.46 9.88-9.92 9.88zm5.43-7.42c-.3-.15-1.76-.87-2.04-.97-.27-.1-.47-.15-.67.15s-.77.97-.94 1.17c-.17.2-.35.22-.65.07-.3-.15-1.25-.46-2.39-1.47a9 9 0 01-1.66-2.07c-.17-.3-.02-.46.13-.6.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.07-.15-.67-1.62-.92-2.22-.24-.58-.49-.5-.67-.51l-.57-.01a1.1 1.1 0 00-.8.37c-.27.3-1.04 1.02-1.04 2.48s1.07 2.88 1.22 3.08c.15.2 2.1 3.2 5.08 4.49.71.3 1.26.49 1.7.63.71.23 1.36.2 1.87.12.57-.09 1.76-.72 2.01-1.41.25-.7.25-1.29.17-1.41-.07-.12-.27-.2-.57-.34z" />
                </svg>
              </span>
            }
            label="WhatsApp Business Platform"
            className="hidden md:block left-0 top-[60%] -translate-y-1/2 -translate-x-[85%]"
          />
          <FloatingBadge
            icon={<span className="text-base leading-none">✨</span>}
            label="AI-Powered Support"
            className="hidden md:block right-0 top-[60%] -translate-y-1/2 translate-x-[85%]"
          />

          <motion.div
            className="rounded-2xl overflow-hidden shadow-2xl shadow-violet-200/60 ring-1 ring-slate-200 bg-white"
            whileHover={{ y: -4 }}
            transition={SPRING}
          >
            <img src="/hero-1.svg" alt="ZunoPilot dashboard preview" className="w-full h-auto block" loading="eager" />
          </motion.div>
        </motion.div>
      </motion.div>
    </section>
  );
}

function FloatingBadge({
  icon, label, className,
}: {
  icon: React.ReactNode; label: string; className?: string;
}) {
  // Static pill — no entrance, no bobbing. Tailwind translate utilities own positioning.
  return (
    <div className={`absolute z-10 ${className || ''}`}>
      <div className="inline-flex items-center gap-2 bg-white/95 backdrop-blur-sm pl-2 pr-4 py-1.5 rounded-full shadow-md ring-1 ring-slate-200 text-sm font-medium text-slate-800 whitespace-nowrap">
        {icon}
        {label}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                              Partners marquee                              */
/* -------------------------------------------------------------------------- */

const PARTNER_LOGOS = [
  '/partner-logo1.png', '/partner-logo2.png',
  '/partner-logo3.png', '/partner-logo4.png',
];

function Partners() {
  const loop = [...PARTNER_LOGOS, ...PARTNER_LOGOS];
  return (
    <motion.section
      className="py-10 lg:py-14 bg-white"
      initial={{ opacity: 0 }}
      whileInView={{ opacity: 1 }}
      viewport={viewport}
      transition={{ duration: 0.6, ease: EASE_OUT }}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col lg:flex-row items-stretch gap-6 lg:gap-10">
          <div className="lg:w-1/4 flex items-center lg:border-r lg:pr-10 border-slate-200">
            <p className="text-sm text-slate-500 leading-relaxed">
              Endorsed by the globe's<br />leading innovative enterprises
            </p>
          </div>

          <div
            className="flex-1 overflow-hidden"
            style={{
              maskImage: 'linear-gradient(to right, transparent, black 8%, black 92%, transparent)',
              WebkitMaskImage: 'linear-gradient(to right, transparent, black 8%, black 92%, transparent)',
            }}
          >
            <div className="flex w-max animate-marquee gap-5 sm:gap-7">
              {loop.map((src, i) => (
                <motion.div
                  key={i}
                  whileHover={{ scale: 1.05, borderColor: 'hsl(var(--brand-light))' }}
                  transition={CARD_SPRING}
                  className="shrink-0 h-16 sm:h-20 w-56 sm:w-64 rounded-full border border-sky-200/80 bg-white flex items-center justify-center"
                >
                  <img src={src} alt="Partner" className="h-8 sm:h-10 w-auto object-contain opacity-80 hover:opacity-100 transition-opacity" loading="lazy" />
                </motion.div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </motion.section>
  );
}

/* -------------------------------------------------------------------------- */
/*                                  Features                                  */
/* -------------------------------------------------------------------------- */

function Features() {
  return (
    <section id="features" className="py-16 sm:py-20 lg:py-24 bg-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-3xl mx-auto">
          <AnimatedHeading
            className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight text-slate-900"
            lines={['Powerful tools to manage', 'your Business chat']}
          />
          <motion.p
            initial={{ opacity: 0, y: 18 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={viewport}
            transition={{ duration: 0.6, ease: EASE_OUT }}
            className="mt-4 text-base sm:text-lg text-slate-500"
          >
            ZunoPilot integrates everything you need to run order processing, customer
            support, and automatic trigger notification campaigns on WhatsApp.
          </motion.p>
        </div>

        <motion.div
          className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-5 lg:gap-6 md:auto-rows-auto"
          initial="hidden"
          whileInView="show"
          viewport={viewport}
          variants={stagger(0, 0.1)}
        >
          <FeatureCard
            title="Shared Live Inbox"
            description="Connect multiple agents to a single WhatsApp Number. Hand off conversations dynamically, review logs, and tag customers."
            image="/shared.png"
            className="md:col-span-1"
          />
          <FeatureCard
            title="Keyword Automation"
            description='Define priority keyword matching rules (e.g. "hours", "address") to instantly reply to common queries without manual intervention.'
            image="/keyword.png"
            className="md:col-span-1"
          />
          <FeatureCard
            title="Trigger Notifications"
            description="Automate customer notifications. Instantly fire WhatsApp utility templates on order creations, acceptances, and deliveries."
            image="/notifications.png"
            className="md:col-span-1 md:row-span-2"
            tall
          />
          <FeatureCard
            title="Order Management"
            description="Manage orders directly from WhatsApp, update statuses, share invoices, and keep customers informed throughout the journey."
            image="/order.png"
            className="md:col-span-2"
            wide
          />
        </motion.div>
      </div>
    </section>
  );
}

function FeatureCard({
  title, description, image, className, tall, wide,
}: {
  title: string; description: string; image: string;
  className?: string; tall?: boolean; wide?: boolean;
}) {
  const shellBase =
    'group relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-50 to-slate-100/60 ring-1 ring-slate-200/80 p-6 sm:p-7 cursor-default';

  const imageMotion = {
    initial: { scale: 1 },
    whileHover: { scale: 1.04 },
    transition: CARD_SPRING,
  };

  const Inner = (
    wide ? (
      <div className="flex flex-col md:flex-row md:items-center gap-6 md:gap-8 h-full">
        <div className="md:w-2/5">
          <h3 className="text-lg sm:text-xl font-bold text-slate-900">{title}</h3>
          <p className="mt-2 text-sm text-slate-500 leading-relaxed">{description}</p>
        </div>
        <motion.div className="md:w-3/5 overflow-hidden rounded-xl" {...imageMotion}>
          <img src={image} alt={title} className="w-full h-auto object-contain" loading="lazy" />
        </motion.div>
      </div>
    ) : (
      <>
        <h3 className="text-lg sm:text-xl font-bold text-slate-900">{title}</h3>
        <p className="mt-2 text-sm text-slate-500 leading-relaxed max-w-md">{description}</p>
        <motion.div className={`mt-5 overflow-hidden rounded-xl ${tall ? 'h-full' : ''}`} {...imageMotion}>
          <img src={image} alt={title} className="w-full h-auto object-contain" loading="lazy" />
        </motion.div>
      </>
    )
  );

  return (
    <motion.div
      variants={item}
      whileHover={{
        y: -8,
        boxShadow: '0 22px 50px -14px rgb(96 73 231 / 0.22)',
      }}
      whileTap={{ scale: 0.99 }}
      transition={CARD_SPRING}
      className={`${shellBase} ${className || ''}`}
    >
      {/* Soft violet glow that appears on hover */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-3xl opacity-0 group-hover:opacity-100 transition-opacity duration-500"
        style={{ boxShadow: 'inset 0 0 0 1px rgb(167 155 246 / 0.4)' }}
      />
      {Inner}
    </motion.div>
  );
}

/* -------------------------------------------------------------------------- */
/*                                   Stats                                    */
/* -------------------------------------------------------------------------- */

const STATS = [
  { numeric: 10, suffix: 'M+', label: 'Messages Sent', highlight: true },
  { numeric: 5000, suffix: '+', label: 'Businesses Connected', highlight: false },
  { numeric: 99.9, suffix: '%', label: 'Uptime SLA', highlight: true },
  { numeric: 0, suffix: '24/7', label: 'Premium Support', highlight: false, raw: '24/7' },
];

function Stats() {
  return (
    <section className="py-16 sm:py-20 lg:py-24 bg-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-2xl mx-auto">
          <AnimatedHeading
            className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight text-slate-900"
            lines={['Driving Business Growth on', 'WhatsApp']}
          />
          <motion.p
            initial={{ opacity: 0, y: 18 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={viewport}
            transition={{ duration: 0.6, ease: EASE_OUT }}
            className="mt-4 text-base sm:text-lg text-slate-500"
          >
            Empowering brands with seamless communication, intelligent automation, and dependable performance.
          </motion.p>
        </div>

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
      </div>
    </section>
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
      whileHover={{
        y: -6,
        scale: 1.015,
        boxShadow: '0 18px 36px -10px rgb(96 73 231 / 0.22)',
      }}
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
      <div className="text-sm sm:text-base text-slate-500">{label}</div>
    </motion.div>
  );
}

/* -------------------------------------------------------------------------- */
/*                                Testimonials                                */
/* -------------------------------------------------------------------------- */

function Testimonials() {
  return (
    <section id="testimonial" className="py-16 sm:py-20 lg:py-24 bg-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mx-auto">
          <AnimatedHeading
            text="Trusted by Fast-Growing Brands"
            className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight text-slate-900 sm:whitespace-nowrap"
          />
          <motion.p
            initial={{ opacity: 0, y: 18 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={viewport}
            transition={{ duration: 0.6, ease: EASE_OUT }}
            className="mt-4 text-base sm:text-lg text-slate-500 max-w-2xl mx-auto"
          >
            Helping businesses automate customer conversations, streamline operations, and scale engagement on WhatsApp.
          </motion.p>
        </div>

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
            quote='Running a multi-seat salon was messy with just one phone. The shared inbox lets our front desk and managers organize bookings seamlessly."'
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
            quote='Our response time dropped by 70% after switching to ZunoPilot." The shared inbox and automation features helped our support team handle customer queries much faster.'
            name="Priya Sharma," role="Customer Success Manager"
          />
        </motion.div>
      </div>
    </section>
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
      whileHover={{
        y: -6,
        scale: 1.01,
        boxShadow: '0 16px 40px -12px rgb(15 23 42 / 0.15)',
      }}
      whileTap={{ scale: 0.99 }}
      transition={CARD_SPRING}
      className={`group h-full rounded-2xl bg-slate-50 ring-1 ring-slate-200/80 px-5 py-4 sm:px-6 sm:py-5 flex flex-col justify-between cursor-default ${className}`}
    >
      <p className="text-[15px] sm:text-base text-slate-700 leading-snug">{quote}</p>
      <div className="mt-3 sm:mt-4 flex items-end justify-between gap-3">
        <div>
          <div className="font-semibold text-slate-900 text-[15px] sm:text-base">{name}</div>
          <div className="text-xs sm:text-sm text-slate-500">{role}</div>
        </div>
        {rating && (
          <div className="text-right shrink-0">
            <motion.div
              className="flex gap-0.5 text-violet-600"
              whileHover={{ scale: 1.1 }}
              transition={CARD_SPRING}
            >
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
            <div className="text-[11px] sm:text-xs text-slate-500 mt-0.5">4.9 out of 5.0</div>
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
/*                               Pricing teaser                                */
/* -------------------------------------------------------------------------- */

/**
 * A pointer to /pricing, not a second copy of it.
 *
 * The plans used to be listed here with their own hardcoded numbers — in US
 * dollars, while checkout charges rupees. Two places holding the same
 * commercial facts is how a visitor gets quoted one price and billed another,
 * so the only number on this page is read from the same catalogue the checkout
 * charges from, and everything else lives on the pricing page.
 */
function PricingTeaser() {
  const { data } = useCatalogue();

  // The cheapest self-serve entry point, whatever the catalogue currently says.
  const from = data?.plans
    .filter((plan) => plan.selfServe && plan.prices.MONTHLY)
    .map((plan) => plan.prices.MONTHLY!.amountPaise)
    .sort((a, b) => a - b)[0];

  return (
    <section id="pricing" className="py-16 sm:py-20 lg:py-24 bg-white">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
        <AnimatedHeading
          text="Simple, transparent Pricing"
          className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight text-slate-900"
        />
        <p className="mt-4 text-slate-600 max-w-2xl mx-auto">
          Every plan includes the assistant, the shared inbox and the workflow builder.
          Pay for the size of your team and how much AI you use.
        </p>

        {from !== undefined && (
          <p className="mt-8 text-slate-900">
            <span className="text-5xl font-extrabold tracking-tight">{formatRupees(from)}</span>
            {' '}
            <span className="text-slate-500">per month, billed monthly</span>
          </p>
        )}

        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link
            to="/pricing"
            className="inline-flex items-center gap-2 rounded-full bg-violet-600 px-7 py-3 text-white font-semibold hover:bg-violet-700 transition-colors"
          >
            See all plans <ArrowRight className="h-4 w-4" />
          </Link>
          <Link
            to="/signup"
            className="inline-flex items-center rounded-full border border-slate-300 px-7 py-3 font-semibold text-slate-700 hover:border-slate-400 transition-colors"
          >
            Start free trial
          </Link>
        </div>

        <p className="mt-6 text-xs text-slate-500">
          Quarterly and yearly billing work out cheaper. Prices exclude GST.
        </p>
      </div>
    </section>
  );
}


/* -------------------------------------------------------------------------- */
/*                                    FAQ                                     */
/* -------------------------------------------------------------------------- */

const FAQS = [
  { q: 'What is ZunoPilot?', a: 'ZunoPilot is a WhatsApp business automation platform that helps businesses manage customer conversations, automate responses, send notifications, and collaborate with teams from a single dashboard.' },
  { q: 'Can multiple team members manage the same WhatsApp number?', a: "Yes. ZunoPilot's Shared Live Inbox allows multiple agents to handle conversations from a single WhatsApp number, assign chats, add notes, and collaborate efficiently." },
  { q: 'How does Keyword Automation work?', a: 'Keyword Automation automatically responds to customer messages based on predefined keywords or phrases. This helps businesses provide instant answers to common queries without manual intervention.' },
  { q: 'Can I send automated WhatsApp notifications?', a: 'Absolutely. ZunoPilot enables businesses to send automated notifications for order updates, appointment reminders, payment confirmations, delivery status updates, and more.' },
  { q: 'Is ZunoPilot suitable for growing businesses?', a: "Yes. Whether you're a startup, SME, or enterprise, ZunoPilot is designed to scale with your business by providing reliable messaging, automation, and team collaboration tools." },
];

function FAQ() {
  const [openIdx, setOpenIdx] = useState<number | null>(0);

  return (
    <section id="faq" className="py-16 sm:py-20 lg:py-24 bg-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-2xl mx-auto">
          <AnimatedHeading
            text="Frequently Asked Questions"
            className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight text-slate-900"
          />
          <motion.p
            initial={{ opacity: 0, y: 18 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={viewport}
            transition={{ duration: 0.6, ease: EASE_OUT }}
            className="mt-4 text-base sm:text-lg text-slate-500"
          >
            Everything you need to know before getting started. Helping teams move forward with confidence.
          </motion.p>
        </div>

        <motion.div
          className="mt-10 max-w-3xl mx-auto space-y-3 sm:space-y-4"
          initial="hidden"
          whileInView="show"
          viewport={viewport}
          variants={stagger(0, 0.08)}
        >
          {FAQS.map((it, i) => {
            const isOpen = openIdx === i;
            return (
              <motion.div
                key={it.q}
                variants={item}
                whileHover={{ y: -2, backgroundColor: '#f1f5f9' }}
                transition={CARD_SPRING}
                className="rounded-2xl bg-slate-50 ring-1 ring-slate-200/80 overflow-hidden"
              >
                <button
                  type="button"
                  onClick={() => setOpenIdx(isOpen ? null : i)}
                  aria-expanded={isOpen}
                  className="w-full flex items-center gap-4 p-4 sm:p-5 text-left"
                >
                  <motion.span
                    animate={{ rotate: isOpen ? 45 : 0, backgroundColor: isOpen ? 'hsl(var(--brand-hover))' : 'hsl(var(--brand))' }}
                    transition={SPRING}
                    className="grid place-items-center h-8 w-8 rounded-md shrink-0"
                  >
                    <Plus className="h-4 w-4 text-white" strokeWidth={3} />
                  </motion.span>
                  <span className="font-semibold text-slate-900 text-sm sm:text-base">{it.q}</span>
                </button>
                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      key="content"
                      initial="collapsed"
                      animate="open"
                      exit="collapsed"
                      variants={{
                        open: { height: 'auto', opacity: 1 },
                        collapsed: { height: 0, opacity: 0 },
                      }}
                      transition={{ duration: 0.28, ease: EASE_OUT }}
                      className="overflow-hidden"
                    >
                      <div className="px-5 sm:px-6 pb-5 sm:pb-6 pl-[60px] sm:pl-[68px] text-sm text-slate-600 leading-relaxed -mt-1">
                        {it.a}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </motion.div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/*                                Contact CTA                                 */
/* -------------------------------------------------------------------------- */

function ContactCTA() {
  const [email, setEmail] = useState('');

  return (
    <section id="contact" className="py-12 sm:py-16">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, scale: 0.94, y: 30 }}
          whileInView={{ opacity: 1, scale: 1, y: 0 }}
          viewport={viewport}
          transition={{ duration: 0.7, ease: EASE_OUT }}
          className="relative overflow-hidden rounded-3xl px-6 sm:px-10 lg:px-16 py-12 sm:py-16 lg:py-20 ring-1 ring-slate-200 bg-no-repeat bg-cover bg-center"
          style={{ backgroundImage: "url('/contact-cta-background.png')" }}
        >
          <motion.div
            className="relative text-center max-w-2xl mx-auto"
            initial="hidden"
            whileInView="show"
            viewport={viewport}
            variants={stagger(0.1, 0.12)}
          >
            <AnimatedHeading
              className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight text-slate-900"
              lines={['Scale Your Business on', 'WhatsApp']}
            />
            <motion.p variants={fadeUp} className="mt-4 text-sm sm:text-base text-slate-600 max-w-md mx-auto">
              Connect with customers faster, automate repetitive tasks, and deliver exceptional support with ZunoPilot.
            </motion.p>

            <motion.form
              variants={fadeUp}
              onSubmit={(e) => {
                e.preventDefault();
                if (email) {
                  console.log('CTA email submission:', email);
                  setEmail('');
                }
              }}
              className="mt-7 mx-auto max-w-md flex flex-col sm:flex-row items-stretch sm:items-center gap-2 rounded-2xl sm:rounded-full bg-white p-2 sm:p-1.5 shadow-md shadow-violet-200/60 ring-1 ring-white/80"
            >
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Your email address"
                className="flex-1 bg-transparent px-4 py-2.5 sm:py-2 text-sm outline-none placeholder:text-slate-400"
              />
              <motion.div
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                transition={SPRING}
                className="w-full sm:w-auto"
              >
                <Button
                  type="submit"
                  className="w-full sm:w-auto rounded-xl sm:rounded-full bg-violet-600 hover:bg-violet-700 px-5 h-11 sm:h-10 text-sm font-semibold shrink-0"
                >
                  Send Request
                </Button>
              </motion.div>
            </motion.form>
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/*                                   Footer                                   */
/* -------------------------------------------------------------------------- */

const FOOTER_MENUS = [
  { label: 'Home', href: '#home' },
  { label: 'Features', href: '#features' },
  { label: 'Pricing', href: '/pricing', route: true },
  { label: 'Testimonial', href: '#testimonial' },
  { label: 'Contact Us', href: '#contact' },
];

const FOOTER_SECURITY = [
  { label: 'Privacy Policy', to: '/privacy' },
  { label: 'Terms & Condition', to: '/terms' },
  { label: "FAQ's", href: '#faq' },
];

function Footer() {
  return (
    <motion.footer
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={viewport}
      transition={{ duration: 0.6, ease: EASE_OUT }}
      className="bg-white"
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-12 pb-6">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-10 md:gap-8 items-start">
          <div className="md:col-span-4 lg:col-span-4 flex flex-col">
            <Link to="/" className="flex items-center gap-2">
              <img src="/app-logo.png" alt="ZunoPilot" className="h-9 w-auto" />
              <span className="text-xl font-bold tracking-tight text-slate-900">ZunoPilot</span>
            </Link>
            <p className="mt-16 text-sm text-slate-500 max-w-xs leading-relaxed">
              We help businesses connect, automate & grow through smarter WhatsApp
              conversations🚀
            </p>
          </div>

          <div className="md:col-span-3 lg:col-span-2">
            <h4 className="text-base font-semibold text-slate-900 mb-5">Menus</h4>
            <ul className="space-y-4">
              {FOOTER_MENUS.map((m) => (
                <li key={m.label}>
                  {'route' in m && m.route ? (
                    <Link to={m.href} className="text-sm text-slate-700 hover:text-slate-900">{m.label}</Link>
                  ) : (
                    <a href={m.href} className="text-sm text-slate-700 hover:text-slate-900">{m.label}</a>
                  )}
                </li>
              ))}
            </ul>
          </div>

          <div className="md:col-span-2 lg:col-span-2">
            <h4 className="text-base font-semibold text-slate-900 mb-5">Security</h4>
            <ul className="space-y-4">
              {FOOTER_SECURITY.map((it) =>
                'to' in it ? (
                  <li key={it.label}>
                    <Link to={it.to!} className="text-sm text-slate-700 hover:text-slate-900">{it.label}</Link>
                  </li>
                ) : (
                  <li key={it.label}>
                    <a href={it.href} className="text-sm text-slate-700 hover:text-slate-900">{it.label}</a>
                  </li>
                )
              )}
            </ul>
          </div>

          <div className="md:col-span-3 lg:col-span-4">
            <h4 className="text-base font-semibold text-slate-900 mb-5">Contact</h4>
            <ul className="space-y-4 text-sm text-slate-700">
              <li><a href="mailto:support@zunopilot.com" className="hover:text-slate-900">support@zunopilot.com</a></li>
              <li><a href="tel:+919390683154" className="hover:text-slate-900">+91 939-068-3154</a></li>
              <li className="leading-relaxed">
                #514, Manjeera Trinity Corporate<br />
                JNTU-Hitech City Road, Kukatpally<br />
                Hyderabad, Telangana 500072, India
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-12 border-t border-slate-200" />

        <div className="relative mt-5 flex items-center justify-between gap-4 select-none">
          <div className="flex items-center gap-5 text-slate-900">
            <SocialIcon href="https://www.facebook.com/zunopilot/" label="Facebook"><Facebook className="h-[18px] w-[18px] fill-current" strokeWidth={0} /></SocialIcon>
            <SocialIcon href="https://www.instagram.com/zunopilot/" label="Instagram"><Instagram className="h-[18px] w-[18px]" strokeWidth={2} /></SocialIcon>
            <SocialIcon href="https://x.com/zunopilot" label="X"><XLogo className="h-[16px] w-[16px]" /></SocialIcon>
            <SocialIcon href="https://www.linkedin.com/company/zunopilot" label="LinkedIn"><Linkedin className="h-[18px] w-[18px] fill-current" strokeWidth={0} /></SocialIcon>
          </div>

          {/* Watermark — single dark logo (icon with Z baked in) + matching wordmark. */}
          <div className="flex items-center gap-3" style={{ color: '#4b4b52' }}>
            <img
              src="/dark-logo.png"
              alt=""
              className="h-12 sm:h-14 w-auto shrink-0 opacity-40"
            />
            <span className="text-2xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight opacity-40" style={{ color: '#4b4b52' }}>
              ZunoPilot
            </span>
          </div>
        </div>
      </div>
    </motion.footer>
  );
}

function SocialIcon({
  href, label, children,
}: { href: string; label: string; children: React.ReactNode }) {
  return (
    <motion.a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      whileHover={{ y: -3, color: 'hsl(var(--brand))' }}
      transition={SPRING}
      className="text-slate-900"
    >
      {children}
    </motion.a>
  );
}

function XLogo({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}
