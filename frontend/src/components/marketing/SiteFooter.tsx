import { Link } from 'react-router-dom';
import { ArrowUpRight, Facebook, Instagram, Linkedin } from 'lucide-react';
import { motion } from 'framer-motion';
import {
  FEATURE_LINKS, LEGAL_LINKS, PRIMARY_NAV, SOLUTION_LINKS, type NavItem,
} from '@/lib/marketing-nav';
import { EASE_OUT, SPRING, viewport } from './primitives';

/*
 * The website footer.
 *
 * Four link columns rather than the previous two, because the footer is now the only
 * place every feature and solution page is reachable from every other page. That is
 * not decoration: a page that is linked from exactly one hub is a page Google reaches
 * late and ranks accordingly, and the detail pages under /features are precisely the
 * ones the keyword research is aimed at.
 *
 * Columns are driven by `lib/marketing-nav.ts` so a new page appears here the moment
 * it appears in the nav table — see the note at the top of that file for why the URLs
 * are not written out in the markup.
 */

function FooterLink({ item }: { item: NavItem }) {
  return item.anchor ? (
    <a href={item.href} className="text-sm text-slate-700 hover:text-slate-900">{item.label}</a>
  ) : (
    <Link to={item.href} className="text-sm text-slate-700 hover:text-slate-900">{item.label}</Link>
  );
}

function Column({ title, items }: { title: string; items: readonly NavItem[] }) {
  return (
    <div>
      <h4 className="text-base font-semibold text-slate-900 mb-5">{title}</h4>
      <ul className="space-y-3">
        {items.map((it) => (
          <li key={`${title}-${it.href}`}><FooterLink item={it} /></li>
        ))}
      </ul>
    </div>
  );
}

export default function SiteFooter() {
  return (
    <motion.footer
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={viewport}
      transition={{ duration: 0.6, ease: EASE_OUT }}
      className="bg-white border-t border-slate-100"
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-12 pb-6">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-8 lg:gap-6 items-start">
          <div className="col-span-2 lg:col-span-2 flex flex-col">
            <Link to="/" className="flex items-center gap-2">
              <img src="/app-logo.png" alt="ZunoPilot" className="h-9 w-auto" />
              <span className="text-xl font-bold tracking-tight text-slate-900">ZunoPilot</span>
            </Link>
            <p className="mt-6 text-sm text-slate-600 max-w-xs leading-relaxed">
              AI-powered WhatsApp business automation. Automate customer conversations,
              manage them from one shared portal, and keep your team connected.
            </p>
          </div>

          <Column title="Features" items={FEATURE_LINKS} />
          <Column title="Solutions" items={SOLUTION_LINKS} />
          <Column title="Menus" items={PRIMARY_NAV} />

          <div>
            <h4 className="text-base font-semibold text-slate-900 mb-5">Company</h4>
            <ul className="space-y-3 text-sm text-slate-700">
              {LEGAL_LINKS.map((it) => (
                <li key={it.href}><FooterLink item={it} /></li>
              ))}
              {/*
                Contact details, kept as three separate affordances rather than one line of text.

                The WhatsApp link is a `wa.me` deep link on the same number as the phone line —
                on a phone it opens the app, on a desktop it opens WhatsApp Web, and either way
                the visitor lands in a conversation rather than copying digits out of a footer.
                For a product whose whole subject is WhatsApp, a footer that offers every channel
                *except* WhatsApp is a strange omission.

                `rel="noopener"` because it opens in a new tab, and the number is written without
                spaces in the `href` and with them in the label — one is machine-readable, the
                other is not meant to be.
              */}
              <li><a href="mailto:support@zunopilot.com" className="hover:text-slate-900 break-all">support@zunopilot.com</a></li>
              <li><a href="tel:+919014793487" className="hover:text-slate-900">+91 90147 93487</a></li>
              <li>
                <a
                  href="https://wa.me/919014793487"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 hover:text-slate-900"
                >
                  Chat on WhatsApp
                  <ArrowUpRight aria-hidden className="h-3.5 w-3.5" />
                </a>
              </li>
            </ul>
          </div>
        </div>

        <p className="mt-10 text-sm text-slate-600 leading-relaxed">
          #514, Manjeera Trinity Corporate, JNTU-Hitech City Road, Kukatpally,
          Hyderabad, Telangana 500072, India
        </p>

        <div className="mt-8 border-t border-slate-200" />

        <div className="relative mt-5 flex items-center justify-between gap-4 select-none">
          <div className="flex items-center gap-5 text-slate-900">
            <SocialIcon href="https://www.facebook.com/zunopilot/" label="Facebook">
              <Facebook className="h-[18px] w-[18px] fill-current" strokeWidth={0} />
            </SocialIcon>
            <SocialIcon href="https://www.instagram.com/zunopilot/" label="Instagram">
              <Instagram className="h-[18px] w-[18px]" strokeWidth={2} />
            </SocialIcon>
            <SocialIcon href="https://x.com/zunopilot" label="X">
              <XLogo className="h-[16px] w-[16px]" />
            </SocialIcon>
            <SocialIcon href="https://www.linkedin.com/company/zunopilot" label="LinkedIn">
              <Linkedin className="h-[18px] w-[18px] fill-current" strokeWidth={0} />
            </SocialIcon>
          </div>

          {/* Watermark — single dark logo (icon with Z baked in) + matching wordmark. */}
          <div className="flex items-center gap-3" style={{ color: '#4b4b52' }}>
            <img src="/dark-logo.png" alt="" className="h-12 sm:h-14 w-auto shrink-0 opacity-40" />
            <span
              className="text-2xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight opacity-40"
              style={{ color: '#4b4b52' }}
            >
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
