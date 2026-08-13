import { Link, useLocation } from 'react-router-dom';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { motion } from 'framer-motion';
import { useDocumentHead } from '@/lib/document-head';
import SiteHeader from '@/components/marketing/SiteHeader';
import SiteFooter from '@/components/marketing/SiteFooter';
import { CtaPair, EASE_OUT } from '@/components/marketing/primitives';

/*
 * The placeholder for a page that is planned, linked, and not written yet.
 *
 * **Why these routes exist at all.** The Solutions dropdown lists six children and the
 * solutions hub links to the same six. The alternative to a page like this is six links
 * that 404, on the page the site's internal-linking structure is built around — worse
 * for a visitor than "we're writing this", and much worse for Google, because a hub
 * whose outbound links are broken is a hub Google stops trusting.
 *
 * **Every feature page is real.** All six under `/features` have full copy and are in
 * the sitemap; only the solutions tree is placeheld. If that changes, the list below is
 * the only place to edit.
 *
 * **Every one of them is `noindex`.** A thin page that says "coming soon" competing in
 * search results for "whatsapp number masking" is a worse outcome than not appearing:
 * it burns the click and teaches the ranking system that the site's pages do not answer
 * the query. `follow` is kept, so the links out of here still pass. The pages are also
 * absent from `sitemap.xml` — a sitemap is a list of pages you are *asking* to be
 * indexed, and `document-head.test.ts` enforces that the sitemap and `PAGE_HEADS` are
 * exactly the same set, so adding one here without writing real copy would fail the
 * build. That is the intended pressure.
 *
 * When a page gets written: delete its entry from `COMING_SOON`, add a real head to
 * `PAGE_HEADS`, add the `<loc>` to the sitemap, and point the route at the new
 * component. The test will tell you if you miss a step.
 */

export interface ComingSoonPage {
  /** Route path. Must match the href used in `lib/marketing-nav.ts`. */
  path: string;
  /** The `<h1>`. The page's eventual title, so the link that got here is honest. */
  title: string;
  /** One or two sentences on what the page will cover. */
  blurb: string;
  /** Where "back" goes — the hub this page hangs under. */
  parent: { label: string; href: string };
  /** A couple of pages that *are* written and cover adjacent ground. */
  related: readonly { label: string; href: string }[];
}

const SOLUTIONS_HUB = { label: 'All solutions', href: '/solutions' };

/**
 * Written feature pages to send someone to instead.
 *
 * Three rather than the whole list: the point is one obvious next click, not a second
 * navigation menu. These three are the ones a visitor who wanted a *solution* page is
 * most likely to find useful — the capability behind it.
 */
const WRITTEN_FEATURES = [
  { label: 'WhatsApp Automation', href: '/features/whatsapp-automation' },
  { label: 'AI WhatsApp Automation', href: '/features/ai-whatsapp-automation' },
  { label: 'All features', href: '/features' },
];

export const COMING_SOON: readonly ComingSoonPage[] = [
  {
    path: '/solutions/lead-management',
    title: 'WhatsApp Lead Management',
    blurb:
      'Capturing enquiries, engaging prospects and running consistent follow-up workflows on '
      + 'WhatsApp. The full page is being written.',
    parent: SOLUTIONS_HUB,
    related: WRITTEN_FEATURES,
  },
  {
    path: '/solutions/sales-automation',
    title: 'WhatsApp Sales Automation',
    blurb:
      'Structuring the repeatable parts of the sales conversation so representatives spend their '
      + 'time on qualified opportunities. The full page is being written.',
    parent: SOLUTIONS_HUB,
    related: WRITTEN_FEATURES,
  },
  {
    path: '/solutions/customer-support',
    title: 'WhatsApp Customer Support',
    blurb:
      'Giving customers a more connected support experience, with routine interactions handled '
      + 'by workflows and agents free for the rest. The full page is being written.',
    parent: SOLUTIONS_HUB,
    related: WRITTEN_FEATURES,
  },
  {
    path: '/solutions/marketing-automation',
    title: 'WhatsApp Marketing Automation',
    blurb:
      'Making WhatsApp part of your customer engagement strategy through structured campaign and '
      + 'communication workflows. The full page is being written.',
    parent: SOLUTIONS_HUB,
    related: WRITTEN_FEATURES,
  },
  {
    path: '/solutions/customer-engagement',
    title: 'WhatsApp Customer Engagement',
    blurb:
      'Staying connected beyond the first conversation with reminders, updates and re-engagement '
      + 'built around real customer moments. The full page is being written.',
    parent: SOLUTIONS_HUB,
    related: WRITTEN_FEATURES,
  },
  {
    path: '/industries',
    title: 'WhatsApp Automation by Industry',
    blurb:
      'How restaurants, ecommerce, real estate, education and service businesses each use '
      + 'WhatsApp automation. The full page is being written.',
    parent: { label: 'Back to home', href: '/' },
    related: [
      { label: 'All features', href: '/features' },
      { label: 'All solutions', href: '/solutions' },
    ],
  },
];

const byPath = new Map(COMING_SOON.map((page) => [page.path, page]));

/**
 * Resolves its own content from the current pathname.
 *
 * Route-driven rather than prop-driven so App.tsx renders one `<ComingSoon />` per
 * entry in the table above and nothing else — the copy stays next to the list it
 * belongs to, and adding a placeholder is a one-line change in one file.
 */
export default function ComingSoon() {
  const { pathname } = useLocation();
  // Trailing slashes are normalised: the copy's internal-link tables write
  // `/features/whatsapp-campaigns/` and the router matches without.
  const page = byPath.get(pathname.replace(/\/+$/, '') || '/');

  useDocumentHead({
    title: page ? `${page.title} – Coming soon | ZunoPilot` : 'Coming soon – ZunoPilot',
    description: page
      ? `${page.title} on ZunoPilot. This page is being written — explore ZunoPilot's WhatsApp automation features in the meantime.`
      : "This ZunoPilot page is being written. Explore our WhatsApp automation features in the meantime.",
    // No canonical, and noindex: see the header of this file.
    path: null,
    robots: 'noindex, follow',
  });

  const title = page?.title ?? 'This page is on the way';
  const blurb = page?.blurb
    ?? 'We are still writing this one. In the meantime, the pages below cover the same ground.';
  const parent = page?.parent ?? { label: 'Back to home', href: '/' };
  const related = page?.related ?? WRITTEN_FEATURES;

  return (
    <div className="min-h-screen bg-white text-slate-900 flex flex-col">
      <SiteHeader />

      <main className="flex-1 bg-gradient-to-b from-violet-50/70 via-white to-white">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-24 text-center">
          <motion.p
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: EASE_OUT }}
            className="text-sm font-semibold uppercase tracking-widest text-violet-600"
          >
            Coming soon
          </motion.p>

          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.08, ease: EASE_OUT }}
            className="mt-4 text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight text-slate-900"
          >
            {title}
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.16, ease: EASE_OUT }}
            className="mt-5 text-base sm:text-lg text-slate-600 leading-relaxed"
          >
            {blurb}
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.24, ease: EASE_OUT }}
            className="mt-8"
          >
            <CtaPair />
          </motion.div>

          {/*
            Somewhere to go that is not the back button. A placeholder with no exits is
            the same dead end as a 404, just politer about it.
          */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.32, ease: EASE_OUT }}
            className="mt-12 rounded-3xl bg-white ring-1 ring-slate-200/80 p-6 sm:p-8 text-left"
          >
            <p className="text-base font-semibold text-slate-900">In the meantime</p>
            <ul className="mt-4 space-y-3">
              {related.map((link) => (
                <li key={link.href}>
                  <Link
                    to={link.href}
                    className="group inline-flex items-center gap-2 text-[15px] font-medium text-violet-600 hover:text-violet-700"
                  >
                    {link.label}
                    <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                  </Link>
                </li>
              ))}
            </ul>
          </motion.div>

          <p className="mt-8">
            <Link
              to={parent.href}
              className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-900"
            >
              <ArrowLeft className="h-4 w-4" />
              {parent.label}
            </Link>
          </p>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
