import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Clock, Eye, ShieldAlert } from 'lucide-react';
import { sa, when } from '../lib/api';
import { Badge, Button, Card, CardHeader, Empty, Input } from './ui';

// Requesting support access, from the operator's side.
//
// There is no approve button here, and that absence is the feature. The console
// can ask, watch, and end early — the workspace decides. A "grant" action on this
// screen, however well-guarded, would be the one that gets used when someone is in
// a hurry, and the consent model would become decoration.

const CUSTOMER_APP = import.meta.env.VITE_CUSTOMER_APP_URL || 'http://localhost:5173';

export default function SupportAccessPanel({ tenantId }: { tenantId: string }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['impersonation', tenantId],
    queryFn: () => sa.impersonation.list(tenantId),
    // A pending request becomes usable the moment the customer answers.
    refetchInterval: 20_000,
  });

  const ask = useMutation({
    mutationFn: () => sa.impersonation.request(tenantId, reason.trim()),
    onSuccess: () => {
      toast.success('Requested. The workspace owner has to approve it.');
      setReason('');
      qc.invalidateQueries({ queryKey: ['impersonation', tenantId] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const start = useMutation({
    mutationFn: (grantId: string) => sa.impersonation.token(tenantId, grantId),
    onSuccess: (result) => {
      // Handed over by opening the customer app with the token, rather than
      // rendering their dashboard inside this console: the point is to see exactly
      // what they see, in the app they are describing.
      const url = `${CUSTOMER_APP}/support-session#token=${encodeURIComponent(result.token)}`;
      window.open(url, '_blank', 'noopener');
      toast.success(`Read-only session open. Token expires ${when(result.tokenExpiresAt)}.`);
      qc.invalidateQueries({ queryKey: ['impersonation', tenantId] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const end = useMutation({
    mutationFn: (grantId: string) => sa.impersonation.end(tenantId, grantId),
    onSuccess: () => {
      toast.success('Session ended.');
      qc.invalidateQueries({ queryKey: ['impersonation', tenantId] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const grants = data ?? [];
  const open = grants.find((g) => g.status === 'PENDING' || g.active);
  const tooShort = reason.trim().length < 15;

  return (
    <Card>
      <CardHeader
        title={<span className="flex items-center gap-2"><Eye className="h-4 w-4" /> Support access</span>}
        hint="You can ask to view this workspace read-only. Only an owner there can allow it."
      />
      <div className="space-y-3 p-4">
        {!open && (
          <div className="space-y-2">
            <Input
              value={reason}
              onChange={setReason}
              placeholder="Why you need to look — shown to the owner word for word"
            />
            <div className="flex items-center gap-2">
              <Button disabled={tooShort || ask.isPending} onClick={() => ask.mutate()}>
                {ask.isPending ? 'Requesting…' : 'Request access'}
              </Button>
              {tooShort && reason.length > 0 && (
                <span className="text-[11px] text-slate-500">
                  Say what you are investigating — "debugging" is not something anyone can consent to.
                </span>
              )}
            </div>
          </div>
        )}

        {isLoading && <Empty>Loading…</Empty>}

        {grants.slice(0, 6).map((grant) => (
          <div
            key={grant.id}
            className={`rounded-lg border p-3 ${
              grant.active ? 'border-blue-200 bg-blue-50'
                : grant.status === 'PENDING' ? 'border-amber-200 bg-amber-50' : 'border-slate-200'
            }`}
          >
            <div className="flex flex-wrap items-center gap-2">
              {grant.status === 'PENDING' && <Clock className="h-3.5 w-3.5 text-amber-600" />}
              {grant.active && <Eye className="h-3.5 w-3.5 text-blue-600" />}
              <Badge
                tone={grant.active ? 'blue' : grant.status === 'PENDING' ? 'amber' : 'slate'}
              >
                {grant.active ? 'active' : grant.status.toLowerCase()}
              </Badge>
              <span className="text-[11px] text-slate-500">
                asked {when(grant.requestedAt)}
                {grant.requestCount > 0 && ` · ${grant.requestCount} pages opened`}
              </span>
            </div>

            <p className="mt-1 text-xs italic text-slate-600">“{grant.reason}”</p>

            {grant.status === 'PENDING' && (
              <p className="mt-1.5 flex items-start gap-1.5 text-[11px] text-amber-900">
                <ShieldAlert className="mt-0.5 h-3 w-3 shrink-0" />
                Waiting for an owner to approve. Lapses on its own by{' '}
                {when(grant.requestExpiresAt)} — there is no way to approve it from here.
              </p>
            )}

            {grant.active && (
              <>
                <p className="mt-1 text-[11px] text-blue-900">
                  Read-only until {when(grant.approvedUntil)}
                  {grant.viewAs && ` · viewing as ${grant.viewAs.name}`}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button disabled={start.isPending} onClick={() => start.mutate(grant.id)}>
                    {grant.startedAt ? 'Open again' : 'Open their dashboard'}
                  </Button>
                  <Button variant="outline" disabled={end.isPending} onClick={() => end.mutate(grant.id)}>
                    End session
                  </Button>
                </div>
              </>
            )}

            {grant.status === 'DENIED' && (
              <p className="mt-1 text-[11px] text-slate-500">
                Declined by {grant.respondedBy ?? 'the workspace'}.
              </p>
            )}
            {grant.status === 'REVOKED' && (
              <p className="mt-1 text-[11px] text-slate-500">
                Ended {grant.revokedBySelf ? 'by you' : 'by the workspace'} · {when(grant.revokedAt)}
              </p>
            )}
          </div>
        ))}

        {grants.length === 0 && !isLoading && (
          <p className="text-[11px] text-slate-500">No access has ever been requested for this workspace.</p>
        )}
      </div>
    </Card>
  );
}
