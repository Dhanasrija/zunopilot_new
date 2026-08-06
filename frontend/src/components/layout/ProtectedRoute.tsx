import { useEffect, useState } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { api } from '@/lib/api';
import {
  useAuthStore, type AuthTenant, type AuthUser, type ModuleKey, type Permission,
} from '@/stores/auth.store';

// Two gates, in order: signed in, and set up.
//
// The second matters because the token is persisted. A workspace that abandoned
// the profile form and later opened a bookmark would otherwise land on a dashboard
// of zeroes with no route back to the form — sending them to it is the only useful
// thing to do with that session.
//
// `profileComplete` comes from the server on every sign-in and every `/auth/me`,
// so this is not the client deciding, only the client obeying.

interface SessionResponse {
  data: {
    user: AuthUser;
    tenant: AuthTenant;
    profileComplete: boolean;
    permissions: Permission[];
    modules: ModuleKey[];
  };
}

/**
 * Re-read the session once per app load.
 *
 * Capabilities — what this person may do, and which optional modules the
 * workspace has — are persisted alongside the token, so without this they would
 * only ever change at sign-in. Two things depend on refreshing them:
 *
 *   • An operator switching a module on or off, or an owner editing a role, has
 *     to take effect without telling the customer to log out and back in.
 *   • A session persisted *before* capabilities existed carries neither, which
 *     would otherwise leave the sidebar showing nothing but the dashboard until
 *     the token happened to expire.
 *
 * A failure here is deliberately not fatal: the persisted session still renders.
 * An expired or revoked token fails on the first real API call, which is where
 * the app already handles it.
 */
export default function ProtectedRoute() {
  const token = useAuthStore((s) => s.token);
  const profileComplete = useAuthStore((s) => s.profileComplete);
  const setSession = useAuthStore((s) => s.setSession);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (!token) { setChecked(true); return; }

    let cancelled = false;
    api.get<SessionResponse>('/auth/me')
      .then((response) => { if (!cancelled) setSession({ token, ...response.data.data }); })
      .catch(() => { /* keep the persisted session; the next call surfaces a real problem */ })
      .finally(() => { if (!cancelled) setChecked(true); });

    return () => { cancelled = true; };
  }, [token, setSession]);

  if (!token) return <Navigate to="/login" replace />;

  // Hold the first paint until capabilities are known, or a page would render
  // its nav, then visibly rebuild it a moment later.
  if (!checked) return null;

  if (!profileComplete) return <Navigate to="/onboarding" replace />;

  return <Outlet />;
}
