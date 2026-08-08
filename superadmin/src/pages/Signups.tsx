import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Info } from 'lucide-react';
import { sa, when, day } from '../lib/api';
import { Badge, Card, CardHeader, Empty, Stat, Td, Th } from '../components/ui';

/*
 * Who tried to sign up, and where they stopped.
 *
 * Three stages, in the order somebody moves through them: asked for a code, verified it, finished the
 * profile. **Two of the three are permanent records and one is a 24-hour window**, and the page says
 * so where it matters rather than in a footnote — a list that looks like all-time history while
 * covering one day would read as "nobody has abandoned signup in months".
 *
 * The middle stage is the one worth acting on. Somebody who verified a code and stopped at the form
 * gave us a working phone number and a moment of intent; they are also the workspaces that show up
 * unnamed in the Workspaces list, which is what made this page necessary.
 */
export default function Signups() {
  const { data, isLoading } = useQuery({
    queryKey: ['signups'],
    queryFn: () => sa.signups(),
  });

  const counts = data?.counts;
  const reached = (counts?.abandonedAtProfile ?? 0) + (counts?.completed ?? 0);
  /** Of the people who verified a code, how many went on to finish. */
  const finishRate = reached > 0
    ? Math.round(((counts?.completed ?? 0) / reached) * 100)
    : null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Signups</h1>
        <p className="text-sm text-slate-500">
          How far people get between asking for a code and having a workspace.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat
          label="Left at the code"
          value={counts?.abandonedAtCode ?? '—'}
          hint={`last ${data?.abandonedWindowHours ?? 24}h only`}
          tone={counts?.abandonedAtCode ? 'amber' : undefined}
        />
        <Stat
          label="Verified, setup unfinished"
          value={counts?.abandonedAtProfile ?? '—'}
          hint="has a working number"
          tone={counts?.abandonedAtProfile ? 'amber' : undefined}
        />
        <Stat
          label="Finished setup"
          value={counts?.completed ?? '—'}
          hint={finishRate === null ? undefined : `${finishRate}% of those who verified`}
        />
      </div>

      <div className="flex items-start gap-2 rounded-lg border border-slate-200 bg-white p-3">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
        <p className="text-xs leading-snug text-slate-600">
          {/*
            The honest limitation, stated once, prominently. The alternative — retaining the phone
            numbers of everyone who typed one and walked away — is a decision about unconsented
            personal data, not a reporting detail, so the page reports what retention already allows.
          */}
          <strong>“Left at the code” only covers the last {data?.abandonedWindowHours ?? 24} hours.</strong>{' '}
          One-time codes are deleted a day after they expire, so somebody who asked for a code last
          week and never used it leaves no record. The other two lists are permanent.
        </p>
      </div>

      {/* ── Verified, never finished ── the one worth acting on ───────────────── */}
      <Card className="overflow-hidden">
        <CardHeader
          title="Verified a code, never finished setup"
          hint="They have an account and a workspace already — it has no business name, category or number yet."
        />
        {isLoading ? <Empty>Loading…</Empty>
          : (data?.abandonedAtProfile.length ?? 0) === 0 ? (
            <Empty>Nobody is stuck at the profile form.</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[44rem]">
                <thead className="border-b border-slate-100 bg-slate-50/60">
                  <tr>
                    <Th>Number</Th><Th>Name given</Th><Th>Email</Th>
                    <Th>Verified</Th><Th>Workspace</Th>
                  </tr>
                </thead>
                <tbody>
                  {data?.abandonedAtProfile.map((row) => (
                    <tr key={row.tenantId} className="border-b border-slate-50 last:border-0">
                      <Td className="font-mono text-xs">
                        {row.owner?.phone ?? <span className="text-slate-400">—</span>}
                        {row.owner?.country && (
                          <span className="ml-1.5 text-[11px] text-slate-400">{row.owner.country}</span>
                        )}
                      </Td>
                      <Td>{row.owner?.fullName || <span className="text-slate-400">—</span>}</Td>
                      <Td className="text-xs text-slate-500">
                        {row.owner?.email || <span className="text-slate-400">—</span>}
                      </Td>
                      <Td className="text-xs text-slate-500">{when(row.verifiedAt)}</Td>
                      <Td>
                        <Link
                          to={`/tenants/${row.tenantId}`}
                          className="text-xs text-violet-700 hover:underline"
                        >
                          {row.businessName || 'unnamed'}
                        </Link>
                        {!row.isActive && <span className="ml-1.5"><Badge tone="red">suspended</Badge></span>}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </Card>

      {/* ── Left at the code ─────────────────────────────────────────────────── */}
      <Card className="overflow-hidden">
        <CardHeader
          title="Asked for a code and never entered it"
          hint={`Last ${data?.abandonedWindowHours ?? 24} hours. Codes are deleted a day after they expire.`}
        />
        {isLoading ? <Empty>Loading…</Empty>
          : (data?.abandonedAtCode.length ?? 0) === 0 ? (
            <Empty>Everyone who asked for a code in the last day used it.</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[40rem]">
                <thead className="border-b border-slate-100 bg-slate-50/60">
                  <tr>
                    <Th>Number</Th>
                    <Th className="text-right">Codes asked for</Th>
                    <Th className="text-right">Wrong entries</Th>
                    <Th>Last asked</Th><Th>IP</Th>
                  </tr>
                </thead>
                <tbody>
                  {data?.abandonedAtCode.map((row) => (
                    <tr key={row.phone} className="border-b border-slate-50 last:border-0">
                      <Td className="font-mono text-xs">{row.phone}</Td>
                      <Td className="text-right tabular-nums">{row.requests}</Td>
                      <Td className="text-right tabular-nums">
                        {/*
                          Wrong entries separate two very different people: one who never opened the
                          SMS, and one who tried and failed — the second is a delivery or usability
                          problem worth chasing.
                        */}
                        {row.wrongCodeAttempts || <span className="text-slate-400">0</span>}
                      </Td>
                      <Td className="text-xs text-slate-500">{when(row.lastRequestedAt)}</Td>
                      <Td className="font-mono text-[11px] text-slate-400">{row.ip ?? '—'}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </Card>

      {/* ── Finished ─────────────────────────────────────────────────────────── */}
      <Card className="overflow-hidden">
        <CardHeader
          title="Finished setup"
          hint="The 50 most recent. The Workspaces page has all of them."
        />
        {isLoading ? <Empty>Loading…</Empty>
          : (data?.completed.length ?? 0) === 0 ? <Empty>No completed signups yet.</Empty> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[40rem]">
                <thead className="border-b border-slate-100 bg-slate-50/60">
                  <tr><Th>Workspace</Th><Th>Category</Th><Th>Verified</Th><Th>Finished</Th></tr>
                </thead>
                <tbody>
                  {data?.completed.map((row) => (
                    <tr key={row.tenantId} className="border-b border-slate-50 last:border-0">
                      <Td>
                        <Link
                          to={`/tenants/${row.tenantId}`}
                          className="font-medium text-slate-800 hover:text-violet-700 hover:underline"
                        >
                          {row.businessName || 'unnamed'}
                        </Link>
                      </Td>
                      <Td className="text-xs text-slate-500">
                        {row.category ?? <span className="text-slate-400">not set</span>}
                      </Td>
                      <Td className="text-xs text-slate-500">{day(row.verifiedAt)}</Td>
                      <Td className="text-xs text-slate-500">
                        {row.completedAt ? when(row.completedAt) : '—'}
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
