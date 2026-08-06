import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import { sa, tokenStore } from '../lib/api';
import { Button, Card, Input } from '../components/ui';

export default function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const login = useMutation({
    mutationFn: () => sa.login(email.trim(), password),
    onSuccess: (data) => {
      tokenStore.set(data.token);
      navigate('/', { replace: true });
    },
    // The server returns one message for a wrong password and an unknown
    // address, and this shows it verbatim rather than guessing which it was.
    onError: (err: Error) => setError(err.message),
  });

  return (
    <div className="grid min-h-screen place-items-center px-4">
      <Card className="w-full max-w-sm p-6">
        <div className="mb-5 flex items-center gap-2.5">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-slate-900 text-white">
            <ShieldCheck className="h-4 w-4" />
          </div>
          <div>
            <h1 className="text-base font-semibold">ZunoPilot Operations</h1>
            <p className="text-xs text-slate-500">Platform administration</p>
          </div>
        </div>

        <form
          className="space-y-3"
          onSubmit={(e) => { e.preventDefault(); setError(null); login.mutate(); }}
        >
          <div className="space-y-1.5">
            <label htmlFor="email" className="text-xs font-medium text-slate-600">Email</label>
            <Input id="email" type="email" value={email} onChange={setEmail} placeholder="superadmin@zunopilot.com" />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="password" className="text-xs font-medium text-slate-600">Password</label>
            <Input id="password" type="password" value={password} onChange={setPassword} />
          </div>

          {error && (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">{error}</p>
          )}

          <Button type="submit" className="w-full" disabled={!email || !password || login.isPending}>
            {login.isPending ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>

        <p className="mt-4 text-[11px] leading-snug text-slate-400">
          This console can read every workspace on the platform. Sign-ins and every change made here
          are recorded in the audit log.
        </p>
      </Card>
    </div>
  );
}
