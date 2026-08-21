import { useEffect, useState } from 'react';
import { useCatalogue, type BillingInterval } from '@/lib/pricing';
import { Disclosures, IntervalSwitch, PlanCard } from '@/components/billing/PlanGrid';
import { useDocumentHead } from '@/lib/document-head';
import { PAGE_HEADS } from '@/lib/page-heads';
import SiteHeader from '@/components/marketing/SiteHeader';
import SiteFooter from '@/components/marketing/SiteFooter';

// The public pricing page.
//
// Served from the same price records checkout charges from, so what a visitor
// is quoted and what they are billed cannot drift. Quarterly is selected by
// default because that is what the catalogue says the default is — not because
// this page hardcoded it.

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
    <div className="min-h-screen bg-gradient-to-b from-violet-50/40 to-background">
      {/*
        **The site header, not a local one.**

        This page used to render its own strip — a wordmark, "Sign in", "Start free trial" — so
        clicking Pricing in the nav made the nav disappear, and the only way back to Features or
        Solutions was the browser's back button. The pricing content below is untouched; what
        changed is that the page now sits inside the same chrome as every other public page.
      */}
      <SiteHeader />

      <main className="mx-auto max-w-6xl px-6 pb-20">
        <div className="mx-auto max-w-2xl text-center">
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Pricing that grows with the conversations
          </h1>
          <p className="mt-3 text-muted-foreground">
            Every plan includes the assistant, the shared inbox and the workflow builder.
            Pay for the size of your team and how much AI you use.
          </p>
        </div>

        {isLoading && <p className="mt-10 text-center text-sm text-muted-foreground">Loading prices…</p>}

        {data && (
          <>
            <div className="mt-8 flex justify-center">
              <IntervalSwitch catalogue={data} value={interval} onChange={setInterval} />
            </div>

            <div className="mt-8 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
              {data.plans.map((plan) => (
                <PlanCard
                  key={plan.code}
                  plan={plan}
                  interval={interval}
                  catalogue={data}
                  onChoose={() => { window.location.href = '/signup'; }}
                  onContactSales={() => {
                    window.location.href = 'mailto:sales@zunopilot.com?subject=Enterprise%20plan';
                  }}
                />
              ))}
            </div>

            <div className="mt-8 rounded-xl border bg-muted/30 p-4">
              <Disclosures catalogue={data} />
            </div>
          </>
        )}
      </main>

      <SiteFooter />
    </div>
  );
}
