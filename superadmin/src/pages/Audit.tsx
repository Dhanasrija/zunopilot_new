import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { sa, when } from '../lib/api';
import { Badge, Card, Empty, Input, Td, Th } from '../components/ui';

// Who reached in and changed something.
//
// The one thing on this console that is not derivable from the product's own
// rows, which is exactly why it is stored rather than computed.
export default function Audit() {
  const [action, setAction] = useState('');
  const { data, isLoading } = useQuery({
    queryKey: ['audit', action],
    queryFn: () => sa.audit({ action: action.trim() || undefined, take: 200 }),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Audit log</h1>
          <p className="text-sm text-slate-500">
            {data ? `${data.total} recorded actions` : 'Loading…'} · append-only
          </p>
        </div>
        <Input value={action} onChange={setAction} placeholder="Filter by action…" className="w-56" />
      </div>

      <Card className="overflow-hidden">
        {isLoading ? (
          <Empty>Loading…</Empty>
        ) : !data?.rows.length ? (
          <Empty>Nothing recorded yet.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[48rem]">
              <thead className="border-b border-slate-100 bg-slate-50/60">
                <tr>
                  <Th>When</Th><Th>Action</Th><Th>What happened</Th><Th>Workspace</Th><Th>By</Th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row) => (
                  <tr key={row.id} className="border-b border-slate-50 last:border-0">
                    <Td className="whitespace-nowrap text-xs text-slate-500">{when(row.createdAt)}</Td>
                    <Td>
                      <Badge tone={row.action.includes('suspend') ? 'red' : row.action.includes('login') ? 'slate' : 'violet'}>
                        {row.action}
                      </Badge>
                    </Td>
                    <Td>{row.summary}</Td>
                    <Td className="text-xs">
                      {row.tenantId ? (
                        <Link to={`/tenants/${row.tenantId}`} className="text-violet-700 hover:underline">
                          {row.tenantName ?? row.tenantId.slice(0, 8)}
                        </Link>
                      ) : <span className="text-slate-400">—</span>}
                    </Td>
                    <Td className="text-xs text-slate-500">
                      {row.superAdmin?.fullName ?? 'system'}
                      {row.ip && <div className="text-[10px] text-slate-400">{row.ip}</div>}
                    </Td>
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
