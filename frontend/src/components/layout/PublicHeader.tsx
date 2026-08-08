import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/stores/auth.store';

/**
 * The website's header: logo, section nav, and the right-hand call to action.
 *
 * Lifted out of `LegalLayout` when the 404 page needed the same thing. It was going to be a
 * fourth hand-written copy of this markup — Landing, Contact and Login each still have their
 * own — and a fourth copy is how a nav link gets added in three places out of four.
 *
 * Those three are not converted here. Landing's header animates on scroll and Login's is a
 * different shape, so folding them in is a real change with its own risk, and this one is
 * about giving a missing page somewhere to go. Named so it is not mistaken for finished.
 *
 * The signed-in branch matters more on an error page than on a legal one: somebody who mistypes
 * a URL inside the app needs a way back to it, and the nav below only points at the website.
 */

const NAV = [
  { label: 'Home', href: '/#home' },
  { label: 'Features', href: '/#features' },
  { label: 'Pricing', href: '/#pricing' },
  { label: 'Testimonial', href: '/#testimonial' },
  { label: 'Contact Us', href: '/contact' },
];

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
          {NAV.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="text-[15px] font-medium text-slate-700 hover:text-slate-900 transition-colors"
            >
              {item.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          {token ? (
            <Link to="/dashboard">
              <Button className="rounded-full bg-violet-600 hover:bg-violet-700 px-5 h-10 text-sm shadow-md shadow-violet-200">
                Go to Dashboard
              </Button>
            </Link>
          ) : (
            <>
              <Link to="/login" className="hidden sm:inline-block text-[15px] font-medium text-slate-700 hover:text-slate-900 px-3">
                Sign in
              </Link>
              <Link to="/signup">
                <Button className="rounded-full bg-violet-600 hover:bg-violet-700 px-4 sm:px-5 h-10 text-sm shadow-md shadow-violet-200">
                  Start Free Trial
                </Button>
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
