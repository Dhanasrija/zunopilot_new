import { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import {
  User, Mail, Phone, MessageSquare, Lock, ChevronDown,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth.store';
import {
  digitsOnly, lettersOnly,
  validateName, validateEmail, validatePhone,
  validateRequired, validateMaxLength,
} from '@/lib/validators';

const INTERESTS = [
  'WhatsApp Business Setup',
  'Shared Team Inbox',
  'Keyword Automation',
  'Order Management',
  'Pricing & Plans',
  'Other',
];

const COUNTRIES = [
  { code: '+91', flag: 'IND' },
  { code: '+1', flag: 'USA' },
  { code: '+44', flag: 'GBR' },
  { code: '+61', flag: 'AUS' },
  { code: '+971', flag: 'UAE' },
];

const NAV = [
  { label: 'Home', href: '/#home' },
  { label: 'Features', href: '/#features' },
  { label: 'Pricing', href: '/#pricing' },
  { label: 'Testimonial', href: '/#testimonial' },
  { label: 'Contact Us', href: '/contact', active: true },
];

type Errors = Partial<Record<'fullName' | 'email' | 'phone' | 'interest' | 'message' | 'agree', string>>;

export default function Contact() {
  const [form, setForm] = useState({
    fullName: '', email: '', phone: '', interest: '', message: '', agree: false,
  });
  const [country, setCountry] = useState(COUNTRIES[0]);
  const [errors, setErrors] = useState<Errors>({});
  const [submitting, setSubmitting] = useState(false);
  const token = useAuthStore((s) => s.token);

  const setField = (k: keyof typeof form, v: any) => {
    setForm((f) => ({ ...f, [k]: v }));
    if (errors[k as keyof Errors]) setErrors((e) => ({ ...e, [k]: undefined }));
  };

  const validate = (): boolean => {
    const next: Errors = {
      fullName: validateName(form.fullName, 'Full name') || undefined,
      email: validateEmail(form.email) || undefined,
      phone: validatePhone(form.phone, 7, 15) || undefined,
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
        dialCode: country.code,
        phone: form.phone,
        interest: form.interest,
        message: form.message,
      });

      toast.success('Enquiry sent. We will be in touch shortly.');
      setForm({ fullName: '', email: '', phone: '', interest: '', message: '', agree: false });
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
      <header className="bg-transparent">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 lg:h-20 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <img src="/app-logo.png" alt="ZunoPilot" className="h-9 w-auto" />
            <span className="text-xl font-bold tracking-tight text-slate-900">ZunoPilot</span>
          </Link>

          <nav className="hidden lg:flex items-center gap-8">
            {NAV.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className={`text-[15px] font-medium transition-colors ${item.active ? 'text-violet-600' : 'text-slate-700 hover:text-slate-900'
                  }`}
              >
                {item.label}
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-3">
            {token ? (
              <Link to="/dashboard">
                <Button className="rounded-full bg-violet-600 hover:bg-violet-700 px-5 h-10 text-sm shadow-md shadow-violet-200">Go to Dashboard</Button>
              </Link>
            ) : (
              <>
                <Link to="/login" className="hidden sm:inline-block text-[15px] font-medium text-slate-700 hover:text-slate-900 px-3">Sign in</Link>
                <Link to="/signup">
                  <Button className="rounded-full bg-violet-600 hover:bg-violet-700 px-4 sm:px-5 h-10 text-sm shadow-md shadow-violet-200">Start Free Trial</Button>
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center px-4 py-8 sm:py-12">
        <div className="w-full max-w-6xl grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-16 items-center">
          <div className="text-center lg:text-left">
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-slate-900">
              Let's Start the<br />
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
                    <div className="relative">
                      <select
                        value={country.code}
                        onChange={(e) => {
                          const c = COUNTRIES.find((x) => x.code === e.target.value);
                          if (c) setCountry(c);
                        }}
                        className="appearance-none h-11 pl-3 pr-8 rounded-lg border border-slate-200 bg-white text-sm text-slate-800 outline-none focus:ring-2 focus:ring-violet-200"
                      >
                        {COUNTRIES.map((c) => (
                          <option key={c.code} value={c.code}>{c.code} {c.flag}</option>
                        ))}
                      </select>
                      <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
                    </div>
                    <div className="flex-1">
                      <IconInput
                        icon={<Phone className="h-4 w-4" />}
                        type="tel"
                        inputMode="numeric"
                        placeholder="phone number"
                        value={form.phone}
                        onChange={(v) => setField('phone', digitsOnly(v, 15))}
                        maxLength={15}
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
