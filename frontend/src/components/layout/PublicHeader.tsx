import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/stores/auth.store';
import { CTA_LABEL, PRIMARY_NAV, SIGNUP_LINK } from '@/lib/marketing-nav';

/**
 * The lightweight header for the legal pages and the 404.
 *
 * **Why this still exists next to `components/marketing/SiteHeader`.** SiteHeader is
 * sticky, opaque and carries a scroll-spy; it belongs on top of the marketing pages it
 * was built for. These two contexts want neither — the legal pages are a reading layout
 * and the 404 sits on a full-bleed background image that a white bar would cut in half.
 * So the shapes stay different on purpose.
 *
 * What they no longer duplicate is the *link list*. That comes from
 * `lib/marketing-nav.ts`, which is the whole reason the module exists: adding
 * `/solutions` to the site should not be an edit anyone can forget to make here.
 */

/** Same box as `SiteHeader`'s, so the two headers do not differ by four pixels. */
const HEADER_CTA =
  'rounded-full bg-violet-600 hover:bg-violet-700 px-5 h-10 min-w-[9.5rem] text-sm shadow-md shadow-violet-200';

export default function PublicHeader() {
  const token = useAuthStore((s) => s.token);

  return (
    <header className="bg-transparent">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 lg:h-20 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2">
          <img src="/app-logo.png" alt="ZunoPilot" className="h-9 w-auto" />
          <span className="text-xl font-bold tracking-tight text-slate-900">ZunoPilot</span>
        </Link>

        <nav className="hidden lg:flex items-center gap-8">
          {PRIMARY_NAV.map((entry) => (
            entry.anchor ? (
              <a
                key={entry.href}
                href={entry.href}
                className="text-[15px] font-medium text-slate-700 hover:text-slate-900 transition-colors"
              >
                {entry.label}
              </a>
            ) : (
              <Link
                key={entry.href}
                to={entry.href}
                className="text-[15px] font-medium text-slate-700 hover:text-slate-900 transition-colors"
              >
                {entry.label}
              </Link>
            )
          ))}
        </nav>

        <div className="flex items-center gap-3">
          {token ? (
            <Link to="/dashboard">
              <Button className={HEADER_CTA}>Go to Dashboard</Button>
            </Link>
          ) : (
            /* One control, not two — see the note in `marketing/SiteHeader.tsx`. */
            <>
              <Link to={SIGNUP_LINK}>
                <Button className={HEADER_CTA}>{CTA_LABEL}</Button>
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
