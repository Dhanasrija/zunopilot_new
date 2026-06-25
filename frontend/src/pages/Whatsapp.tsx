import { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { formatDateTime } from '@/lib/utils';
import { useFacebookSdk } from '@/hooks/useFacebookSdk';
import {
  RefreshCw, Copy, ExternalLink, AlertTriangle, Shield,
  Eye, EyeOff, Info, CheckCircle2, Smartphone,
} from 'lucide-react';

interface Account {
  id: string;
  wabaId: string;
  phoneNumberId: string;
  displayPhone?: string;
  businessName?: string;
  connectedAt: string;
  tokenExpired?: boolean;
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
      className="ml-1.5 text-slate-400 hover:text-slate-600 transition-colors"
      title="Copy"
    >
      {copied ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}

export default function Whatsapp() {
  const qc = useQueryClient();
  const [newToken, setNewToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [manual, setManual] = useState({ wabaId: '', phoneNumberId: '', displayPhone: '', accessToken: '' });

  const { data: account, isLoading } = useQuery({
    queryKey: ['whatsapp.account'],
    queryFn: async () => (await api.get<{ data: Account | null }>('/whatsapp')).data.data,
  });

  const { data: config } = useQuery({
    queryKey: ['whatsapp.config'],
    queryFn: async () =>
      (await api.get<{ data: { appId: string; configId: string; graphVersion: string } }>('/whatsapp/config')).data.data,
  });

  const updateToken = useMutation({
    mutationFn: () => api.patch('/whatsapp/token', { accessToken: newToken }),
    onSuccess: () => {
      toast.success('Access token updated successfully');
      setNewToken('');
      qc.invalidateQueries({ queryKey: ['whatsapp.account'] });
    },
  });

  const disconnect = useMutation({
    mutationFn: () => api.delete('/whatsapp'),
    onSuccess: () => {
      toast.success('WhatsApp account disconnected');
      qc.invalidateQueries({ queryKey: ['whatsapp.account'] });
    },
  });

  const submit = useMutation({
    mutationFn: (payload: any) => api.post('/whatsapp/embedded-signup', payload),
    onSuccess: () => {
      toast.success('WhatsApp connected');
      qc.invalidateQueries({ queryKey: ['whatsapp.account'] });
    },
  });

  const sdkReady = useFacebookSdk({ appId: config?.appId, graphVersion: config?.graphVersion });
  const sessionInfoRef = useRef<{ waba_id?: string; phone_number_id?: string; business_name?: string } | null>(null);

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (typeof event.data !== 'string') return;
      if (!event.origin.endsWith('facebook.com')) return;
      try {
        const payload = JSON.parse(event.data);
        if (payload.type === 'WA_EMBEDDED_SIGNUP') {
          if (payload.event === 'FINISH' && payload.data) sessionInfoRef.current = payload.data;
          else if (payload.event === 'CANCEL') sessionInfoRef.current = null;
        }
      } catch { /* ignore */ }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  const launchEmbeddedSignup = () => {
    if (!sdkReady || !window.FB) return toast.error('Facebook SDK still loading…');
    if (!config?.configId) return toast.error('Missing Embedded Signup config_id on the backend');
    sessionInfoRef.current = null;
    window.FB.login(
      (response: any) => {
        const code = response?.authResponse?.code;
        if (!code) return toast.error('Signup cancelled');
        const info = sessionInfoRef.current;
        if (!info?.waba_id || !info?.phone_number_id)
          return toast.error('Did not receive WABA / phone info from Meta — try again');
        submit.mutate({ code, wabaId: info.waba_id, phoneNumberId: info.phone_number_id, businessName: info.business_name });
      },
      {
        config_id: config.configId,
        response_type: 'code',
        override_default_response_type: true,
        extras: { feature: 'whatsapp_embedded_signup', sessionInfoVersion: 2 },
      }
    );
  };

  return (
    <div className="space-y-5">
      {/* Page header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-500 flex items-center justify-center shrink-0">
            <svg viewBox="0 0 24 24" className="w-6 h-6 fill-white"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.123.554 4.118 1.528 5.854L0 24l6.335-1.52A11.945 11.945 0 0 0 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-1.89 0-3.663-.493-5.2-1.357l-.372-.22-3.762.902.937-3.653-.243-.384A9.95 9.95 0 0 1 2 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"/></svg>
          </div>
          <div>
            <h1 className="text-2xl font-bold">WhatsApp Setup</h1>
            <p className="text-sm text-muted-foreground mt-0.5">Link your WhatsApp Business Account via Meta Embedded Signup to start receiving orders.</p>
          </div>
        </div>
        <Button variant="outline" size="sm" className="gap-1.5 shrink-0"
          onClick={() => window.open('https://developers.facebook.com/docs/whatsapp/embedded-signup', '_blank')}>
          <Info className="w-3.5 h-3.5" /> How it works?
        </Button>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="rounded-xl border bg-white shadow-sm p-12 flex flex-col items-center justify-center gap-3">
          <RefreshCw className="w-7 h-7 animate-spin text-emerald-500" />
          <p className="text-sm text-slate-500">Checking WhatsApp account status…</p>
        </div>
      )}

      {/* ── CONNECTED ── */}
      {!isLoading && account && (
        <div className="space-y-4">
          {/* Connection card */}
          <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
            {/* View in Meta link */}
            <div className="flex justify-end px-5 pt-4">
              <a
                href={`https://business.facebook.com/wa/manage/phone-numbers/?waba_id=${account.wabaId}`}
                target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 transition-colors"
              >
                View in Meta <ExternalLink className="w-3 h-3" />
              </a>
            </div>

            <div className="flex flex-col md:flex-row gap-6 px-6 pb-6">
              {/* Left: status + disconnect */}
              <div className="flex flex-col items-start gap-4 md:w-64 shrink-0">
                {/* WhatsApp logo with check */}
                <div className="relative">
                  <div className="w-20 h-20 rounded-full bg-emerald-50 border-4 border-emerald-100 flex items-center justify-center">
                    <div className="w-14 h-14 rounded-full bg-emerald-500 flex items-center justify-center">
                      <svg viewBox="0 0 24 24" className="w-8 h-8 fill-white"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.123.554 4.118 1.528 5.854L0 24l6.335-1.52A11.945 11.945 0 0 0 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-1.89 0-3.663-.493-5.2-1.357l-.372-.22-3.762.902.937-3.653-.243-.384A9.95 9.95 0 0 1 2 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"/></svg>
                    </div>
                  </div>
                  <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-emerald-500 border-2 border-white flex items-center justify-center">
                    <CheckCircle2 className="w-3.5 h-3.5 text-white" />
                  </div>
                </div>

                <div>
                  <p className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold">Connection Status</p>
                  <p className="text-3xl font-bold text-slate-900 mt-0.5">Connected</p>
                  {account.tokenExpired && (
                    <Badge className="mt-2 bg-amber-100 text-amber-700 border-amber-300 font-semibold">
                      Token Expired
                    </Badge>
                  )}
                  {account.tokenExpired && (
                    <p className="text-xs text-slate-500 mt-2 leading-relaxed">
                      Your WhatsApp Business account is connected, but{' '}
                      <span className="text-red-500 font-medium">the access token has expired.</span>
                    </p>
                  )}
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 text-red-500 border-red-200 hover:bg-red-50 hover:border-red-300 hover:text-red-600"
                  onClick={() => disconnect.mutate()}
                  disabled={disconnect.isPending}
                >
                  {disconnect.isPending
                    ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Disconnecting…</>
                    : <><span className="text-red-400">⏻</span> Disconnect</>}
                </Button>
              </div>

              {/* Divider */}
              <div className="hidden md:block w-px bg-slate-100 self-stretch" />

              {/* Right: info grid */}
              <div className="flex-1 grid grid-cols-2 gap-x-8 gap-y-4 content-start">
                {[
                  { label: 'WABA ID', value: account.wabaId, copy: true, icon: '</>' },
                  { label: 'Business Name', value: account.businessName || '—', icon: '🏢' },
                  { label: 'Phone Number ID', value: account.phoneNumberId, copy: true, icon: '📞' },
                  { label: 'Connected On', value: formatDateTime(account.connectedAt), icon: '📅' },
                  { label: 'Display Name', value: account.displayPhone || '—', copy: !!account.displayPhone, icon: '👤' },
                  { label: 'Business Account Status', value: 'ACTIVE', isStatus: true, icon: '🕐' },
                ].map(({ label, value, copy, icon, isStatus }) => (
                  <div key={label}>
                    <p className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold">{label}</p>
                    <div className="flex items-center mt-1">
                      {isStatus ? (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />{value}
                        </span>
                      ) : (
                        <>
                          <span className="text-sm font-medium text-slate-700 font-mono truncate max-w-[180px]">{value}</span>
                          {copy && value !== '—' && <CopyButton value={value} />}
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Token expired section */}
          {account.tokenExpired && (
            <>
              <div className="rounded-xl border border-red-200 bg-red-50/40 shadow-sm overflow-hidden">
                <div className="grid md:grid-cols-2 gap-0">
                  {/* Left: instructions */}
                  <div className="p-6 border-r border-red-100">
                    <div className="flex items-start gap-3 mb-4">
                      <div className="w-9 h-9 rounded-full bg-red-100 border border-red-200 flex items-center justify-center shrink-0 mt-0.5">
                        <AlertTriangle className="w-4 h-4 text-red-500" />
                      </div>
                      <div>
                        <h3 className="font-bold text-slate-900">Meta Access Token Expired</h3>
                        <p className="text-sm text-slate-500 mt-0.5 leading-relaxed">
                          Your Meta developer access token is no longer valid. Paste a new token from your Meta Developer Dashboard to resume template operations.
                        </p>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <p className="text-xs font-semibold text-slate-700">How to generate a new token?</p>
                      {[
                        { n: 1, text: <>Go to <a href="https://developers.facebook.com" target="_blank" rel="noreferrer" className="text-blue-600 hover:underline font-medium">Meta Developer Portal <ExternalLink className="w-3 h-3 inline" /></a></> },
                        { n: 2, text: <>Navigate to <span className="font-medium">App Dashboard &gt; WhatsApp &gt; API Setup <ExternalLink className="w-3 h-3 inline text-slate-400" /></span></> },
                        { n: 3, text: 'Generate a new access token with required permissions' },
                        { n: 4, text: 'Copy and paste the token below' },
                      ].map(({ n, text }) => (
                        <div key={n} className="flex items-start gap-3">
                          <span className="w-5 h-5 rounded-full bg-slate-200 text-slate-600 text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">{n}</span>
                          <p className="text-xs text-slate-600 leading-relaxed">{text}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Right: token input */}
                  <div className="p-6 bg-white">
                    <h3 className="font-bold text-slate-900 mb-1">Paste New Meta Access Token</h3>
                    <p className="text-xs text-slate-500 mb-5">Enter the new access token to reconnect your WhatsApp account.</p>

                    <div className="space-y-3">
                      <div className="relative">
                        <div className="absolute left-3 top-2.5 text-slate-400">
                          <Shield className="w-4 h-4" />
                        </div>
                        <input
                          type={showToken ? 'text' : 'password'}
                          placeholder="EAA..."
                          value={newToken}
                          onChange={(e) => setNewToken(e.target.value)}
                          className="w-full h-10 pl-9 pr-10 text-sm border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-400 font-mono"
                        />
                        <button
                          type="button"
                          onClick={() => setShowToken((v) => !v)}
                          className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600"
                        >
                          {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>

                      <Button
                        className="w-full bg-violet-600 hover:bg-violet-700 text-white font-semibold"
                        disabled={!newToken || updateToken.isPending}
                        onClick={() => updateToken.mutate()}
                      >
                        {updateToken.isPending ? <><RefreshCw className="w-4 h-4 animate-spin mr-2" />Updating…</> : 'Update Token'}
                      </Button>

                      <div className="flex items-start gap-2 pt-1">
                        <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                        <p className="text-[11px] text-slate-500 leading-relaxed">
                          We never store your token. It is encrypted and securely used to connect with Meta API.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Bottom note */}
              <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-slate-50 border text-xs text-slate-500">
                <Info className="w-4 h-4 shrink-0 text-slate-400" />
                <span><strong>Note:</strong> Some features like sending templates and receiving messages will be paused until the token is updated.</span>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── NOT CONNECTED ── */}
      {!isLoading && !account && (
        <div className="space-y-4">
          {/* Connect card */}
          <div className="rounded-xl border bg-white shadow-sm p-8 flex flex-col items-center text-center gap-5">
            <div className="w-20 h-20 rounded-full bg-emerald-50 border-4 border-emerald-100 flex items-center justify-center">
              <div className="w-14 h-14 rounded-full bg-emerald-500 flex items-center justify-center">
                <svg viewBox="0 0 24 24" className="w-8 h-8 fill-white"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.123.554 4.118 1.528 5.854L0 24l6.335-1.52A11.945 11.945 0 0 0 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-1.89 0-3.663-.493-5.2-1.357l-.372-.22-3.762.902.937-3.653-.243-.384A9.95 9.95 0 0 1 2 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"/></svg>
              </div>
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-900">Connect WhatsApp Business</h2>
              <p className="text-sm text-slate-500 mt-1 max-w-sm">
                Link your WhatsApp Business Account using Meta Embedded Signup to start sending messages and receiving orders.
              </p>
            </div>
            <Button
              size="lg"
              className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2 px-8 font-semibold"
              onClick={launchEmbeddedSignup}
              disabled={!sdkReady || !config?.configId || submit.isPending}
            >
              {!sdkReady
                ? <><RefreshCw className="w-4 h-4 animate-spin" /> Loading SDK…</>
                : submit.isPending
                  ? <><RefreshCw className="w-4 h-4 animate-spin" /> Connecting…</>
                  : <><Smartphone className="w-4 h-4" /> Connect with Meta</>}
            </Button>
            {config?.appId && (
              <p className="text-[11px] text-slate-400">App ID: {config.appId}</p>
            )}
          </div>

          {/* Manual connect (dev) */}
          <div className="rounded-xl border bg-white shadow-sm p-6">
            <div className="mb-4">
              <h3 className="font-semibold text-sm">Manual Connect <span className="text-[10px] font-normal text-slate-400 ml-1">(development only)</span></h3>
              <p className="text-xs text-muted-foreground mt-0.5">Paste credentials directly from Meta dashboard for local testing.</p>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {[
                { label: 'WABA ID', key: 'wabaId', placeholder: '107265272260677' },
                { label: 'Phone Number ID', key: 'phoneNumberId', placeholder: '109085305409874' },
                { label: 'Display Phone', key: 'displayPhone', placeholder: '+15550292978' },
                { label: 'Access Token', key: 'accessToken', placeholder: 'EAA...' },
              ].map(({ label, key, placeholder }) => (
                <div key={key} className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-600">{label}</label>
                  <Input
                    placeholder={placeholder}
                    value={(manual as any)[key]}
                    type={key === 'accessToken' ? 'password' : 'text'}
                    onChange={(e) => setManual({ ...manual, [key]: e.target.value })}
                  />
                </div>
              ))}
              <div className="md:col-span-2">
                <Button
                  onClick={() => submit.mutate(manual)}
                  disabled={!manual.wabaId || !manual.phoneNumberId || !manual.accessToken || submit.isPending}
                >
                  {submit.isPending ? 'Connecting…' : 'Connect Manually'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
