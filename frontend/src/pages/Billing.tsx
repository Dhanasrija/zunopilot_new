import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { usePermissions } from '@/lib/permissions';
import {
  formatLimit, formatRupees, useCatalogue,
  type BillingInterval, type PlanCode,
  type Catalogue,
} from '@/lib/pricing';
import { Disclosures, IntervalSwitch, PlanCard } from '@/components/billing/PlanGrid';
import TaxDetails from '@/components/billing/TaxDetails';
import { BillingIdentityDialog } from '@/components/billing/BillingIdentityDialog';
import { isBillable, isBillingAddressError, useBillingIdentity } from '@/components/billing/billing-identity';
import SupportAccess from '@/components/billing/SupportAccess';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn, formatDateTime } from '@/lib/utils';
import { AlertTriangle, ArrowLeftRight, BookUser, ChevronRight, ExternalLink, FileText, LifeBuoy, Loader2, Package, Receipt, ShieldCheck } from 'lucide-react';

// Billing.
//
// Shows what the workspace is on, what it is using against what it is allowed,
// and every invoice. The plan grid is the same component the public pricing
// page uses, so the numbers here are the ones a visitor was quoted.

interface SubscriptionResponse {
  subscription: {
    plan: PlanCode;
    interval: BillingInterval;
    status: string;
    currentPeriodStart: string | null;
    currentPeriodEnd: string | null;
    cancelledAt: string | null;
    assignedNote: string | null;
    pendingChange: { plan: PlanCode; interval: BillingInterval; effectiveAt: string } | null;
  } | null;
  entitlements: {
    plan: PlanCode | 'FREE';
    planName: string;
    status: string;
    whatsappNumbers: number | null;
    teamMembers: number | null;
    activeAutomations: number | null;
    aiInteractionsPerMonth: number | null;
    support: string;
  };
  usage: {
    used: number; limit: number | null; remaining: number | null;
    periodStart: string; periodEnd: string; overQuota: boolean;
    overageInteractions: number; overagePaise: number;
    overageRatePaise: number; overageCapPaise: number; capReached: boolean;
  };
  consumption: { teamMembers: number; whatsappNumbers: number; activeAutomations: number };
  invoices: Array<{
    id: string; number: string; planName: string; intervalLabel: string;
    periodStart: string; periodEnd: string; totalPaise: number; issuedAt: string;
  }>;
  razorpayConfigured: boolean;
  disclosures: { tax: string; aiOverage: string };
}

/** Derived from the response rather than restated, so they cannot drift from it. */
type Subscription = NonNullable<SubscriptionResponse['subscription']>;
type Invoice = SubscriptionResponse['invoices'][number];

/** Load Razorpay's checkout script once, on demand. */
const loadRazorpay = (): Promise<boolean> => new Promise((resolve) => {
  if (typeof window === 'undefined') return resolve(false);
  if ((window as { Razorpay?: unknown }).Razorpay) return resolve(true);
  const script = document.createElement('script');
  script.src = 'https://checkout.razorpay.com/v1/checkout.js';
  script.onload = () => resolve(true);
  script.onerror = () => resolve(false);
  document.body.appendChild(script);
});

function UsageBar({ label, used, limit }: { label: string; used: number; limit: number | null }) {
  const pct = limit === null ? 0 : Math.min(100, Math.round((used / limit) * 100));
  const tight = limit !== null && pct >= 80;

  return (
    <div>
      <div className="flex items-baseline justify-between text-caption">
        <span className="font-medium">{label}</span>
        <span className={cn('tabular-nums', tight ? 'text-ink-900' : 'text-muted-foreground')}>
          {used.toLocaleString('en-IN')}
          {limit === null ? ' · unlimited' : ` / ${limit.toLocaleString('en-IN')}`}
        </span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className={cn('h-full rounded-full transition-all',
            limit === null ? 'w-0' : tight ? 'bg-warning' : 'bg-accent-600')}
          style={{ width: limit === null ? '0%' : `${pct}%` }}
        />
      </div>
    </div>
  );
}

/**
 * The money summary beside the plan.
 *
 * Every figure here comes from the server. `payablePaise` is the charged total and
 * `amountPaise` the approved price; GST is the DIFFERENCE between them, never a rate applied
 * on the client. Quoting 18% of something and charging something else is exactly the drift
 * `payablePaise` exists to prevent.
 */
function BillingSummary({
  catalogue, subscription, entitlements, onChangePlan, canManage,
}: {
  catalogue: Catalogue;
  subscription: Subscription | null;
  entitlements: { plan: PlanCode | 'FREE'; planName: string };
  onChangePlan: () => void;
  canManage: boolean;
}) {
  const plan = catalogue.plans.find((p) => p.code === entitlements.plan);
  const price = subscription ? plan?.prices[subscription.interval] : undefined;
  const intervalLabel = subscription
    ? catalogue.intervals.find((i) => i.code === subscription.interval)?.label
    : null;
  const gstPaise = price ? price.payablePaise - price.amountPaise : 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-body">
          <Receipt className="h-4 w-4 text-ink-500" /> Billing summary
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <dl className="space-y-2 text-caption">
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-muted-foreground">Plan</dt>
            <dd className="text-right font-medium">
              {entitlements.planName}
              {intervalLabel && <span className="text-muted-foreground"> · {intervalLabel}</span>}
            </dd>
          </div>

          {subscription?.currentPeriodStart && subscription.currentPeriodEnd && (
            <div className="flex items-baseline justify-between gap-4">
              <dt className="shrink-0 text-muted-foreground">Billing cycle</dt>
              <dd className="text-right">
                {formatDateTime(subscription.currentPeriodStart)} – {formatDateTime(subscription.currentPeriodEnd)}
              </dd>
            </div>
          )}

          {price && (
            <>
              <div className="flex items-baseline justify-between gap-4">
                <dt className="text-muted-foreground">Billing amount</dt>
                <dd className="tabular-nums">{formatRupees(price.amountPaise, { decimals: true })}</dd>
              </div>
              {gstPaise > 0 && catalogue.gst && (
                <div className="flex items-baseline justify-between gap-4">
                  <dt className="text-muted-foreground">GST ({catalogue.gst.ratePercent}%)</dt>
                  <dd className="tabular-nums">{formatRupees(gstPaise, { decimals: true })}</dd>
                </div>
              )}
              <div className="flex items-baseline justify-between gap-4 border-t pt-2">
                <dt className="font-medium">Total</dt>
                <dd className="text-body font-semibold tabular-nums">
                  {formatRupees(price.payablePaise, { decimals: true })}
                </dd>
              </div>
            </>
          )}

          {!price && (
            <p className="text-muted-foreground">
              No paid plan yet. Pick one to see what it costs.
            </p>
          )}
        </dl>

        {canManage && (
          <Button className="w-full gap-1" onClick={onChangePlan}>
            <ArrowLeftRight className="h-4 w-4" />
            {subscription ? 'Change plan' : 'Choose a plan'}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

/** Support links. Static, so it says only what is actually true. */
function NeedHelp() {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-body">
          <LifeBuoy className="h-4 w-4 text-ink-500" /> Need help?
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-caption text-muted-foreground">
          We are here to help you with your billing.
        </p>
        <a
          href="mailto:support@zunopilot.com?subject=Billing%20question"
          className="flex items-center justify-between gap-2 rounded-md border border-ink-300 px-3 py-2 text-caption transition-colors duration-micro hover:bg-accent-100/40"
        >
          Contact support <ChevronRight className="h-4 w-4 shrink-0 text-ink-500" />
        </a>
      </CardContent>
    </Card>
  );
}

/**
 * The last three invoices on the Overview, with the rest a tab away.
 *
 * Three because the question this answers is "did the last one go through" — the full ledger
 * is a different task and has its own tab.
 */
function RecentInvoices({ invoices, onViewAll }: { invoices: Invoice[]; onViewAll: () => void }) {
  if (invoices.length === 0) return null;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0 pb-3">
        <CardTitle className="text-body">Recent invoices</CardTitle>
        {invoices.length > 3 && (
          <button
            type="button"
            onClick={onViewAll}
            className="text-caption font-medium text-accent-600 hover:underline"
          >
            View all invoices
          </button>
        )}
      </CardHeader>
      <CardContent className="space-y-2">
        {invoices.slice(0, 3).map((invoice) => (
          <div
            key={invoice.id}
            className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b pb-2 last:border-0 last:pb-0"
          >
            <div className="min-w-0">
              <p className="font-mono text-caption">{invoice.number}</p>
              <p className="text-caption text-muted-foreground">
                {invoice.planName} · {invoice.intervalLabel}
              </p>
            </div>
            <div className="flex items-baseline gap-3">
              <span className="tabular-nums">{formatRupees(invoice.totalPaise, { decimals: true })}</span>
              <a
                href={`/invoices/${invoice.id}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-caption text-accent-600 hover:underline"
              >
                View <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export default function Billing() {
  const qc = useQueryClient();
  const { can } = usePermissions();
  const manage = can('settings:write');

  const catalogue = useCatalogue();
  // Monthly until the catalogue answers, which also says monthly. Seeding this with a
  // different interval would flash the wrong prices on a slow connection.
  // Controlled so "View all invoices" on the Overview can move to the Invoices tab.
  const [tab, setTab] = useState('overview');
  const [interval, setInterval] = useState<BillingInterval>('MONTHLY');
  const [choosing, setChoosing] = useState<PlanCode | null>(null);

  /*
   * The address step, between choosing a plan and paying.
   *
   * The server refuses a checkout without a billing address and — when tax is charged — a state,
   * because a GST invoice must name a place of supply. Rather than let someone meet that 422
   * with their card out, the plan choice is held here while the details are collected, then
   * resumed automatically.
   *
   * `pendingChoice` is what makes it a step rather than a detour: the plan they clicked is
   * remembered, so saving the address continues to payment instead of returning them to the grid
   * to click it again.
   */
  const billingIdentity = useBillingIdentity();
  const [pendingChoice, setPendingChoice] = useState<{ plan: PlanCode; interval: BillingInterval } | null>(null);

  const startChange = (plan: PlanCode, chosen: BillingInterval) => {
    setChoosing(plan);
    changePlan.mutate({ plan, billingInterval: chosen });
  };

  const choosePlan = (plan: PlanCode, chosen: BillingInterval) => {
    // Ask first when we already know something is missing. `isBillable` mirrors the server's
    // rule; if the two ever disagree the 422 handler below opens the same dialog anyway, so the
    // mismatch costs a round trip rather than correctness.
    if (!isBillable(billingIdentity.data)) {
      setPendingChoice({ plan, interval: chosen });
      return;
    }
    startChange(plan, chosen);
  };

  // Quarterly is the default, and it comes from the server rather than being
  // hardcoded in two places.
  useEffect(() => {
    if (catalogue.data) setInterval(catalogue.data.defaultInterval);
  }, [catalogue.data]);

  const { data, isLoading } = useQuery({
    queryKey: ['billing', 'subscription'],
    queryFn: () => api.get<{ data: SubscriptionResponse }>('/billing/subscription').then((r) => r.data.data),
  });

  /**
   * Change plan.
   *
   * Asks the server what kind of change this is first. An upgrade or a
   * scheduled downgrade on a live subscription is done in place at Razorpay and
   * never opens a payment window — the mandate already exists. Only a first
   * purchase, or a subscription Razorpay will not update, falls through to
   * checkout.
   */
  const changePlan = useMutation({
    mutationFn: async ({ plan, billingInterval }: { plan: PlanCode; billingInterval: BillingInterval }) => {
      const response = await api.post<{
        data: {
          requiresCheckout?: boolean;
          kind: string;
          effective?: 'IMMEDIATE' | 'PERIOD_END';
          effectiveAt?: string;
          bonusDays?: number;
        };
      }>('/billing/change-plan', { plan, interval: billingInterval });

      if (!response.data.data.requiresCheckout) return response.data.data;
      await checkout.mutateAsync({ plan, billingInterval });
      return { kind: 'PURCHASE', effective: 'IMMEDIATE' as const };
    },
    onSuccess: (result) => {
      if (result.effective === 'PERIOD_END' && result.effectiveAt) {
        toast.success(
          `Scheduled. You keep your current plan until ${new Date(result.effectiveAt).toLocaleDateString('en-IN')}.`,
        );
      } else if (result.bonusDays) {
        toast.success(`Upgraded. ${result.bonusDays} days carried over from your previous plan.`);
      } else {
        toast.success('Plan updated.');
      }
      qc.invalidateQueries({ queryKey: ['billing', 'subscription'] });
    },
    onError: (err: Error, variables) => {
      // The backstop for the pre-check in `choosePlan`. If the server refuses for want of an
      // address — a stale cache, or another tab that changed it — open the same step and keep
      // the plan they chose, rather than leaving a toast and a grid to click through again.
      if (isBillingAddressError(err)) {
        setPendingChoice({ plan: variables.plan, interval: variables.billingInterval });
        return;
      }
      if (err.message !== 'Payment cancelled') toast.error(err.message);
    },
    onSettled: () => setChoosing(null),
  });

  const setCap = useMutation({
    mutationFn: (overageCapPaise: number | null) =>
      api.put('/billing/overage-cap', { overageCapPaise }),
    onSuccess: () => {
      toast.success('Spend limit updated.');
      qc.invalidateQueries({ queryKey: ['billing', 'subscription'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const cancelScheduled = useMutation({
    mutationFn: () => api.delete('/billing/scheduled-change'),
    onSuccess: () => {
      toast.success('Scheduled change cancelled.');
      qc.invalidateQueries({ queryKey: ['billing', 'subscription'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const checkout = useMutation({
    mutationFn: async ({ plan, billingInterval }: { plan: PlanCode; billingInterval: BillingInterval }) => {
      // Only two enums leave the browser. The amount and the Razorpay plan id
      // are the server's business.
      const started = await api.post<{
        data: {
          // `payablePaise` is what Razorpay collects (price + GST);
          // `taxablePaise` is the approved ex-GST price. Never show the second
          // one as the total.
          keyId: string; subscriptionId: string;
          payablePaise: number; taxablePaise: number;
          plan: string; interval: string; upfrontNote: string;
        };
      }>('/billing/checkout', { plan, interval: billingInterval });

      const session = started.data.data;
      const ready = await loadRazorpay();
      if (!ready) throw new Error('Could not load the payment window. Check your connection.');

      return new Promise<void>((resolve, reject) => {
        const Razorpay = (window as unknown as { Razorpay: new (o: unknown) => { open: () => void } }).Razorpay;
        const modal = new Razorpay({
          key: session.keyId,
          subscription_id: session.subscriptionId,
          name: 'ZunoPilot',
          description: `${session.plan} · ${session.interval}`,
          handler: async (response: {
            razorpay_payment_id: string;
            razorpay_subscription_id: string;
            razorpay_signature: string;
          }) => {
            try {
              // The browser saying "it worked" is a claim. The server verifies
              // the signature before anything is granted.
              await api.post('/billing/checkout/verify', {
                razorpayPaymentId: response.razorpay_payment_id,
                razorpaySubscriptionId: response.razorpay_subscription_id,
                razorpaySignature: response.razorpay_signature,
              });
              resolve();
            } catch (err) {
              reject(err as Error);
            }
          },
          modal: { ondismiss: () => reject(new Error('Payment cancelled')) },
        });
        modal.open();
      });
    },
    onSuccess: () => {
      toast.success('Subscription active. Your invoice is below.');
      qc.invalidateQueries({ queryKey: ['billing', 'subscription'] });
    },
    onError: (err: Error) => {
      if (err.message !== 'Payment cancelled') toast.error(err.message);
    },
    onSettled: () => setChoosing(null),
  });

  const cancel = useMutation({
    mutationFn: () => api.post('/billing/cancel'),
    onSuccess: () => {
      toast.success('Cancelled. Your plan runs to the end of the paid period.');
      qc.invalidateQueries({ queryKey: ['billing', 'subscription'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (isLoading || catalogue.isLoading) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }
  if (!data || !catalogue.data) return <p className="text-sm text-muted-foreground">Unavailable.</p>;

  const { entitlements, usage, consumption, subscription, invoices } = data;
  const onFree = entitlements.plan === 'FREE';

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-h2 font-semibold">Billing</h1>
        <p className="text-sm text-muted-foreground">
          Your plan, what you are using, and every invoice.
        </p>
      </div>

      {!data.razorpayConfigured && manage && (
        <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/15 p-3">
          <AlertTriangle className="mt-px h-4 w-4 shrink-0 text-ink-900" />
          <div className="text-caption text-ink-900">
            <p className="font-medium">Payments are not configured on this server</p>
            <p className="mt-px text-ink-900">
              Set the Razorpay keys and plan ids to enable checkout. A plan can still be assigned
              manually in the meantime.
            </p>
          </div>
        </div>
      )}

      {/*
        Four tabs rather than one long scroll. The page carries four unrelated jobs — see what
        you are on, change it, find an invoice, edit the address — and stacking them meant
        scrolling past three to reach the fourth.

        Controlled, because "View all invoices" in the Overview has to move the reader to the
        Invoices tab. A link that scrolled instead would leave the tab strip lying about where
        they are.
      */}
      <Tabs value={tab} onValueChange={setTab}>
        {/*
          The strip scrolls on a phone instead of setting the page width. Four triggers with
          `whitespace-nowrap` are wider than 375px, and `TabsList` is inline-flex — without this
          wrapper its content becomes the document's minimum width and every screen below it is
          clipped at the right edge. That exact failure shipped once already, from the mobile
          header's notification label.
        */}
        <div className="-mx-1 overflow-x-auto px-1">
          <TabsList className="w-max min-w-full">
            <TabsTrigger value="overview"><FileText className="h-4 w-4" /> Overview</TabsTrigger>
            <TabsTrigger value="plans"><Package className="h-4 w-4" /> Plans</TabsTrigger>
            <TabsTrigger value="invoices"><Receipt className="h-4 w-4" /> Invoices</TabsTrigger>
            <TabsTrigger value="details"><BookUser className="h-4 w-4" /> Billing details</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="overview" className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="space-y-4 lg:col-span-2">
            <Card className="lg:col-span-1">
              <CardHeader className="pb-3">
                <CardTitle className="text-body">Current plan</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-2">
                  <span className="text-h3 font-semibold">{entitlements.planName}</span>
                  <Badge
                    variant="outline"
                    className={cn('text-caption', onFree
                      ? 'border-ink-300 bg-surface-0 text-ink-700'
                      : 'border-success/30 bg-success/10 text-success')}
                  >
                    {entitlements.status}
                  </Badge>
                </div>

                {subscription?.currentPeriodEnd && (
                  <p className="text-caption text-muted-foreground">
                    {subscription.cancelledAt ? 'Access until ' : 'Renews on '}
                    {formatDateTime(subscription.currentPeriodEnd)}
                  </p>
                )}
                {subscription?.pendingChange && (
                  <div className="rounded-md border border-accent-100 bg-accent-100 p-2">
                    <p className="text-caption leading-snug text-accent-700">
                      Changing to <strong>{subscription.pendingChange.plan}</strong>{' '}
                      ({subscription.pendingChange.interval.toLowerCase()}) on{' '}
                      {formatDateTime(subscription.pendingChange.effectiveAt)}. You keep your current
                      plan until then.
                    </p>
                    {manage && (
                      <button
                        className="mt-1 text-caption font-medium text-accent-700 underline"
                        onClick={() => cancelScheduled.mutate()}
                      >
                        Cancel this change
                      </button>
                    )}
                  </div>
                )}

                {subscription?.assignedNote && (
                  <p className="flex items-start gap-1 text-caption text-muted-foreground">
                    <ShieldCheck className="mt-px h-3 w-3 shrink-0" />
                    {subscription.assignedNote}
                  </p>
                )}

                <div className="space-y-2 border-t pt-3">
                  <UsageBar label="AI interactions this month" used={usage.used} limit={usage.limit} />
                  <UsageBar label="Team members" used={consumption.teamMembers} limit={entitlements.teamMembers} />
                  <UsageBar label="WhatsApp numbers" used={consumption.whatsappNumbers} limit={entitlements.whatsappNumbers} />
                  <UsageBar label="Active automations" used={consumption.activeAutomations} limit={entitlements.activeAutomations} />
                </div>

                {usage.overQuota && !onFree && (
                  <div className={cn('rounded-md p-2',
                    usage.capReached ? 'bg-danger/10' : 'bg-warning/15')}
                  >
                    <p className={cn('text-caption leading-snug',
                      usage.capReached ? 'text-danger' : 'text-ink-900')}
                    >
                      {usage.capReached ? (
                        <>
                          You have reached your spend limit of{' '}
                          {formatRupees(usage.overageCapPaise)} for this period, so the assistant has
                          stopped using AI. Customers still get answered by your keyword rules and
                          fallback message. Raise the limit to turn AI back on.
                        </>
                      ) : (
                        <>
                          Past your included quota. Further AI is charged at{' '}
                          {formatRupees(usage.overageRatePaise, { decimals: true })} per interaction —{' '}
                          <strong>
                            {usage.overageInteractions.toLocaleString('en-IN')} so far,{' '}
                            {formatRupees(usage.overagePaise, { decimals: true })}
                          </strong>
                          , added to your next invoice.
                        </>
                      )}
                    </p>
                  </div>
                )}

                {usage.overQuota && onFree && (
                  <p className="rounded-md bg-warning/15 p-2 text-caption leading-snug text-ink-900">
                    You have used the free allowance for this period. Choose a plan to keep the
                    assistant answering with AI.
                  </p>
                )}

                {/*
                  The spend limit. A cap is what makes usage billing safe to switch
                  on — without one, a loop or a viral week becomes a bill nobody
                  agreed to.
                */}
                {manage && !onFree && (
                  <div className="border-t pt-3">
                    <div className="flex items-baseline justify-between">
                      <span className="text-caption font-medium">AI spend limit</span>
                      <span className="text-caption text-muted-foreground">
                        per billing month
                      </span>
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <div className="relative flex-1">
                        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-caption text-muted-foreground">₹</span>
                        <input
                          type="number"
                          min={0}
                          step={100}
                          defaultValue={Math.round(usage.overageCapPaise / 100)}
                          onBlur={(e) => {
                            const rupees = Number(e.target.value);
                            if (!Number.isFinite(rupees) || rupees < 0) return;
                            const paise = Math.round(rupees) * 100;
                            if (paise !== usage.overageCapPaise) setCap.mutate(paise);
                          }}
                          className="h-7 w-full rounded-md border bg-background pl-4 pr-2 text-caption tabular-nums"
                        />
                      </div>
                      <button
                        className="text-caption text-muted-foreground underline"
                        onClick={() => setCap.mutate(null)}
                      >
                        Reset
                      </button>
                    </div>
                    <p className="mt-1 text-caption leading-snug text-muted-foreground">
                      Set to ₹0 to never spend beyond your plan — the assistant stops using AI at the
                      quota instead.
                    </p>
                  </div>
                )}

                <p className="text-caption text-muted-foreground">
                  Counted {formatDateTime(usage.periodStart)} – {formatDateTime(usage.periodEnd)}.
                </p>

                {manage && subscription && !subscription.cancelledAt && !onFree && (
                  <Button
                    variant="outline" size="sm" className="w-full text-caption"
                    disabled={cancel.isPending}
                    onClick={() => cancel.mutate()}
                  >
                    {cancel.isPending && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                    Cancel at period end
                  </Button>
                )}
              </CardContent>
            </Card>
            </div>

            <div className="space-y-4">
              <BillingSummary
                catalogue={catalogue.data}
                subscription={subscription}
                entitlements={entitlements}
                onChangePlan={() => setTab('plans')}
                canManage={manage}
              />
              <NeedHelp />
            </div>
          </div>

          {/* The three most recent, with the rest a tab away. */}
          <RecentInvoices invoices={invoices} onViewAll={() => setTab('invoices')} />
        </TabsContent>

        <TabsContent value="plans" className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-h3 font-semibold">
                {onFree ? 'Choose a plan' : 'Change plan'}
              </h2>
              <IntervalSwitch catalogue={catalogue.data} value={interval} onChange={setInterval} />
            </div>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {catalogue.data.plans.map((plan) => (
                <PlanCard
                  key={plan.code}
                  plan={plan}
                  interval={interval}
                  catalogue={catalogue.data!}
                  currentPlan={entitlements.plan}
                  busy={choosing === plan.code}
                  currentInterval={subscription?.interval ?? null}
                  pendingPlan={subscription?.pendingChange ?? null}
                  onChoose={manage ? (code, chosen) => choosePlan(code, chosen) : undefined}
                  onContactSales={() => {
                    window.location.href = 'mailto:sales@zunopilot.com?subject=Enterprise%20plan';
                  }}
                />
              ))}
            </div>

            <Disclosures catalogue={catalogue.data} />

            {!manage && (
              <p className="text-caption text-muted-foreground">
                Only an owner can change the plan.
              </p>
            )}
        </TabsContent>

        <TabsContent value="invoices">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-body">Invoices</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {invoices.length === 0 ? (
                  <p className="px-6 pb-6 text-sm text-muted-foreground">No invoices yet.</p>
                ) : (
                  <table className="table-stack w-full text-sm">
                    <thead className="border-y bg-muted/40 text-left text-caption uppercase tracking-wide text-muted-foreground">
                      <tr>
                        <th className="px-4 py-2 font-medium">Invoice</th>
                        <th className="px-4 py-2 font-medium">Plan</th>
                        <th className="px-4 py-2 font-medium">Period</th>
                        <th className="px-4 py-2 text-right font-medium">Amount</th>
                        <th className="px-4 py-2" />
                      </tr>
                    </thead>
                    <tbody>
                      {invoices.map((invoice) => (
                        <tr key={invoice.id} className="border-b last:border-0">
                          <td data-label="Invoice" className="px-4 py-2 font-mono text-caption">{invoice.number}</td>
                          <td data-label="Plan" className="px-4 py-2">
                            {invoice.planName}
                            <span className="text-muted-foreground"> · {invoice.intervalLabel}</span>
                          </td>
                          <td data-label="Period" className="px-4 py-2 text-caption text-muted-foreground">
                            {formatDateTime(invoice.periodStart)} – {formatDateTime(invoice.periodEnd)}
                          </td>
                          <td data-label="Amount" className="px-4 py-2 text-right tabular-nums">
                            {formatRupees(invoice.totalPaise, { decimals: true })}
                          </td>
                          <td className="px-4 py-2 text-right">
                            <a
                              href={`/invoices/${invoice.id}`}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 text-caption text-accent-600 hover:underline"
                            >
                              View <ExternalLink className="h-3 w-3" />
                            </a>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>
        </TabsContent>

        <TabsContent value="details" className="space-y-4">
          <TaxDetails canManage={manage} />
          <SupportAccess />
        </TabsContent>
      </Tabs>

      {/*
        The address step. Page level, outside the tabs, because it is one dialog whose subject is
        `pendingChoice` — and choosing a plan on the Plans tab must not unmount it.
      */}
      <BillingIdentityDialog
        open={pendingChoice !== null}
        onOpenChange={(next) => { if (!next) setPendingChoice(null); }}
        canManage={manage}
        onComplete={() => {
          const resume = pendingChoice;
          setPendingChoice(null);
          // Straight on to payment. Saving the address was a step in buying something, not an
          // errand — sending them back to the grid to find the plan again would make it one.
          if (resume) startChange(resume.plan, resume.interval);
        }}
      />
    </div>
  );
}
