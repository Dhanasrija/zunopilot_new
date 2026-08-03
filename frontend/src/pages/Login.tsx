import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';
import { useAuthStore, type AuthTenant, type AuthUser } from '@/stores/auth.store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ArrowLeft, Loader2, ShieldCheck } from 'lucide-react';

// Signing in.
//
// One flow for signing up and signing in: a phone number either has an account or
// gets one. That removes the "already registered?" fork entirely, and with it the
// class of problem where someone creates a second account because they typed a
// different spelling of their email.
//
// Where they land afterwards is the **server's** answer (`profileComplete`), not a
// guess made here from whichever fields happen to be loaded.

interface RequestResult {
  expiresAt: string;
  resendAfterSeconds: number;
  channel: 'sms' | 'echo';
  /** Development only — the API refuses to return this in production. */
  devCode?: string;
}

interface VerifyResult {
  token: string;
  user: AuthUser;
  tenant: AuthTenant;
  profileComplete: boolean;
  isNew: boolean;
}

export default function Login() {
  const navigate = useNavigate();
  const setSession = useAuthStore((s) => s.setSession);

  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [phone, setPhone] = useState('+91 ');
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const codeInput = useRef<HTMLInputElement>(null);

  // Counts down so the resend control says *when*, rather than just refusing.
  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const timer = setTimeout(() => setCooldown((n) => n - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const sendCode = useMutation({
    mutationFn: () => api.post<{ data: RequestResult }>('/auth/otp', { phone })
      .then((r) => r.data.data),
    onSuccess: (result) => {
      setStep('code');
      setCooldown(result.resendAfterSeconds);
      setDevCode(result.devCode ?? null);
      setError(null);
      if (result.devCode) setCode(result.devCode);
      setTimeout(() => codeInput.current?.focus(), 50);
    },
    onError: (err: Error) => setError(err.message),
  });

  const verify = useMutation({
    mutationFn: () => api.post<{ data: VerifyResult }>('/auth/otp/verify', { phone, code })
      .then((r) => r.data.data),
    onSuccess: (result) => {
      setSession(result);
      // The whole point of the flag: a workspace that has not been set up goes to
      // the form, everyone else goes straight to work.
      navigate(result.profileComplete ? '/dashboard' : '/onboarding', { replace: true });
    },
    onError: (err: Error) => setError(err.message),
  });

  const digits = phone.replace(/[^\d]/g, '');

  return (
    <div className="grid min-h-screen place-items-center bg-gradient-to-br from-accent-100 via-surface-1 to-surface-0 px-4">
      <div className="w-full max-w-sm rounded-lg border bg-surface-1 p-6 shadow-none">
        <div className="mb-4 flex items-center gap-2">
          <img src="/app-logo.png" alt="" className="h-8 w-auto" />
          <div className="min-w-0">
            <h1 className="text-body font-semibold">
              Sign in to <span className="text-accent-600">ZunoPilot</span>
            </h1>
            <p className="truncate text-caption text-muted-foreground">
              {step === 'phone'
                ? 'We will text you a code. No password to remember.'
                : `Sent to ${phone.trim()}`}
            </p>
          </div>
        </div>

        {step === 'phone' ? (
          <form
            className="space-y-3"
            onSubmit={(e) => { e.preventDefault(); setError(null); sendCode.mutate(); }}
          >
            <div className="space-y-1">
              <Label htmlFor="phone">Mobile number</Label>
              <Input
                id="phone"
                type="tel"
                autoComplete="tel"
                autoFocus
                value={phone}
                placeholder="+91 77020 00350"
                onChange={(e) => setPhone(e.target.value)}
              />
              <p className="text-caption text-muted-foreground">
                Include your country code — it is how we know which country you are in, so we never
                have to ask.
              </p>
            </div>

            {error && (
              <p className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-caption text-danger">
                {error}
              </p>
            )}

            <Button type="submit" className="w-full" disabled={digits.length < 8 || sendCode.isPending}>
              {sendCode.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
              Send me a code
            </Button>
          </form>
        ) : (
          <form
            className="space-y-3"
            onSubmit={(e) => { e.preventDefault(); setError(null); verify.mutate(); }}
          >
            <div className="space-y-1">
              <Label htmlFor="code">Code</Label>
              <Input
                id="code"
                ref={codeInput}
                inputMode="numeric"
                autoComplete="one-time-code"
                className="text-center text-h3 tracking-[0.4em]"
                value={code}
                placeholder="••••••"
                onChange={(e) => setCode(e.target.value.replace(/[^\d]/g, '').slice(0, 8))}
              />
            </div>

            {devCode && (
              // Shown only because the API returned it, which it will not do in
              // production. Labelled plainly so nobody mistakes it for a feature.
              <div className="rounded-lg border border-warning/40 bg-warning/15 px-3 py-2">
                <p className="text-caption font-medium text-ink-900">
                  Development mode — code shown instead of sent
                </p>
                <p className="mt-px font-mono text-h3 tracking-widest text-ink-900">{devCode}</p>
                <p className="mt-px text-caption text-ink-900">
                  No SMS was spent. This never happens in production.
                </p>
              </div>
            )}

            {error && (
              <p className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-caption text-danger">
                {error}
              </p>
            )}

            <Button type="submit" className="w-full" disabled={code.length < 4 || verify.isPending}>
              {verify.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
              Continue
            </Button>

            <div className="flex items-center justify-between">
              <button
                type="button"
                className="flex items-center gap-1 text-caption text-muted-foreground hover:text-foreground"
                onClick={() => { setStep('phone'); setCode(''); setDevCode(null); setError(null); }}
              >
                <ArrowLeft className="h-3 w-3" /> Change number
              </button>
              <button
                type="button"
                disabled={cooldown > 0 || sendCode.isPending}
                className="text-caption text-accent-700 underline disabled:text-muted-foreground disabled:no-underline"
                onClick={() => { setError(null); sendCode.mutate(); }}
              >
                {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
              </button>
            </div>
          </form>
        )}

        <div className="mt-4 flex items-start gap-2 border-t pt-3">
          <ShieldCheck className="mt-px h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <p className="text-caption leading-snug text-muted-foreground">
            New here? Entering your number creates your workspace — there is nothing separate to sign
            up for.
          </p>
        </div>

        <p className="mt-3 text-center text-caption text-muted-foreground">
          <Link to="/pricing" className="underline">See plans and pricing</Link>
        </p>
      </div>
    </div>
  );
}
