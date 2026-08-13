import { Link, useLocation } from 'react-router-dom';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { motion } from 'framer-motion';
import { useDocumentHead } from '@/lib/document-head';
import { PAGE_HEADS } from '@/lib/page-heads';
import { DETAIL_BY_PATH } from '@/lib/marketing-content';
import SiteHeader from '@/components/marketing/SiteHeader';
import SiteFooter from '@/components/marketing/SiteFooter';
import NotFound from '@/pages/NotFound';
import {
  CheckList, CtaPair, EASE_OUT, PageBreadcrumbs, Section, SectionHead, TileGrid,
} from '@/components/marketing/primitives';

/*
 * The placeholder for a page that is planned, linked, and not written yet.
 *
 * **Why these routes exist at all.** The Solutions dropdown lists six children and the
 * solutions hub links to the same six. The alternative is six links that 404, on the page
 * the site's internal-linking structure is built around — worse for a visitor than "we're
 * writing this", and much worse for Google, because a hub whose outbound links are broken
 * is a hub Google stops trusting.
 *
 * **These pages ARE indexed, which is a reversal, and worth understanding.** A "coming
 * soon" page competing in search results for "whatsapp lead management" is normally a worse
 * outcome than not appearing: it burns the click and teaches the ranking system that the
 * site's pages do not answer the query. So these were `noindex` and absent from
 * `sitemap.xml`. They were put into the sitemap on request — and a sitemap entry is a
 * request to index, so the `noindex` had to go with it. Keeping both would have been a
 * contradiction Google resolves in favour of the page, logging "Submitted URL marked
 * noindex" in Search Console and indexing nothing.
 *
 * **Given that, the page carries as much real content as it honestly can.** It renders each
 * page's actual `intro` copy from `lib/marketing-content.ts` — two or three accurate
 * paragraphs on the topic — above the notice that the full page is still being written. The
 * difference between what gets indexed at sixty words and at two hundred and fifty accurate
 * ones is the difference between a page Google files as thin and one it files as short. It
 * also emits `BreadcrumbList`, which is true of the page regardless of how finished it is,
 * but deliberately **no `FAQPage`**: there are no questions on the screen, and FAQ markup
 * that does not match visible content is a rich-result violation.
 *
 * **The real fix is still one line per page.** Every one of these six has a complete
 * page — hero, capabilities, benefits, worked example, five FAQs — written and sitting in
 * `lib/marketing-content.ts` behind `pages/DetailPage.tsx`. Point the route in App.tsx at
 * `DetailPage` instead of here and the page is finished. Nothing was deleted.
 */

export interface ComingSoonPage {
  /**
   * Key into `PAGE_HEADS`.
   *
   * These pages are indexable, so each needs its own title, description and self-referential
   * canonical — and those belong in the one table where the site's metadata can be read as a
   * set, not inline here. Same contract `lib/marketing-content.ts` uses.
   */
  headKey: keyof typeof PAGE_HEADS;
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
    headKey: 'leadManagement',
    path: '/solutions/lead-management',
    title: 'WhatsApp Lead Management',
    blurb:
      'Capturing enquiries, engaging prospects and running consistent follow-up workflows on '
      + 'WhatsApp. The full page is being written.',
    parent: SOLUTIONS_HUB,
    related: WRITTEN_FEATURES,
  },
  {
    headKey: 'salesAutomation',
    path: '/solutions/sales-automation',
    title: 'WhatsApp Sales Automation',
    blurb:
      'Structuring the repeatable parts of the sales conversation so representatives spend their '
      + 'time on qualified opportunities. The full page is being written.',
    parent: SOLUTIONS_HUB,
    related: WRITTEN_FEATURES,
  },
  {
    headKey: 'customerSupport',
    path: '/solutions/customer-support',
    title: 'WhatsApp Customer Support',
    blurb:
      'Giving customers a more connected support experience, with routine interactions handled '
      + 'by workflows and agents free for the rest. The full page is being written.',
    parent: SOLUTIONS_HUB,
    related: WRITTEN_FEATURES,
  },
  {
    headKey: 'marketingAutomation',
    path: '/solutions/marketing-automation',
    title: 'WhatsApp Marketing Automation',
    blurb:
      'Making WhatsApp part of your customer engagement strategy through structured campaign and '
      + 'communication workflows. The full page is being written.',
    parent: SOLUTIONS_HUB,
    related: WRITTEN_FEATURES,
  },
  {
    headKey: 'customerEngagement',
    path: '/solutions/customer-engagement',
    title: 'WhatsApp Customer Engagement',
    blurb:
      'Staying connected beyond the first conversation with reminders, updates and re-engagement '
      + 'built around real customer moments. The full page is being written.',
    parent: SOLUTIONS_HUB,
    related: WRITTEN_FEATURES,
  },
  {
    headKey: 'industries',
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
  // `/solutions/lead-management/` and the router matches without.
  const page = byPath.get(pathname.replace(/\/+$/, '') || '/');

  // The router only mounts this for paths in the table, so `undefined` should be
  // unreachable. `NotFound` rather than an empty shell if it ever is: the one way it can
  // happen — a route added in App.tsx with no entry here — should look like a missing page
  // and be `noindex`, which is what NotFound already does.
  if (!page) return <NotFound />;
  return <Placeholder key={page.path} page={page} />;
}

/**
 * Split out so the hooks below always run in the same order.
 *
 * `ComingSoon` returns early on an unknown path and hooks cannot sit above an early return.
 * The `key` on the call site remounts this when the route changes, so nothing carries across
 * from the previous page.
 */
function Placeholder({ page }: { page: ComingSoonPage }) {
  /*
   * **A real head, with a self-referential canonical and no `noindex`.**
   *
   * These pages are advertised in `sitemap.xml`, so they have to be indexable — see the
   * header of this file for why that is a reversal and what it costs. Each head is its own
   * entry in `PAGE_HEADS`, so the titles and descriptions are unique and reviewable next to
   * the finished pages'.
   */
  useDocumentHead(PAGE_HEADS[page.headKey]);

  /*
   * `BreadcrumbList` comes from `PageBreadcrumbs` below, which derives the trail from the
   * route — so it is not emitted here. There is deliberately **no `FAQPage`**: there are no
   * questions on screen, and structured data that does not match visible content is a
   * rich-result violation.
   */
  const detail = DETAIL_BY_PATH.get(page.path);

  const { title, blurb, parent, related } = page;

  /*
   * **How much of the finished page to show, and why it is this much.**
   *
   * These pages are indexed, so the thing to avoid is a thin page ranking for a commercial
   * query. The first attempt showed only `intro` — but that is two paragraphs, about fifty
   * words, which put the whole page at eighty-odd and squarely in "thin" territory. So it
   * shows `intro`, the capability list, and the benefit tiles: roughly two hundred and fifty
   * words of copy that is already written and already accurate.
   *
   * What it deliberately does **not** show is the worked example, the audience section, the
   * FAQs and the closing copy — those are what make the finished page a finished page, and
   * `pages/DetailPage.tsx` renders all of it from the same table. This is a placeholder that
   * is substantial rather than a page pretending to be complete, and the notice above says
   * which it is.
   *
   * Everything falls back to empty if a placeholder has no matching entry. An absent section
   * is better than a fabricated one.
   */
  const intro = detail?.intro ?? [];
  const list = detail?.list ?? [];
  const benefits = detail?.benefits ?? [];

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

          {/* The trail, so the page states where it sits even while it is unfinished. */}
          <div className="mt-6"><PageBreadcrumbs /></div>

          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.08, ease: EASE_OUT }}
            className="mt-4 text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight text-slate-900"
          >
            {title}
          </motion.h1>

          {/*
            The real copy first, the notice second — in that order deliberately. A visitor
            who searched for this topic should read something useful before being told the
            page is unfinished, and the first paragraph is also what Google is most likely
            to pull as a snippet.
          */}
          {intro.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.16, ease: EASE_OUT }}
              className="mt-6 space-y-4 text-left text-base sm:text-lg text-slate-700 leading-relaxed"
            >
              {intro.map((para) => <p key={para}>{para}</p>)}
            </motion.div>
          )}

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2, ease: EASE_OUT }}
            className="mt-6 rounded-2xl bg-violet-50/80 px-5 py-4 text-[15px] text-slate-700 leading-relaxed ring-1 ring-violet-100"
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

        {/*
          The written-but-not-yet-laid-out half of the page.

          Same primitives the finished pages use, so this does not read as a different site,
          and outside the narrow `max-w-3xl` column above because a six-item grid needs the
          width. Both sections are omitted entirely when the copy is missing.
        */}
        {list.length > 0 && (
          <Section>
            <div className="max-w-4xl mx-auto rounded-3xl bg-white ring-1 ring-slate-200/80 p-6 sm:p-8">
              <p className="text-base font-semibold text-slate-900">{detail?.listLabel}</p>
              <CheckList items={list} className="mt-5" />
            </div>
          </Section>
        )}

        {benefits.length > 0 && detail?.benefitsTitle && (
          <Section tone="tinted">
            <SectionHead title={[...detail.benefitsTitle]} />
            <div className="mt-10">
              <TileGrid tiles={benefits} />
            </div>
          </Section>
        )}
      </main>

      <SiteFooter />
    </div>
  );
}
