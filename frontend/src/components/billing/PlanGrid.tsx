import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Check, Loader2, Sparkles } from 'lucide-react';
import {
  formatRupees, type BillingInterval, type Catalogue, type PlanCode, type PlanView,
} from '@/lib/pricing';

// The plan cards and the interval switch.
//
// Shared by the public pricing page and the in-app billing page so the numbers,
// the badges and the disclosures are identical in both. Two rules from the
// pricing spec are enforced structurally here rather than left to whoever edits
// the copy:
//
//   • A non-monthly price is always labelled with what is actually charged and
//     when. The effective monthly figure appears *below* it, marked "effective"
//     — never as the headline, and never phrased as "per month".
//   • Enterprise has no checkout. It gets a Contact Sales action, because a
//     disabled Buy button on a sales-led plan just looks broken.

export function IntervalSwitch({
  catalogue, value, onChange,
}: {
  catalogue: Catalogue;
  value: BillingInterval;
  onChange: (interval: BillingInterval) => void;
}) {
  return (
    <div className="inline-flex flex-wrap items-center gap-1 rounded-lg border border-ink-300 bg-surface-0 p-1">
      {catalogue.intervals.map((interval) => (
        <button
          key={interval.code}
          type="button"
          aria-pressed={value === interval.code}
          onClick={() => onChange(interval.code)}
          className={cn(
            'relative rounded-md px-3 py-2 text-sm font-medium transition-colors duration-micro',
            // The selected segment is a raised surface with accent text, so the choice reads
            // from the fill rather than from weight alone — the previous version differed only
            // by a foreground colour, which is easy to miss on a bright screen.
            value === interval.code
              ? 'border border-ink-300 bg-surface-1 text-accent-700'
              // A transparent border on the unselected ones, so selecting does not shift the
              // row by a pixel as a border appears.
              : 'border border-transparent text-ink-500 hover:text-ink-900',
          )}
        >
          {interval.label}
          {interval.badge && (
            <span className={cn(
              'ml-1 rounded-full px-1 py-px text-caption font-semibold',
              interval.code === 'YEARLY'
                ? 'bg-success/10 text-success'
                : 'bg-accent-100 text-accent-700',
            )}
            >
              {interval.badge}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

export function PlanCard({
  plan, interval, catalogue, currentPlan, currentInterval, pendingPlan, busy,
  onChoose, onContactSales,
}: {
  plan: PlanView;
  interval: BillingInterval;
  catalogue: Catalogue;
  currentPlan?: PlanCode | 'FREE' | null;
  currentInterval?: BillingInterval | null;
  /** A change already scheduled for period end. */
  pendingPlan?: { plan: PlanCode; interval: BillingInterval } | null;
  busy?: boolean;
  onChoose?: (plan: PlanCode, interval: BillingInterval) => void;
  onContactSales?: () => void;
}) {
  const price = plan.prices[interval];
  // Plan *and* interval. Comparing the plan alone left "Choose Growth" live
  // for someone already on Growth at a different interval — a button whose
  // only effect was to bill them again.
  const isCurrent = currentPlan === plan.code
    && (!currentInterval || currentInterval === interval);
  const isPending = pendingPlan?.plan === plan.code && pendingPlan?.interval === interval;
  const highlight = plan.recommended;

  return (
    <div
      className={cn(
        'relative flex flex-col rounded-lg border p-4',
        highlight ? 'border-accent-100 shadow-none ring-1 ring-accent-100' : 'border-border',
      )}
    >
      {plan.badges.length > 0 && (
        <div className="absolute -top-3 left-5 flex gap-1">
          {plan.badges.map((badge) => (
            // `text-on-accent` and a transparent border, both explicitly: the Badge default
            // variant is a TINT (bg-accent-100 / text-accent-700 / border-accent-200), and
            // overriding only the background left dark purple text on a dark purple fill.
            <Badge
              key={badge}
              className="border-transparent bg-accent-600 text-caption text-on-accent hover:bg-accent-600"
            >
              {badge}
            </Badge>
          ))}
          {plan.recommended && (
            <Badge variant="outline" className="border-accent-100 bg-surface-1 text-caption text-accent-700">
              Recommended
            </Badge>
          )}
        </div>
      )}

      <div className="mb-3">
        <h3 className="text-h3 font-semibold">{plan.name}</h3>
        <p className="mt-px text-caption leading-snug text-muted-foreground">{plan.tagline}</p>
      </div>

      <div className="mb-4">
        {price ? (
          <>
            <div className="flex items-baseline gap-1">
              <span className="text-h2 font-semibold tracking-tight">
                {formatRupees(price.amountPaise)}
              </span>
              <span className="text-sm text-muted-foreground">
                {catalogue.intervals.find((i) => i.code === interval)?.everyLabel}
              </span>
            </div>

            {/*
              Rule 12: an upfront charge is never described as monthly. The
              effective figure is secondary and explicitly labelled.
            */}
            {interval !== 'MONTHLY' && (
              <p className="mt-1 text-caption text-muted-foreground">
                {formatRupees(price.effectiveMonthlyPaise, { decimals: true })} per month effective
                {price.savingsPercent ? ` · about ${price.savingsPercent}% cheaper than monthly` : ''}
              </p>
            )}
            {/*
              The headline stays the approved ex-GST price, but a customer must
              not reach the Razorpay modal and find a bigger number. So when GST
              applies, the total that will actually be charged is stated here —
              read from the API, never computed from the headline.
            */}
            <p className="mt-px text-caption text-muted-foreground">
              {catalogue.disclosures.upfront[interval]}
              {catalogue.gst
                ? ` ${formatRupees(price.payablePaise, { decimals: true })} incl. ${catalogue.gst.ratePercent}% GST.`
                : ' Excludes GST.'}
            </p>
          </>
        ) : (
          <>
            <div className="text-h2 font-semibold tracking-tight">Custom</div>
            <p className="mt-1 text-caption text-muted-foreground">
              Priced around your team, your numbers and your usage.
            </p>
          </>
        )}
      </div>

      {plan.selfServe ? (
        <Button
          className={cn('w-full', highlight && !isCurrent && 'bg-accent-600 hover:bg-accent-700')}
          variant={highlight && !isCurrent ? 'default' : 'outline'}
          disabled={isCurrent || isPending || busy || !onChoose}
          onClick={() => onChoose?.(plan.code, interval)}
        >
          {busy && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
          {isCurrent ? 'Current plan' : isPending ? 'Scheduled' : `Choose ${plan.name}`}
        </Button>
      ) : (
        <Button variant="outline" className="w-full gap-1" onClick={onContactSales}>
          <Sparkles className="h-3.5 w-3.5" /> Contact sales
        </Button>
      )}

      <ul className="mt-4 space-y-1">
        {plan.includes.map((line) => (
          <li key={line} className="flex items-start gap-2 text-caption leading-snug">
            <Check className="mt-px h-3.5 w-3.5 shrink-0 text-success" />
            <span>{line}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The two statements that must appear wherever prices are shown. */
export function Disclosures({ catalogue }: { catalogue: Catalogue }) {
  return (
    <div className="space-y-1 text-caption leading-snug text-muted-foreground">
      <p>{catalogue.disclosures.tax}</p>
      <p>{catalogue.disclosures.aiOverage}</p>
      <p>
        All prices are in {catalogue.currency} and exclude GST.
        {catalogue.gst ? ` ${catalogue.gst.note}` : ' '}
      </p>
    </div>
  );
}
