import { Link, useLocation } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { motion } from 'framer-motion';
import { useDocumentHead } from '@/lib/document-head';
import { PAGE_HEADS } from '@/lib/page-heads';
import { useBreadcrumbSchema } from '@/lib/json-ld';
import { DETAIL_BY_PATH, type DetailPage as DetailPageData } from '@/lib/marketing-content';
import SiteHeader from '@/components/marketing/SiteHeader';
import SiteFooter from '@/components/marketing/SiteFooter';
import NotFound from '@/pages/NotFound';
import {
  CARD_SPRING, CheckList, CtaBand, FaqSection, FlowChain, PageHero, ScrollProgress,
  Section, SectionHead, TileGrid, item, stagger, viewport,
} from '@/components/marketing/primitives';

/*
 * One template, eleven pages.
 *
 * **This replaces the Coming Soon placeholder, and the reason is search.** Those eleven
 * URLs are exactly where terms like "whatsapp number masking", "whatsapp team inbox" and
 * "whatsapp lead management" land. A placeholder at that address is the worst of both
 * outcomes: it either does not get indexed, or it does and burns the click. Every one of
 * them now carries a real answer to its own question — a hero, what it does, why it
 * matters, a worked example, who it suits, and an FAQ — with unique metadata, its own
 * `FAQPage` and `BreadcrumbList` graphs, and a place in the sitemap.
 *
 * The copy lives in `lib/marketing-content.ts`. Keeping it out of here is what makes
 * eleven pages one file to review rather than eleven files to keep in sync — see the
 * header of that module.
 *
 * **On an unknown path.** The router only mounts this for paths that are in the table,
 * so `undefined` should be unreachable. It renders `NotFound` rather than throwing or
 * rendering an empty shell, because the one way it can happen — a route added in
 * App.tsx without a matching entry — should look like a missing page to a visitor and be
 * `noindex` to Google, which is precisely what `NotFound` already does.
 */

export default function DetailPage() {
  const { pathname } = useLocation();
  // Trailing slashes are normalised: the copy's link tables write
  // `/features/whatsapp-campaigns/` and the router matches without one.
  const data = DETAIL_BY_PATH.get(pathname.replace(/\/+$/, '') || '/');

  if (!data) return <NotFound />;
  return <Detail key={data.path} data={data} />;
}

/**
 * Split out so the hooks below always run in the same order.
 *
 * `DetailPage` returns early when the path is unknown, and hooks cannot sit above an
 * early return. The `key` on the call site remounts this when the route changes, so
 * `useState` inside the FAQ accordion resets between pages rather than carrying the
 * previous page's open question across.
 */
function Detail({ data }: { data: DetailPageData }) {
  useDocumentHead(PAGE_HEADS[data.headKey as keyof typeof PAGE_HEADS]);
  useBreadcrumbSchema(data.crumbs);

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <ScrollProgress />
      <SiteHeader />

      <PageHero title={[...data.h1]} intro={data.intro} crumbs={data.crumbs} />

      {/* What it does — the capability list. */}
      <Section tone="tinted">
        <div className="max-w-4xl mx-auto rounded-3xl bg-white ring-1 ring-slate-200/80 p-6 sm:p-8">
          <p className="text-base font-semibold text-slate-900">{data.listLabel}</p>
          <CheckList items={data.list} className="mt-5" />
        </div>
      </Section>

      {/* Why it matters. */}
      <Section>
        <SectionHead title={[...data.benefitsTitle]} />
        <div className="mt-10">
          <TileGrid tiles={data.benefits} />
        </div>
      </Section>

      {/* The worked example, where the page has one. */}
      {data.flow && data.flowTitle && (
        <Section tone="tinted">
          <SectionHead
            title={[...data.flowTitle]}
            lead={data.flowLead ? <p>{data.flowLead}</p> : undefined}
          />
          <FlowChain className="mt-10" steps={data.flow} />
        </Section>
      )}

      {/* Who it is for. */}
      <Section>
        <SectionHead title={[...data.audienceTitle]} />
        <div className="mt-10">
          <TileGrid tiles={data.audience} />
        </div>
      </Section>

      {/* Where to go next. Every detail page links onward to three others, so no page
          in the tree is a leaf — for a reader or for a crawler. */}
      <Section tone="tinted">
        <SectionHead title={['Related Pages']} />
        <motion.div
          initial="hidden"
          whileInView="show"
          viewport={viewport}
          variants={stagger(0, 0.07)}
          className="mt-10 grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-5"
        >
          {data.related.map((link) => (
            <motion.div key={link.href} variants={item} whileHover={{ y: -6 }} transition={CARD_SPRING}>
              <Link
                to={link.href}
                className="group flex h-full items-center justify-between gap-3 rounded-3xl bg-white ring-1 ring-slate-200/80 p-6 hover:ring-violet-200 transition-colors"
              >
                <span className="text-base font-semibold text-slate-900">{link.label}</span>
                <ArrowRight className="h-4 w-4 shrink-0 text-violet-600 transition-transform group-hover:translate-x-1" />
              </Link>
            </motion.div>
          ))}
        </motion.div>
      </Section>

      <FaqSection faqs={data.faqs} />

      <CtaBand title={[...data.ctaTitle]} body={data.ctaBody} />

      <SiteFooter />
    </div>
  );
}
