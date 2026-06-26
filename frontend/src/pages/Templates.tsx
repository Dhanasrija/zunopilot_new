import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { useNavigate } from 'react-router-dom';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, DialogTrigger, DialogClose,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import {
  Plus, Trash2, AlertCircle, CheckCircle2, Clock, XCircle,
  PlusCircle, MinusCircle, Sparkles, RefreshCw, Pencil, Eye,
  MoreVertical, Settings, ChevronLeft, ChevronRight, Copy,
  Send, FileText, LayoutGrid, Link2,
} from 'lucide-react';

// ── Constants ────────────────────────────────────────────────────────────────

const TRIGGERS = [
  'ORDER_CREATED', 'ORDER_ACCEPTED', 'ORDER_PREPARING', 'ORDER_READY',
  'ORDER_OUT_FOR_DELIVERY', 'ORDER_DELIVERED', 'ORDER_CANCELLED',
] as const;

const COMMON_LANGUAGES = [
  { code: 'en_US', name: 'English (US)' }, { code: 'en_GB', name: 'English (UK)' },
  { code: 'es_ES', name: 'Spanish (Spain)' }, { code: 'es_LA', name: 'Spanish (Latin America)' },
  { code: 'pt_BR', name: 'Portuguese (Brazil)' }, { code: 'fr_FR', name: 'French (France)' },
  { code: 'de_DE', name: 'German' }, { code: 'it_IT', name: 'Italian' },
  { code: 'ar_AR', name: 'Arabic' }, { code: 'hi_IN', name: 'Hindi' },
];

const LANG_LABEL: Record<string, string> = {
  en_US: 'English', en_GB: 'English', es_ES: 'Spanish', es_LA: 'Spanish',
  pt_BR: 'Portuguese', fr_FR: 'French', de_DE: 'German', it_IT: 'Italian',
  ar_AR: 'Arabic', hi_IN: 'Hindi', en: 'English', es: 'Spanish',
};

const CAT_STYLE: Record<string, { bg: string; text: string; dot: string }> = {
  UTILITY: { bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-500' },
  MARKETING: { bg: 'bg-orange-50', text: 'text-orange-700', dot: 'bg-orange-500' },
  AUTHENTICATION: { bg: 'bg-blue-50', text: 'text-blue-700', dot: 'bg-blue-500' },
};

const CAT_ICON_BG: Record<string, string> = {
  UTILITY: 'bg-emerald-100 text-emerald-600',
  MARKETING: 'bg-orange-100  text-orange-600',
  AUTHENTICATION: 'bg-blue-100    text-blue-600',
};

// ── Types ────────────────────────────────────────────────────────────────────

interface Template { id: string; name: string; trigger: string; metaTemplate: string; language: string; body: string; isActive: boolean; }
interface MetaButton { type: 'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER'; text: string; url?: string; phone_number?: string; }
interface MetaTemplate { name: string; category: string; language: string; status: string; id: string; components: any[]; }

// ── Small helpers ─────────────────────────────────────────────────────────────

function relTime(ms: number) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}hr ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function extractVars(text: string): string[] {
  const m = [...text.matchAll(/\{\{(\d+)\}\}/g)];
  return [...new Set(m.map((x) => x[1]))].sort((a, b) => +a - +b);
}

function getVarsRatioError(text: string): string | null {
  const vars = extractVars(text);
  if (!vars.length) return null;
  const nonVar = text.replace(/\{\{\d+\}\}/g, '').trim();
  const min = vars.length * 10;
  if (nonVar.length < min)
    return `Body too short for ${vars.length} variable${vars.length > 1 ? 's' : ''}. Add at least ${min - nonVar.length} more characters of fixed text.`;
  return null;
}

function getComp(template: MetaTemplate, type: string) {
  return template.components?.find((c) => c.type === type);
}
function getCompText(template: MetaTemplate, type: string): string {
  return getComp(template, type)?.text || '';
}
function getButtons(template: MetaTemplate): any[] {
  return getComp(template, 'BUTTONS')?.buttons || [];
}

// ── Category icon chip ────────────────────────────────────────────────────────

function CatIcon({ category }: { category: string }) {
  const cls = CAT_ICON_BG[category] || 'bg-slate-100 text-slate-600';
  const Icon = category === 'UTILITY' ? FileText : category === 'MARKETING' ? Send : Link2;
  return (
    <span className={`inline-flex items-center justify-center w-8 h-8 rounded-lg ${cls} shrink-0`}>
      <Icon className="w-4 h-4" />
    </span>
  );
}

// ── Status badge / dot ────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const s = status.toUpperCase();
  if (s === 'APPROVED') return <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700"><span className="w-2 h-2 rounded-full bg-emerald-500" />Approved</span>;
  if (s === 'PENDING') return <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-600"><span className="w-2 h-2 rounded-full bg-amber-500" />Pending</span>;
  if (s === 'REJECTED') return <span className="inline-flex items-center gap-1.5 text-xs font-medium text-red-600"><span className="w-2 h-2 rounded-full bg-red-500" />Rejected</span>;
  return <span className="inline-flex items-center gap-1.5 text-xs text-slate-500"><span className="w-2 h-2 rounded-full bg-slate-400" />{status}</span>;
}

function StatusBadgeFull({ status }: { status: string }) {
  const s = status.toUpperCase();
  if (s === 'APPROVED') return <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 gap-1"><CheckCircle2 className="w-3 h-3" />Approved</Badge>;
  if (s === 'PENDING') return <Badge className="bg-amber-100 text-amber-700 border-amber-200 gap-1"><Clock className="w-3 h-3" />Pending</Badge>;
  if (s === 'REJECTED') return <Badge variant="destructive" className="gap-1"><XCircle className="w-3 h-3" />Rejected</Badge>;
  return <Badge variant="outline">{status}</Badge>;
}

// ── WhatsApp Preview ──────────────────────────────────────────────────────────

function WhatsappPreview({ template }: { template: MetaTemplate }) {
  const header = getCompText(template, 'HEADER');
  const body = getCompText(template, 'BODY');
  const footer = getCompText(template, 'FOOTER');
  const btns = getButtons(template);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm font-semibold text-slate-700">WhatsApp Preview</p>
        <div className="flex gap-1">
          <button className="p-1 rounded text-slate-400 hover:text-slate-600"><span className="text-xs">📱</span></button>
          <button className="p-1 rounded text-slate-400 hover:text-slate-600"><span className="text-xs">💻</span></button>
        </div>
      </div>
      {/* Phone shell */}
      <div className="flex-1 bg-[#E5DDD5] rounded-xl overflow-hidden border border-slate-200 flex flex-col min-h-0">
        {/* Chat header */}
        <div className="bg-[#075E54] px-3 py-2 flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-emerald-300 flex items-center justify-center text-xs font-bold text-emerald-900">B</div>
          <div>
            <p className="text-white text-xs font-semibold leading-none">Business Name</p>
            <p className="text-emerald-200 text-[10px]">Business Account</p>
          </div>
        </div>
        {/* Messages area */}
        <div className="flex-1 p-3 overflow-y-auto">
          <div className="max-w-[85%] bg-white rounded-lg shadow-sm overflow-hidden">
            {header && <div className="px-3 pt-2.5 pb-1 font-semibold text-xs text-slate-800 border-b border-slate-100">{header}</div>}
            {body && <div className="px-3 py-2 text-xs text-slate-700 whitespace-pre-wrap leading-relaxed">{body}</div>}
            {footer && <div className="px-3 pb-2 text-[10px] text-slate-400">{footer}</div>}
            <div className="px-3 pb-1.5 text-right text-[9px] text-slate-400">10:30 AM</div>
          </div>
          {btns.length > 0 && (
            <div className="max-w-[85%] mt-1 space-y-1">
              {btns.map((b: any, i: number) => (
                <div key={i} className="bg-white rounded-lg text-center text-[11px] py-1.5 text-[#53BDEB] font-medium shadow-sm border border-slate-100">{b.text}</div>
              ))}
            </div>
          )}
        </div>
      </div>
      <p className="text-[10px] text-slate-400 text-center mt-2">Actual appearance may vary.</p>
    </div>
  );
}

// ── View Template Dialog ──────────────────────────────────────────────────────

function ViewTemplateDialog({ template, open, onOpenChange, onEdit }: {
  template: MetaTemplate | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onEdit: () => void;
}) {
  const [tab, setTab] = useState('content');
  if (!template) return null;

  const header = getCompText(template, 'HEADER');
  const body = getCompText(template, 'BODY');
  const footer = getCompText(template, 'FOOTER');
  const vars = extractVars(body);
  const catStyle = CAT_STYLE[template.category] || CAT_STYLE.UTILITY;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[92vh] overflow-hidden flex flex-col p-0">
        {/* Header bar */}
        <div className="flex items-center justify-between px-6 py-4 border-b shrink-0">
          <div className="flex items-center gap-3">
            <button onClick={() => onOpenChange(false)} className="text-slate-400 hover:text-slate-700 transition-colors">
              <ChevronLeft className="w-5 h-5" />
            </button>
            <div>
              <h2 className="text-lg font-semibold">View Template</h2>
              <p className="text-xs text-muted-foreground">View template details, content, variables and performance.</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="gap-1.5" onClick={onEdit}>
              <Pencil className="w-3.5 h-3.5" /> Edit Template
            </Button>
            <Button size="sm" className="gap-1.5 bg-violet-600 hover:bg-violet-700 text-white">
              <Send className="w-3.5 h-3.5" /> Test Template
            </Button>
          </div>
        </div>

        {/* Info card */}
        <div className="mx-6 mt-4 rounded-lg border bg-slate-50/60 p-4 shrink-0">
          <div className="flex items-start gap-4">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${CAT_ICON_BG[template.category] || 'bg-slate-100 text-slate-600'}`}>
              <FileText className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-semibold text-slate-900">{template.name}</h3>
                <StatusBadgeFull status={template.status} />
              </div>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${catStyle.bg} ${catStyle.text}`}>
                  {template.category.charAt(0) + template.category.slice(1).toLowerCase()} Template
                </span>
                <span className="text-[10px] text-slate-500">☆ {LANG_LABEL[template.language] || template.language}</span>
              </div>
            </div>
            <div className="hidden md:grid grid-cols-2 gap-x-8 gap-y-1 text-xs shrink-0">
              <div>
                <p className="text-[10px] uppercase tracking-wide text-slate-400 font-medium">Template ID</p>
                <p className="font-mono text-slate-600 mt-0.5">{template.id.slice(0, 16)}…</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-slate-400 font-medium">Namespace</p>
                <p className="font-mono text-slate-600 mt-0.5">{template.id.slice(0, 16)}…</p>
              </div>
            </div>
          </div>
        </div>

        {/* Body — scrollable */}
        <div className="flex-1 overflow-hidden flex gap-0 min-h-0">
          {/* Left: tabs */}
          <div className="flex-1 overflow-y-auto px-6 pb-6">
            <Tabs value={tab} onValueChange={setTab} className="mt-4">
              <TabsList className="mb-4">
                <TabsTrigger value="content">Content</TabsTrigger>
                <TabsTrigger value="variables">Variables ({vars.length})</TabsTrigger>
                <TabsTrigger value="languages">Languages (1)</TabsTrigger>
                <TabsTrigger value="category">Category</TabsTrigger>
                <TabsTrigger value="activity">Activity Log</TabsTrigger>
              </TabsList>

              {/* Content tab */}
              <TabsContent value="content" className="space-y-4 mt-0">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-semibold text-sm">Template Content</p>
                    <p className="text-xs text-muted-foreground">This is the content that will be sent to your customers.</p>
                  </div>
                  <Button variant="outline" size="sm" className="gap-1.5 text-xs"
                    onClick={() => { navigator.clipboard.writeText([header, body, footer].filter(Boolean).join('\n\n')); toast.success('Copied!'); }}>
                    <Copy className="w-3.5 h-3.5" /> Copy Content
                  </Button>
                </div>

                {header && (
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Header (Text)</Label>
                    <div className="relative">
                      <Textarea value={header} readOnly rows={2} className="bg-slate-50 text-sm resize-none pr-16" />
                      <span className="absolute bottom-2 right-3 text-[10px] text-slate-400">{header.length}/90</span>
                    </div>
                  </div>
                )}

                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Body (Text)</Label>
                  <div className="relative">
                    <Textarea value={body} readOnly rows={6} className="bg-slate-50 text-sm resize-none pr-16" />
                    <span className="absolute bottom-2 right-3 text-[10px] text-slate-400">{body.length}/1024</span>
                  </div>
                </div>

                {footer && (
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Footer (Text)</Label>
                    <div className="relative">
                      <Textarea value={footer} readOnly rows={2} className="bg-slate-50 text-sm resize-none pr-16" />
                      <span className="absolute bottom-2 right-3 text-[10px] text-slate-400">{footer.length}/90</span>
                    </div>
                  </div>
                )}

                {getButtons(template).length > 0 && (
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Buttons</Label>
                    <div className="space-y-2">
                      {getButtons(template).map((b: any, i: number) => (
                        <div key={i} className="flex items-center gap-2 p-2 rounded-md bg-slate-50 border text-sm">
                          <Badge variant="outline" className="text-[10px]">{b.type}</Badge>
                          <span className="font-medium">{b.text}</span>
                          {b.url && <span className="text-xs text-blue-600 truncate">{b.url}</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </TabsContent>

              {/* Variables tab */}
              <TabsContent value="variables" className="mt-0">
                {vars.length === 0 ? (
                  <div className="py-12 text-center text-muted-foreground text-sm">No variables in this template.</div>
                ) : (
                  <div className="space-y-3">
                    <p className="text-sm text-muted-foreground">This template uses {vars.length} variable{vars.length > 1 ? 's' : ''} that are replaced at send time.</p>
                    <div className="divide-y border rounded-lg overflow-hidden">
                      {vars.map((v) => (
                        <div key={v} className="flex items-center justify-between px-4 py-3 bg-white hover:bg-slate-50">
                          <div className="flex items-center gap-3">
                            <span className="font-mono text-sm font-semibold text-violet-600">{`{{${v}}}`}</span>
                            <span className="text-xs text-slate-500">Variable {v}</span>
                          </div>
                          <Badge variant="outline" className="text-[10px]">Dynamic</Badge>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </TabsContent>

              {/* Languages tab */}
              <TabsContent value="languages" className="mt-0">
                <div className="border rounded-lg overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3 bg-white">
                    <div className="flex items-center gap-3">
                      <span className="text-lg">🌐</span>
                      <div>
                        <p className="text-sm font-medium">{LANG_LABEL[template.language] || template.language}</p>
                        <p className="text-[10px] text-slate-500 font-mono">{template.language}</p>
                      </div>
                    </div>
                    <StatusBadgeFull status={template.status} />
                  </div>
                </div>
              </TabsContent>

              {/* Category tab */}
              <TabsContent value="category" className="mt-0">
                <div className={`rounded-lg border p-4 ${catStyle.bg}`}>
                  <div className="flex items-center gap-3">
                    <CatIcon category={template.category} />
                    <div>
                      <p className={`font-semibold text-sm ${catStyle.text}`}>{template.category}</p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {template.category === 'UTILITY' && 'Transactional messages, order updates, account alerts.'}
                        {template.category === 'MARKETING' && 'Promotions, offers, product announcements.'}
                        {template.category === 'AUTHENTICATION' && 'One-time passwords, verification codes.'}
                      </p>
                    </div>
                  </div>
                </div>
              </TabsContent>

              {/* Activity Log */}
              <TabsContent value="activity" className="mt-0">
                <div className="py-12 text-center text-muted-foreground text-sm">Activity log coming soon.</div>
              </TabsContent>
            </Tabs>
          </div>

          {/* Right: WhatsApp preview */}
          <div className="w-72 shrink-0 border-l px-5 py-4 overflow-y-auto hidden lg:flex flex-col">
            <WhatsappPreview template={template} />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Create / Edit Template Dialog ─────────────────────────────────────────────

function TemplateFormDialog({ open, onOpenChange, editingTemplate, metaTemplates, onSuccess }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editingTemplate: MetaTemplate | null;
  metaTemplates: MetaTemplate[];
  onSuccess: () => void;
}) {
  const blank = {
    name: '', category: 'UTILITY' as const, language: 'en_US',
    hasHeader: false, headerText: '',
    bodyText: '', bodyExamples: {} as Record<string, string>,
    hasFooter: false, footerText: '',
    hasButtons: false, buttons: [] as MetaButton[],
  };
  const [form, setForm] = useState(blank);

  // populate form when editing
  const populate = (t: MetaTemplate) => {
    const hc = getComp(t, 'HEADER');
    const bc = getComp(t, 'BODY');
    const fc = getComp(t, 'FOOTER');
    const btnc = getComp(t, 'BUTTONS');
    setForm({
      name: t.name, category: t.category as any, language: t.language,
      hasHeader: !!hc, headerText: hc?.text || '',
      bodyText: bc?.text || '', bodyExamples: {},
      hasFooter: !!fc, footerText: fc?.text || '',
      hasButtons: !!btnc,
      buttons: (btnc?.buttons || []).map((b: any) => ({ type: b.type, text: b.text, url: b.url, phone_number: b.phone_number })),
    });
  };

  const reset = () => { setForm(blank); };

  const createMutation = useMutation({
    mutationFn: async () => {
      const components = buildComponents();
      return api.post('/templates/meta', {
        name: form.name.toLowerCase().replace(/[^a-z0-9_]/g, ''),
        category: form.category, language: form.language, components,
      });
    },
    onSuccess: () => { toast.success('Template submitted to Meta for review'); onOpenChange(false); reset(); onSuccess(); },
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      const components = buildComponents();
      return api.post(`/templates/meta/${editingTemplate!.id}`, { components });
    },
    onSuccess: () => { toast.success('Template updated'); onOpenChange(false); reset(); onSuccess(); },
  });

  function buildComponents() {
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
        type: 'BUTTONS', buttons: form.buttons.map((b) => {
          const btn: any = { type: b.type, text: b.text };
          if (b.type === 'URL') btn.url = b.url;
          if (b.type === 'PHONE_NUMBER') btn.phone_number = b.phone_number;
          return btn;
        })
      });
    return comps;
  }

  const addButton = () => {
    if (form.buttons.length >= 10) { toast.error('Max 10 buttons'); return; }
    setForm({ ...form, buttons: [...form.buttons, { type: 'QUICK_REPLY', text: '' }] });
  };
  const removeButton = (i: number) => setForm({ ...form, buttons: form.buttons.filter((_, x) => x !== i) });
  const updateButton = (i: number, fields: Partial<MetaButton>) => {
    const btns = [...form.buttons]; btns[i] = { ...btns[i], ...fields } as MetaButton;
    setForm({ ...form, buttons: btns });
  };

  const ratioErr = getVarsRatioError(form.bodyText);
  const isEditing = !!editingTemplate;
  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) reset(); }}>
      <DialogContent className="max-w-2xl max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-violet-700">
            <Sparkles className="w-5 h-5 text-violet-500" />
            {isEditing ? 'Edit Meta Template' : 'Create Meta Template'}
          </DialogTitle>
          <DialogDescription>
            {isEditing
              ? 'Modify the template. It will be resubmitted to Meta for re-approval.'
              : 'Define a new template. Meta will review it (usually within a few minutes).'}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-5 py-2">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Template Name</Label>
              <Input placeholder="order_delivery_alert" value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') })}
                disabled={isEditing} />
              <p className="text-[10px] text-muted-foreground">Lowercase, alphanumeric + underscores only.</p>
            </div>
            <div className="space-y-1.5">
              <Label>Category</Label>
              <Select value={form.category} onValueChange={(v: any) => setForm({ ...form, category: v })} disabled={isEditing}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="UTILITY">Utility</SelectItem>
                  <SelectItem value="MARKETING">Marketing</SelectItem>
                  <SelectItem value="AUTHENTICATION">Authentication</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Language</Label>
            <Select value={form.language} onValueChange={(v) => setForm({ ...form, language: v })} disabled={isEditing}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {COMMON_LANGUAGES.map((l) => <SelectItem key={l.code} value={l.code}>{l.name} ({l.code})</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* Header */}
          <div className="space-y-3 rounded-lg border p-4 bg-slate-50/50">
            <div className="flex items-center justify-between">
              <div>
                <Label className="font-semibold">Header (optional)</Label>
                <p className="text-[10px] text-muted-foreground mt-0.5">Short title at the top of the message.</p>
              </div>
              <Switch checked={form.hasHeader} onCheckedChange={(v) => setForm({ ...form, hasHeader: v })} />
            </div>
            {form.hasHeader && (
              <Input placeholder="e.g. Order Update" value={form.headerText}
                onChange={(e) => setForm({ ...form, headerText: e.target.value })} maxLength={60} />
            )}
          </div>

          {/* Body */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label>Body Text <span className="text-red-500">*</span></Label>
              <span className="text-[10px] text-muted-foreground">Use {'{{1}}'}, {'{{2}}'} for variables.</span>
            </div>
            <Textarea placeholder="Hello {{1}}, your order #{{2}} is now being prepared!"
              value={form.bodyText}
              onChange={(e) => setForm({ ...form, bodyText: e.target.value })}
              rows={4}
              className={ratioErr ? 'border-red-400 focus-visible:ring-red-400' : ''} />
            {ratioErr && <p className="text-xs text-red-600 flex items-center gap-1.5"><AlertCircle className="w-3.5 h-3.5 shrink-0" />{ratioErr}</p>}
          </div>

          {/* Variable examples */}
          {extractVars(form.bodyText).length > 0 && (
            <div className="space-y-3 rounded-lg border p-4 bg-amber-50/50 border-amber-200">
              <div>
                <Label className="text-sm font-semibold text-amber-800">Variable Example Values</Label>
                <p className="text-[10px] text-amber-700 mt-0.5">Required by Meta — without these, templates get auto-rejected.</p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {extractVars(form.bodyText).map((v) => (
                  <div key={v} className="space-y-1">
                    <Label className="text-[10px] font-mono text-amber-700">{'{{' + v + '}}'}</Label>
                    <Input placeholder={`example for {{${v}}}`}
                      value={form.bodyExamples[v] || ''}
                      onChange={(e) => setForm({ ...form, bodyExamples: { ...form.bodyExamples, [v]: e.target.value } })}
                      className="h-8 text-xs" />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Footer */}
          <div className="space-y-3 rounded-lg border p-4 bg-slate-50/50">
            <div className="flex items-center justify-between">
              <div>
                <Label className="font-semibold">Footer (optional)</Label>
                <p className="text-[10px] text-muted-foreground mt-0.5">Light grey text at the bottom.</p>
              </div>
              <Switch checked={form.hasFooter} onCheckedChange={(v) => setForm({ ...form, hasFooter: v })} />
            </div>
            {form.hasFooter && (
              <Input placeholder="e.g. Reply STOP to unsubscribe" value={form.footerText}
                onChange={(e) => setForm({ ...form, footerText: e.target.value })} maxLength={60} />
            )}
          </div>

          {/* Buttons */}
          <div className="space-y-3 rounded-lg border p-4 bg-slate-50/50">
            <div className="flex items-center justify-between">
              <div>
                <Label className="font-semibold">Buttons (optional)</Label>
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
                      <Button variant="ghost" size="icon" className="h-6 w-6 text-red-500" onClick={() => removeButton(i)}>
                        <PlusCircle className="w-4 h-4 rotate-45" />
                      </Button>
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
                      <Input className="h-8" placeholder="Button label" value={btn.text}
                        onChange={(e) => updateButton(i, { text: e.target.value })} maxLength={25} />
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
                <Button variant="outline" size="sm" onClick={addButton}
                  className="w-full gap-1 border-dashed text-violet-500 hover:text-violet-600">
                  <PlusCircle className="w-4 h-4" /> Add Button
                </Button>
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
          <Button
            disabled={!form.name || !form.bodyText || !!ratioErr || isPending}
            onClick={() => isEditing ? updateMutation.mutate() : createMutation.mutate()}
            className="bg-violet-600 hover:bg-violet-700 text-white"
          >
            {isPending ? 'Submitting…' : isEditing ? 'Save Changes' : 'Submit to Meta'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Templates() {
  const qc = useQueryClient();
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState('meta-templates');
  const [searchQuery, setSearchQuery] = useState('');
  const [catFilter, setCatFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [langFilter, setLangFilter] = useState('ALL');
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 10;

  const [formOpen, setFormOpen] = useState(false);

  const [deleteConfirm, setDeleteConfirm] = useState<{ open: boolean; type: 'meta' | 'mapping' | null; targetIdOrName: string; displayName: string }>({
    open: false, type: null, targetIdOrName: '', displayName: '',
  });

  // Trigger mapping form
  const [mappingForm, setMappingForm] = useState({
    name: '', trigger: 'ORDER_CREATED', metaTemplate: '', language: 'en_US', body: '', isActive: true,
  });

  // ── Queries ────────────────────────────────────────────────────────────────

  const { data: mappings = [], isLoading: isLoadingMappings } = useQuery({
    queryKey: ['templates.mappings'],
    queryFn: async () => (await api.get<{ data: Template[] }>('/templates')).data.data,
  });

  const { data: metaData, isLoading: isLoadingMeta, refetch: refetchMeta } = useQuery({
    queryKey: ['templates.meta'],
    queryFn: async () => {
      const r = await api.get<{ success: boolean; connected: boolean; tokenExpired?: boolean; data: MetaTemplate[] }>('/templates/meta');
      return r.data;
    },
  });

  // While loading show neither "not connected" nor data — just a spinner
  const isConnected = isLoadingMeta ? true : (metaData?.connected ?? false);
  const isTokenExp = metaData?.tokenExpired ?? false;
  const metaTemplates = metaData?.data ?? [];

  // ── Mutations ──────────────────────────────────────────────────────────────

  const deleteMetaMutation = useMutation({
    mutationFn: (name: string) => api.delete(`/templates/meta/${name}`),
    onSuccess: () => { toast.success('Template deleted from Meta'); qc.invalidateQueries({ queryKey: ['templates.meta'] }); },
  });

  const deleteMappingMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/templates/${id}`),
    onSuccess: () => { toast.success('Mapping removed'); qc.invalidateQueries({ queryKey: ['templates.mappings'] }); },
  });

  const saveMapping = useMutation({
    mutationFn: () => api.put('/templates', mappingForm),
    onSuccess: () => {
      toast.success('Trigger mapping saved');
      setMappingForm({ name: '', trigger: 'ORDER_CREATED', metaTemplate: '', language: 'en_US', body: '', isActive: true });
      qc.invalidateQueries({ queryKey: ['templates.mappings'] });
    },
  });

  // ── Derived stats ──────────────────────────────────────────────────────────

  const approvedCount = metaTemplates.filter((t) => t.status.toUpperCase() === 'APPROVED').length;
  const pendingCount = metaTemplates.filter((t) => t.status.toUpperCase() === 'PENDING').length;
  const activeMappings = mappings.filter((m) => m.isActive).length;

  // ── Filtered + paginated ───────────────────────────────────────────────────

  const filtered = useMemo(() => {
    return metaTemplates.filter((t) => {
      if (catFilter !== 'ALL' && t.category !== catFilter) return false;
      if (statusFilter !== 'ALL' && t.status.toUpperCase() !== statusFilter) return false;
      if (langFilter !== 'ALL' && t.language !== langFilter) return false;
      if (searchQuery && !t.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
      return true;
    });
  }, [metaTemplates, catFilter, statusFilter, langFilter, searchQuery]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const uniqueLangs = [...new Set(metaTemplates.map((t) => t.language))];

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleView = (t: MetaTemplate) => {
    navigate(`/templates/${t.id}/view`, { state: { template: t } });
  };

  const handleEdit = (t: MetaTemplate) => {
    navigate(`/templates/${t.id}/edit`, { state: { template: t } });
  };

  const handleMetaTemplateSelect = (id: string) => {
    const t = metaTemplates.find((x) => x.id === id);
    if (!t) return;
    const body = getCompText(t, 'BODY');
    setMappingForm({
      ...mappingForm, metaTemplate: t.name, language: t.language, body,
      name: t.name.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
    });
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">
      {/* Page header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Message Templates</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Manage WhatsApp templates directly from Meta and map them to business events.</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button variant="outline" size="sm" className="gap-1.5"
            onClick={() => refetchMeta()}>
            <RefreshCw className={`w-4 h-4 ${isLoadingMeta ? 'animate-spin' : ''}`} />
            Sync Meta Templates
          </Button>
          <Button
            size="sm"
            className="gap-1.5 bg-violet-600 hover:bg-violet-700 text-white"
            disabled={!isConnected}
            onClick={() => setFormOpen(true)}
          >
            <Plus className="w-4 h-4" /> Create Template
          </Button>
          <Button variant="ghost" size="icon" className="w-9 h-9">
            <Settings className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-xl border bg-white shadow-sm p-5 flex items-center gap-4">
          <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${isConnected ? 'bg-emerald-100' : 'bg-red-100'}`}>
            <svg viewBox="0 0 24 24" className={`w-5 h-5 ${isConnected ? 'fill-emerald-600' : 'fill-red-500'}`}>
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
              <path d="M12 0C5.373 0 0 5.373 0 12c0 2.123.554 4.118 1.528 5.854L0 24l6.335-1.52A11.945 11.945 0 0 0 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-1.89 0-3.663-.493-5.2-1.357l-.372-.22-3.762.902.937-3.653-.243-.384A9.95 9.95 0 0 1 2 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"/>
            </svg>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Meta Connection</p>
            <p className={`text-2xl font-bold mt-0.5 ${isConnected ? 'text-emerald-600' : 'text-red-500'}`}>
              {isConnected ? 'Live' : 'Off'}
            </p>
            <p className="text-xs text-muted-foreground">{isConnected ? 'WABA connected' : 'Not connected'}</p>
          </div>
        </div>

        <div className="rounded-xl border bg-white shadow-sm p-5 flex items-center gap-4">
          <div className="w-11 h-11 rounded-xl bg-blue-100 flex items-center justify-center shrink-0">
            <FileText className="w-5 h-5 text-blue-600" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Total Templates</p>
            <p className="text-2xl font-bold mt-0.5">{metaTemplates.length}</p>
            <p className="text-xs text-muted-foreground">{approvedCount} Approved</p>
          </div>
        </div>

        <div className="rounded-xl border bg-white shadow-sm p-5 flex items-center gap-4">
          <div className="w-11 h-11 rounded-xl bg-amber-100 flex items-center justify-center shrink-0">
            <Clock className="w-5 h-5 text-amber-500" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Pending Review</p>
            <p className="text-2xl font-bold mt-0.5">{pendingCount}</p>
            <p className="text-xs text-muted-foreground">Awaiting Meta approval</p>
          </div>
        </div>

        <div className="rounded-xl border bg-white shadow-sm p-5 flex items-center gap-4">
          <div className="w-11 h-11 rounded-xl bg-violet-100 flex items-center justify-center shrink-0">
            <Link2 className="w-5 h-5 text-violet-600" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Active Mappings</p>
            <p className="text-2xl font-bold mt-0.5">{activeMappings}</p>
            <p className="text-xs text-muted-foreground">Business triggers connected</p>
          </div>
        </div>
      </div>

      {/* Main content */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="meta-templates">Meta Templates</TabsTrigger>
          <TabsTrigger value="trigger-mapping">Trigger Mapping</TabsTrigger>
        </TabsList>

        {/* ── Meta Templates Tab ─────────────────────────────────────────── */}
        <TabsContent value="meta-templates" className="mt-4">
          {!isConnected ? (
            <Card className="border-dashed border-2">
              <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                <AlertCircle className="w-10 h-10 text-amber-500 mb-4" />
                <h3 className="font-bold text-lg">WhatsApp Account Not Connected</h3>
                <p className="text-sm text-muted-foreground max-w-sm mt-1 mb-4">
                  Connect your WhatsApp Business Account in the WhatsApp Setup page to manage templates.
                </p>
                <Button onClick={() => navigate('/whatsapp')}>Go to WhatsApp Setup</Button>
              </CardContent>
            </Card>
          ) : isTokenExp ? (
            <Card className="border-dashed border-2 border-red-200">
              <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                <AlertCircle className="w-10 h-10 text-red-500 mb-4" />
                <h3 className="font-bold text-lg text-red-700">Access Token Expired</h3>
                <p className="text-sm text-muted-foreground max-w-sm mt-1 mb-4">
                  Your Meta token has expired. Please reconnect in WhatsApp Setup.
                </p>
                <Button onClick={() => navigate('/whatsapp')} className="bg-red-600 hover:bg-red-700 text-white">
                  Go to WhatsApp Setup
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="flex gap-5">
              {/* Table column */}
              <div className="flex-1 min-w-0">
                <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
                    {/* Search + filters bar */}
                    <div className="flex items-center gap-2 p-4 border-b flex-wrap">
                      <div className="relative flex-1 min-w-48">
                        <input
                          className="w-full h-9 pl-9 pr-3 text-sm border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-400"
                          placeholder="Search templates..."
                          value={searchQuery}
                          onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
                        />
                        <svg className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" /></svg>
                      </div>
                      <Select value={catFilter} onValueChange={(v) => { setCatFilter(v); setPage(1); }}>
                        <SelectTrigger className="h-9 w-40 text-sm"><SelectValue placeholder="All Categories" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="ALL">All Categories</SelectItem>
                          <SelectItem value="UTILITY">Utility</SelectItem>
                          <SelectItem value="MARKETING">Marketing</SelectItem>
                          <SelectItem value="AUTHENTICATION">Authentication</SelectItem>
                        </SelectContent>
                      </Select>
                      <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
                        <SelectTrigger className="h-9 w-36 text-sm"><SelectValue placeholder="All Status" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="ALL">All Status</SelectItem>
                          <SelectItem value="APPROVED">Approved</SelectItem>
                          <SelectItem value="PENDING">Pending</SelectItem>
                          <SelectItem value="REJECTED">Rejected</SelectItem>
                        </SelectContent>
                      </Select>
                      <Select value={langFilter} onValueChange={(v) => { setLangFilter(v); setPage(1); }}>
                        <SelectTrigger className="h-9 w-36 text-sm"><SelectValue placeholder="All Languages" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="ALL">All Languages</SelectItem>
                          {uniqueLangs.map((l) => <SelectItem key={l} value={l}>{LANG_LABEL[l] || l}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Table */}
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-slate-50/50 hover:bg-slate-50/50">
                          <TableHead className="text-[11px] font-semibold uppercase tracking-wide pl-4">Template Name</TableHead>
                          <TableHead className="text-[11px] font-semibold uppercase tracking-wide">Category</TableHead>
                          <TableHead className="text-[11px] font-semibold uppercase tracking-wide">Language</TableHead>
                          <TableHead className="text-[11px] font-semibold uppercase tracking-wide">Status</TableHead>
                          <TableHead className="text-[11px] font-semibold uppercase tracking-wide pr-4 text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {isLoadingMeta ? (
                          <TableRow><TableCell colSpan={6} className="py-16 text-center">
                            <RefreshCw className="w-6 h-6 animate-spin text-violet-500 mx-auto" />
                          </TableCell></TableRow>
                        ) : paginated.length === 0 ? (
                          <TableRow><TableCell colSpan={6} className="py-16 text-center text-muted-foreground text-sm">
                            No templates match your filters.
                          </TableCell></TableRow>
                        ) : paginated.map((t) => {
                          const cs = CAT_STYLE[t.category] || CAT_STYLE.UTILITY;
                          const bodyPreview = getCompText(t, 'BODY').slice(0, 55);
                          return (
                            <TableRow key={t.id} className="hover:bg-slate-50/50">
                              <TableCell className="pl-4">
                                <div className="flex items-center gap-3">
                                  <CatIcon category={t.category} />
                                  <div>
                                    <p className="font-medium text-sm text-slate-800">{t.name}</p>
                                    <p className="text-[11px] text-slate-400 truncate max-w-[200px]">{bodyPreview}{bodyPreview.length === 55 ? '…' : ''}</p>
                                  </div>
                                </div>
                              </TableCell>
                              <TableCell>
                                <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${cs.bg} ${cs.text}`}>
                                  {t.category.charAt(0) + t.category.slice(1).toLowerCase()}
                                </span>
                              </TableCell>
                              <TableCell className="text-sm text-slate-600">{LANG_LABEL[t.language] || t.language}</TableCell>
                              <TableCell><StatusBadge status={t.status} /></TableCell>
                              <TableCell className="pr-4">
                                <div className="flex items-center justify-end gap-1">
                                  <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400 hover:text-slate-700" onClick={() => handleView(t)}>
                                    <Eye className="w-4 h-4" />
                                  </Button>
                                  <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400 hover:text-violet-600" onClick={() => handleEdit(t)}>
                                    <Pencil className="w-4 h-4" />
                                  </Button>
                                  <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400 hover:text-red-500"
                                    onClick={() => setDeleteConfirm({ open: true, type: 'meta', targetIdOrName: t.name, displayName: t.name })}>
                                    <Trash2 className="w-4 h-4" />
                                  </Button>
                                </div>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>

                    {/* Pagination */}
                    {totalPages > 1 && (
                      <div className="flex items-center justify-between px-4 py-3 border-t text-sm text-slate-500">
                        <span>Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length} templates</span>
                        <div className="flex items-center gap-1">
                          <Button variant="ghost" size="icon" className="h-8 w-8" disabled={page === 1} onClick={() => setPage(p => p - 1)}>
                            <ChevronLeft className="w-4 h-4" />
                          </Button>
                          {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                            const n = i + 1;
                            return (
                              <Button key={n} variant={page === n ? 'default' : 'ghost'} size="icon"
                                className={`h-8 w-8 text-xs ${page === n ? 'bg-violet-600 text-white hover:bg-violet-700' : ''}`}
                                onClick={() => setPage(n)}>
                                {n}
                              </Button>
                            );
                          })}
                          {totalPages > 5 && <span className="px-1">…</span>}
                          <Button variant="ghost" size="icon" className="h-8 w-8" disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>
                            <ChevronRight className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    )}
                </div>
              </div>

              {/* Quick Actions sidebar */}
              <div className="w-60 shrink-0 hidden xl:block">
                <Card className="shadow-sm">
                  <CardHeader className="pb-2 pt-4 px-4">
                    <CardTitle className="text-sm">Quick Actions</CardTitle>
                  </CardHeader>
                  <CardContent className="px-3 pb-4 space-y-1">
                    {[
                      { icon: Plus, label: 'Create New Template', desc: 'Design a new WhatsApp template', action: () => setFormOpen(true), color: 'text-violet-600 bg-violet-50' },
                      { icon: Link2, label: 'Configure Trigger Mapping', desc: 'Map templates to business events', action: () => setActiveTab('trigger-mapping'), color: 'text-blue-600 bg-blue-50' },
                      { icon: FileText, label: 'Template Guidelines', desc: 'Meta template best practices', action: () => window.open('https://developers.facebook.com/docs/whatsapp/message-templates/guidelines/', '_blank'), color: 'text-slate-600 bg-slate-50' },
                    ].map(({ icon: Icon, label, desc, action, color }) => (
                      <button key={label} onClick={action}
                        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-slate-50 text-left transition-colors group">
                        <span className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${color}`}>
                          <Icon className="w-3.5 h-3.5" />
                        </span>
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-slate-700 group-hover:text-slate-900 truncate">{label}</p>
                          <p className="text-[10px] text-slate-400 truncate">{desc}</p>
                        </div>
                        <ChevronRight className="w-3.5 h-3.5 text-slate-300 group-hover:text-slate-500 shrink-0 ml-auto" />
                      </button>
                    ))}
                  </CardContent>
                </Card>
              </div>
            </div>
          )}
        </TabsContent>

        {/* ── Trigger Mapping Tab ────────────────────────────────────────── */}
        <TabsContent value="trigger-mapping" className="mt-4">
          <div className="grid gap-6 md:grid-cols-3">
            <Card className="md:col-span-1 h-fit shadow-sm">
              <CardHeader>
                <CardTitle className="text-base">Map Order Trigger</CardTitle>
                <CardDescription>Assign Meta-approved templates to order status changes.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1.5">
                  <Label className="text-xs">Display Name</Label>
                  <Input placeholder="e.g. Order Accepted Alert" value={mappingForm.name}
                    onChange={(e) => setMappingForm({ ...mappingForm, name: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Order Status Trigger</Label>
                  <Select value={mappingForm.trigger} onValueChange={(v) => setMappingForm({ ...mappingForm, trigger: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {TRIGGERS.map((t) => <SelectItem key={t} value={t}>{t.replace(/_/g, ' ')}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Meta Template</Label>
                  {!isConnected ? (
                    <p className="text-xs text-amber-600 bg-amber-50 p-2 rounded flex items-center gap-1.5">
                      <AlertCircle className="w-3.5 h-3.5" /> WABA not connected
                    </p>
                  ) : (
                    <Select
                      value={metaTemplates.find((t) => t.name === mappingForm.metaTemplate && t.language === mappingForm.language)?.id || ''}
                      onValueChange={handleMetaTemplateSelect}
                    >
                      <SelectTrigger><SelectValue placeholder="Select approved template…" /></SelectTrigger>
                      <SelectContent>
                        {metaTemplates.filter((t) => t.status.toUpperCase() === 'APPROVED').map((t) => (
                          <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                        ))}
                        {metaTemplates.filter((t) => t.status.toUpperCase() === 'APPROVED').length === 0 && (
                          <SelectItem value="_" disabled>No approved templates yet</SelectItem>
                        )}
                      </SelectContent>
                    </Select>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Language</Label>
                  <Input value={mappingForm.language} disabled className="bg-slate-50 font-mono text-xs" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Body Preview</Label>
                  <Textarea value={mappingForm.body} disabled placeholder="Template preview will load here…" rows={3} className="bg-slate-50 text-xs" />
                </div>
                <Button className="w-full bg-violet-600 hover:bg-violet-700 text-white"
                  disabled={!mappingForm.name || !mappingForm.metaTemplate || saveMapping.isPending}
                  onClick={() => saveMapping.mutate()}>
                  {saveMapping.isPending ? 'Saving…' : 'Save Mapping'}
                </Button>
              </CardContent>
            </Card>

            <Card className="md:col-span-2 shadow-sm">
              <CardHeader>
                <CardTitle className="text-base">Configured Triggers</CardTitle>
                <CardDescription>Notifications that fire automatically when order statuses change.</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50/50 hover:bg-slate-50/50">
                      <TableHead className="text-[11px] font-semibold uppercase tracking-wide">Trigger</TableHead>
                      <TableHead className="text-[11px] font-semibold uppercase tracking-wide">Name</TableHead>
                      <TableHead className="text-[11px] font-semibold uppercase tracking-wide">Template</TableHead>
                      <TableHead className="text-[11px] font-semibold uppercase tracking-wide">Lang</TableHead>
                      <TableHead className="text-[11px] font-semibold uppercase tracking-wide">Status</TableHead>
                      <TableHead className="w-10" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoadingMappings ? (
                      <TableRow><TableCell colSpan={6} className="py-10 text-center">
                        <RefreshCw className="w-5 h-5 animate-spin text-violet-500 mx-auto" />
                      </TableCell></TableRow>
                    ) : mappings.length === 0 ? (
                      <TableRow><TableCell colSpan={6} className="py-10 text-center text-muted-foreground text-sm">
                        No trigger mappings configured yet.
                      </TableCell></TableRow>
                    ) : mappings.map((m) => (
                      <TableRow key={m.id}>
                        <TableCell className="font-semibold text-xs text-violet-600">{m.trigger.replace(/_/g, ' ')}</TableCell>
                        <TableCell className="text-xs font-medium">{m.name}</TableCell>
                        <TableCell className="font-mono text-xs text-slate-500">{m.metaTemplate}</TableCell>
                        <TableCell className="text-xs font-mono">{m.language}</TableCell>
                        <TableCell>
                          {m.isActive
                            ? <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 text-[10px]">Active</Badge>
                            : <Badge variant="secondary" className="text-[10px]">Off</Badge>}
                        </TableCell>
                        <TableCell>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-red-400 hover:text-red-600 hover:bg-red-50"
                            onClick={() => setDeleteConfirm({ open: true, type: 'mapping', targetIdOrName: m.id, displayName: m.trigger.replace(/_/g, ' ') })}>
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      {/* Create Template Dialog (new only — edit goes to /templates/:id/edit) */}
      <TemplateFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        editingTemplate={null}
        metaTemplates={metaTemplates}
        onSuccess={() => qc.invalidateQueries({ queryKey: ['templates.meta'] })}
      />

      {/* Delete Confirm Dialog */}
      <Dialog open={deleteConfirm.open} onOpenChange={(v) => setDeleteConfirm({ ...deleteConfirm, open: v })}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <AlertCircle className="w-5 h-5" /> Confirm Deletion
            </DialogTitle>
            <DialogDescription className="text-sm mt-1">
              {deleteConfirm.type === 'meta'
                ? `Delete "${deleteConfirm.displayName}" from Meta? This cannot be undone.`
                : `Remove the trigger mapping for "${deleteConfirm.displayName}"?`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 mt-2">
            <Button variant="outline" size="sm"
              onClick={() => setDeleteConfirm({ open: false, type: null, targetIdOrName: '', displayName: '' })}>
              Cancel
            </Button>
            <Button variant="destructive" size="sm"
              onClick={() => {
                if (deleteConfirm.type === 'meta') deleteMetaMutation.mutate(deleteConfirm.targetIdOrName);
                else deleteMappingMutation.mutate(deleteConfirm.targetIdOrName);
                setDeleteConfirm({ open: false, type: null, targetIdOrName: '', displayName: '' });
              }}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
