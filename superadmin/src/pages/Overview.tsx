import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { sa, rupees } from '../lib/api';
import { Badge, Card, CardHeader, Empty, Stat, Td, Th } from '../components/ui';

export default function Overview() {
  const { data, isLoading } = useQuery({ queryKey: ['overview'], queryFn: () => sa.overview() });

  if (isLoading || !data) return <p className="text-sm text-slate-500">Loading…</p>;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Platform overview</h1>
        <p className="text-sm text-slate-500">Every workspace on this deployment.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Workspaces"
          value={data.tenants.total}
          hint={`${data.tenants.active} active${data.tenants.suspended ? ` · ${data.tenants.suspended} suspended` : ''}`}
          tone={data.tenants.suspended > 0 ? 'amber' : undefined}
        />
        <Stat label="Active users" value={data.users} hint={`${data.whatsappNumbers} WhatsApp numbers`} />
        <Stat
          label="Messages · 24h"
          value={data.last24h.messages.toLocaleString('en-IN')}
          hint={`${data.last24h.aiRoutedMessages.toLocaleString('en-IN')} routed by AI`}
        />
        <Stat
          label="Revenue · this month"
          value={rupees(data.revenue.thisMonthPaise)}
          hint={`${data.revenue.thisMonthInvoices} invoice${data.revenue.thisMonthInvoices === 1 ? '' : 's'} · ${rupees(data.revenue.allTimePaise)} all time`}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Published workflows" value={data.publishedWorkflows} />
        <Stat
          label="Open handoffs"
          value={data.openHandoffs}
          hint="Customers waiting for a human"
          tone={data.openHandoffs > 0 ? 'red' : undefined}
        />
        <Stat label="Invoices issued" value={data.revenue.invoiceCount} />
      </div>

      <Card>
        <CardHeader
          title="Subscriptions by plan"
          hint="Read from subscription rows. Revenue above comes from settled invoices instead."
          action={<Link to="/tenants" className="text-xs font-medium text-violet-700 hover:underline">All workspaces →</Link>}
        />
        {data.plans.length === 0 ? (
          <Empty>No paid subscriptions yet.</Empty>
        ) : (
          <table className="w-full">
            <thead className="border-b border-slate-100 bg-slate-50/60">
              <tr><Th>Plan</Th><Th>Status</Th><Th className="text-right">Workspaces</Th></tr>
            </thead>
            <tbody>
              {data.plans.map((row) => (
                <tr key={`${row.plan}-${row.status}`} className="border-b border-slate-50 last:border-0">
                  <Td><span className="font-medium">{row.plan}</span></Td>
                  <Td>
                    <Badge tone={row.status === 'ACTIVE' ? 'green' : row.status === 'MANUAL' ? 'violet' : 'amber'}>
                      {row.status.toLowerCase()}
                    </Badge>
                  </Td>
                  <Td className="text-right tabular-nums">{row.count}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
