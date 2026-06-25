import { useEffect, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import {
  ChevronLeft, AlertCircle, PlusCircle, RefreshCw, Eye, Send, FileText,
  CheckCircle2, Clock, XCircle, MoreVertical,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface MetaTemplate {
  id: string; name: string; category: string; language: string;
  status: string; components: any[];
}
interface MetaButton { type: 'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER'; text: string; url?: string; phone_number?: string; }

// ── Helpers ───────────────────────────────────────────────────────────────────

const LANG_LABEL: Record<string, string> = {
  en_US: 'English (US)', en_GB: 'English (UK)', en: 'English',
  es_ES: 'Spanish', es_LA: 'Spanish', es: 'Spanish',
  pt_BR: 'Portuguese', fr_FR: 'French', de_DE: 'German',
  it_IT: 'Italian', ar_AR: 'Arabic', hi_IN: 'Hindi',
};

const CAT_ICON_BG: Record<string, string> = {
  UTILITY:        'bg-emerald-100 text-emerald-600',
  MARKETING:      'bg-orange-100  text-orange-600',
  AUTHENTICATION: 'bg-blue-100    text-blue-600',
};

function getComp(t: MetaTemplate, type: string) { return t.components?.find((c) => c.type === type); }
function getCompText(t: MetaTemplate, type: string): string { return getComp(t, type)?.text || ''; }
function getButtons(t: MetaTemplate): any[] { return getComp(t, 'BUTTONS')?.buttons || []; }
function extractVars(text: string): string[] {
  return [...new Set([...text.matchAll(/\{\{(\d+)\}\}/g)].map((m) => m[1]))].sort((a, b) => +a - +b);
}
function getVarsRatioError(text: string): string | null {
  const vars = extractVars(text);
  if (!vars.length) return null;
  const nonVar = text.replace(/\{\{\d+\}\}/g, '').trim();
  const min = vars.length * 10;
  if (nonVar.length < min)
    return `Body too short for ${vars.length} variable${vars.length > 1 ? 's' : ''}. Add ${min - nonVar.length} more characters of fixed text.`;
  return null;
}

function StatusBadge({ status }: { status: string }) {
  const s = status.toUpperCase();
  if (s === 'APPROVED') return <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 gap-1"><CheckCircle2 className="w-3 h-3" />Approved</Badge>;
  if (s === 'PENDING')  return <Badge className="bg-amber-100 text-amber-700 border-amber-200 gap-1"><Clock className="w-3 h-3" />Pending</Badge>;
  if (s === 'REJECTED') return <Badge variant="destructive" className="gap-1"><XCircle className="w-3 h-3" />Rejected</Badge>;
  return <Badge variant="outline">{status}</Badge>;
}

// ── WhatsApp live preview ─────────────────────────────────────────────────────

function WhatsappPreview({ header, body, footer, buttons }: {
  header: string; body: string; footer: string; buttons: MetaButton[];
}) {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm font-semibold">WhatsApp Preview</p>
        <span className="text-slate-400 text-xs">Live</span>
      </div>
      <div className="flex-1 bg-[#E5DDD5] rounded-xl overflow-hidden border border-slate-200 flex flex-col">
        <div className="bg-[#075E54] px-3 py-2 flex items-center gap-2 shrink-0">
          <ChevronLeft className="w-4 h-4 text-white" />
          <div className="w-7 h-7 rounded-full bg-emerald-400 flex items-center justify-center text-xs font-bold text-white">Z</div>
          <div className="flex-1 min-w-0">
            <p className="text-white text-xs font-semibold truncate">Demo Biryani House</p>
            <p className="text-emerald-200 text-[10px]">Business Account ✓</p>
          </div>
          <MoreVertical className="w-4 h-4 text-white" />
        </div>
        <div className="flex-1 p-3">
          <div className="max-w-[90%] bg-white rounded-xl rounded-tl-none shadow-sm overflow-hidden text-xs">
            {header && <div className="px-3 pt-2.5 pb-1 font-bold text-slate-900 border-b border-slate-100">{header}</div>}
            {body ? (
              <div className="px-3 py-2 text-slate-800 whitespace-pre-wrap leading-relaxed">{body}</div>
            ) : (
              <div className="px-3 py-2 text-slate-400 italic">Body text will appear here…</div>
            )}
            {footer && <div className="px-3 pb-2 text-[10px] text-slate-400">{footer}</div>}
            <div className="px-3 pb-1.5 text-right text-[9px] text-slate-400">10:30 AM ✓✓</div>
          </div>
          {buttons.filter((b) => b.text).length > 0 && (
            <div className="max-w-[90%] mt-1 space-y-1">
              {buttons.filter((b) => b.text).map((b, i) => (
                <div key={i} className="bg-white rounded-xl text-center text-[11px] py-1.5 text-[#53BDEB] font-semibold shadow-sm">{b.text}</div>
              ))}
            </div>
          )}
        </div>
      </div>
      <p className="text-[10px] text-slate-400 text-center mt-2">Actual appearance may vary.</p>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

const BLANK_FORM = {
  hasHeader: false, headerText: '',
  bodyText: '', bodyExamples: {} as Record<string, string>,
  hasFooter: false, footerText: '',
  hasButtons: false, buttons: [] as MetaButton[],
};

export default function TemplateEdit() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const stateTemplate = (location.state as any)?.template as MetaTemplate | undefined;

  const [form, setForm] = useState(BLANK_FORM);
  const [populated, setPopulated] = useState(false);

  // Fetch from API (use state as initialData for instant load)
  const { data: template, isLoading } = useQuery<MetaTemplate>({
    queryKey: ['template', id],
    queryFn: async () => {
      const r = await api.get<{ success: boolean; data: MetaTemplate }>(`/templates/meta/${id}`);
      return r.data.data;
    },
    initialData: stateTemplate,
    staleTime: 30_000,
  });

  // Pre-fill form whenever template loads
  useEffect(() => {
    if (!template || populated) return;
    const hc   = getComp(template, 'HEADER');
    const bc   = getComp(template, 'BODY');
    const fc   = getComp(template, 'FOOTER');
    const btnc = getComp(template, 'BUTTONS');
    setForm({
      hasHeader:    !!hc,
      headerText:   hc?.text || '',
      bodyText:     bc?.text || '',
      bodyExamples: {},
      hasFooter:    !!fc,
      footerText:   fc?.text || '',
      hasButtons:   !!btnc,
      buttons:      (btnc?.buttons || []).map((b: any) => ({
        type: b.type as MetaButton['type'],
        text: b.text || '',
        url:  b.url,
        phone_number: b.phone_number,
      })),
    });
    setPopulated(true);
  }, [template, populated]);

  const updateMutation = useMutation({
    mutationFn: async () => {
      const comps: any[] = [];
      if (form.hasHeader && form.headerText.trim())
        comps.push({ type: 'HEADER', format: 'TEXT', text: form.headerText.trim() });

      const bodyVars = extractVars(form.bodyText);
      const bodyComp: any = { type: 'BODY', text: form.bodyText.trim() };
      if (bodyVars.length > 0)
        bodyComp.example = { body_text: [bodyVars.map((v) => form.bodyExamples[v] || `sample_${v}`)] };
      comps.push(bodyComp);

      if (form.hasFooter && form.footerText.trim())
        comps.push({ type: 'FOOTER', text: form.footerText.trim() });

      if (form.hasButtons && form.buttons.length > 0)
        comps.push({
          type: 'BUTTONS',
          buttons: form.buttons.map((b) => {
            const btn: any = { type: b.type, text: b.text };
            if (b.type === 'URL') btn.url = b.url;
            if (b.type === 'PHONE_NUMBER') btn.phone_number = b.phone_number;
            return btn;
          }),
        });

      return api.post(`/templates/meta/${id}`, { components: comps });
    },
    onSuccess: () => {
      toast.success('Template updated — resubmitted to Meta for approval');
      navigate(`/templates/${id}/view`, { state: { template } });
    },
  });

  const addButton = () => {
    if (form.buttons.length >= 10) { toast.error('Max 10 buttons'); return; }
    setForm({ ...form, buttons: [...form.buttons, { type: 'QUICK_REPLY', text: '' }] });
  };
  const removeButton = (i: number) =>
    setForm({ ...form, buttons: form.buttons.filter((_, x) => x !== i) });
  const updateButton = (i: number, fields: Partial<MetaButton>) => {
    const btns = [...form.buttons]; btns[i] = { ...btns[i], ...fields } as MetaButton;
    setForm({ ...form, buttons: btns });
  };

  const ratioErr = getVarsRatioError(form.bodyText);

  if (isLoading && !template) {
    return (
      <div className="flex items-center justify-center py-20">
        <RefreshCw className="w-6 h-6 animate-spin text-violet-500" />
      </div>
    );
  }
  if (!template) {
    return (
      <div className="py-20 text-center">
        <p className="text-muted-foreground">Template not found.</p>
        <Button variant="outline" className="mt-4" onClick={() => navigate('/templates')}>Back</Button>
      </div>
    );
  }

  const catIconCls = CAT_ICON_BG[template.category] || 'bg-slate-100 text-slate-600';

  return (
    <div className="space-y-0 -mt-1">
      {/* Top bar */}
      <div className="flex items-center justify-between py-3 mb-1">
        <div className="flex items-center gap-2">
          <button onClick={() => navigate(`/templates/${id}/view`, { state: { template } })}
            className="p-1.5 rounded-md hover:bg-slate-100 text-slate-500 hover:text-slate-700 transition-colors">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-xl font-semibold leading-none">Edit Template</h1>
            <p className="text-xs text-muted-foreground mt-0.5">Modify the template components. Changes will be resubmitted to Meta for approval.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-1.5"
            onClick={() => navigate(`/templates/${id}/view`, { state: { template } })}>
            <Eye className="w-3.5 h-3.5" /> View Template
          </Button>
          <Button size="sm" className="gap-1.5 bg-violet-600 hover:bg-violet-700 text-white"
            disabled={!form.bodyText || !!ratioErr || updateMutation.isPending}
            onClick={() => updateMutation.mutate()}>
            {updateMutation.isPending ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Saving…</> : <><Send className="w-3.5 h-3.5" /> Save Changes</>}
          </Button>
        </div>
      </div>

      {/* Info strip */}
      <div className="rounded-xl border bg-white shadow-sm px-5 py-3.5 mb-5 flex items-center gap-4 flex-wrap">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${catIconCls}`}>
          <FileText className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-slate-900">{template.name}</span>
            <StatusBadge status={template.status} />
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            {template.category} · {LANG_LABEL[template.language] || template.language}
            {' · '}ID: <span className="font-mono">{template.id.slice(0, 16)}…</span>
          </p>
        </div>
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 max-w-xs">
          ⚠️ Editing will reset status to <strong>Pending</strong> until Meta re-approves.
        </p>
      </div>

      {/* Two-column layout */}
      <div className="flex gap-5 items-start">
        {/* Form */}
        <div className="flex-1 min-w-0 rounded-xl border bg-white shadow-sm p-6 space-y-5">
          <div>
            <p className="font-semibold text-sm">Template Components</p>
            <p className="text-xs text-muted-foreground mt-0.5">The template name, category and language cannot be changed after creation.</p>
          </div>

          {/* Readonly fields */}
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Template Name</Label>
              <Input value={template.name} disabled className="bg-slate-50 font-mono text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Category</Label>
              <Input value={template.category} disabled className="bg-slate-50 text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Language</Label>
              <Input value={LANG_LABEL[template.language] || template.language} disabled className="bg-slate-50 text-sm" />
            </div>
          </div>

          <hr />

          {/* Header */}
          <div className="space-y-3 rounded-lg border p-4 bg-slate-50/50">
            <div className="flex items-center justify-between">
              <div>
                <Label className="font-semibold text-sm">Header (optional)</Label>
                <p className="text-[10px] text-muted-foreground mt-0.5">Short title at the top of the message.</p>
              </div>
              <Switch checked={form.hasHeader} onCheckedChange={(v) => setForm({ ...form, hasHeader: v })} />
            </div>
            {form.hasHeader && (
              <div className="relative">
                <Input placeholder="e.g. Order Update" value={form.headerText} maxLength={60}
                  onChange={(e) => setForm({ ...form, headerText: e.target.value })} />
                <span className="absolute right-3 top-2.5 text-[10px] text-slate-400">{form.headerText.length}/60</span>
              </div>
            )}
          </div>

          {/* Body */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-sm">Body Text <span className="text-red-500">*</span></Label>
              <span className="text-[10px] text-muted-foreground">Use {'{{1}}'}, {'{{2}}'} for dynamic variables</span>
            </div>
            <div className="relative">
              <Textarea
                placeholder="Hello {{1}}, your order #{{2}} is now being prepared!"
                value={form.bodyText} rows={5}
                className={ratioErr ? 'border-red-400 focus-visible:ring-red-400 pr-16' : 'pr-16'}
                onChange={(e) => setForm({ ...form, bodyText: e.target.value })}
              />
              <span className="absolute bottom-2 right-3 text-[10px] text-slate-400">{form.bodyText.length}/1024</span>
            </div>
            {ratioErr && (
              <p className="text-xs text-red-600 flex items-center gap-1.5">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />{ratioErr}
              </p>
            )}
          </div>

          {/* Variable examples */}
          {extractVars(form.bodyText).length > 0 && (
            <div className="space-y-3 rounded-lg border p-4 bg-amber-50/50 border-amber-200">
              <div>
                <Label className="text-sm font-semibold text-amber-800">Variable Example Values</Label>
                <p className="text-[10px] text-amber-700 mt-0.5">Required by Meta — templates without examples get auto-rejected.</p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {extractVars(form.bodyText).map((v) => (
                  <div key={v} className="space-y-1">
                    <Label className="text-[10px] font-mono text-amber-700">{'{{' + v + '}}'}</Label>
                    <Input placeholder={`example for {{${v}}}`} className="h-8 text-xs"
                      value={form.bodyExamples[v] || ''}
                      onChange={(e) => setForm({ ...form, bodyExamples: { ...form.bodyExamples, [v]: e.target.value } })} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Footer */}
          <div className="space-y-3 rounded-lg border p-4 bg-slate-50/50">
            <div className="flex items-center justify-between">
              <div>
                <Label className="font-semibold text-sm">Footer (optional)</Label>
                <p className="text-[10px] text-muted-foreground mt-0.5">Light grey text shown at the bottom.</p>
              </div>
              <Switch checked={form.hasFooter} onCheckedChange={(v) => setForm({ ...form, hasFooter: v })} />
            </div>
            {form.hasFooter && (
              <div className="relative">
                <Input placeholder="e.g. Reply STOP to unsubscribe" value={form.footerText} maxLength={60}
                  onChange={(e) => setForm({ ...form, footerText: e.target.value })} />
                <span className="absolute right-3 top-2.5 text-[10px] text-slate-400">{form.footerText.length}/60</span>
              </div>
            )}
          </div>

          {/* Buttons */}
          <div className="space-y-3 rounded-lg border p-4 bg-slate-50/50">
            <div className="flex items-center justify-between">
              <div>
                <Label className="font-semibold text-sm">Buttons (optional)</Label>
                <p className="text-[10px] text-muted-foreground mt-0.5">Quick replies or call-to-action buttons (max 10).</p>
              </div>
              <Switch checked={form.hasButtons} onCheckedChange={(v) => setForm({ ...form, hasButtons: v })} />
            </div>
            {form.hasButtons && (
              <div className="space-y-3">
                {form.buttons.map((btn, i) => (
                  <div key={i} className="p-3 border rounded bg-white space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-violet-500">Button #{i + 1}</span>
                      <button type="button" onClick={() => removeButton(i)}
                        className="text-red-400 hover:text-red-600 p-0.5">
                        <PlusCircle className="w-4 h-4 rotate-45" />
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <Select value={btn.type} onValueChange={(v: any) => updateButton(i, { type: v })}>
                        <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="QUICK_REPLY">Quick Reply</SelectItem>
                          <SelectItem value="URL">Visit URL</SelectItem>
                          <SelectItem value="PHONE_NUMBER">Call Phone</SelectItem>
                        </SelectContent>
                      </Select>
                      <Input className="h-8" placeholder="Button label" value={btn.text} maxLength={25}
                        onChange={(e) => updateButton(i, { text: e.target.value })} />
                    </div>
                    {btn.type === 'URL' && (
                      <Input className="h-8 font-mono text-xs" placeholder="https://example.com/track/{{1}}"
                        value={btn.url || ''} onChange={(e) => updateButton(i, { url: e.target.value })} />
                    )}
                    {btn.type === 'PHONE_NUMBER' && (
                      <Input className="h-8 font-mono text-xs" placeholder="+15551234567"
                        value={btn.phone_number || ''} onChange={(e) => updateButton(i, { phone_number: e.target.value })} />
                    )}
                  </div>
                ))}
                <Button type="button" variant="outline" size="sm" onClick={addButton}
                  className="w-full gap-1 border-dashed text-violet-500 hover:text-violet-600">
                  <PlusCircle className="w-4 h-4" /> Add Button
                </Button>
              </div>
            )}
          </div>

          {/* Save footer */}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => navigate(`/templates/${id}/view`, { state: { template } })}>
              Cancel
            </Button>
            <Button className="bg-violet-600 hover:bg-violet-700 text-white gap-1.5"
              disabled={!form.bodyText || !!ratioErr || updateMutation.isPending}
              onClick={() => updateMutation.mutate()}>
              {updateMutation.isPending ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Saving…</> : 'Save Changes'}
            </Button>
          </div>
        </div>

        {/* Live preview */}
        <div className="w-72 shrink-0 sticky top-6">
          <div className="rounded-xl border bg-white shadow-sm p-4">
            <WhatsappPreview
              header={form.hasHeader ? form.headerText : ''}
              body={form.bodyText}
              footer={form.hasFooter ? form.footerText : ''}
              buttons={form.hasButtons ? form.buttons : []}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
