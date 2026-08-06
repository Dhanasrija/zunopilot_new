import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { usePermissions } from '@/lib/permissions';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { formatDateTime } from '@/lib/utils';
import { Eye, ShieldAlert, ShieldCheck } from 'lucide-react';

// Support access — the customer's side.
//
// This is the half that makes impersonation defensible, so it lives in the
// product rather than in an admin tool: the workspace sees who asked, why, for
// how long, what was actually looked at, and can end it mid-session.
//
// An audit trail only the watcher can read is not accountability.

interface Grant {
  id: string;
  status: 'PENDING' | 'APPROVED' | 'DENIED' | 'REVOKED' | 'EXPIRED';
  reason: string;
  requestedAt: string;
  requestExpiresAt: string;
  respondedAt: string | null;
  approvedUntil: string | null;
  revokedAt: string | null;
  revokedBySelf: boolean;
  startedAt: string | null;
  lastUsedAt: string | null;
  requestCount: number;
  active: boolean;
  requestedBy: { name: string; email: string } | null;
  respondedBy: string | null;
  viewAs: { name: string; email: string } | null;
}

interface Response {
  grants: Grant[];
  maxWindowHours: number;
  defaultWindowHours: number;
}

const STATUS_TONE: Record<Grant['status'], string> = {
  PENDING: 'border-warning/40 bg-warning/15 text-ink-900',
  APPROVED: 'border-accent-100 bg-accent-100 text-accent-700',
  DENIED: 'border-ink-300 bg-surface-0 text-ink-700',
  REVOKED: 'border-ink-300 bg-surface-0 text-ink-700',
  EXPIRED: 'border-ink-300 bg-surface-0 text-ink-700',
};

function AccessLog({ grantId }: { grantId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['support-access', grantId, 'log'],
    queryFn: () => api.get<{
      data: {
        requestCount: number;
        complete: boolean;
        entries: Array<{ method: string; path: string; at: string }>;
      };
    }>(`/support-access/${grantId}/log`).then((r) => r.data.data),
  });

  if (isLoading) return <p className="mt-2 text-caption text-muted-foreground">Loading…</p>;
  if (!data?.entries.length) {
    return <p className="mt-2 text-caption text-muted-foreground">Nothing was opened.</p>;
  }

  return (
    <div className="mt-2 max-h-52 overflow-y-auto rounded-lg border bg-surface-0">
      {data.entries.map((entry, index) => (
        <div key={index} className="flex gap-2 border-b px-2 py-1 text-caption last:border-0">
          <span className="w-32 shrink-0 text-muted-foreground">{formatDateTime(entry.at)}</span>
          <code className="truncate">{entry.path}</code>
        </div>
      ))}
      {!data.complete && (
        <p className="px-2 py-1 text-caption text-muted-foreground">
          {data.requestCount} requests were made in total; this list is best-effort and may be
          shorter.
        </p>
      )}
    </div>
  );
}

export default function SupportAccess() {
  const qc = useQueryClient();
  const { can } = usePermissions();
  const [hours, setHours] = useState('1');
  const [openLog, setOpenLog] = useState<string | null>(null);

  const { data } = useQuery({
    queryKey: ['support-access'],
    queryFn: () => api.get<{ data: Response }>('/support-access').then((r) => r.data.data),
    // A live session is something an owner should see appear without reloading.
    refetchInterval: 60_000,
  });

  const act = useMutation({
    mutationFn: ({ grantId, action, body }: {
      grantId: string; action: 'approve' | 'deny' | 'revoke'; body?: Record<string, unknown>;
    }) => api.post(`/support-access/${grantId}/${action}`, body ?? {}),
    onSuccess: (_r, { action }) => {
      toast.success({
        approve: 'Support access approved.',
        deny: 'Request denied.',
        revoke: 'Support access ended.',
      }[action]);
      qc.invalidateQueries({ queryKey: ['support-access'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const grants = data?.grants ?? [];
  const pending = grants.filter((g) => g.status === 'PENDING');
  const active = grants.filter((g) => g.active);
  const history = grants.filter((g) => g.status !== 'PENDING' && !g.active);

  // Nothing has ever been requested, so there is nothing to explain yet. An empty
  // card about a capability nobody has used is just noise on the billing page.
  if (grants.length === 0) return null;

  const manage = can('impersonation:manage');

  return (
    <Card className={active.length ? 'border-accent-100' : pending.length ? 'border-warning/40' : undefined}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-body">
          {active.length ? <Eye className="h-4 w-4 text-accent-600" /> : <ShieldCheck className="h-4 w-4" />}
          Support access
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-caption leading-snug text-muted-foreground">
          ZunoPilot support can only view your workspace if you approve it, for as long as you choose,
          and <strong>never with the ability to change anything</strong>. You can end a session at any
          time, and everything they open is listed here.
        </p>

        {active.map((grant) => (
          <div key={grant.id} className="rounded-lg border border-accent-100 bg-accent-100 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Eye className="h-3.5 w-3.5 text-accent-600" />
              <span className="text-caption font-semibold text-accent-700">
                {grant.requestedBy?.name ?? 'Support'} is viewing your workspace now
              </span>
              <Badge variant="outline" className="border-accent-100 bg-surface-1 text-caption text-accent-700">
                read-only
              </Badge>
            </div>
            <p className="mt-1 text-caption text-accent-700">
              Until {grant.approvedUntil ? formatDateTime(grant.approvedUntil) : 'further notice'} · {grant.requestCount} page
              {grant.requestCount === 1 ? '' : 's'} opened
              {grant.viewAs ? ` · seeing what ${grant.viewAs.name} sees` : ''}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {manage && (
                <Button
                  size="sm" variant="outline" className="h-7 border-accent-100 bg-surface-1 text-caption"
                  disabled={act.isPending}
                  onClick={() => act.mutate({ grantId: grant.id, action: 'revoke' })}
                >
                  End now
                </Button>
              )}
              <Button
                size="sm" variant="ghost" className="h-7 text-caption"
                onClick={() => setOpenLog(openLog === grant.id ? null : grant.id)}
              >
                {openLog === grant.id ? 'Hide' : 'See what they opened'}
              </Button>
            </div>
            {openLog === grant.id && <AccessLog grantId={grant.id} />}
          </div>
        ))}

        {pending.map((grant) => (
          <div key={grant.id} className="rounded-lg border border-warning/40 bg-warning/15 p-3">
            <div className="flex items-start gap-2">
              <ShieldAlert className="mt-px h-4 w-4 shrink-0 text-ink-900" />
              <div className="min-w-0">
                <p className="text-caption font-semibold text-ink-900">
                  {grant.requestedBy?.name ?? 'Support'} is asking to view your workspace
                </p>
                <p className="mt-px text-caption text-ink-900">{grant.requestedBy?.email}</p>
                {/* Shown verbatim. Consent to a paraphrase is not consent. */}
                <blockquote className="mt-1 border-l-2 border-warning/40 pl-2 text-caption italic text-ink-900">
                  {grant.reason}
                </blockquote>
                <p className="mt-1 text-caption text-ink-900">
                  Requested {formatDateTime(grant.requestedAt)} · lapses on its own if you do nothing,
                  by {formatDateTime(grant.requestExpiresAt)}
                </p>
              </div>
            </div>

            {manage ? (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Select value={hours} onValueChange={setHours}>
                  <SelectTrigger className="h-7 w-28 bg-surface-1 text-caption"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: data?.maxWindowHours ?? 8 }, (_, i) => i + 1).map((h) => (
                      <SelectItem key={h} value={String(h)}>{h} hour{h === 1 ? '' : 's'}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  size="sm" className="h-7 text-caption"
                  disabled={act.isPending}
                  onClick={() => act.mutate({
                    grantId: grant.id, action: 'approve', body: { hours: Number(hours) },
                  })}
                >
                  Allow read-only access
                </Button>
                <Button
                  size="sm" variant="outline" className="h-7 bg-surface-1 text-caption"
                  disabled={act.isPending}
                  onClick={() => act.mutate({ grantId: grant.id, action: 'deny' })}
                >
                  Decline
                </Button>
              </div>
            ) : (
              <p className="mt-2 text-caption text-ink-900">
                Only an owner can answer this.
              </p>
            )}
          </div>
        ))}

        {history.length > 0 && (
          <div className="space-y-1 border-t pt-3">
            <p className="text-caption font-medium text-muted-foreground">Past requests</p>
            {history.slice(0, 8).map((grant) => (
              <div key={grant.id} className="rounded-lg border p-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className={`text-caption ${STATUS_TONE[grant.status]}`}>
                    {grant.status === 'REVOKED' && grant.revokedBySelf
                      ? 'ended by support'
                      : grant.status.toLowerCase()}
                  </Badge>
                  <span className="text-caption text-muted-foreground">
                    {grant.requestedBy?.name ?? 'Support'} · {formatDateTime(grant.requestedAt)}
                    {grant.requestCount > 0 && ` · ${grant.requestCount} pages opened`}
                  </span>
                  {grant.requestCount > 0 && (
                    <button
                      className="text-caption text-accent-700 underline"
                      onClick={() => setOpenLog(openLog === grant.id ? null : grant.id)}
                    >
                      {openLog === grant.id ? 'hide' : 'details'}
                    </button>
                  )}
                </div>
                {openLog === grant.id && <AccessLog grantId={grant.id} />}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
