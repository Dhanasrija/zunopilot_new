import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useCatalogue, type BillingInterval } from '@/lib/pricing';
import { Disclosures, IntervalSwitch, PlanCard } from '@/components/billing/PlanGrid';
import { useDocumentHead } from '@/lib/document-head';
import { PAGE_HEADS } from '@/lib/page-heads';
import { SIGNUP_LINK } from '@/lib/marketing-nav';
import { DEMO_REQUEST_LINK } from '@/lib/enquiry';
import SiteHeader from '@/components/marketing/SiteHeader';
import SiteFooter from '@/components/marketing/SiteFooter';
import { CtaBand, PageBreadcrumbs, Section } from '@/components/marketing/primitives';


export default function Pricing() {
  useDocumentHead(PAGE_HEADS.pricing);
  const { data, isLoading } = useCatalogue();
  // Monthly until the catalogue answers, which also says monthly. Seeding this with a
  // different interval would flash the wrong prices on a slow connection.
  const [interval, setInterval] = useState<BillingInterval>('MONTHLY');

  useEffect(() => {
    if (data) setInterval(data.defaultInterval);
  }, [data]);

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <SiteHeader />

      {/*
        **No hero.** It carried a headline, three lines of positioning and the Get Started /
        Book a Demo pair — all of it above the fold, so the prices were pushed below it on
        every laptop. Somebody on `/pricing` has already been sold the idea; they came for a
        number. Removed on request, and the reasoning holds: the CTA band at the foot of the
        page still catches anyone who reads to the end, and the header CTA never left.

        The `pt-` on the section below replaces the spacing the hero used to provide, so the
        interval switch does not collide with the sticky header.
      */}
      <div className="mx-auto max-w-7xl px-4 pt-8 sm:px-6 lg:px-8">
        <PageBreadcrumbs align="left" />
       <h1 className="mt-2 text-center text-3xl sm:text-4xl font-extrabold tracking-tight text-slate-900">
  ZunoPilot Pricing
</h1>
      </div>

      <Section tone="tinted" className="pt-10 sm:pt-14">
        {isLoading && (
          <p className="text-center text-sm text-slate-600">Loading prices…</p>
        )}

        {/*
          **If the catalogue request fails, say so.**

          Before, `isLoading` went false, `data` stayed undefined, and the page rendered a
          blank band between the hero and the CTA — a pricing page with no prices and no
          explanation, which reads as a broken product rather than a failed request. There is
          no fallback price to show (that is the whole point of reading them from the
          catalogue), so the honest thing is to name the problem and offer the route that does
          not depend on this endpoint.
        */}
        {!isLoading && !data && (
          <div className="mx-auto max-w-lg rounded-3xl bg-white p-6 text-center ring-1 ring-slate-200/80">
            <p className="text-base font-semibold text-slate-900">
              We could not load the current prices.
            </p>
            <p className="mt-2 text-[15px] leading-relaxed text-slate-600">
              This is on our side, not yours. Reload the page in a moment, or get in touch and
              we will send the plan comparison across.
            </p>
            <p className="mt-5">
              <Link
                to={DEMO_REQUEST_LINK}
                className="text-[15px] font-semibold text-violet-600 hover:text-violet-700"
              >
                Talk to us about pricing &rarr;
              </Link>
            </p>
          </div>
        )}

        {data && (
          <>
            <div className="flex justify-center">
              <IntervalSwitch catalogue={data} value={interval} onChange={setInterval} />
            </div>

            <div className="mt-8 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
              {data.plans.map((plan) => (
                <PlanCard
                  key={plan.code}
                  plan={plan}
                  interval={interval}
                  catalogue={data}
                  // `SIGNUP_LINK` rather than a literal, so choosing a plan lands on the same
                  // screen every other CTA on the site lands on. A full navigation rather than
                  // a router push, because the sign-in flow reads a clean document.
                  onChoose={() => { window.location.href = SIGNUP_LINK; }}
                  onContactSales={() => {
                    window.location.href = 'mailto:sales@zunopilot.com?subject=Enterprise%20plan';
                  }}
                />
              ))}
            </div>

            <div className="mt-8 rounded-3xl bg-white ring-1 ring-slate-200/80 p-5">
              <Disclosures catalogue={data} />
            </div>
          </>
        )}
      </Section>

      <CtaBand
        title={['Not Sure Which Plan', 'Fits Your Team?']}
        body={[
          'Tell us how your business handles WhatsApp today and we will walk you through what '
          + 'the platform would look like for you.',
        ]}
      />

      <SiteFooter />
    </div>
  );
}
