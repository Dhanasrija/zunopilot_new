import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { motion, useReducedMotion } from 'framer-motion';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';
import {
  useAuthStore, type AuthTenant, type AuthUser, type AuthWorkspace,
} from '@/stores/auth.store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PhoneField } from '@/components/ui/phone-field';
import {
  detectCountry, fullNumber, nationalNumberProblem, type Country,
} from '@/lib/countries';
import { Label } from '@/components/ui/label';
import { AlertTriangle, ArrowLeft, Loader2, MessageSquare, ShieldCheck, Users } from 'lucide-react';
import { useDocumentHead } from '@/lib/document-head';
import { PAGE_HEADS } from '@/lib/page-heads';

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
  /**
   * Every workspace this number can reach.
   *
   * Declared here so it reaches the store: `setSession` keeps the *previous* list when a payload
   * omits the field — right for a response that predates it, wrong for a fresh sign-in, which would
   * otherwise leave one person looking at the workspaces of whoever used this browser last.
   */
  workspaces: AuthWorkspace[];
}

export default function Login() {
  /*
   * **`noindex, follow`, and no canonical.**
   *
   * Without this the page inherited index.html's tags: `index, follow` and a canonical
   * pointing at the home page. That mattered little while the CTAs said "Start Free" and
   * pointed at `/signup`; it matters now, because every "Get Started" on every marketing
   * page links straight here, which makes `/login` the most internally-linked URL on the
   * site. A heavily-linked URL that says "index me" and canonicalises somewhere else is
   * exactly the shape Search Console files under "Alternate page with proper canonical
   * tag" — and if Google disagrees about the canonical, it indexes a sign-in form.
   *
   * `follow` is kept so the links out of here still count. The matching half of this fix
   * is in `public/robots.txt`: the `Disallow` was removed, because a crawler that cannot
   * fetch the page cannot read the `noindex` either.
   */
  useDocumentHead(PAGE_HEADS.login);

  const navigate = useNavigate();
  const setSession = useAuthStore((s) => s.setSession);

  const [step, setStep] = useState<'phone' | 'code' | 'new'>('phone');

  /**
   * A verified session that has not been adopted yet, held back for confirmation.
   *
   * Only ever set when the server said `isNew` — see the note on the `'new'` step.
   */
  const [pending, setPending] = useState<VerifyResult | null>(null);

  /**
   * Country and national number are held apart, not as one prefilled string.
   *
   * This was `useState('+91 ')` in a free-text field, which meant the dial code was
   * editable text a visitor could half-overwrite: type a US number over part of it
   * and `+91 2025550123` reaches the API, where `normalisePhone` happily accepts 12
   * digits. On *this* form that was not a validation error — sign-in doubles as
   * sign-up, so it created a second user and a second workspace and told the person
   * nothing. Keeping the dial code in a picker makes it unrepresentable.
   *
   * `detectCountry()` reads the browser locale and only moves off India when the
   * locale names a region — see the note on it in `lib/countries.ts`.
   */
  const [country, setCountry] = useState<Country>(detectCountry);
  const [national, setNational] = useState('');
  const phone = fullNumber(country, national);
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

  /** Adopt a verified session and go where the server says. */
  const land = (result: VerifyResult) => {
    setSession(result);
    // The whole point of the flag: a workspace that has not been set up goes to
    // the form, everyone else goes straight to work.
    navigate(result.profileComplete ? '/dashboard' : '/onboarding', { replace: true });
  };

  const verify = useMutation({
    mutationFn: () => api.post<{ data: VerifyResult }>('/auth/otp/verify', { phone, code })
      .then((r) => r.data.data),
    onSuccess: (result) => {
      // `isNew` was read off the response and thrown away for as long as this flow
      // has existed, which is how a wrong country code stayed silent: the owner of
      // this product picked `+1` from the country list, entered his ten-digit Indian
      // number, verified a code, and landed on an empty onboarding form for a
      // workspace nobody meant to create. Nothing on screen said a new business had
      // just been made. It read as "I cannot log in".
      //
      // So a brand-new account now has to be acknowledged before it is adopted.
      if (result.isNew) {
        setPending(result);
        setStep('new');
        return;
      }
      land(result);
    },
    onError: (err: Error) => setError(err.message),
  });

  // Was `digits.length < 8`, one flat rule for every country. libphonenumber knows the
  // possible lengths per country, so this refuses a half-typed Indian number without
  // also refusing a legitimately shorter one elsewhere.
  const numberProblem = nationalNumberProblem(national, country);

  return (
    /*
     * **The shell, rebuilt.** It was a 384px card centred on a gradient — functional, and it
     * read as an internal admin tool rather than as the sign-in page of the product the
     * marketing site had just spent ten sections selling. It is also the page every
     * "Get Started" on the site now lands on, so it is the first authenticated surface a new
     * customer sees.
     *
     * A two-panel split: the brand argument on the left, the form on the right. The left panel
     * is `hidden lg:flex`, because on a phone it would push the form below the fold and the
     * only thing anyone is here to do is type a number. Nothing inside the form changed — the
     * OTP flow, the three steps, the wrong-country-code confirmation and every string in them
     * are untouched.
     *
     * Everything is on brand tokens (`accent-*`, `ink-*`, `surface-*`, `text-body`), not the
     * marketing site's raw Tailwind palette. This file is not in `check-brand.mjs`'s legacy
     * allowlist, and it should not be: this is a product screen.
     */
    <div className="min-h-screen bg-surface-0 lg:grid lg:grid-cols-[1.05fr_1fr]">
      <BrandPanel />

      <div className="flex min-h-screen flex-col justify-center px-6 py-12 sm:px-12 lg:min-h-0">
        <div className="mx-auto w-full max-w-sm">
          {/* On mobile the brand panel is hidden, so the logo has to appear here instead. */}
          <Link to="/" className="mb-8 inline-flex items-center gap-2 lg:hidden">
            <img src="/app-logo.png" alt="" className="h-8 w-auto" />
            <span className="text-body font-semibold text-ink-900">ZunoPilot</span>
          </Link>

          <div className="mb-6">
            <h1 className="text-h2 font-semibold tracking-tight text-ink-900">
              {step === 'new' ? 'Check the number' : 'Sign in to ZunoPilot'}
            </h1>
            <p className="mt-2 text-body text-muted-foreground">
              {step === 'phone' && 'We will text you a code. No password to remember.'}
              {step === 'code' && (
                <>
                  Sent to <span className="font-medium text-ink-900">{phone.trim()}</span>
                </>
              )}
              {step === 'new' && 'One thing to confirm before you go on.'}
            </p>
          </div>

          {/*
            **A step indicator, because the flow has steps.** The old card gave no sense of
            where you were: enter a number, and the whole panel silently became a code field.
            Two dots is barely a progress bar, which is right — the flow is two steps and
            pretending otherwise would be worse than saying nothing.
          */}
          {step !== 'new' && (
            <div className="mb-6 flex items-center gap-2" aria-hidden>
              {(['phone', 'code'] as const).map((s) => (
                <span
                  key={s}
                  className={`h-1 flex-1 rounded-full transition-colors duration-300 ${
                    step === s || (step === 'code' && s === 'phone')
                      ? 'bg-accent-600'
                      : 'bg-ink-300/60'
                  }`}
                />
              ))}
            </div>
          )}

          {step === 'phone' ? (
            <form
              className="space-y-3"
              onSubmit={(e) => { e.preventDefault(); setError(null); sendCode.mutate(); }}
            >
              <div className="space-y-1">
                <Label htmlFor="phone">Mobile number</Label>
                <PhoneField
                  id="phone"
                  autoFocus
                  country={country}
                  onCountryChange={setCountry}
                  value={national}
                  onChange={setNational}
                />
                <p className="text-caption text-muted-foreground">
                  Pick your country, then enter your number. Your country comes from the code you
                  choose, so we never have to ask separately.
                </p>
              </div>

              {error && (
                <p className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-caption text-danger">
                  {error}
                </p>
              )}

              <Button type="submit" className="w-full" disabled={!!numberProblem || sendCode.isPending}>
                {sendCode.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
                Send me a code
              </Button>
            </form>
          ) : step === 'code' ? (
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
          ) : (
            // A workspace that nobody meant to create.
            //
            // **This confirms rather than prevents, and the wording has to be honest
            // about that.** The account and the tenant are written during
            // `/auth/otp/verify`, so by the time this renders the workspace exists —
            // what is still in the visitor's hands is whether they adopt it. Holding
            // the session in `pending` instead of calling `setSession` is the part
            // that matters: choosing the other number leaves the app signed out
            // rather than sitting inside the wrong business.
            //
            // Preventing it outright would mean splitting verify into "prove the
            // number" and "create the workspace", which is a real change to the
            // signup contract and not one to make while someone is locked out.
            <div className="space-y-3">
              <div className="rounded-lg border border-warning/40 bg-warning/15 px-3 py-2">
                <p className="flex items-center gap-2 text-caption font-medium text-ink-900">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  This number has no workspace yet
                </p>
                <p className="mt-1 font-mono text-body text-ink-900">{phone.trim()}</p>
                <p className="mt-1 text-caption leading-snug text-ink-900">
                  Signing in created a new, empty workspace for it. If you meant a different country
                  code, your existing workspace is still there under the right number.
                </p>
              </div>

              <Button
                type="button"
                className="w-full"
                onClick={() => pending && land(pending)}
              >
                Set up this new workspace
              </Button>

              <Button
                type="button"
                variant="secondary"
                className="w-full"
                onClick={() => {
                  setPending(null);
                  setStep('phone');
                  // The number is kept and the code cleared: the fix is almost always
                  // the country, so leaving the digits typed puts the person one click
                  // from the picker instead of retyping ten digits to prove a point.
                  setCode('');
                  setDevCode(null);
                  setError(null);
                }}
              >
                Check the country code
              </Button>
            </div>
          )}

          {/* Suppressed on the `new` step, where the panel above has just said the same
              thing about a specific number and saying it twice reads as reassurance. */}
          {step !== 'new' && (
            <div className="mt-4 flex items-start gap-2 border-t pt-3">
              <ShieldCheck className="mt-px h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <p className="text-caption leading-snug text-muted-foreground">
                New here? Entering your number creates your workspace — there is nothing separate to
                sign up for.
              </p>
            </div>
          )}

          <p className="mt-6 text-center text-caption text-muted-foreground">
            <Link to="/pricing" className="underline hover:text-ink-900">
              See plans and pricing
            </Link>
            <span aria-hidden className="mx-2 text-ink-300">|</span>
            <Link to="/contact" className="underline hover:text-ink-900">
              Talk to us
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * The left half: what this product is, for someone who arrived from an ad.
 *
 * **Why it is worth the pixels.** The three lines are the same three the marketing site
 * leads with, so a visitor who clicked "Get Started" mid-scroll does not lose the thread at
 * the moment they are asked to hand over a phone number. It is the cheapest reassurance
 * available on a page whose only other content is one input.
 *
 * `hidden lg:flex` — see the note on the shell. The gradient blobs are `motion.div`s with
 * infinite transitions, so they check `useReducedMotion()` themselves; `MotionConfig`'s
 * `reducedMotion="user"` shortens durations but does not stop a repeat.
 */
function BrandPanel() {
  const reduce = useReducedMotion();

  const POINTS = [
    { icon: MessageSquare, text: 'Automate customer conversations on WhatsApp' },
    { icon: Users, text: 'Run them from one shared team inbox' },
    { icon: ShieldCheck, text: 'Keep customer-facing numbers under business control' },
  ];

  return (
    /*
      `text-on-accent` rather than `text-white` throughout, and `bg-on-accent/10` for the icon
      chips. §2.1 reserves raw white for nothing — `on-accent` is the token for type sitting on
      a dark or accent fill, and `check-brand.mjs` enforces it. They resolve to the same colour
      today; the point is that retuning the token moves this panel with everything else.
    */
    <div className="relative hidden overflow-hidden bg-ink-950 lg:flex lg:flex-col lg:justify-between lg:p-12">
      {/*
        Two slow-drifting blobs. Decorative and `aria-hidden`: the panel's meaning is entirely
        in the text, and an animated gradient that a screen reader announces is noise.
      */}
      <motion.div
        aria-hidden
        animate={reduce ? undefined : { x: [0, 40, 0], y: [0, -30, 0] }}
        transition={{ duration: 18, repeat: Infinity, ease: 'easeInOut' }}
        className="pointer-events-none absolute -left-24 -top-24 h-96 w-96 rounded-full bg-accent-600/30 blur-3xl"
      />
      <motion.div
        aria-hidden
        animate={reduce ? undefined : { x: [0, -30, 0], y: [0, 40, 0] }}
        transition={{ duration: 22, repeat: Infinity, ease: 'easeInOut' }}
        className="pointer-events-none absolute -bottom-32 -right-20 h-[26rem] w-[26rem] rounded-full bg-accent-600/20 blur-3xl"
      />

      <Link to="/" className="relative inline-flex items-center gap-3">
        <img src="/app-logo.png" alt="" className="h-9 w-auto" />
        <span className="text-h3 font-semibold tracking-tight text-on-accent">ZunoPilot</span>
      </Link>

      <div className="relative max-w-md">
        <motion.h2
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.22, 0.61, 0.36, 1] }}
          className="text-h1 font-semibold leading-tight tracking-tight text-on-accent"
        >
          AI-powered WhatsApp business automation.
        </motion.h2>

        <motion.ul
          initial="hidden"
          animate="show"
          variants={{ hidden: {}, show: { transition: { delayChildren: 0.2, staggerChildren: 0.1 } } }}
          className="mt-8 space-y-4"
        >
          {POINTS.map((point) => (
            <motion.li
              key={point.text}
              variants={{
                hidden: { opacity: 0, x: -12 },
                show: { opacity: 1, x: 0, transition: { duration: 0.5 } },
              }}
              className="flex items-start gap-3"
            >
              <span
                aria-hidden
                className="mt-px grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-on-accent/10 text-on-accent ring-1 ring-on-accent/15"
              >
                <point.icon className="h-4 w-4" />
              </span>
              <span className="text-body leading-snug text-on-accent/85">{point.text}</span>
            </motion.li>
          ))}
        </motion.ul>
      </div>

      {/*
        The office address used to sit here and was removed, not allowlisted: `#514` matches
        `check-brand`'s hex-literal rule, and a sign-in screen is the wrong place to spend an
        exemption. The footer on every public page carries the address already.
      */}
      <p className="relative text-caption text-on-accent/50">
        Built by mTouchLabs, Hyderabad
      </p>
    </div>
  );
}
