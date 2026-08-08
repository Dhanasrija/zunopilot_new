import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Search } from 'lucide-react';
import { sa, day } from '../lib/api';
import { Badge, Card, Empty, Input, Select, Td, Th } from '../components/ui';

export default function Tenants() {
  const [search, setSearch] = useState('');
  const [plan, setPlan] = useState('');
  const [status, setStatus] = useState('');

  // Searched server-side. Filtering a page of 50 in the browser would quietly
  // hide every workspace past the first page.
  const { data, isLoading } = useQuery({
    queryKey: ['tenants', search, plan, status],
    queryFn: () => sa.tenants({
      search: search.trim() || undefined,
      plan: plan || undefined,
      status: status || undefined,
      take: 100,
    }),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Workspaces</h1>
          <p className="text-sm text-slate-500">
            {data ? `${data.total} total` : 'Loading…'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <Input
              value={search}
              onChange={setSearch}
              placeholder="Name, owner email or number…"
              className="w-64 pl-8"
            />
          </div>
          <Select
            value={plan}
            onChange={setPlan}
            options={[
              { value: '', label: 'Any plan' },
              { value: 'NONE', label: 'No plan' },
              { value: 'STARTER', label: 'Starter' },
              { value: 'GROWTH', label: 'Growth' },
              { value: 'BUSINESS', label: 'Business' },
              { value: 'ENTERPRISE', label: 'Enterprise' },
            ]}
          />
          <Select
            value={status}
            onChange={setStatus}
            options={[
              { value: '', label: 'Any status' },
              { value: 'active', label: 'Active' },
              { value: 'suspended', label: 'Suspended' },
            ]}
          />
        </div>
      </div>

      <Card className="overflow-hidden">
        {isLoading ? (
          <Empty>Loading…</Empty>
        ) : !data?.rows.length ? (
          <Empty>No workspaces match that.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[52rem]">
              <thead className="border-b border-slate-100 bg-slate-50/60">
                <tr>
                  <Th>Workspace</Th>
                  <Th>Plan</Th>
                  <Th>WhatsApp</Th>
                  <Th className="text-right">Users</Th>
                  <Th className="text-right">Customers</Th>
                  <Th className="text-right">Orders</Th>
                  <Th>Joined</Th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row) => (
                  <tr key={row.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                    <Td>
                      <Link to={`/tenants/${row.id}`} className="font-medium text-slate-800 hover:text-violet-700 hover:underline">
                        {/*
                          A workspace with no name never finished signing up — the row exists because
                          somebody verified a code. Saying so beats an empty cell.
                        */}
                        {row.businessName || <span className="italic text-slate-400">unnamed</span>}
                      </Link>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                        <span className="text-[11px] text-slate-400">
                          {row.category ?? 'category not set'}
                        </span>
                        {!row.onboardingCompletedAt && <Badge tone="amber">setup unfinished</Badge>}
                        {!row.isActive && <Badge tone="red">suspended</Badge>}
                        {row.gstin && <Badge tone="blue">GST</Badge>}
                      </div>
                    </Td>
                    <Td>
                      {row.plan ? (
                        <>
                          <Badge tone={row.subscriptionStatus === 'MANUAL' ? 'violet' : 'green'}>
                            {row.plan.toLowerCase()}
                          </Badge>
                          <div className="mt-0.5 text-[11px] text-slate-400">
                            {row.interval?.toLowerCase()}
                            {row.periodEnd ? ` · to ${day(row.periodEnd)}` : ''}
                          </div>
                        </>
                      ) : (
                        <Badge>free</Badge>
                      )}
                    </Td>
                    <Td className="text-xs">
                      {row.numbers.length ? row.numbers.join(', ') : <span className="text-slate-400">none</span>}
                    </Td>
                    <Td className="text-right tabular-nums">{row.users}</Td>
                    <Td className="text-right tabular-nums">{row.customers}</Td>
                    <Td className="text-right tabular-nums">{row.orders}</Td>
                    <Td className="text-xs text-slate-500">{day(row.createdAt)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
