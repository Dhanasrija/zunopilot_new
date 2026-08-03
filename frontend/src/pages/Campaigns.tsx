import { useState } from 'react';
import { EmptyState } from '@/components/ui/empty-state';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Megaphone, Send, ShieldCheck, Users } from 'lucide-react';
import { toast } from 'sonner';
import { formatDateTime } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth.store';

// Marketing.
//
// The screen is built around one number the business is not otherwise shown:
// how many of its customers it may *not* message. Seeing "reachable 412" alone
// invites the question "why not everyone" only once it is too late.

type CampaignStatus = 'DRAFT' | 'SCHEDULED' | 'SENDING' | 'SENT' | 'PAUSED' | 'FAILED' | 'CANCELLED';
type TemplateStatus = 'DRAFT' | 'PENDING' | 'APPROVED' | 'REJECTED';

const STATUS_TONE: Record<CampaignStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  DRAFT: 'outline', SCHEDULED: 'secondary', SENDING: 'default', SENT: 'secondary',
  PAUSED: 'secondary', FAILED: 'destructive', CANCELLED: 'outline',
};

interface CampaignTemplate {
  id: string; name: string; metaTemplate: string; language: string;
  category: 'MARKETING' | 'UTILITY'; bodyPreview: string; status: TemplateStatus;
}

interface Campaign {
  id: string; name: string; status: CampaignStatus;
  template: CampaignTemplate;
  startedAt: string | null; completedAt: string | null; createdAt: string;
  error: string | null;
  progress: { total: number; counts: Record<string, number> };
}

interface Consent { total: number; optedIn: number; optedOut: number }

function NewTemplateDialog({ open, onOpenChange, onSaved }: {
  open: boolean; onOpenChange: (v: boolean) => void; onSaved: () => void;
}) {
  const [name, setName] = useState('');
  const [metaTemplate, setMetaTemplate] = useState('');
  const [bodyPreview, setBodyPreview] = useState('');
  const [status, setStatus] = useState<TemplateStatus>('DRAFT');

  const save = useMutation({
    mutationFn: () => api.post('/campaigns/templates', { name, metaTemplate, bodyPreview, status }),
    onSuccess: () => {
      toast.success('Template saved');
      setName(''); setMetaTemplate(''); setBodyPreview(''); setStatus('DRAFT');
      onOpenChange(false);
      onSaved();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Add a template</DialogTitle></DialogHeader>
        <div className="grid gap-3 py-2">
          <div className="grid gap-1">
            <Label htmlFor="tpl-name">Name</Label>
            <Input id="tpl-name" value={name} onChange={(e) => setName(e.target.value)}
              placeholder="Diwali offer" />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="tpl-meta">Approved template name in Meta</Label>
            <Input id="tpl-meta" value={metaTemplate} onChange={(e) => setMetaTemplate(e.target.value)}
              placeholder="diwali_offer_v1" />
            <p className="text-caption text-muted-foreground">
              Exactly as it appears in WhatsApp Manager. This is what goes on the wire.
            </p>
          </div>
          <div className="grid gap-1">
            <Label htmlFor="tpl-body">Preview copy</Label>
            <Textarea id="tpl-body" value={bodyPreview} rows={3}
              onChange={(e) => setBodyPreview(e.target.value)} />
            <p className="text-caption text-muted-foreground">
              Shown on these screens only. Meta renders the approved template, so
              this is a reminder of what it says, not the message itself.
            </p>
          </div>
          <div className="grid gap-1">
            <Label htmlFor="tpl-status">Approval status</Label>
            <select id="tpl-status" value={status}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              onChange={(e) => setStatus(e.target.value as TemplateStatus)}
            >
              {(['DRAFT', 'PENDING', 'APPROVED', 'REJECTED'] as const).map((s) => (
                <option key={s} value={s}>{s.charAt(0) + s.slice(1).toLowerCase()}</option>
              ))}
            </select>
            <p className="text-caption text-muted-foreground">
              Only an approved template can be sent — Meta rejects anything else.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!name.trim() || !metaTemplate.trim() || !bodyPreview.trim() || save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending ? 'Saving…' : 'Save template'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NewCampaignDialog({ templates, open, onOpenChange, onSaved }: {
  templates: CampaignTemplate[];
  open: boolean; onOpenChange: (v: boolean) => void; onSaved: () => void;
}) {
  const [name, setName] = useState('');
  const [templateId, setTemplateId] = useState('');

  // Live, so the reachable and excluded counts are visible before anyone commits.
  const audience = useQuery({
    queryKey: ['audience-preview'],
    queryFn: async () => (await api.post<{ data: { reachable: number; excludedNoConsent: number } }>(
      '/campaigns/audience-preview', {})).data.data,
    enabled: open,
  });

  const save = useMutation({
    mutationFn: () => api.post('/campaigns', { name, templateId }),
    onSuccess: () => {
      toast.success('Campaign created as a draft');
      setName(''); setTemplateId('');
      onOpenChange(false);
      onSaved();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>New campaign</DialogTitle></DialogHeader>
        <div className="grid gap-3 py-2">
          <div className="grid gap-1">
            <Label htmlFor="c-name">Name</Label>
            <Input id="c-name" value={name} onChange={(e) => setName(e.target.value)}
              placeholder="Diwali week" />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="c-template">Template</Label>
            <select id="c-template" value={templateId}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              onChange={(e) => setTemplateId(e.target.value)}
            >
              <option value="">Choose a template…</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}{t.status === 'APPROVED' ? '' : ` (${t.status.toLowerCase()} — cannot send)`}
                </option>
              ))}
            </select>
          </div>

          {audience.data && (
            <div className="rounded-md border bg-muted/40 p-3 text-caption">
              <p className="flex items-center gap-1 font-medium">
                <Users className="h-3.5 w-3.5" />
                {audience.data.reachable} customer{audience.data.reachable === 1 ? '' : 's'} will get this
              </p>
              <p className="mt-1 text-muted-foreground">
                {audience.data.excludedNoConsent} excluded — they have not opted in, or
                they replied STOP. There is no way to include them.
              </p>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!name.trim() || !templateId || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? 'Creating…' : 'Create draft'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function Campaigns() {
  const qc = useQueryClient();
  const permissions = useAuthStore((s) => s.permissions);
  const canWrite = permissions.includes('campaigns:write');
  const canSend = permissions.includes('campaigns:send');

  const [newTemplate, setNewTemplate] = useState(false);
  const [newCampaign, setNewCampaign] = useState(false);

  const campaigns = useQuery({
    queryKey: ['campaigns'],
    queryFn: async () => (await api.get<{ data: Campaign[] }>('/campaigns')).data.data,
    // A sending campaign moves; the list should not need a manual refresh.
    refetchInterval: (query) =>
      (query.state.data ?? []).some((c) => c.status === 'SENDING') ? 5_000 : false,
  });

  const templates = useQuery({
    queryKey: ['campaign-templates'],
    queryFn: async () => (await api.get<{ data: CampaignTemplate[] }>('/campaigns/templates')).data.data,
  });

  const consent = useQuery({
    queryKey: ['campaign-consent'],
    queryFn: async () => (await api.get<{ data: Consent }>('/campaigns/consent')).data.data,
  });

  const start = useMutation({
    mutationFn: (id: string) => api.post(`/campaigns/${id}/start`),
    onSuccess: () => { toast.success('Sending started'); qc.invalidateQueries({ queryKey: ['campaigns'] }); },
    onError: (err: Error) => toast.error(err.message),
  });

  const pause = useMutation({
    mutationFn: (id: string) => api.post(`/campaigns/${id}/pause`),
    onSuccess: () => { toast.success('Paused'); qc.invalidateQueries({ queryKey: ['campaigns'] }); },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-h2 font-semibold tracking-tight">Campaigns</h1>
          <p className="text-sm text-muted-foreground">Offers to customers who opted in.</p>
        </div>
        {canWrite && (
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setNewTemplate(true)}>Add a template</Button>
            <Button onClick={() => setNewCampaign(true)}>
              <Megaphone className="mr-2 h-4 w-4" /> New campaign
            </Button>
          </div>
        )}
      </div>

      {/*
        Consent, stated up front. The opted-out number is the one a business needs
        to see before it plans a send, not after somebody asks why reach is falling.
      */}
      {consent.data && (
        <Card>
          <CardContent className="flex flex-wrap items-center gap-6 py-4">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-success" />
              <div>
                <div className="text-h3 font-semibold">{consent.data.optedIn}</div>
                <div className="text-caption text-muted-foreground">can be messaged</div>
              </div>
            </div>
            <div>
              <div className="text-h3 font-semibold">{consent.data.optedOut}</div>
              <div className="text-caption text-muted-foreground">opted out</div>
            </div>
            <div>
              <div className="text-h3 font-semibold">{consent.data.total}</div>
              <div className="text-caption text-muted-foreground">customers in total</div>
            </div>
            <p className="ml-auto max-w-sm text-caption leading-snug text-muted-foreground">
              Anyone who replies <strong>STOP</strong> is removed immediately and
              cannot be added back except by their own <strong>START</strong>.
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-body">Campaigns</CardTitle></CardHeader>
        <CardContent className="p-0">
          {campaigns.isLoading ? (
            <p className="p-6 text-sm text-muted-foreground">Loading…</p>
          ) : (campaigns.data ?? []).length === 0 ? (
            <EmptyState
              action={canWrite ? (
                <Button
                  variant={(templates.data ?? []).length === 0 ? 'outline' : 'default'}
                  onClick={() => ((templates.data ?? []).length === 0
                    ? setNewTemplate(true)
                    : setNewCampaign(true))}
                >
                  <Megaphone className="mr-2 h-4 w-4" />
                  {(templates.data ?? []).length === 0 ? 'Add a template' : 'New campaign'}
                </Button>
              ) : undefined}
            >
              {(templates.data ?? []).length === 0
                ? 'A campaign sends one approved template to everyone who opted in. Add a template Meta has approved, then build a campaign on it.'
                : 'No campaigns yet. Build one on an approved template and it goes only to customers who opted in.'}
            </EmptyState>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Campaign</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Progress</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="w-32" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(campaigns.data ?? []).map((campaign) => {
                    const { total, counts } = campaign.progress;
                    const done = (counts.SENT ?? 0) + (counts.SKIPPED_OPTED_OUT ?? 0) + (counts.FAILED ?? 0);
                    return (
                      <TableRow key={campaign.id}>
                        <TableCell>
                          <Link to={`/campaigns/${campaign.id}`} className="font-medium hover:underline">
                            {campaign.name}
                          </Link>
                          <div className="text-caption text-muted-foreground">{campaign.template.name}</div>
                        </TableCell>
                        <TableCell>
                          <Badge variant={STATUS_TONE[campaign.status]}>
                            {campaign.status.charAt(0) + campaign.status.slice(1).toLowerCase()}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm">
                          {total === 0 ? <span className="text-muted-foreground">—</span> : (
                            <>
                              {done} / {total}
                              {counts.SKIPPED_OPTED_OUT ? (
                                <div className="text-caption text-ink-900">
                                  {counts.SKIPPED_OPTED_OUT} opted out mid-send
                                </div>
                              ) : null}
                              {counts.FAILED ? (
                                <div className="text-caption text-danger">{counts.FAILED} failed</div>
                              ) : null}
                            </>
                          )}
                        </TableCell>
                        <TableCell className="text-caption text-muted-foreground">
                          {formatDateTime(campaign.createdAt)}
                        </TableCell>
                        <TableCell>
                          {canSend && ['DRAFT', 'SCHEDULED', 'PAUSED'].includes(campaign.status) && (
                            <Button size="sm" disabled={start.isPending}
                              onClick={() => start.mutate(campaign.id)}
                            >
                              <Send className="mr-1 h-3 w-3" /> Send
                            </Button>
                          )}
                          {canSend && campaign.status === 'SENDING' && (
                            <Button size="sm" variant="outline" disabled={pause.isPending}
                              onClick={() => pause.mutate(campaign.id)}
                            >
                              Pause
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-body">Templates ({(templates.data ?? []).length})</CardTitle>
        </CardHeader>
        <CardContent>
          {(templates.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">
              None yet. A campaign can only be sent with a template Meta has approved.
            </p>
          ) : (
            <ul className="divide-y">
              {(templates.data ?? []).map((template) => (
                <li key={template.id} className="flex items-start justify-between gap-4 py-2 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{template.name}</span>
                      <Badge variant={template.status === 'APPROVED' ? 'secondary' : 'outline'}>
                        {template.status.toLowerCase()}
                      </Badge>
                    </div>
                    <p className="mt-px text-caption text-muted-foreground">{template.bodyPreview}</p>
                    <p className="font-mono text-caption text-muted-foreground">{template.metaTemplate}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <NewTemplateDialog
        open={newTemplate}
        onOpenChange={setNewTemplate}
        onSaved={() => qc.invalidateQueries({ queryKey: ['campaign-templates'] })}
      />
      <NewCampaignDialog
        templates={templates.data ?? []}
        open={newCampaign}
        onOpenChange={setNewCampaign}
        onSaved={() => qc.invalidateQueries({ queryKey: ['campaigns'] })}
      />
    </div>
  );
}
