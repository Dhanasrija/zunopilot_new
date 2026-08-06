import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Info } from 'lucide-react';
import { sa, rupees } from '../lib/api';
import { Badge, Card, CardHeader, Empty, Td, Th } from '../components/ui';

// Subscription plans.
//
// Read-only on purpose, and the page says why rather than leaving someone hunting
// for the edit button: `PLANS` in `billing/catalogue.ts` is the source, and
// `syncPriceCatalogue()` writes it into `Price` rows. A price edited only in the
// database is **archived and replaced by the code value** the next time
// `sync-prices` or `razorpay-plans` runs — so a form here would work until the
// next deploy and then silently undo itself.
//
// What it does surface is the thing worth alarming on: the database and the code
// disagreeing, which means checkout is charging something the pricing page is not
// showing.
export default function Plans() {
  const { data, isLoading } = useQuery({ queryKey: ['plans'], queryFn: () => sa.plans() });

  if (isLoading || !data) return <p className="text-sm text-slate-500">Loading…</p>;

  const drift = data.plans.flatMap((p) => p.prices.filter((x) => x.outOfSync || x.notSynced));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Subscription plans</h1>
        <p className="text-sm text-slate-500">
          {data.gst ? `Prices exclude GST; ${data.gst.ratePercent}% is added at checkout.` : 'GST is not configured, so no tax is charged.'}
        </p>
      </div>

      {drift.length > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
          <div className="text-xs text-red-900">
            <p className="font-medium">{drift.length} price{drift.length === 1 ? '' : 's'} out of sync</p>
            <p className="mt-0.5">
              The database and the catalogue disagree, so checkout is charging an amount the pricing
              page is not showing. Run <code className="rounded bg-red-100 px-1">npx tsx scripts/sync-prices.ts</code>.
            </p>
          </div>
        </div>
      )}

      <div className="flex items-start gap-2 rounded-lg border border-slate-200 bg-white p-3">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
        <div className="text-xs text-slate-600">
          <p className="font-medium text-slate-800">Prices are changed in code, not here</p>
          <p className="mt-0.5">
            A price is an approved value, and <code className="rounded bg-slate-100 px-1">{data.source}</code> is
            the source. An edit made only in the database is archived and replaced by the code value the
            next time the sync script runs, so this screen is read-only by design.
          </p>
          <ol className="mt-1.5 list-decimal space-y-0.5 pl-4">
            {data.howToChange.map((step) => <li key={step}>{step}</li>)}
          </ol>
        </div>
      </div>

      {data.plans.map((plan) => (
        <Card key={plan.code} className="overflow-hidden">
          <CardHeader
            title={
              <span className="flex flex-wrap items-center gap-2">
                {plan.name}
                {plan.badges.map((b) => <Badge key={b} tone="violet">{b}</Badge>)}
                {!plan.selfServe && <Badge tone="blue">sales-led</Badge>}
                <Badge>{plan.subscribers} subscriber{plan.subscribers === 1 ? '' : 's'}</Badge>
              </span>
            }
            hint={plan.tagline}
          />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem]">
              <thead className="border-b border-slate-100 bg-slate-50/60">
                <tr>
                  <Th>Interval</Th>
                  <Th className="text-right">Price (ex GST)</Th>
                  <Th className="text-right">Payable</Th>
                  <Th>Razorpay plan</Th>
                  <Th>State</Th>
                </tr>
              </thead>
              <tbody>
                {plan.prices.length === 0 ? (
                  <tr><Td className="text-slate-400">No self-serve price.</Td></tr>
                ) : plan.prices.map((price) => (
                  <tr key={price.interval} className="border-b border-slate-50 last:border-0">
                    <Td className="capitalize">{price.interval.toLowerCase()}</Td>
                    <Td className="text-right tabular-nums">{rupees(price.catalogueAmountPaise, true)}</Td>
                    <Td className="text-right tabular-nums font-medium">{rupees(price.payablePaise, true)}</Td>
                    <Td className="font-mono text-[11px] text-slate-500">
                      {price.razorpayPlanId ?? <span className="text-amber-600">not provisioned</span>}
                    </Td>
                    <Td>
                      {price.notSynced ? <Badge tone="red">not in database</Badge>
                        : price.outOfSync ? <Badge tone="red">database has {rupees(price.liveAmountPaise ?? 0, true)}</Badge>
                          : <Badge tone="green">in sync</Badge>}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="border-t border-slate-100 px-4 py-2.5 text-[11px] text-slate-500">
            AI overage {rupees(plan.overage.ratePaise, true)} per interaction · default cap{' '}
            {rupees(plan.overage.defaultCapPaise)} per period
            {plan.includes.length > 0 && <> · {plan.includes.join(' · ')}</>}
          </div>
        </Card>
      ))}

      {data.archivedPrices.length > 0 && (
        <Card className="overflow-hidden">
          <CardHeader
            title="Archived prices"
            hint="Never deleted — an old invoice must still resolve to the terms that applied."
          />
          <table className="w-full">
            <thead className="border-b border-slate-100 bg-slate-50/60">
              <tr><Th>Plan</Th><Th>Interval</Th><Th className="text-right">Amount</Th><Th>Archived</Th></tr>
            </thead>
            <tbody>
              {data.archivedPrices.map((price) => (
                <tr key={price.id} className="border-b border-slate-50 last:border-0">
                  <Td>{price.plan}</Td>
                  <Td className="capitalize">{price.interval.toLowerCase()}</Td>
                  <Td className="text-right tabular-nums">{rupees(price.amountPaise, true)}</Td>
                  <Td className="text-xs text-slate-500">{new Date(price.archivedAt).toLocaleDateString('en-IN')}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {data.plans.length === 0 && <Empty>No plans defined.</Empty>}
    </div>
  );
}
