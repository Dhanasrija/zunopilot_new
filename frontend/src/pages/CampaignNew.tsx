import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, Megaphone, RefreshCw, ShieldCheck, Users } from 'lucide-react';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { TemplatePreview, type TemplateButton } from '@/components/campaigns/TemplatePreview';
import { useCustomerLists } from '@/lib/customer-lists';
import { needsMedia, type TemplateHeaderFormat } from '@/lib/media';

// Creating a campaign.
//
// A page rather than the dialog it replaced: name, template, a preview of what the customer
// will receive, audience. The preview is the reason this needs a page — a bubble with a
// header, footer and buttons does not fit beside a form in a dialog.
//
// **Media headers are not offered here.** A template whose header is an image needs that
// image supplied with every send, and that step is deliberately parked — so such a template
// is shown in the picker but cannot be chosen, with the reason on screen. Showing it disabled
// rather than hiding it means an operator looking for their image template finds out why it
// is unavailable instead of concluding it was lost.

interface CampaignTemplate {
  id: string;
  name: string;
  metaTemplate: string;
  language: string;
  category: 'MARKETING' | 'UTILITY';
  bodyPreview: string;
  status: 'DRAFT' | 'PENDING' | 'APPROVED' | 'REJECTED';
  headerFormat: TemplateHeaderFormat;
  headerText: string | null;
  footerText: string | null;
  buttons: TemplateButton[];
  variables: string[];
  syncedAt: string | null;
}

interface Audience { reachable: number; excludedNoConsent: number }

export default function CampaignNew() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [params] = useSearchParams();

  const [name, setName] = useState('');
  const [templateId, setTemplateId] = useState('');
  /** Preselected when arriving from a list's Broadcast button. */
  const [listIds, setListIds] = useState<string[]>(() => {
    const fromUrl = params.get('listId');
    return fromUrl ? [fromUrl] : [];
  });

  /**
   * Marketing templates only, filtered by the **server**.
   *
   * A UTILITY template is for order updates and an AUTHENTICATION one carries a login code;
   * neither belongs in a broadcast, and sending an OTP template to a list is the specific
   * mistake this closes off. Doing it in the query rather than in the browser means the page
   * cannot accidentally widen it later.
   */
  const templates = useQuery({
    queryKey: ['campaign-templates', 'MARKETING'],
    queryFn: async () => (await api.get<{ data: CampaignTemplate[] }>('/campaigns/templates', {
      params: { category: 'MARKETING' },
    })).data.data,
  });

  const template = templates.data?.find((t) => t.id === templateId) ?? null;

  const lists = useCustomerLists();
  const audienceFilter = listIds.length ? { listIds } : {};

  const audience = useQuery({
    queryKey: ['audience-preview', listIds],
    queryFn: async () => (await api.post<{ data: Audience }>(
      '/campaigns/audience-preview', audienceFilter,
    )).data.data,
  });

  const sync = useMutation({
    mutationFn: async () => (await api.post<{
      data: { created: number; updated: number; skipped: Array<{ name: string; reason: string }> };
    }>('/campaigns/templates/sync')).data.data,
    onSuccess: (result) => {
      toast.success(`${result.created} added, ${result.updated} updated from Meta`);
      qc.invalidateQueries({ queryKey: ['campaign-templates'] });
    },
  });

  const save = useMutation({
    mutationFn: async () => (await api.post<{ data: { id: string } }>('/campaigns', {
      name, templateId, audienceFilter,
    })).data.data,
    onSuccess: () => {
      toast.success('Campaign created as a draft');
      qc.invalidateQueries({ queryKey: ['campaigns'] });
      nav('/campaigns');
    },
  });

  const canSave = !!name.trim() && !!templateId && !save.isPending;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <Button variant="outline" size="sm" className="gap-1 mb-3" onClick={() => nav('/campaigns')}>
          <ArrowLeft className="h-4 w-4" /> Campaigns
        </Button>
        <h1 className="text-h2 font-semibold">New campaign</h1>
        <p className="text-sm text-muted-foreground">
          One approved template, sent to the people you choose who have opted in.
        </p>
      </div>

      <Card>
        <CardContent className="space-y-4 pt-6">
          <div className="space-y-1">
            <Label htmlFor="c-name">Name</Label>
            <Input
              id="c-name"
              value={name}
              autoFocus
              placeholder="Diwali week"
              onChange={(e) => setName(e.target.value)}
            />
            <p className="text-caption text-muted-foreground">
              For your own reference. Customers never see it.
            </p>
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="c-template">Template</Label>
              <Button
                type="button" variant="outline" size="sm" className="gap-1"
                disabled={sync.isPending}
                onClick={() => sync.mutate()}
              >
                <RefreshCw className={sync.isPending ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'} />
                {sync.isPending ? 'Syncing…' : 'Sync from Meta'}
              </Button>
            </div>
            <select
              id="c-template"
              value={templateId}
              className="h-10 w-full rounded-md border border-ink-400 bg-surface-1 px-2 text-sm text-ink-900"
              onChange={(e) => setTemplateId(e.target.value)}
            >
              <option value="">Choose a template…</option>
              {(templates.data ?? []).map((t) => (
                // A media-header template is disabled, not omitted — see the note at the top
                // of this file. `disabled` is enforced by the browser, and `canSave` never
                // sees such an id because it cannot be selected.
                <option key={t.id} value={t.id} disabled={needsMedia(t.headerFormat)}>
                  {t.name}
                  {t.status === 'APPROVED' ? '' : ` (${t.status.toLowerCase()} — cannot send)`}
                  {needsMedia(t.headerFormat)
                    ? ` (needs ${t.headerFormat === 'IMAGE' ? 'an' : 'a'} ${t.headerFormat.toLowerCase()} — not supported yet)`
                    : ''}
                </option>
              ))}
            </select>
            <p className="text-caption text-muted-foreground">
              Marketing templates only. Utility and authentication templates are for order
              updates and login codes, and are not offered here.
            </p>
            {(templates.data ?? []).some((t) => needsMedia(t.headerFormat)) && (
              <p className="text-caption text-muted-foreground">
                Templates with an image, video or document header are greyed out. WhatsApp
                needs that file supplied with every message, which this screen does not do
                yet.
              </p>
            )}
            {templates.data?.length === 0 && (
              <p className="text-caption text-muted-foreground">
                None yet — sync from Meta to pull in your approved templates.
              </p>
            )}
          </div>

          {template && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={template.status === 'APPROVED' ? 'default' : 'secondary'}>
                  {template.status.toLowerCase()}
                </Badge>
                <span className="text-caption text-muted-foreground">
                  {template.metaTemplate} · {template.language}
                </span>
                {template.headerFormat !== 'NONE' && (
                  <Badge variant="outline">{template.headerFormat.toLowerCase()} header</Badge>
                )}
              </div>

              <TemplatePreview template={template} />

              {!template.syncedAt && (
                <p className="text-caption text-muted-foreground">
                  Added by hand, never reconciled with Meta, so the preview is only as right as
                  what was typed in. Sync to read it off the approved template.
                </p>
              )}
            </div>
          )}

          <div className="space-y-1">
            <Label>Send to</Label>
            {(lists.data ?? []).length === 0 ? (
              <p className="text-caption text-muted-foreground">
                Everyone who has opted in. Build a list under Customers to send to a group you
                choose.
              </p>
            ) : (
              <div className="space-y-1 rounded-md border p-2">
                {(lists.data ?? []).map((list) => (
                  <label key={list.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-ink-400 text-accent-600"
                      checked={listIds.includes(list.id)}
                      onChange={(e) => setListIds((current) => (e.target.checked
                        ? [...current, list.id]
                        : current.filter((id) => id !== list.id)))}
                    />
                    <span>{list.name}</span>
                    <span className="text-caption text-muted-foreground">
                      {list._count.members} on it
                    </span>
                  </label>
                ))}
                <p className="pt-1 text-caption text-muted-foreground">
                  {listIds.length === 0
                    ? 'No list picked — this goes to everyone who has opted in.'
                    : 'Anyone on a ticked list who has opted in. Membership is fixed, so this is the group you see.'}
                </p>
              </div>
            )}
          </div>

          {audience.data && (
            <div className="rounded-md border bg-muted/40 p-3 text-caption">
              <p className="flex items-center gap-1 font-medium">
                <Users className="h-3.5 w-3.5" />
                {audience.data.reachable} customer{audience.data.reachable === 1 ? '' : 's'} will
                get this
              </p>
              <p className="mt-1 flex items-start gap-1 text-muted-foreground">
                <ShieldCheck className="mt-px h-3.5 w-3.5 shrink-0" />
                {audience.data.excludedNoConsent} excluded — they have not opted in, or they
                replied STOP. There is no way to include them.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button variant="outline" onClick={() => nav('/campaigns')}>Cancel</Button>
        <Button className="gap-1" disabled={!canSave} onClick={() => save.mutate()}>
          <Megaphone className="h-4 w-4" />
          {save.isPending ? 'Creating…' : 'Create draft'}
        </Button>
      </div>
    </div>
  );
}
