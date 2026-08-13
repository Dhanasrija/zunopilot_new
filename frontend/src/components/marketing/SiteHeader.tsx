import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ChevronDown, Menu as MenuIcon, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/stores/auth.store';
import { CTA_LABEL, PRIMARY_NAV, SIGNUP_LINK, type NavItem } from '@/lib/marketing-nav';
import { EASE_OUT, SPRING } from './primitives';

/*
 * One header for every page of the website.
 *
 * **What this replaces.** Landing, Contact, Login, LegalLayout and NotFound each had
 * their own copy of this markup — five headers, one of which existed only because the
 * 404 page needed somewhere to put a nav. Adding `/features` and `/solutions` to the
 * site meant adding two links in five places, and the copy that gets missed is always
 * the one on the page nobody looks at.
 *
 * The scroll-spy that used to live in Landing.tsx comes with it, but it now only runs
 * on the home page: `#faq` is a real section there and a cross-page link everywhere
 * else, so observing for it off-home would find nothing and highlight nothing.
 *
 * **The dropdown.** Any `PRIMARY_NAV` entry with `children` gets one — today that is
 * Features, listing the seven feature pages. The parent stays a real link to the hub;
 * the menu is in addition to it, not instead of it, which matters because "Features"
 * itself is a page people want. See `Dropdown` for the interaction details.
 */

/**
 * The id of whichever observed section is nearest the top of the viewport.
 *
 * Returns `''` when `ids` is empty, which is the off-home case — no link is ever marked
 * active by scroll, which is correct, because the active page is indicated by the route
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

/**
 * The header's own CTA box.
 *
 * Narrower and shorter than the in-page `CtaPair` — a nav bar is not a hero — but a
 * fixed `min-w` for the same reason: "Get Started" and "Go to Dashboard" swap places
 * depending on whether someone is signed in, and without a floor the header visibly
 * resizes at the moment the auth state resolves.
 */
const HEADER_CTA =
  'rounded-full bg-violet-600 hover:bg-violet-700 px-5 h-10 min-w-[9.5rem] text-sm shadow-md shadow-violet-200';

export function Logo() {
  return (
    <Link to="/" className="flex items-center gap-2">
      <img src="/app-logo.png" alt="ZunoPilot" className="h-9 w-auto" />
      <span className="text-xl font-bold tracking-tight text-slate-900">ZunoPilot</span>
    </Link>
  );
}

/* -------------------------------------------------------------------------- */
/*                                  Dropdown                                   */
/* -------------------------------------------------------------------------- */

/**
 * A nav entry that is both a link and a menu.
 *
 * **Why it is not just a hover menu.** Hover alone excludes keyboard and touch, and a
 * parent that only opens a menu makes the hub page unreachable from the nav. So there
 * are two controls: the label is a `<Link>` to the hub, and a separate chevron button
 * toggles the panel with `aria-expanded`. Hover opens it for pointer users, focus keeps
 * it open for keyboard users, Escape and an outside click close it.
 *
 * **The gap problem.** A panel positioned below the trigger with any vertical gap
 * closes the moment the pointer crosses the gap. The panel's wrapper therefore carries
 * the offset as `pt-3` *inside* the hover target rather than as a `top` offset outside
 * it, so the pointer never leaves the element that is keeping it open.
 */
function Dropdown({
  entry, isActive, linkClass,
}: {
  entry: NavItem;
  isActive: (item: NavItem) => boolean;
  linkClass: (active: boolean) => string;
}) {
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const { pathname } = useLocation();

  // A navigation should not leave the menu hanging open over the new page.
  useEffect(() => { setOpen(false); }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const onDown = (e: MouseEvent) => {
      if (!wrapper.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [open]);

  return (
    <div
      ref={wrapper}
      className="relative flex items-center"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      // Keyboard: tabbing into the label or any menu item keeps the panel open, and
      // tabbing past the last item closes it. `onBlur` fires before the next `focus`,
      // so the check is against the element focus is moving *to*.
      onFocus={() => setOpen(true)}
      onBlur={(e) => {
        if (!wrapper.current?.contains(e.relatedTarget as Node)) setOpen(false);
      }}
    >
      <Link to={entry.href} className={`${linkClass(isActive(entry))} pr-1`}>
        {entry.label}
      </Link>
      <button
        type="button"
        aria-label={`${entry.label} menu`}
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((v) => !v)}
        className="p-1 -ml-1 text-slate-400 hover:text-slate-700 transition-colors"
      >
        <motion.span
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ duration: 0.2, ease: EASE_OUT }}
          className="block"
        >
          <ChevronDown className="h-4 w-4" />
        </motion.span>
      </button>

      <AnimatePresence>
        {open && entry.children && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18, ease: EASE_OUT }}
            // `pt-3` is the visual gap, inside the hover target. See the note above.
            className="absolute left-1/2 top-full z-50 -translate-x-1/2 pt-3"
          >
            <ul className="w-[22rem] overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200 shadow-xl shadow-slate-900/10 p-2">
              {entry.children.map((child) => (
                <li key={child.href}>
                  <Link
                    to={child.href}
                    onClick={() => setOpen(false)}
                    className={`block rounded-xl px-3 py-2.5 transition-colors ${
                      isActive(child) ? 'bg-violet-50' : 'hover:bg-slate-50'
                    }`}
                  >
                    <span className={`block text-sm font-semibold ${isActive(child) ? 'text-violet-600' : 'text-slate-900'}`}>
                      {child.label}
                    </span>
                    {child.blurb && (
                      <span className="mt-0.5 block text-xs text-slate-500 leading-relaxed">
                        {child.blurb}
                      </span>
                    )}
                  </Link>
                </li>
              ))}

              <li className="mt-1 border-t border-slate-100 pt-1">
                <Link
                  to={entry.href}
                  onClick={() => setOpen(false)}
                  className="block rounded-xl px-3 py-2.5 text-sm font-semibold text-violet-600 hover:bg-violet-50 transition-colors"
                >
                  See all {entry.label.toLowerCase()} &rarr;
                </Link>
              </li>
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                                   Header                                    */
/* -------------------------------------------------------------------------- */

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

  const isActive = (item: NavItem) => (
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
          {PRIMARY_NAV.map((entry, i) => (
            <div key={entry.href} className="flex items-center">
              {entry.children ? (
                <Dropdown entry={entry} isActive={isActive} linkClass={linkClass} />
              ) : entry.anchor ? (
                <a href={entry.href} className={linkClass(isActive(entry))}>{entry.label}</a>
              ) : (
                <Link to={entry.href} className={linkClass(isActive(entry))}>{entry.label}</Link>
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
                <Button className={HEADER_CTA}>Go to Dashboard</Button>
              </motion.div>
            </Link>
          ) : (
            <>
              <Link to="/login" className="text-[15px] font-medium text-slate-700 hover:text-slate-900 px-3">
                Sign in
              </Link>
              <Link to={SIGNUP_LINK}>
                <motion.div whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.97 }} transition={SPRING}>
                  <Button className={HEADER_CTA}>{CTA_LABEL}</Button>
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
            className="lg:hidden border-t border-slate-100 bg-white overflow-hidden max-h-[calc(100vh-4rem)] overflow-y-auto"
          >
            <nav className="px-4 py-4 space-y-1">
              {PRIMARY_NAV.map((entry) => {
                const cls = `block px-3 py-2 rounded-md hover:bg-slate-50 ${isActive(entry) ? 'text-violet-600 font-semibold' : 'text-slate-700'}`;
                return (
                  <div key={entry.href}>
                    {entry.anchor ? (
                      <a href={entry.href} onClick={() => setOpen(false)} className={cls}>{entry.label}</a>
                    ) : (
                      <Link to={entry.href} onClick={() => setOpen(false)} className={cls}>{entry.label}</Link>
                    )}

                    {/*
                      On touch there is no hover, and a drawer has room to spare — so the
                      children are simply listed underneath rather than hidden behind a
                      second tap. Indented and hairline-ruled so the hierarchy is still
                      obvious.
                    */}
                    {entry.children && (
                      <ul className="mt-1 mb-2 ml-3 border-l border-slate-100 pl-3 space-y-0.5">
                        {entry.children.map((child) => (
                          <li key={child.href}>
                            <Link
                              to={child.href}
                              onClick={() => setOpen(false)}
                              className={`block px-3 py-2 rounded-md text-sm hover:bg-slate-50 ${
                                isActive(child) ? 'text-violet-600 font-semibold' : 'text-slate-600'
                              }`}
                            >
                              {child.label}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}

              <div className="pt-3 border-t border-slate-100 flex flex-col gap-2">
                {token ? (
                  <Link to="/dashboard" onClick={() => setOpen(false)}>
                    <Button className="w-full rounded-full bg-violet-600 hover:bg-violet-700 h-11">
                      Go to Dashboard
                    </Button>
                  </Link>
                ) : (
                  <>
                    <Link to="/login" onClick={() => setOpen(false)} className="px-3 py-2 text-slate-700">
                      Sign in
                    </Link>
                    <Link to={SIGNUP_LINK} onClick={() => setOpen(false)}>
                      <Button className="w-full rounded-full bg-violet-600 hover:bg-violet-700 h-11">
                        {CTA_LABEL}
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
