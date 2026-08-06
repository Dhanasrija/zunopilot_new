import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useCatalogue, type BillingInterval } from '@/lib/pricing';
import { Disclosures, IntervalSwitch, PlanCard } from '@/components/billing/PlanGrid';
import { Button } from '@/components/ui/button';

// The public pricing page.
//
// Served from the same price records checkout charges from, so what a visitor
// is quoted and what they are billed cannot drift. Quarterly is selected by
// default because that is what the catalogue says the default is — not because
// this page hardcoded it.

export default function Pricing() {
  const { data, isLoading } = useCatalogue();
  const [interval, setInterval] = useState<BillingInterval>('QUARTERLY');

  useEffect(() => {
    if (data) setInterval(data.defaultInterval);
  }, [data]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-violet-50/40 to-background">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <Link to="/" className="text-lg font-semibold">ZunoPilot</Link>
        <div className="flex items-center gap-2">
          <Button variant="ghost" asChild><Link to="/login">Sign in</Link></Button>
          <Button asChild className="bg-violet-600 hover:bg-violet-700">
            <Link to="/signup">Start free trial</Link>
          </Button>
        </div>
      </header>

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
    </div>
  );
}
