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
import { validateEmail, validatePassword } from '@/lib/validators';

type Errors = { email?: string; password?: string };

export default function Login() {
  const [email, setEmail] = useState('owner@demo.com');
  const [password, setPassword] = useState('Password123!');
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const setSession = useAuthStore((s) => s.setSession);
  const token = useAuthStore((s) => s.token);
  const nav = useNavigate();

  const m = useMutation({
    mutationFn: async () => {
      const { data } = await api.post('/auth/login', { email, password });
      return data.data;
    },
    onSuccess: (data) => {
      setSession(data);
      toast.success('Welcome back');
      nav('/dashboard');
    },
  });

  const validate = (): boolean => {
    const next: Errors = {
      email: validateEmail(email) || undefined,
      password: validatePassword(password) || undefined,
    };
    setErrors(next);
    return !next.email && !next.password;
  };

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
                <Link to="/login" className="hidden sm:inline-block text-[15px] font-medium text-slate-700 hover:text-slate-900 px-3">
                  Sign in
                </Link>
                <Link to="/signup">
                  <Button className="rounded-full bg-violet-600 hover:bg-violet-700 px-4 sm:px-5 h-10 text-sm shadow-md shadow-violet-200">Start Free Trial</Button>
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center px-4 py-8">
        <div className="w-full max-w-md rounded-3xl bg-white/95 backdrop-blur shadow-xl shadow-violet-200/40 ring-1 ring-slate-200 p-6 sm:p-8 lg:p-10">
          <div className="text-center">
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900">
              Welcome back to <span className="text-violet-600">ZunoPilot</span>
            </h1>
            <p className="mt-2 text-sm text-slate-500">
              Sign in to access your business inbox, orders, and analytics.
            </p>
          </div>

          <form className="mt-6 space-y-4" onSubmit={handleSubmit} noValidate>
            <Field label="Email" error={errors.email}>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => { setEmail(e.target.value); if (errors.email) setErrors((s) => ({ ...s, email: undefined })); }}
                placeholder="Enter your mail"
                maxLength={100}
                aria-invalid={!!errors.email}
                className={`rounded-lg ${errors.email ? 'border-red-400 focus-visible:ring-red-300' : ''}`}
              />
            </Field>

            <Field label="Password" error={errors.password}>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); if (errors.password) setErrors((s) => ({ ...s, password: undefined })); }}
                  placeholder="Enter your password"
                  maxLength={64}
                  aria-invalid={!!errors.password}
                  className={`rounded-lg pr-10 ${errors.password ? 'border-red-400 focus-visible:ring-red-300' : ''}`}
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
            </Field>

            <Button
              type="submit"
              disabled={m.isPending}
              className="w-full h-12 rounded-full bg-violet-600 hover:bg-violet-700 text-base font-semibold shadow-md shadow-violet-200"
            >
              {m.isPending ? 'Signing in…' : 'Sign In'}
            </Button>
          </form>

          <p className="mt-5 text-center text-sm text-slate-500">
            Don't have an account?{' '}
            <Link to="/signup" className="text-violet-600 font-semibold hover:underline">Create one</Link>
          </p>
        </div>
      </main>
    </div>
  );
}

/* Helper — renders label + child + an error line under it. */
function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm font-medium text-slate-700">{label}</Label>
      {children}
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}
