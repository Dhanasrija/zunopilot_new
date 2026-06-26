import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Eye, EyeOff } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth.store';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  digitsOnly, lettersOnly,
  validateName, validateEmail, validatePassword,
  validatePhone, validateUrl, validateRequired, validateMaxLength,
} from '@/lib/validators';

const CATEGORIES = [
  { value: 'RESTAURANT',        label: 'Restaurant' },
  { value: 'ECOMMERCE_GROCERY', label: 'E-commerce (Grocery)' },
] as const;

type CategoryValue = (typeof CATEGORIES)[number]['value'];

type Errors = Partial<Record<
  'businessName' | 'category' | 'contactNumber' | 'address' |
  'website' | 'fullName' | 'email' | 'password',
  string
>>;

export default function Signup() {
  const [form, setForm] = useState({
    email: '', password: '', fullName: '',
    businessName: '', category: 'RESTAURANT' as CategoryValue,
    contactNumber: '', address: '', website: '',
  });
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const setSession = useAuthStore((s) => s.setSession);
  const token = useAuthStore((s) => s.token);
  const nav = useNavigate();

  const set = (k: keyof typeof form, v: string) => {
    setForm((f) => ({ ...f, [k]: v }));
    if (errors[k as keyof Errors]) setErrors((e) => ({ ...e, [k]: undefined }));
  };

  const validate = (): boolean => {
    const next: Errors = {
      businessName: validateName(form.businessName, 'Business name') || undefined,
      category: validateRequired(form.category, 'Category') || undefined,
      contactNumber: validatePhone(form.contactNumber, 7, 15) || undefined,
      address: validateMaxLength(form.address, 200, 'Address') || undefined,
      website: validateUrl(form.website, false) || undefined,
      fullName: validateName(form.fullName, 'Full name') || undefined,
      email: validateEmail(form.email) || undefined,
      password: validatePassword(form.password) || undefined,
    };
    setErrors(next);
    return !Object.values(next).some(Boolean);
  };

  const m = useMutation({
    mutationFn: async () => {
      const { data } = await api.post('/auth/signup', form);
      return data.data;
    },
    onSuccess: (data) => {
      setSession({ token: data.token, user: data.user, tenant: data.tenant });
      toast.success('Account created. Check your email to verify.');
      nav('/whatsapp');
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    m.mutate();
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
          <div className="flex items-center gap-3">
            {token ? (
              <Link to="/dashboard">
                <Button className="rounded-full bg-violet-600 hover:bg-violet-700 px-5 h-10 text-sm shadow-md shadow-violet-200">Go to Dashboard</Button>
              </Link>
            ) : (
              <>
                <Link to="/login" className="sm:hidden">
                  <Button variant="outline" className="rounded-full border-slate-300 hover:bg-slate-50 px-4 h-10 text-sm text-slate-700 hover:text-slate-900 bg-transparent">
                    Sign in
                  </Button>
                </Link>
                <Link to="/login" className="hidden sm:inline-block text-[15px] font-medium text-slate-700 hover:text-slate-900 px-3">
                  Sign in
                </Link>
                <Link to="/signup">
                  <Button className="hidden sm:inline-flex rounded-full bg-violet-600 hover:bg-violet-700 px-5 h-10 text-sm shadow-md shadow-violet-200">
                    Start Free Trial
                  </Button>
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center px-4 py-8">
        <div className="w-full max-w-xl rounded-3xl bg-white/95 backdrop-blur shadow-xl shadow-violet-200/40 ring-1 ring-slate-200 p-6 sm:p-8 lg:p-10">
          <div className="text-center">
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900">
              Get Started with <span className="text-violet-600">ZunoPilot</span>
            </h1>
            <p className="mt-2 text-sm text-slate-500 max-w-md mx-auto">
              Set up your account in minutes and unlock powerful WhatsApp automation for your business.
            </p>
          </div>

          <form
            className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-4"
            onSubmit={handleSubmit}
            noValidate
          >
            <FieldGroup label="Business Name" error={errors.businessName} className="sm:col-span-2">
              <Input
                value={form.businessName}
                onChange={(e) => set('businessName', e.target.value.slice(0, 100))}
                placeholder="Enter your business name"
                maxLength={100}
                className={inputCls(errors.businessName)}
              />
            </FieldGroup>

            <FieldGroup label="Category" error={errors.category}>
              <Select value={form.category} onValueChange={(v) => set('category', v)}>
                <SelectTrigger className={inputCls(errors.category)}><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </FieldGroup>

            <FieldGroup label="Contact Number" error={errors.contactNumber}>
              <Input
                inputMode="numeric"
                value={form.contactNumber}
                onChange={(e) => set('contactNumber', digitsOnly(e.target.value, 15))}
                placeholder="Phone number"
                maxLength={15}
                className={inputCls(errors.contactNumber)}
              />
            </FieldGroup>

            <FieldGroup label="Address" error={errors.address} className="sm:col-span-2">
              <Input
                value={form.address}
                onChange={(e) => set('address', e.target.value.slice(0, 200))}
                placeholder="Enter your address"
                maxLength={200}
                className={inputCls(errors.address)}
              />
            </FieldGroup>

            <FieldGroup label="Website" error={errors.website} className="sm:col-span-2">
              <Input
                type="url"
                value={form.website}
                onChange={(e) => set('website', e.target.value.slice(0, 200))}
                placeholder="https://example.com"
                maxLength={200}
                className={inputCls(errors.website)}
              />
            </FieldGroup>

            <FieldGroup label="Your Full Name" error={errors.fullName} className="sm:col-span-2">
              <Input
                value={form.fullName}
                onChange={(e) => set('fullName', lettersOnly(e.target.value, 60))}
                placeholder="Enter your full name"
                maxLength={60}
                className={inputCls(errors.fullName)}
              />
            </FieldGroup>

            <FieldGroup label="Email" error={errors.email}>
              <Input
                type="email"
                value={form.email}
                onChange={(e) => set('email', e.target.value.slice(0, 100))}
                placeholder="Enter your mail"
                maxLength={100}
                className={inputCls(errors.email)}
              />
            </FieldGroup>

            <FieldGroup label="Password" error={errors.password}>
              <div className="relative">
                <Input
                  type={showPassword ? 'text' : 'password'}
                  value={form.password}
                  onChange={(e) => set('password', e.target.value.slice(0, 64))}
                  placeholder="At least 8 chars, letters & numbers"
                  maxLength={64}
                  className={`${inputCls(errors.password)} pr-10`}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </FieldGroup>

            <div className="sm:col-span-2 mt-2">
              <Button
                type="submit"
                disabled={m.isPending}
                className="w-full h-12 rounded-full bg-violet-600 hover:bg-violet-700 text-base font-semibold shadow-md shadow-violet-200"
              >
                {m.isPending ? 'Creating…' : 'Create Account'}
              </Button>
            </div>
          </form>

          <p className="mt-5 text-center text-sm text-slate-500">
            Already have an account?{' '}
            <Link to="/login" className="text-violet-600 font-semibold hover:underline">Sign in</Link>
          </p>
        </div>
      </main>
    </div>
  );
}

function FieldGroup({
  label, error, children, className = '',
}: {
  label: string; error?: string; children: React.ReactNode; className?: string;
}) {
  return (
    <div className={`space-y-1.5 ${className}`}>
      <Label className="text-sm font-medium text-slate-700">{label}</Label>
      {children}
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}

const inputCls = (err?: string) =>
  `rounded-lg ${err ? 'border-red-400 focus-visible:ring-red-300' : ''}`;
