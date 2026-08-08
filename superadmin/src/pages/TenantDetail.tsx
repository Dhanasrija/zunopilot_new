import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  ArrowLeft, Ban, Cpu, KeyRound, Plug, RotateCcw, ShieldCheck,
} from 'lucide-react';
import {
  sa, rupees, when, day,
  type ActivityEntry, type LlmChoices, type LlmVendor, type ModuleKey,
} from '../lib/api';
import {
  Badge, Button, Card, CardHeader, Empty, Input, Select, Stat, Td, Th, cn,
} from '../components/ui';
import SupportAccessPanel from '../components/SupportAccessPanel';

// One workspace, on one screen: who is in it, what it has connected, what it has
// been doing, and what it has paid.
//
// The activity timeline is the part worth understanding. It is **derived** from
// the rows the product already keeps — `User.createdAt`, `WhatsappAccount`,
// `RoutingDecision`, `Payment`, `Invoice` — rather than from events emitted since
// logging was added. So it is complete for workspaces that existed long before
// this console did, which is exactly when support needs it.

const TABS = ['Activity', 'Users', 'Billing', 'Setup'] as const;
type Tab = typeof TABS[number];

const KIND_TONE: Record<string, 'slate' | 'green' | 'amber' | 'red' | 'violet' | 'blue'> = {
  'tenant.created': 'violet',
  'user.signup': 'blue',
  'whatsapp.connected': 'green',
  'whatsapp.reconnected': 'amber',
  'message.first': 'blue',
  'automation.triggered': 'slate',
  'workflow.published': 'violet',
  'plan.started': 'green',
  'payment.succeeded': 'green',
  'payment.failed': 'amber',
  'invoice.issued': 'blue',
  'handoff.requested': 'amber',
  'admin.action': 'red',
};

function Timeline({ entries }: { entries: ActivityEntry[] }) {
  const [kind, setKind] = useState('');
  const kinds = [...new Set(entries.map((e) => e.kind))].sort();
  const shown = kind ? entries.filter((e) => e.kind === kind) : entries;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-2.5">
        <Select
          value={kind}
          onChange={setKind}
          options={[
            { value: '', label: `Everything (${entries.length})` },
            ...kinds.map((k) => ({
              value: k,
              label: `${k.replace(/\./g, ' · ')} (${entries.filter((e) => e.kind === k).length})`,
            })),
          ]}
        />
      </div>

      {shown.length === 0 ? (
        <Empty>Nothing recorded.</Empty>
      ) : (
        <ol className="divide-y divide-slate-50">
          {shown.map((entry, index) => (
            <li key={`${entry.at}-${index}`} className="flex gap-3 px-4 py-2.5">
              <div className="w-36 shrink-0 text-[11px] leading-5 text-slate-400">
                {when(entry.at)}
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={KIND_TONE[entry.kind] ?? 'slate'}>{entry.kind.split('.')[0]}</Badge>
                  <span className="text-sm text-slate-800">{entry.title}</span>
                </div>
                {entry.detail && <p className="mt-0.5 text-[11px] text-slate-500">{entry.detail}</p>}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function AssignPlan({ tenantId }: { tenantId: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [plan, setPlan] = useState('BUSINESS');
  const [interval, setInterval] = useState('YEARLY');
  const [months, setMonths] = useState('12');
  const [note, setNote] = useState('');
  const [numberLimit, setNumberLimit] = useState('');

  const assign = useMutation({
    mutationFn: () => sa.assignPlan(tenantId, {
      plan,
      interval,
      months: Number(months) || 12,
      note: note.trim() || undefined,
      ...(numberLimit ? { numberLimit: Number(numberLimit) } : {}),
    }),
    onSuccess: () => {
      toast.success('Plan assigned');
      setOpen(false);
      qc.invalidateQueries({ queryKey: ['tenant', tenantId] });
      qc.invalidateQueries({ queryKey: ['activity', tenantId] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (!open) {
    return <Button variant="outline" onClick={() => setOpen(true)}>Assign a plan</Button>;
  }

  return (
    <div className="space-y-2.5 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <p className="text-xs font-medium text-slate-700">Assign a plan by hand</p>
      <p className="text-[11px] leading-snug text-slate-500">
        Sets an open-ended <strong>MANUAL</strong> subscription, which is how Enterprise and goodwill
        extensions are delivered. It does not touch Razorpay — a hand-assigned plan is not a mandate,
        and creating one would start charging a card that never agreed to it.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        <Select
          value={plan}
          onChange={setPlan}
          options={['STARTER', 'GROWTH', 'BUSINESS', 'ENTERPRISE'].map((p) => ({ value: p, label: p }))}
        />
        <Select
          value={interval}
          onChange={setInterval}
          options={['MONTHLY', 'QUARTERLY', 'YEARLY'].map((i) => ({ value: i, label: i.toLowerCase() }))}
        />
        <Input value={months} onChange={setMonths} placeholder="Months (12)" />
        <Input value={numberLimit} onChange={setNumberLimit} placeholder="WhatsApp number override" />
      </div>
      <Input value={note} onChange={setNote} placeholder="Why — shown on the workspace's billing page" />
      <div className="flex gap-2">
        <Button disabled={assign.isPending} onClick={() => assign.mutate()}>
          {assign.isPending ? 'Assigning…' : 'Assign'}
        </Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </div>
  );
}

const MODULE_COPY: Record<ModuleKey, { label: string; blurb: string }> = {
  MARKETING: {
    label: 'Marketing',
    blurb: 'Campaigns to opted-in customers. Sending spends money on the WhatsApp '
      + 'account and is what puts a number’s quality rating at risk.',
  },
  LEADS: {
    label: 'Leads',
    blurb: 'A pipeline with owners, statuses, reminders and click-to-dial.',
  },
  SUPPORT: {
    label: 'Customer support',
    blurb: 'Tickets raised from conversations, assigned and resolved, with updates '
      + 'sent back to the customer.',
  },
  KEYWORD_RULES: {
    label: 'Keyword replies',
    blurb: 'The workspace’s own FAQ answers — "if the message mentions any of these words, send '
      + 'this reply" — and the same answers used as the AI agent’s knowledge base. On for every '
      + 'workspace by default; switch it off for one whose conversations all run through '
      + 'workflows. Switching it off stops the saved replies going out, it does not delete them, '
      + 'and they answer again the moment you switch it back on. The fallback message — what a '
      + 'customer gets when nothing matched — stays editable either way.',
  },
  ECOMMERCE: {
    label: 'Selling',
    blurb: 'The Orders screen and the Menu / catalogue, and their APIs. On for every workspace '
      + 'by default — switch it off for one that does not sell anything, such as a clinic '
      + 'booking appointments or an academy handling admissions, and both disappear from their '
      + 'nav. Nothing is deleted: past orders and catalogue items are still there if you switch '
      + 'it back on.',
  },
  AI_AGENT: {
    label: 'AI agent',
    blurb: 'The intent router, the AI answer, and AI nodes inside workflows. On for every '
      + 'workspace by default — switch it off to stop this one spending on model calls. '
      + 'Their bot keeps working from keyword rules, order flows and published workflows; '
      + 'only the model is skipped. The workspace cannot turn this back on itself.',
  },
};

/**
 * Which model answers this workspace's customers.
 *
 * An operator's choice rather than the workspace's, for the same reason the modules below are ours:
 * it decides who we pay per message and how long a customer waits, which is our cost and our latency
 * budget. A workspace has no route to this at all.
 *
 * ── What the options actually mean ──────────────────────────────────────────
 *
 * **Platform default** is what every workspace gets unless somebody pins it, and it follows
 * `LLM_VENDOR` on the server — so it changes for everyone at once when that changes, which is the
 * point of leaving a workspace on it.
 *
 * A vendor with no API key on this server is **disabled, not hidden**: an operator looking for Groq
 * and not finding it would reasonably conclude the feature is missing, when the answer is that one
 * environment variable is unset.
 *
 * Generation is not affected. Writing a workflow from a prompt always uses OpenAI — a large node
 * graph against a strict schema is a different job from a two-line reply — and the note below says so
 * rather than leaving somebody to wonder why a Groq workspace's drafts came from a GPT model.
 */
function ModelChoice({ tenantId, llm }: { tenantId: string; llm: LlmChoices }) {
  const qc = useQueryClient();
  const [note, setNote] = useState('');

  const set = useMutation({
    mutationFn: (vendor: LlmVendor | null) =>
      sa.setTenantLlmVendor(tenantId, { vendor, note: note.trim() || undefined }),
    onSuccess: (choices) => {
      toast.success(choices.pinned
        ? `Now answering with ${choices.pinned}. Takes effect on the next message.`
        : 'Back on the platform default model.');
      setNote('');
      qc.invalidateQueries({ queryKey: ['tenant', tenantId] });
      qc.invalidateQueries({ queryKey: ['activity', tenantId] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const platformLabel = llm.platform.model
    ? `Platform default — ${llm.platform.model}`
    : 'Platform default';

  return (
    <Card>
      <CardHeader
        title={<span className="inline-flex items-center gap-2"><Cpu className="h-4 w-4 text-slate-400" />Model</span>}
        hint="Who serves the model for this workspace's replies. Takes effect on the next message."
      />
      <div className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Select
            className="w-72"
            value={llm.pinned ?? ''}
            onChange={(v) => set.mutate(v === '' ? null : (v as LlmVendor))}
            options={[
              { value: '', label: platformLabel },
              ...llm.vendors.map((v) => ({
                value: v.vendor,
                // The model, so the choice is a model and not a brand — and why it is unavailable
                // where it is, because "Groq (no API key on this server)" is a fixable sentence.
                label: v.available
                  ? `${v.vendor} — ${v.model}`
                  : `${v.vendor} (no API key on this server)`,
                disabled: !v.available,
              })),
            ]}
          />
          {set.isPending && <span className="text-[11px] text-slate-500">Saving…</span>}
        </div>

        <ul className="space-y-1 text-[11px] leading-snug text-slate-500">
          {llm.vendors.filter((v) => v.available && v.structuredMode === 'json_object').map((v) => (
            <li key={v.vendor}>
              <strong>{v.vendor}</strong> asks for JSON rather than having it enforced, so the router
              is a little duller on it — a malformed reply is treated as no match, not as an error.
            </li>
          ))}
          <li>
            Writing a workflow from a prompt always uses <strong>{llm.authoringVendor}</strong>,
            whatever is chosen here.
          </li>
        </ul>

        <Input
          value={note}
          onChange={setNote}
          placeholder="Why (optional) — goes on the audit record"
        />
      </div>
    </Card>
  );
}

/**
 * Which modules this workspace has.
 *
 * The only place any of them can be changed — there is no customer-facing
 * route, which is what makes this a rollout control rather than a setting a
 * workspace can help itself to.
 *
 * Turning one off leaves everything behind it intact: the routes stop answering
 * and the menu item disappears, and switching it back on restores the workspace
 * exactly as it was. A rollout switch that deleted a customer's leads would be
 * one nobody could use.
 *
 * Two directions live in this one list. Marketing, Leads and Support are add-ons a workspace
 * does not have until it is granted one. **The AI agent is the opposite**: on everywhere, and
 * switched off here when a workspace is costing more in model calls than it is worth, or has
 * stopped paying. The workspace has its own AI switch in Settings, but it only narrows this
 * one — off here means off there, and they cannot lift it.
 */
function Modules({ tenantId }: { tenantId: string }) {
  const qc = useQueryClient();
  const [note, setNote] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['tenant-modules', tenantId],
    queryFn: () => sa.tenantModules(tenantId),
    enabled: Boolean(tenantId),
  });

  const toggle = useMutation({
    mutationFn: ({ module, enabled }: { module: ModuleKey; enabled: boolean }) =>
      sa.setTenantModule(tenantId, { module, enabled, note: note.trim() || undefined }),
    onSuccess: (setting) => {
      toast.success(`${MODULE_COPY[setting.module].label} ${setting.enabled ? 'enabled' : 'disabled'}`);
      setNote('');
      qc.invalidateQueries({ queryKey: ['tenant-modules', tenantId] });
      qc.invalidateQueries({ queryKey: ['activity', tenantId] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <Card>
      <CardHeader
        title="Modules"
        // Not "off by default" any more: some of these are add-ons a workspace does not have
        // until granted, and others are capabilities it has until taken away. What is true of
        // all of them is who decides, which is the part an operator needs to know.
        hint="Only you can change these. A workspace cannot grant itself one, or restore one you have taken away."
      />
      <div className="space-y-3 p-4">
        {isLoading ? <p className="text-sm text-slate-500">Loading…</p> : (
          <ul className="divide-y divide-slate-100">
            {(data ?? []).map((setting) => (
              <li key={setting.module} className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-slate-800">
                      {MODULE_COPY[setting.module].label}
                    </span>
                    <Badge tone={setting.enabled ? 'green' : 'slate'}>
                      {setting.enabled ? 'on' : 'off'}
                    </Badge>
                  </div>
                  <p className="mt-0.5 text-[11px] leading-snug text-slate-500">
                    {MODULE_COPY[setting.module].blurb}
                  </p>
                  {setting.note && (
                    <p className="mt-1 text-[11px] italic text-slate-400">“{setting.note}”</p>
                  )}
                  {setting.updatedAt && (
                    <p className="mt-0.5 text-[11px] text-slate-400">
                      last changed {when(setting.updatedAt)}
                    </p>
                  )}
                </div>
                <Button
                  variant="outline"
                  disabled={toggle.isPending}
                  onClick={() => toggle.mutate({ module: setting.module, enabled: !setting.enabled })}
                >
                  {setting.enabled ? 'Turn off' : 'Turn on'}
                </Button>
              </li>
            ))}
          </ul>
        )}
        <Input
          value={note}
          onChange={setNote}
          placeholder="Why — recorded on the audit trail with the change"
        />
      </div>
    </Card>
  );
}

export default function TenantDetail() {
  const { tenantId = '' } = useParams();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('Activity');

  const { data, isLoading } = useQuery({
    queryKey: ['tenant', tenantId],
    queryFn: () => sa.tenant(tenantId),
    enabled: Boolean(tenantId),
  });

  const activity = useQuery({
    queryKey: ['activity', tenantId],
    queryFn: () => sa.activity(tenantId),
    enabled: Boolean(tenantId) && tab === 'Activity',
  });

  const setActive = useMutation({
    mutationFn: (isActive: boolean) => sa.setTenantActive(tenantId, isActive),
    onSuccess: (_r, isActive) => {
      toast.success(isActive ? 'Workspace restored' : 'Workspace suspended');
      qc.invalidateQueries({ queryKey: ['tenant', tenantId] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const updateUser = useMutation({
    mutationFn: ({ userId, body }: { userId: string; body: { isActive?: boolean; role?: string } }) =>
      sa.updateUser(userId, body),
    onSuccess: () => {
      toast.success('User updated');
      qc.invalidateQueries({ queryKey: ['tenant', tenantId] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const resetPassword = useMutation({
    mutationFn: (userId: string) => sa.resetPassword(userId),
    // Shown once and never recoverable, so it is deliberately not a toast that
    // disappears after four seconds.
    onSuccess: (result) => window.prompt(
      'Temporary password — shown once, copy it now:',
      result.temporaryPassword,
    ),
    onError: (err: Error) => toast.error(err.message),
  });

  if (isLoading || !data) return <p className="text-sm text-slate-500">Loading…</p>;

  const { tenant, entitlements, invoices, payments, connectors, pricing, llm } = data;
  const counts = tenant._count;
  const { usage } = data;

  return (
    <div className="space-y-4">
      <Link to="/tenants" className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800">
        <ArrowLeft className="h-3 w-3" /> All workspaces
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex flex-wrap items-center gap-2 text-xl font-semibold">
            {tenant.businessName}
            {tenant.isActive ? <Badge tone="green">active</Badge> : <Badge tone="red">suspended</Badge>}
          </h1>
          <p className="mt-0.5 text-xs text-slate-500">
            {tenant.category.replace(/_/g, ' ').toLowerCase()} · joined {day(tenant.createdAt)} ·{' '}
            <span className="font-mono">{tenant.id}</span>
          </p>
        </div>
        {tenant.isActive ? (
          <Button
            variant="danger"
            disabled={setActive.isPending}
            onClick={() => {
              if (window.confirm(
                `Suspend ${tenant.businessName}?\n\nThis is a flag, not a delete — nothing is removed and it can be restored.`,
              )) setActive.mutate(false);
            }}
          >
            <Ban className="h-3.5 w-3.5" /> Suspend
          </Button>
        ) : (
          <Button variant="outline" disabled={setActive.isPending} onClick={() => setActive.mutate(true)}>
            <RotateCcw className="h-3.5 w-3.5" /> Restore
          </Button>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Plan"
          value={(entitlements.planName as string) ?? 'Free'}
          hint={`${String(entitlements.status ?? 'none').toLowerCase()}${pricing.payableTodayPaise ? ` · ${rupees(pricing.payableTodayPaise, true)} payable` : ''}`}
        />
        <Stat
          label="AI this period"
          value={usage.used.toLocaleString('en-IN')}
          hint={usage.limit == null
            ? 'unlimited'
            : `of ${usage.limit.toLocaleString('en-IN')} included${usage.overQuota ? ` · ${rupees(usage.overagePaise, true)} overage` : ''}`}
          tone={usage.capReached ? 'red' : usage.overQuota ? 'amber' : undefined}
        />
        <Stat label="Customers" value={counts.customers} hint={`${counts.conversations} conversations`} />
        <Stat label="Messages" value={counts.messages.toLocaleString('en-IN')} hint={`${counts.orders} orders`} />
      </div>

      <div className="flex gap-1 border-b border-slate-200">
        {TABS.map((name) => (
          <button
            key={name}
            onClick={() => setTab(name)}
            className={cn(
              '-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors',
              tab === name
                ? 'border-violet-600 text-violet-700'
                : 'border-transparent text-slate-500 hover:text-slate-800',
            )}
          >
            {name}
          </button>
        ))}
      </div>

      {tab === 'Activity' && (
        <Card className="overflow-hidden">
          <CardHeader
            title="Activity"
            hint="Derived from the workspace's own records, so it is complete from the day it signed up."
          />
          {activity.isLoading ? <Empty>Loading…</Empty>
            : <Timeline entries={activity.data?.entries ?? []} />}
        </Card>
      )}

      {tab === 'Users' && (
        <Card className="overflow-hidden">
          <CardHeader title={`Users (${tenant.users.length})`} hint="Deactivate, change role, or issue a temporary password." />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[44rem]">
              <thead className="border-b border-slate-100 bg-slate-50/60">
                <tr><Th>Name</Th><Th>Email</Th><Th>Role</Th><Th>Joined</Th><Th className="text-right">Actions</Th></tr>
              </thead>
              <tbody>
                {tenant.users.map((user) => (
                  <tr key={user.id} className="border-b border-slate-50 last:border-0">
                    <Td>
                      <span className="font-medium">{user.fullName}</span>
                      {!user.isActive && <Badge tone="red">deactivated</Badge>}
                      {!user.emailVerified && <span className="ml-1.5"><Badge tone="amber">unverified</Badge></span>}
                    </Td>
                    <Td className="text-xs">{user.email}</Td>
                    <Td>
                      <Select
                        value={user.role}
                        onChange={(role) => updateUser.mutate({ userId: user.id, body: { role } })}
                        options={['OWNER', 'MANAGER', 'AGENT'].map((r) => ({ value: r, label: r.toLowerCase() }))}
                        className="text-xs"
                      />
                    </Td>
                    <Td className="text-xs text-slate-500">{day(user.createdAt)}</Td>
                    <Td>
                      <div className="flex justify-end gap-1.5">
                        <Button
                          variant="outline"
                          onClick={() => {
                            if (window.confirm(`Issue a new temporary password for ${user.email}?\n\nTheir current password stops working immediately.`)) {
                              resetPassword.mutate(user.id);
                            }
                          }}
                        >
                          <KeyRound className="h-3 w-3" /> Password
                        </Button>
                        <Button
                          variant={user.isActive ? 'danger' : 'outline'}
                          onClick={() => updateUser.mutate({
                            userId: user.id, body: { isActive: !user.isActive },
                          })}
                        >
                          {user.isActive ? 'Deactivate' : 'Reactivate'}
                        </Button>
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {tab === 'Billing' && (
        <div className="space-y-4">
          <Card>
            <CardHeader title="Subscription" />
            <div className="space-y-3 p-4">
              <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                {([
                  ['Plan', (entitlements.planName as string) ?? 'Free allowance'],
                  ['Status', String(entitlements.status ?? 'none').toLowerCase()],
                  ['Period', `${day(entitlements.periodStart as string)} – ${day(entitlements.periodEnd as string)}`],
                  ['Seats', `${tenant.users.filter((u) => u.isActive).length} active of ${entitlements.teamMembers ?? '∞'}`],
                  ['WhatsApp numbers', `${tenant.whatsappAccounts.length} of ${entitlements.whatsappNumbers ?? '∞'}`],
                  ['GSTIN', tenant.gstin ?? 'not provided'],
                  ['AI used', `${usage.used.toLocaleString('en-IN')} of ${usage.limit?.toLocaleString('en-IN') ?? '∞'}`],
                  ['Overage accrued', `${rupees(usage.overagePaise, true)} of ${rupees(usage.overageCapPaise)} cap`],
                  ['Payable today', pricing.payableTodayPaise == null ? '—' : rupees(pricing.payableTodayPaise, true)],
                ] as Array<[string, string]>).map(([label, value]) => (
                  <div key={label} className="flex justify-between gap-4 border-b border-slate-50 pb-1.5">
                    <dt className="text-slate-500">{label}</dt>
                    <dd className="text-right font-medium text-slate-800">{value}</dd>
                  </div>
                ))}
              </dl>
              <AssignPlan tenantId={tenantId} />
            </div>
          </Card>

          <Card className="overflow-hidden">
            <CardHeader title={`Invoices (${invoices.length})`} />
            {invoices.length === 0 ? <Empty>No invoices yet.</Empty> : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[46rem]">
                  <thead className="border-b border-slate-100 bg-slate-50/60">
                    <tr>
                      <Th>Number</Th><Th>Plan</Th><Th>Period</Th>
                      <Th className="text-right">Taxable</Th><Th className="text-right">GST</Th>
                      <Th className="text-right">Total</Th><Th>Issued</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoices.map((invoice) => (
                      <tr key={invoice.id} className="border-b border-slate-50 last:border-0">
                        <Td className="font-mono text-xs">{invoice.number}</Td>
                        <Td className="text-xs">{invoice.planName} · {invoice.intervalLabel}</Td>
                        <Td className="text-xs text-slate-500">
                          {day(invoice.periodStart)} – {day(invoice.periodEnd)}
                        </Td>
                        <Td className="text-right tabular-nums">
                          {rupees(invoice.subtotalPaise + invoice.overagePaise, true)}
                        </Td>
                        <Td className="text-right tabular-nums">
                          {invoice.taxPaise > 0 ? rupees(invoice.taxPaise, true)
                            : <span className="text-[11px] text-slate-400">separate</span>}
                        </Td>
                        <Td className="text-right font-medium tabular-nums">{rupees(invoice.totalPaise, true)}</Td>
                        <Td className="text-xs text-slate-500">{day(invoice.issuedAt)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card className="overflow-hidden">
            <CardHeader
              title={`Payments (${payments.length})`}
              hint="A CREATED payment is a checkout that was started and never finished, not a failure."
            />
            {payments.length === 0 ? <Empty>No payments yet.</Empty> : (
              <table className="w-full">
                <thead className="border-b border-slate-100 bg-slate-50/60">
                  <tr>
                    <Th>Status</Th><Th>Plan</Th><Th className="text-right">Amount</Th>
                    <Th>When</Th><Th>Razorpay</Th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((payment) => (
                    <tr key={payment.id} className="border-b border-slate-50 last:border-0">
                      <Td>
                        <Badge tone={payment.status === 'PAID' ? 'green' : payment.status === 'CREATED' ? 'slate' : 'red'}>
                          {payment.status.toLowerCase()}
                        </Badge>
                      </Td>
                      <Td className="text-xs">{payment.plan} · {payment.interval.toLowerCase()}</Td>
                      <Td className="text-right tabular-nums">{rupees(payment.amountPaise, true)}</Td>
                      <Td className="text-xs text-slate-500">{when(payment.paidAt ?? payment.createdAt)}</Td>
                      <Td className="font-mono text-[11px] text-slate-500">
                        {payment.razorpayPaymentId ?? '—'}
                        {payment.failureReason && (
                          <div className="text-[10px] text-red-600">{payment.failureReason}</div>
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </div>
      )}

      {tab === 'Setup' && (
        <div className="space-y-4">
          <ModelChoice tenantId={tenantId} llm={llm} />

          <Modules tenantId={tenantId} />

          <Card className="overflow-hidden">
            <CardHeader
              title={`WhatsApp numbers (${tenant.whatsappAccounts.length})`}
              hint="Access tokens are never read by this console — only whether one is about to expire."
            />
            {tenant.whatsappAccounts.length === 0 ? <Empty>No number connected.</Empty> : (
              <table className="w-full">
                <thead className="border-b border-slate-100 bg-slate-50/60">
                  <tr><Th>Number</Th><Th>Phone number id</Th><Th>WABA</Th><Th>Token expires</Th><Th>Connected</Th></tr>
                </thead>
                <tbody>
                  {tenant.whatsappAccounts.map((channel) => {
                    const expiring = channel.tokenExpiresAt
                      && new Date(channel.tokenExpiresAt).getTime() - Date.now() < 7 * 864e5;
                    return (
                      <tr key={channel.id} className="border-b border-slate-50 last:border-0">
                        <Td className="font-medium">{channel.displayPhone ?? '—'}</Td>
                        <Td className="font-mono text-[11px]">{channel.phoneNumberId}</Td>
                        <Td className="font-mono text-[11px] text-slate-500">{channel.wabaId}</Td>
                        <Td className="text-xs">
                          {channel.tokenExpiresAt
                            ? <span className={expiring ? 'font-medium text-red-600' : 'text-slate-500'}>{day(channel.tokenExpiresAt)}</span>
                            : <span className="text-slate-400">no expiry recorded</span>}
                        </Td>
                        <Td className="text-xs text-slate-500">{day(channel.connectedAt)}</Td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </Card>

          <Card className="overflow-hidden">
            <CardHeader title={`Connectors (${connectors.length})`} />
            {connectors.length === 0 ? <Empty>None registered.</Empty> : (
              <ul className="divide-y divide-slate-50">
                {connectors.map((connector) => (
                  <li key={connector.id} className="flex items-center gap-2 px-4 py-2.5 text-sm">
                    <Plug className="h-3.5 w-3.5 text-slate-400" />
                    <span className="font-medium">{connector.name}</span>
                    <code className="rounded bg-slate-100 px-1.5 text-[11px]">{connector.key}</code>
                    <Badge>{connector.kind}</Badge>
                    {connector.status !== 'ACTIVE' && <Badge tone="red">{connector.status.toLowerCase()}</Badge>}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title="Profile" />
            <dl className="grid gap-x-6 gap-y-2 p-4 text-sm sm:grid-cols-2">
              {([
                ['Contact number', tenant.contactNumber],
                ['Address', tenant.address],
                ['Website', tenant.website],
                ['GST state', tenant.gstStateCode],
                ['Workflows', String(counts.workflows)],
                ['Assistants', String(counts.assistants)],
              ] as Array<[string, string | null]>).map(([label, value]) => (
                <div key={label} className="flex justify-between gap-4 border-b border-slate-50 pb-1.5">
                  <dt className="text-slate-500">{label}</dt>
                  <dd className="text-right text-slate-800">{value || '—'}</dd>
                </div>
              ))}
            </dl>
          </Card>

          <SupportAccessPanel tenantId={tenantId} />

          <div className="flex items-start gap-2 rounded-lg border border-slate-200 bg-white p-3">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
            <p className="text-[11px] leading-snug text-slate-500">
              This console shows no customer message content and no credentials — those endpoints
              simply do not return them. The only way to see a workspace as its owner does is a
              read-only support session they have explicitly approved, above.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
