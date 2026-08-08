import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth.store';
import { Card, CardContent } from '@/components/ui/card';
import { Eye, Loader2, ShieldAlert } from 'lucide-react';

// Where a support engineer's approved session lands.
//
// The token arrives in the URL **fragment**, not the query string — a fragment is
// never sent to the server, so it cannot end up in an nginx access log, a Referer
// header, or an error report. It is read once and removed from the address bar
// before anything else renders, so a screenshot of the session does not contain a
// working credential.
//
// Both token stores are written. The customer app reads `localStorage.token` in
// `lib/api.ts` and persists the session under `wa-auth` in zustand, and they can
// disagree — setting only one shows the right name while every request carries the
// wrong token. That trap is already documented; this is the one place it would be
// easiest to fall into.

export default function SupportSession() {
  const navigate = useNavigate();
  const setSession = useAuthStore((s) => s.setSession);
  const [error, setError] = useState<string | null>(null);
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;

    const token = new URLSearchParams(window.location.hash.slice(1)).get('token');

    // Remove it from the address bar immediately, whatever happens next.
    window.history.replaceState(null, '', '/support-session');

    if (!token) {
      setError('This link has no session token. Ask for the session to be opened again.');
      return;
    }

    localStorage.setItem('token', token);

    api.get<{
      data: {
        user: import('@/stores/auth.store').AuthUser;
        tenant: import('@/stores/auth.store').AuthTenant;
        profileComplete: boolean;
      };
    }>('/auth/me')
      .then((response) => {
        /*
         * `workspaces: []` explicitly, not by omission.
         *
         * `setSession` keeps whatever list was already there when a payload has none, and this
         * browser belongs to an operator who may have their own session persisted. A support token
         * cannot list or change workspaces — the server refuses all three routes — so an inherited
         * switcher would offer moves that 403. An empty list renders no switcher, which is the truth.
         */
        setSession({ token, ...response.data.data, workspaces: [] });
        navigate('/dashboard', { replace: true });
      })
      .catch((err: Error) => {
        // A revoked or lapsed grant fails here, which is the correct place for it
        // to fail: nothing has been rendered yet.
        localStorage.removeItem('token');
        setError(err.message || 'This support session is no longer active.');
      });
  }, [navigate, setSession]);

  return (
    <div className="grid min-h-screen place-items-center px-4">
      <Card className="w-full max-w-md">
        <CardContent className="py-8 text-center">
          {error ? (
            <>
              <ShieldAlert className="mx-auto h-8 w-8 text-danger" />
              <p className="mt-3 text-sm font-medium">Session not available</p>
              <p className="mx-auto mt-1 max-w-sm text-caption text-muted-foreground">{error}</p>
            </>
          ) : (
            <>
              <Eye className="mx-auto h-8 w-8 text-accent-600" />
              <p className="mt-3 flex items-center justify-center gap-2 text-sm font-medium">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Opening a read-only support session
              </p>
              <p className="mx-auto mt-1 max-w-sm text-caption text-muted-foreground">
                You are about to see this workspace exactly as its owner does. Nothing you do can
                change their data, and everything you open is recorded and shown to them.
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
