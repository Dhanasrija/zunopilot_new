import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/stores/auth.store';

const NAV = [
  { label: 'Home', href: '/#home' },
  { label: 'Features', href: '/#features' },
  { label: 'Pricing', href: '/#pricing' },
  { label: 'Testimonial', href: '/#testimonial' },
  { label: 'Contact Us', href: '/contact' },
];

type LegalLayoutProps = {
  title: string;
  highlight: string;        // word(s) inside the title to render in violet
  intro: string;
  lastUpdated: string;
  children: React.ReactNode;
};

/**
 * Shared shell for Privacy / Terms — same visual language as the Contact page:
 * sky background, transparent header, white card with content.
 */
export default function LegalLayout({
  title, highlight, intro, lastUpdated, children,
}: LegalLayoutProps) {
  // Split the title around the highlight word(s) to recolour them.
  const [pre, post] = title.split(highlight);
  const token = useAuthStore((s) => s.token);

  return (
    <div
      className="min-h-screen bg-no-repeat bg-cover bg-center flex flex-col"
      style={{ backgroundImage: "url('/login-bg.png')" }}
    >
      {/* Header */}
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

      {/* Hero copy */}
      <section className="px-4 sm:px-6 lg:px-8 pt-6 pb-4">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-slate-900">
            {pre}
            <span className="text-violet-600">{highlight}</span>
            {post}
          </h1>
          <p className="mt-4 text-base sm:text-lg text-slate-600 max-w-2xl mx-auto">{intro}</p>
          <p className="mt-2 text-xs text-slate-500">Last updated: {lastUpdated}</p>
        </div>
      </section>

      {/* Content card */}
      <main className="flex-1 px-4 sm:px-6 lg:px-8 pb-12">
        <div className="max-w-4xl mx-auto">
          <article className="rounded-3xl bg-white/95 backdrop-blur shadow-xl shadow-violet-200/40 ring-1 ring-slate-200 p-6 sm:p-10 prose prose-slate max-w-none">
            {children}
          </article>
        </div>
      </main>
    </div>
  );
}
