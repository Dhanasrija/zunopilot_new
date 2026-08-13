import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  User, Mail, Phone, MessageSquare, Lock, ChevronDown, Search, Check,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import {
  digitsOnly, lettersOnly,
  validateName, validateEmail,
  validateRequired, validateMaxLength,
} from '@/lib/validators';
import {
  COUNTRIES, DEFAULT_COUNTRY, countryMatches, nationalDigitLimit, nationalNumberProblem,
  type Country,
} from '@/lib/countries';
import { INTERESTS, interestFromUrl } from '@/lib/enquiry';
import { useDocumentHead } from '@/lib/document-head';
import PublicHeader from '@/components/layout/PublicHeader';
import { PAGE_HEADS } from '@/lib/page-heads';



type Errors = Partial<Record<'fullName' | 'email' | 'phone' | 'interest' | 'message' | 'agree', string>>;

export default function Contact() {
  useDocumentHead(PAGE_HEADS.contact);
  const [searchParams] = useSearchParams();
  // Read once, as the initial value. Deriving it on every render would fight the
  // visitor: change the dropdown after arriving from a demo link and the URL would
  // keep resetting it.
  const [form, setForm] = useState({
    fullName: '',
    email: '',
    phone: '',
    interest: interestFromUrl(searchParams),
    message: '',
    agree: false,
  });
  const [country, setCountry] = useState<Country>(DEFAULT_COUNTRY);
  const [errors, setErrors] = useState<Errors>({});
  const [submitting, setSubmitting] = useState(false);

  const setField = (k: keyof typeof form, v: any) => {
    setForm((f) => ({ ...f, [k]: v }));
    if (errors[k as keyof Errors]) setErrors((e) => ({ ...e, [k]: undefined }));
  };

  /**
   * Changing the country changes what counts as a valid number, so a phone error
   * raised against the old country is stale and must go — otherwise picking the
   * right country leaves the wrong complaint on screen. The number is also
   * re-trimmed, because the digits that fit inside E.164 depend on the dial code.
   */
  const pickCountry = (next: Country) => {
    setCountry(next);
    setForm((f) => ({ ...f, phone: f.phone.slice(0, nationalDigitLimit(next)) }));
    setErrors((e) => ({ ...e, phone: undefined }));
  };

  const validate = (): boolean => {
    const next: Errors = {
      fullName: validateName(form.fullName, 'Full name') || undefined,
      email: validateEmail(form.email) || undefined,
      // Per-country length rather than a flat 7–15, which was simultaneously too
      // strict for some countries and too loose for others.
      phone: nationalNumberProblem(form.phone, country) || undefined,
      interest: validateRequired(form.interest, 'Interest') || undefined,
      message:
        validateRequired(form.message, 'Message') ||
        validateMaxLength(form.message, 1000, 'Message') ||
        undefined,
      agree: form.agree ? undefined : 'Please agree to the Terms & Conditions',
    };
    setErrors(next);
    return !Object.values(next).some(Boolean);
  };

  /**
   * Send the enquiry.
   *
   * This used to be a one-second `setTimeout` followed by "Enquiry sent!" — it
   * never called anything, so every submission was discarded while the visitor was
   * told someone would be in touch. It now POSTs to `/contact`, which stores the
   * enquiry for the operator console.
   *
   * Two details that matter:
   *
   *   • **The form is cleared only after a confirmed success.** The old code cleared
   *     unconditionally, so a failure also destroyed what the person had typed and
   *     left them nothing to retry with.
   *   • **No error toast here.** `lib/api`'s response interceptor already surfaces
   *     any 4xx/5xx with the server's own message, so adding one would show two —
   *     and the rate-limiter's message comes through for free.
   */
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) {
      toast.error('Please fix the highlighted fields.');
      return;
    }

    setSubmitting(true);
    try {
      await api.post('/contact', {
        fullName: form.fullName,
        email: form.email,
        // The dial code lives outside `form`, so it has to be sent explicitly —
        // the old fake submit would have dropped it entirely.
        dialCode: country.dialCode,
        phone: form.phone,
        interest: form.interest,
        message: form.message,
      });

      toast.success('Enquiry sent. We will be in touch shortly.');
      // Back to the initial state, which on a deep-linked page still includes the
      // preselected interest — the URL has not changed, so neither should the field.
      setForm({
        fullName: '',
        email: '',
        phone: '',
        interest: interestFromUrl(searchParams),
        message: '',
        agree: false,
      });
    } catch {
      // Already reported by the interceptor. Swallowed so the fields survive.
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="min-h-screen bg-no-repeat bg-cover bg-center flex flex-col"
      style={{ backgroundImage: "url('/login-bg.png')" }}
    >
      <PublicHeader />

      <main className="flex-1 flex items-center justify-center px-4 py-8 sm:py-12">
        <div className="w-full max-w-6xl grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-16 items-center">
          <div className="text-center lg:text-left">
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-slate-900">
              {/*
                The space before the `<br />` is load-bearing. Without it the heading's
                `textContent` is "Let's Start theConversation" — which is what Google indexes
                and what a screen reader announces, while the page looks perfectly fine
                because the `<br />` does the visual separating. Same defect
                `AnimatedHeading` uses U+00A0 to avoid; see the note in `marketing.test.tsx`.
              */}
              Let&rsquo;s Start the{' '}<br />
              <span className="text-violet-600">Conversation</span>
            </h1>
            <p className="mt-5 text-base sm:text-lg text-slate-600 max-w-md mx-auto lg:mx-0">
              Connect with our team to learn how ZunoPilot can streamline your customer
              communication and business operations.
            </p>
          </div>

          <div className="w-full">
            <div className="rounded-3xl bg-white/95 backdrop-blur shadow-xl shadow-violet-200/40 ring-1 ring-slate-200 p-6 sm:p-8">
              <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">Send Us a Message</h2>
              <p className="mt-1 text-sm text-slate-500">Fill out the form below and we'll get back to you shortly.</p>

              <form onSubmit={submit} noValidate className="mt-6 space-y-4">
                {/* Full Name */}
                <Field error={errors.fullName}>
                  <IconInput
                    icon={<User className="h-4 w-4" />}
                    placeholder="Full Name"
                    value={form.fullName}
                    onChange={(v) => setField('fullName', lettersOnly(v, 60))}
                    maxLength={60}
                    error={!!errors.fullName}
                  />
                </Field>

                {/* Email */}
                <Field error={errors.email}>
                  <IconInput
                    icon={<Mail className="h-4 w-4" />}
                    type="email"
                    placeholder="Email Address"
                    value={form.email}
                    onChange={(v) => setField('email', v.slice(0, 100))}
                    maxLength={100}
                    error={!!errors.email}
                  />
                </Field>

                {/* Phone + country */}
                <Field error={errors.phone}>
                  <div className="flex gap-3">
                    <CountrySelect value={country} onChange={pickCountry} />
                    <div className="flex-1">
                      <IconInput
                        icon={<Phone className="h-4 w-4" />}
                        type="tel"
                        inputMode="numeric"
                        placeholder="phone number"
                        value={form.phone}
                        onChange={(v) => setField('phone', digitsOnly(v, nationalDigitLimit(country)))}
                        maxLength={nationalDigitLimit(country)}
                        error={!!errors.phone}
                      />
                    </div>
                  </div>
                </Field>

                {/* Interested in dropdown */}
                <Field error={errors.interest}>
                  <div className="relative">
                    <select
                      value={form.interest}
                      onChange={(e) => setField('interest', e.target.value)}
                      className={`appearance-none w-full h-11 pl-4 pr-10 rounded-lg border ${errors.interest ? 'border-red-400' : 'border-slate-200'
                        } bg-white text-sm outline-none focus:ring-2 focus:ring-violet-200 ${form.interest ? 'text-slate-800' : 'text-slate-400'
                        }`}
                    >
                      <option value="" disabled>Interested In</option>
                      {INTERESTS.map((i) => <option key={i} value={i}>{i}</option>)}
                    </select>
                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
                  </div>
                </Field>

                {/* Message */}
                <Field error={errors.message}>
                  <div className={`relative rounded-lg border ${errors.message ? 'border-red-400' : 'border-slate-200'
                    } bg-white focus-within:ring-2 focus-within:ring-violet-200`}>
                    <div className="absolute left-3 top-3 text-slate-400">
                      <MessageSquare className="h-4 w-4" />
                    </div>
                    <textarea
                      placeholder="Your Message"
                      value={form.message}
                      onChange={(e) => setField('message', e.target.value.slice(0, 1000))}
                      rows={4}
                      maxLength={1000}
                      className="w-full bg-transparent pl-10 pr-3 pt-3 pb-7 text-sm outline-none placeholder:text-slate-400 resize-none"
                    />
                    <div className="absolute right-3 bottom-2 text-[11px] text-slate-400">
                      {form.message.length}/1000
                    </div>
                  </div>
                </Field>

                {/* Terms */}
                <div>
                  <label className="flex items-start gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={form.agree}
                      onChange={(e) => setField('agree', e.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded-full border-slate-300 text-violet-600 focus:ring-violet-200"
                    />
                    <span>
                      I agree to the{' '}
                      <Link to="/terms" className="text-violet-600 underline font-medium">
                        Terms &amp; Conditions
                      </Link>{' '}
                      of ZunoPilot
                    </span>
                  </label>
                  {errors.agree && <p className="mt-1 text-xs text-red-500">{errors.agree}</p>}
                </div>

                <Button
                  type="submit"
                  disabled={submitting}
                  className="w-full h-12 rounded-full bg-violet-600 hover:bg-violet-700 text-base font-semibold shadow-md shadow-violet-200"
                >
                  {submitting ? 'Sending…' : 'Send Enquiry'}
                </Button>

                <p className="text-center text-xs text-slate-500 flex items-center justify-center gap-1.5 pt-1">
                  <Lock className="h-3 w-3" />
                  We hate spam, and we respect your privacy.
                </p>
              </form>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

/* ----------------------------- Helpers ----------------------------- */

/**
 * Dial-code picker over every country.
 *
 * A native `<select>` was fine for the five hard-coded countries this replaced, but
 * it is the wrong control for 245: there is no way to search one, and scrolling to
 * Zimbabwe by eye is miserable. So this is a combobox — a button that opens a
 * filtered list — which is the same shape the browser's own autofill uses.
 *
 * **There is a near-identical component at `components/ui/phone-field.tsx`, and this
 * copy stays.** That one is on brand tokens because `components/ui/` is fully checked
 * by the brand gate; this page is on the old marketing palette and is listed in
 * `ALLOW.legacy`. Using the shared one here would either fail the gate or change how
 * this page looks. They converge when the marketing pages get their brand phase.
 *
 * It is deliberately built here rather than pulled from a phone-input package.
 * `react-phone-number-input` and friends ship their own stylesheet and flag
 * sprites, which would put a second visual system inside a form that already has
 * one, on a page the brand gate lists as legacy. The *data* is the part worth
 * taking from a library, and that comes from `libphonenumber-js` in
 * `lib/countries.ts`.
 *
 * The keyboard contract, since a custom control has to earn what `<select>` gave
 * away: ↑/↓ move, Enter selects, Escape closes and returns focus to the button,
 * and typing filters. Every `preventDefault` on Enter matters — this lives inside
 * a `<form>`, so without it choosing a country would submit the enquiry.
 */
function CountrySelect({ value, onChange }: { value: Country; onChange: (c: Country) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);

  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const matches = useMemo(() => COUNTRIES.filter((c) => countryMatches(c, query)), [query]);

  const openList = () => {
    setQuery('');
    // Start on what is already selected, so opening and pressing Enter is a no-op
    // rather than a silent change to whichever country happens to sort first.
    setActive(Math.max(0, COUNTRIES.findIndex((c) => c.iso === value.iso)));
    setOpen(true);
  };

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  const commit = (country: Country) => {
    onChange(country);
    close();
  };

  useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);

  // Clicking anywhere else closes the list. `mousedown` rather than `click` so the
  // list is gone before a click on the page behind it lands.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // Keep the highlighted row visible when it moves by keyboard. `nearest` scrolls
  // only when it has to, so arrowing through the middle of the list does not jump.
  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, matches.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      // Without this the form submits instead of the country being chosen.
      e.preventDefault();
      const picked = matches[active];
      if (picked) commit(picked);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  };

  return (
    <div className="relative" ref={wrapRef}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? close() : openList())}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Country code: ${value.name}, ${value.dialCode}`}
        className="h-11 w-28 pl-3 pr-8 rounded-lg border border-slate-200 bg-white text-sm text-slate-800 text-left outline-none focus:ring-2 focus:ring-violet-200"
      >
        {value.dialCode} <span className="text-slate-500">{value.iso}</span>
      </button>
      <ChevronDown className="absolute right-2 top-[22px] -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />

      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 w-72 rounded-lg border border-slate-200 bg-white shadow-xl shadow-slate-300/30">
          <div className="relative border-b border-slate-100">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => { setQuery(e.target.value); setActive(0); }}
              onKeyDown={onKeyDown}
              placeholder="Search country or code"
              role="combobox"
              aria-expanded
              aria-controls="country-list"
              aria-autocomplete="list"
              aria-activedescendant={matches[active] ? `country-${matches[active].iso}` : undefined}
              className="w-full h-10 pl-9 pr-3 bg-transparent text-sm text-slate-800 outline-none placeholder:text-slate-400"
            />
          </div>

          {matches.length === 0 ? (
            <p className="px-3 py-4 text-sm text-slate-500">
              No country matches “{query.trim()}”.
            </p>
          ) : (
            <ul
              id="country-list"
              ref={listRef}
              role="listbox"
              aria-label="Country"
              className="max-h-64 overflow-y-auto py-1"
            >
              {matches.map((country, i) => {
                const selected = country.iso === value.iso;
                return (
                  <li key={country.iso}>
                    <button
                      type="button"
                      id={`country-${country.iso}`}
                      role="option"
                      aria-selected={selected}
                      data-active={i === active}
                      // `mousedown` would fight the click-outside listener; the
                      // pointer moving the highlight keeps mouse and keyboard on
                      // the same row, so Enter never selects something else.
                      onMouseEnter={() => setActive(i)}
                      onClick={() => commit(country)}
                      className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm ${i === active ? 'bg-violet-50' : ''
                        }`}
                    >
                      <span className="w-12 shrink-0 text-slate-500">{country.dialCode}</span>
                      <span className="min-w-0 flex-1 truncate text-slate-800">{country.name}</span>
                      {selected && <Check className="h-4 w-4 shrink-0 text-violet-600" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function Field({ error, children }: { error?: string; children: React.ReactNode }) {
  return (
    <div>
      {children}
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
    </div>
  );
}

function IconInput({
  icon, placeholder, value, onChange, type = 'text',
  inputMode, maxLength, error,
}: {
  icon: React.ReactNode;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  inputMode?: 'text' | 'numeric' | 'tel' | 'email' | 'url' | 'search';
  maxLength?: number;
  error?: boolean;
}) {
  return (
    <div className="relative">
      <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">{icon}</div>
      <input
        type={type}
        inputMode={inputMode}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        maxLength={maxLength}
        className={`w-full h-11 pl-10 pr-3 rounded-lg border bg-white text-sm text-slate-800 outline-none placeholder:text-slate-400 focus:ring-2 focus:ring-violet-200 ${error ? 'border-red-400' : 'border-slate-200'
          }`}
      />
    </div>
  );
}
