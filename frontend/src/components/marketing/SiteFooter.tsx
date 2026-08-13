import { Link } from 'react-router-dom';
import { Facebook, Instagram, Linkedin } from 'lucide-react';
import { motion } from 'framer-motion';
import {
  FEATURE_LINKS, LEGAL_LINKS, PRIMARY_NAV, SOLUTION_LINKS, type NavItem,
} from '@/lib/marketing-nav';
import {
  OFFICE_ADDRESS, SUPPORT_EMAIL, SUPPORT_PHONE_DISPLAY, SUPPORT_PHONE_E164, WHATSAPP_LINK,
} from '@/lib/contact';
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
              <li>
                <a href={`mailto:${SUPPORT_EMAIL}`} className="hover:text-slate-900 break-all">
                  {SUPPORT_EMAIL}
                </a>
              </li>
              <li>
                <a href={`tel:${SUPPORT_PHONE_E164}`} className="hover:text-slate-900">
                  {SUPPORT_PHONE_DISPLAY}
                </a>
              </li>
              {/*
                WhatsApp as its own row rather than a second use of the phone number.

                `tel:` and `wa.me` are different intents — one dials, one opens a chat — and on
                a site whose entire premise is WhatsApp, "message us on WhatsApp" is the one
                most visitors actually want. Labelled with the icon so it is not mistaken for a
                duplicate of the line above it.
              */}
              <li>
                <a
                  href={WHATSAPP_LINK}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 hover:text-slate-900"
                >
                  <WhatsAppLogo className="h-4 w-4 shrink-0 text-[#25D366]" />
                  Chat on WhatsApp
                </a>
              </li>
            </ul>
          </div>
        </div>

        <address className="mt-10 text-sm text-slate-600 leading-relaxed not-italic">
          {OFFICE_ADDRESS}
        </address>

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

/**
 * The WhatsApp glyph.
 *
 * Inline rather than from lucide-react, which has no WhatsApp icon — its brand icons were
 * removed upstream. One path is cheaper than a second icon dependency.
 */
function WhatsAppLogo({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2m0 1.67c2.2 0 4.27.86 5.83 2.42a8.2 8.2 0 0 1 2.41 5.82c0 4.54-3.7 8.24-8.25 8.24a8.24 8.24 0 0 1-4.2-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.19 8.19 0 0 1-1.26-4.38c0-4.54 3.7-8.24 8.26-8.24m-3.6 4.1c-.17 0-.44.06-.67.31s-.88.86-.88 2.1.9 2.43 1.03 2.6c.13.16 1.76 2.68 4.27 3.76.6.26 1.06.41 1.42.53.6.19 1.14.16 1.57.1.48-.07 1.48-.6 1.68-1.19.21-.58.21-1.08.15-1.19-.06-.1-.23-.16-.48-.29s-1.48-.73-1.71-.81c-.23-.09-.4-.13-.56.12s-.64.81-.79.98c-.14.16-.29.19-.54.06s-1.05-.39-2-1.23a7.5 7.5 0 0 1-1.38-1.72c-.15-.25-.02-.38.11-.51.11-.11.25-.29.37-.44s.17-.25.25-.41c.08-.17.04-.31-.02-.44s-.56-1.35-.77-1.85c-.2-.48-.4-.42-.55-.42z" />
    </svg>
  );
}

function XLogo({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}
