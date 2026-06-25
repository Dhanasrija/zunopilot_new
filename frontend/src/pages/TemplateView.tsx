import { useParams, useNavigate, useLocation, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import {
  ChevronLeft, Pencil, Copy, FileText, CheckCircle2,
  Clock, XCircle, MoreVertical, RefreshCw,
} from 'lucide-react';
import { useState } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface MetaTemplate {
  id: string;
  name: string;
  category: string;
  language: string;
  status: string;
  components: any[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const LANG_LABEL: Record<string, string> = {
  en_US: 'English (US)', en_GB: 'English (UK)', en: 'English',
  es_ES: 'Spanish', es_LA: 'Spanish', es: 'Spanish',
  pt_BR: 'Portuguese', fr_FR: 'French', de_DE: 'German',
  it_IT: 'Italian', ar_AR: 'Arabic', hi_IN: 'Hindi',
};

const CAT_STYLE: Record<string, { bg: string; text: string }> = {
  UTILITY: { bg: 'bg-emerald-100', text: 'text-emerald-700' },
  MARKETING: { bg: 'bg-orange-100', text: 'text-orange-700' },
  AUTHENTICATION: { bg: 'bg-blue-100', text: 'text-blue-700' },
};

const CAT_ICON_BG: Record<string, string> = {
  UTILITY: 'bg-emerald-100 text-emerald-600',
  MARKETING: 'bg-orange-100  text-orange-600',
  AUTHENTICATION: 'bg-blue-100    text-blue-600',
};

function getComp(t: MetaTemplate, type: string) {
  return t.components?.find((c) => c.type === type);
}
function getCompText(t: MetaTemplate, type: string): string {
  return getComp(t, type)?.text || '';
}
function getButtons(t: MetaTemplate): any[] {
  return getComp(t, 'BUTTONS')?.buttons || [];
}
function extractVars(text: string): string[] {
  return [...new Set([...text.matchAll(/\{\{(\d+)\}\}/g)].map((m) => m[1]))].sort((a, b) => +a - +b);
}

// ── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const s = status.toUpperCase();
  if (s === 'APPROVED') return <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 gap-1"><CheckCircle2 className="w-3 h-3" />Approved</Badge>;
  if (s === 'PENDING') return <Badge className="bg-amber-100 text-amber-700 border-amber-200 gap-1"><Clock className="w-3 h-3" />Pending</Badge>;
  if (s === 'REJECTED') return <Badge variant="destructive" className="gap-1"><XCircle className="w-3 h-3" />Rejected</Badge>;
  return <Badge variant="outline">{status}</Badge>;
}

// ── WhatsApp preview ──────────────────────────────────────────────────────────

function WhatsappPreview({ template }: { template: MetaTemplate }) {
  const header = getCompText(template, 'HEADER');
  const body = getCompText(template, 'BODY');
  const footer = getCompText(template, 'FOOTER');
  const btns = getButtons(template);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-semibold">WhatsApp Preview</span>
          <span className="text-slate-400 text-xs">ⓘ</span>
        </div>
        <div className="flex gap-1">
          <button className="px-2 py-1 text-xs border rounded hover:bg-slate-50">📱</button>
          <button className="px-2 py-1 text-xs border rounded hover:bg-slate-50">💻</button>
        </div>
      </div>

      {/* Phone mockup */}
      <div className="flex-1 bg-[#E5DDD5] rounded-xl overflow-hidden border border-slate-200 flex flex-col">
        {/* Chat header bar */}
        <div className="bg-[#075E54] px-3 py-2 flex items-center gap-2 shrink-0">
          <ChevronLeft className="w-4 h-4 text-white" />
          <div className="w-8 h-8 rounded-full bg-emerald-400 flex items-center justify-center text-sm font-bold text-white shrink-0">Z</div>
          <div className="flex-1 min-w-0">
            <p className="text-white text-xs font-semibold truncate">Demo Biryani House</p>
            <p className="text-emerald-200 text-[10px]">Business Account ✓</p>
          </div>
          <MoreVertical className="w-4 h-4 text-white" />
        </div>

        {/* Messages */}
        <div className="flex-1 p-3 overflow-y-auto space-y-1">
          <div className="max-w-[88%] bg-white rounded-xl rounded-tl-none shadow-sm overflow-hidden text-xs">
            {header && (
              <div className="px-3 pt-2.5 pb-1 font-bold text-slate-900 border-b border-slate-100 leading-snug">
                {header}
              </div>
            )}
            {body && (
              <div className="px-3 py-2 text-slate-800 whitespace-pre-wrap leading-relaxed">
                {body}
              </div>
            )}
            {footer && (
              <div className="px-3 pb-2 text-[10px] text-slate-400 leading-tight">
                {footer}
              </div>
            )}
            <div className="px-3 pb-1.5 text-right text-[9px] text-slate-400">10:30 AM ✓✓</div>
          </div>

          {btns.length > 0 && (
            <div className="max-w-[88%] space-y-1">
              {btns.map((b: any, i: number) => (
                <div key={i} className="bg-white rounded-xl text-center text-[11px] py-2 text-[#53BDEB] font-semibold shadow-sm">
                  {b.text}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <p className="text-[10px] text-slate-400 text-center mt-2 leading-tight">
        This is a preview of how your message will appear to customers.<br />Actual appearance may vary.
      </p>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function TemplateView() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [tab, setTab] = useState('content');

  // Use data passed via navigate state as initial value; fetch for freshness
  const stateTemplate = (location.state as any)?.template as MetaTemplate | undefined;

  const { data: template, isLoading } = useQuery<MetaTemplate>({
    queryKey: ['template', id],
    queryFn: async () => {
      const r = await api.get<{ success: boolean; data: MetaTemplate }>(`/templates/meta/${id}`);
      return r.data.data;
    },
    initialData: stateTemplate,
    staleTime: 30_000,
  });

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
        <Button variant="outline" className="mt-4" onClick={() => navigate('/templates')}>Back to Templates</Button>
      </div>
    );
  }

  const header = getCompText(template, 'HEADER');
  const body = getCompText(template, 'BODY');
  const footer = getCompText(template, 'FOOTER');
  const buttons = getButtons(template);
  const vars = extractVars(body);
  const catStyle = CAT_STYLE[template.category] || CAT_STYLE.UTILITY;
  const catIconCls = CAT_ICON_BG[template.category] || 'bg-slate-100 text-slate-600';

  return (
    <div className="space-y-0 -mt-1">
      {/* Top bar */}
      <div className="flex items-center justify-between py-3 mb-1">
        <div className="flex items-center gap-2">
          <button onClick={() => navigate('/templates')}
            className="p-1.5 rounded-md hover:bg-slate-100 text-slate-500 hover:text-slate-700 transition-colors">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-xl font-semibold leading-none">View Template</h1>
            <p className="text-xs text-muted-foreground mt-0.5">View template details, content, variables and performance.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-1.5"
            onClick={() => navigate(`/templates/${template.id}/edit`, { state: { template } })}>
            <Pencil className="w-3.5 h-3.5" /> Edit Template
          </Button>
          <button className="p-2 rounded-md hover:bg-slate-100 text-slate-400">
            <MoreVertical className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Info card */}
      <div className="rounded-xl border bg-white shadow-sm p-5 mb-5">
        <div className="flex items-start gap-4 flex-wrap">
          {/* Icon + name */}
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${catIconCls}`}>
              <FileText className="w-6 h-6" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="font-semibold text-lg text-slate-900 leading-none">{template.name}</h2>
                <StatusBadge status={template.status} />
              </div>
              <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${catStyle.bg} ${catStyle.text}`}>
                  {template.category.charAt(0) + template.category.slice(1).toLowerCase()} Template
                </span>
                <span className="text-[11px] text-slate-400">☆ {LANG_LABEL[template.language] || template.language}</span>
              </div>
              <p className="text-xs text-slate-500 mt-1.5">
                {template.category === 'UTILITY' && 'Utility messages sent during a transaction or account activity.'}
                {template.category === 'MARKETING' && 'Promotional messages, offers, and announcements.'}
                {template.category === 'AUTHENTICATION' && 'One-time passcodes and verification messages.'}
              </p>
            </div>
          </div>

          {/* Meta info grid */}
          <div className="grid grid-cols-1 gap-y-3 text-xs shrink-0">
            <div>
              <p className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold">Template ID</p>
              <p className="font-mono text-slate-700 mt-0.5">{template.id}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold">Namespace</p>
              <p className="font-mono text-slate-700 mt-0.5">{template.id}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs + Preview */}
      <div className="flex gap-5 items-start">
        {/* Left: tabs */}
        <div className="flex-1 min-w-0 rounded-xl border bg-white shadow-sm overflow-hidden">
          <Tabs value={tab} onValueChange={setTab}>
            <div className="px-5 pt-4 border-b">
              <TabsList className="bg-transparent p-0 h-auto gap-0">
                {[
                  { value: 'content', label: 'Content' },
                  { value: 'variables', label: `Variables (${vars.length})` },
                  { value: 'languages', label: 'Languages (1)' },
                  { value: 'category', label: 'Category' },
                ].map(({ value, label }) => (
                  <button
                    key={value}
                    onClick={() => setTab(value)}
                    className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${tab === value
                        ? 'border-violet-600 text-violet-600'
                        : 'border-transparent text-slate-500 hover:text-slate-700'
                      }`}
                  >
                    {label}
                  </button>
                ))}
              </TabsList>
            </div>

            <div className="p-5">
              {/* ── Content ── */}
              {tab === 'content' && (
                <div className="space-y-5">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-semibold text-sm">Template Content</p>
                      <p className="text-xs text-muted-foreground mt-0.5">This is the content that will be sent to your customers.</p>
                    </div>
                    <Button variant="outline" size="sm" className="gap-1.5 text-xs"
                      onClick={() => {
                        navigator.clipboard.writeText([header, body, footer].filter(Boolean).join('\n\n'));
                        toast.success('Copied to clipboard');
                      }}>
                      <Copy className="w-3.5 h-3.5" /> Copy Content
                    </Button>
                  </div>

                  {header && (
                    <div className="space-y-1.5">
                      <p className="text-xs font-medium text-slate-500">Header (Text)</p>
                      <div className="relative">
                        <textarea
                          readOnly
                          value={header}
                          rows={2}
                          className="w-full resize-none rounded-md border bg-slate-50 px-3 py-2 text-sm text-slate-700 focus:outline-none"
                        />
                        <span className="absolute bottom-2 right-3 text-[10px] text-slate-400">{header.length}/90</span>
                      </div>
                    </div>
                  )}

                  {body && (
                    <div className="space-y-1.5">
                      <p className="text-xs font-medium text-slate-500">Body (Text)</p>
                      <div className="relative">
                        <textarea
                          readOnly
                          value={body}
                          rows={6}
                          className="w-full resize-none rounded-md border bg-slate-50 px-3 py-2 text-sm text-slate-700 focus:outline-none"
                        />
                        <span className="absolute bottom-2 right-3 text-[10px] text-slate-400">{body.length}/1024</span>
                      </div>
                    </div>
                  )}

                  {footer && (
                    <div className="space-y-1.5">
                      <p className="text-xs font-medium text-slate-500">Footer (Text)</p>
                      <div className="relative">
                        <textarea
                          readOnly
                          value={footer}
                          rows={2}
                          className="w-full resize-none rounded-md border bg-slate-50 px-3 py-2 text-sm text-slate-700 focus:outline-none"
                        />
                        <span className="absolute bottom-2 right-3 text-[10px] text-slate-400">{footer.length}/90</span>
                      </div>
                    </div>
                  )}

                  {buttons.length > 0 && (
                    <div className="space-y-1.5">
                      <p className="text-xs font-medium text-slate-500">Buttons</p>
                      <div className="space-y-2">
                        {buttons.map((b: any, i: number) => (
                          <div key={i} className="flex items-center gap-2 p-2.5 rounded-md bg-slate-50 border text-sm">
                            <Badge variant="outline" className="text-[10px] uppercase">{b.type.replace('_', ' ')}</Badge>
                            <span className="font-medium">{b.text}</span>
                            {b.url && <span className="text-xs text-blue-600 truncate ml-auto">{b.url}</span>}
                            {b.phone_number && <span className="text-xs text-slate-500 ml-auto">{b.phone_number}</span>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ── Variables ── */}
              {tab === 'variables' && (
                <div className="space-y-3">
                  {vars.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-8 text-center">No variables in this template.</p>
                  ) : (
                    <>
                      <p className="text-sm text-muted-foreground">
                        This template uses {vars.length} variable{vars.length !== 1 ? 's' : ''} that are filled at send time.
                      </p>
                      <div className="divide-y border rounded-lg overflow-hidden">
                        {vars.map((v) => (
                          <div key={v} className="flex items-center justify-between px-4 py-3 bg-white hover:bg-slate-50">
                            <div className="flex items-center gap-3">
                              <code className="text-sm font-bold text-violet-600 bg-violet-50 px-2 py-0.5 rounded">{`{{${v}}}`}</code>
                              <span className="text-sm text-slate-600">Variable {v}</span>
                            </div>
                            <Badge variant="outline" className="text-[10px]">Dynamic</Badge>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* ── Languages ── */}
              {tab === 'languages' && (
                <div className="border rounded-lg overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3.5 bg-white">
                    <div className="flex items-center gap-3">
                      <span className="text-xl">🌐</span>
                      <div>
                        <p className="text-sm font-medium">{LANG_LABEL[template.language] || template.language}</p>
                        <p className="text-[10px] text-slate-500 font-mono mt-0.5">{template.language}</p>
                      </div>
                    </div>
                    <StatusBadge status={template.status} />
                  </div>
                </div>
              )}

              {/* ── Category ── */}
              {tab === 'category' && (
                <div className={`rounded-lg border p-4 ${catStyle.bg}`}>
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${catIconCls}`}>
                      <FileText className="w-5 h-5" />
                    </div>
                    <div>
                      <p className={`font-semibold text-sm ${catStyle.text}`}>{template.category}</p>
                      <p className="text-xs text-slate-600 mt-0.5">
                        {template.category === 'UTILITY' && 'Transactional messages, order updates, account alerts.'}
                        {template.category === 'MARKETING' && 'Promotions, offers, product announcements.'}
                        {template.category === 'AUTHENTICATION' && 'One-time passwords, verification codes.'}
                      </p>
                    </div>
                  </div>
                </div>
              )}

            </div>
          </Tabs>
        </div>

        {/* Right: WhatsApp preview */}
        <div className="w-72 shrink-0 sticky top-6">
          <div className="rounded-xl border bg-white shadow-sm p-4">
            <WhatsappPreview template={template} />
          </div>
        </div>
      </div>
    </div>
  );
}
