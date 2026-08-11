import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Menu as MenuIcon, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/stores/auth.store';
import { PRIMARY_NAV, SIGNUP_LINK } from '@/lib/marketing-nav';
import { EASE_OUT, SPRING } from './primitives';

/*
 * One header for every page of the website.
 *
 * **What this replaces.** Landing, Contact, Login, LegalLayout and NotFound each had
 * their own copy of this markup — five headers, one of which (`PublicHeader`) existed
 * only because the 404 page needed somewhere to put a nav. Adding `/features` and
 * `/solutions` to the site meant adding two links in five places, and the copy that
 * gets missed is always the one on the page nobody looks at.
 *
 * The scroll-spy that used to live in Landing.tsx comes with it, but it now only runs
 * on the home page: `#faq` is a real section there and a cross-page link everywhere
 * else, so observing for it off-home would find nothing and highlight nothing.
 */

/**
 * The id of whichever observed section is nearest the top of the viewport.
 *
 * Returns `''` when `ids` is empty, which is the off-home case — no link is ever
 * marked active, which is correct, because the active page is indicated by the route
 * match instead.
 */
function useActiveSection(ids: string[]): string {
  const [active, setActive] = useState<string>('');
  const key = ids.join('|');

  useEffect(() => {
    const els = ids
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => !!el);
    if (!els.length || typeof IntersectionObserver === 'undefined') return;

    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: '-30% 0px -60% 0px', threshold: 0 },
    );

    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [key]);

  return active;
}

export function Logo() {
  return (
    <Link to="/" className="flex items-center gap-2">
      <img src="/app-logo.png" alt="ZunoPilot" className="h-9 w-auto" />
      <span className="text-xl font-bold tracking-tight text-slate-900">ZunoPilot</span>
    </Link>
  );
}

export default function SiteHeader() {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  const token = useAuthStore((s) => s.token);
  const onHome = pathname === '/';

  // Only the home page has sections to spy on. Off-home the array is empty, the
  // observer never starts, and every link renders in its resting state.
  const anchorIds = onHome
    ? PRIMARY_NAV.filter((n) => n.anchor).map((n) => n.href.replace('/#', ''))
    : [];
  const activeId = useActiveSection(anchorIds);

  const isActive = (item: { href: string; anchor?: boolean }) => (
    item.anchor
      ? onHome && activeId === item.href.replace('/#', '')
      : item.href === '/'
        ? onHome
        : pathname === item.href || pathname.startsWith(`${item.href}/`)
  );

  const linkClass = (active: boolean) =>
    `px-3 text-[15px] font-medium transition-colors ${active ? 'text-violet-600' : 'text-slate-500 hover:text-slate-900'}`;

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
          {PRIMARY_NAV.map((entryItem, i) => (
            <div key={entryItem.href} className="flex items-center">
              {entryItem.anchor ? (
                <a href={entryItem.href} className={linkClass(isActive(entryItem))}>
                  {entryItem.label}
                </a>
              ) : (
                <Link to={entryItem.href} className={linkClass(isActive(entryItem))}>
                  {entryItem.label}
                </Link>
              )}
              {i < PRIMARY_NAV.length - 1 && (
                <span
                  aria-hidden
                  className="h-6 w-px"
                  style={{
                    backgroundImage: 'linear-gradient(to bottom, #cbd5e1 50%, transparent 50%)',
                    backgroundSize: '1px 4px',
                  }}
                />
              )}
            </div>
          ))}
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
              <Link to={SIGNUP_LINK}>
                <motion.div whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.97 }} transition={SPRING}>
                  <Button className="rounded-full bg-violet-600 hover:bg-violet-700 px-5 h-10 text-sm shadow-md shadow-violet-200">
                    Start Free
                  </Button>
                </motion.div>
              </Link>
            </>
          )}
        </div>

        <button
          aria-label="Menu"
          aria-expanded={open}
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
              {PRIMARY_NAV.map((entryItem) => {
                const cls = `block px-3 py-2 rounded-md hover:bg-slate-50 ${isActive(entryItem) ? 'text-violet-600 font-semibold' : 'text-slate-700'}`;
                return entryItem.anchor ? (
                  <a key={entryItem.href} href={entryItem.href} onClick={() => setOpen(false)} className={cls}>
                    {entryItem.label}
                  </a>
                ) : (
                  <Link key={entryItem.href} to={entryItem.href} onClick={() => setOpen(false)} className={cls}>
                    {entryItem.label}
                  </Link>
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
                    <Link to={SIGNUP_LINK} onClick={() => setOpen(false)}>
                      <Button className="w-full rounded-full bg-violet-600 hover:bg-violet-700">
                        Start Free
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
