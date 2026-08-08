import PublicHeader from '@/components/layout/PublicHeader';

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

  return (
    <div
      className="min-h-screen bg-no-repeat bg-cover bg-center flex flex-col"
      style={{ backgroundImage: "url('/login-bg.png')" }}
    >
      <PublicHeader />

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
