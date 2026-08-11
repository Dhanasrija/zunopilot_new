import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/*
 * Where the window goes after a route change.
 *
 * **What was broken.** This unconditionally called `window.scrollTo(0, 0)` on every
 * pathname change, which is right for a normal navigation and wrong for a hash one. A
 * link to `/#testimonial` from any page other than the home page changes the pathname,
 * so this fired — and it fired *after* the browser's own jump to the fragment, landing
 * the visitor at the top of the home page instead of at the section they asked for.
 * Every cross-page anchor in the header and footer (`/#faq`, `/#testimonial`,
 * `/#pricing`) was silently a link to the home page.
 *
 * It also could not work the other way: a hash link followed while *already* on the
 * home page does not change the pathname at all, so the effect never ran and React
 * Router does not scroll for you. Fragment navigation was broken in both directions.
 *
 * **What it does now.** With a hash, find the element and scroll it into view, allowing
 * for the sticky header. Without one, top of the page as before. `hash` joins the
 * dependency list so same-page fragment changes are handled too.
 */

/** Matches the sticky header: 64px below `lg`, 80px at and above it. */
const headerOffset = () => (window.innerWidth >= 1024 ? 80 : 64);

export default function ScrollToTop() {
  const { pathname, hash } = useLocation();

  useEffect(() => {
    if (!hash) {
      window.scrollTo(0, 0);
      return;
    }

    /*
     * One frame's grace before looking for the target.
     *
     * The effect runs on commit, but a page whose sections are lazy — or simply long —
     * may not have laid out yet, and `getBoundingClientRect` on a fresh node returns a
     * position that is about to change. A single rAF is enough in practice and costs
     * nothing when the element is already there.
     */
    const raf = requestAnimationFrame(() => {
      const target = document.getElementById(decodeURIComponent(hash.slice(1)));
      if (!target) {
        // A fragment that matches nothing should not silently leave the visitor
        // wherever the previous page was scrolled to.
        window.scrollTo(0, 0);
        return;
      }
      const top = target.getBoundingClientRect().top + window.scrollY - headerOffset();
      window.scrollTo({ top, behavior: 'smooth' });
    });

    return () => cancelAnimationFrame(raf);
  }, [pathname, hash]);

  return null;
}
