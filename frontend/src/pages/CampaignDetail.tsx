import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ArrowLeft, Users } from 'lucide-react';
import { formatDateTime } from '@/lib/utils';

// One campaign: what was sent, to whom, and what happened to each.

interface Detail {
  campaign: {
    id: string; name: string; status: string; error: string | null;
    startedAt: string | null; completedAt: string | null; createdAt: string;
    template: { name: string; metaTemplate: string; bodyPreview: string; status: string };
    createdBy: { fullName: string } | null;
  };
  progress: { total: number; counts: Record<string, number> };
  audience: { reachable: number; excludedNoConsent: number };
}

interface Recipient {
  id: string; status: string; error: string | null; sentAt: string | null;
  customer: { id: string; name: string | null; waId: string };
}

const RECIPIENT_LABEL: Record<string, string> = {
  PENDING: 'Waiting',
  SENT: 'Sent',
  DELIVERED: 'Delivered',
  READ: 'Read',
  FAILED: 'Failed',
  SKIPPED_OPTED_OUT: 'Skipped — opted out',
};

const RECIPIENT_TONE: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  PENDING: 'outline',
  SENT: 'secondary',
  DELIVERED: 'secondary',
  READ: 'default',
  FAILED: 'destructive',
  SKIPPED_OPTED_OUT: 'outline',
};

export default function CampaignDetail() {
  const { campaignId = '' } = useParams();

  const { data, isLoading } = useQuery({
    queryKey: ['campaign', campaignId],
    queryFn: async () => (await api.get<{ data: Detail }>(`/campaigns/${campaignId}`)).data.data,
    enabled: Boolean(campaignId),
    refetchInterval: (query) => (query.state.data?.campaign.status === 'SENDING' ? 5_000 : false),
  });

  const recipients = useQuery({
    queryKey: ['campaign-recipients', campaignId],
    queryFn: async () => (await api.get<{ data: Recipient[] }>(
      `/campaigns/${campaignId}/recipients`)).data.data,
    enabled: Boolean(campaignId),
    refetchInterval: (query) => ((query.state.data ?? []).some((r) => r.status === 'PENDING') ? 5_000 : false),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!data) return <p className="text-sm text-muted-foreground">Campaign not found.</p>;

  const { campaign, progress, audience } = data;

  return (
    <div className="space-y-4">
      <Link to="/campaigns" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to campaigns
      </Link>

      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-h2 font-semibold tracking-tight">{campaign.name}</h1>
          <Badge>{campaign.status.charAt(0) + campaign.status.slice(1).toLowerCase()}</Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          {campaign.template.name}
          {campaign.createdBy ? ` · created by ${campaign.createdBy.fullName}` : ''}
        </p>
      </div>

      {campaign.error && (
        <Card className="border-danger/30 bg-danger/10">
          <CardContent className="py-3 text-sm text-danger">{campaign.error}</CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3"><CardTitle className="text-body">Delivery</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {([
                ['Recipients', progress.total],
                ['Sent', progress.counts.SENT ?? 0],
                // Named plainly rather than folded into "failed": a refusal
                // honoured is not an error, and nobody should try to retry it.
                ['Opted out mid-send', progress.counts.SKIPPED_OPTED_OUT ?? 0],
                ['Failed', progress.counts.FAILED ?? 0],
              ] as Array<[string, number]>).map(([label, value]) => (
                <div key={label}>
                  <div className="text-h2 font-semibold">{value}</div>
                  <div className="text-caption text-muted-foreground">{label}</div>
                </div>
              ))}
            </div>
            {progress.counts.PENDING ? (
              <p className="mt-3 text-caption text-muted-foreground">
                {progress.counts.PENDING} still to go. Sending is paced deliberately so a
                campaign never competes with live customer messages.
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-body">Audience today</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="flex items-center gap-1">
              <Users className="h-4 w-4" /> {audience.reachable} reachable
            </p>
            <p className="text-caption text-muted-foreground">
              {audience.excludedNoConsent} excluded for consent. The list this campaign
              sends to was frozen when it started, so these numbers can differ.
            </p>
            <dl className="space-y-1 border-t pt-2 text-caption">
              {([
                ['Started', campaign.startedAt ? formatDateTime(campaign.startedAt) : 'Not yet'],
                ['Finished', campaign.completedAt ? formatDateTime(campaign.completedAt) : '—'],
                ['Template', campaign.template.metaTemplate],
              ] as Array<[string, string]>).map(([label, value]) => (
                <div key={label} className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="text-right">{value}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-body">Recipients</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {(recipients.data ?? []).length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">
              Nobody yet — the audience is frozen when the campaign starts.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Customer</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Sent</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(recipients.data ?? []).map((recipient) => (
                    <TableRow key={recipient.id}>
                      <TableCell className="text-sm">
                        {recipient.customer.name ?? `+${recipient.customer.waId}`}
                      </TableCell>
                      <TableCell>
                        <Badge variant={RECIPIENT_TONE[recipient.status] ?? 'outline'}>
                          {RECIPIENT_LABEL[recipient.status] ?? recipient.status}
                        </Badge>
                        {recipient.error && (
                          <div className="mt-px text-caption text-danger">{recipient.error}</div>
                        )}
                      </TableCell>
                      <TableCell className="text-caption text-muted-foreground">
                        {recipient.sentAt ? formatDateTime(recipient.sentAt) : '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
