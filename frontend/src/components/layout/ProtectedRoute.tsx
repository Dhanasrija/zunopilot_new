import { useEffect, useState } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { hardNavigate } from '@/lib/navigation';
import { switchWorkspace } from '@/lib/workspace';
import {
  useAuthStore, type AuthTenant, type AuthUser, type AuthWorkspace, type ModuleKey,
  type Permission,
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
    workspaces?: AuthWorkspace[];
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
    api.get<SessionResponse>('/auth/me', { handles401: true })
      .then((response) => {
        if (cancelled) return;
        /*
         * **The token comes from `localStorage`, not from this closure.**
         *
         * `setSession({ token, ... })` used to pin the token this effect started with. That was
         * harmless while a session could only ever name one workspace; now a switch in another tab —
         * or a re-home below — writes a new token, and pinning the old one would store a credential
         * for one workspace beside the name and permissions of another. Everything after that
         * disagrees with itself.
         */
        const current = localStorage.getItem('token') ?? token;
        setSession({ ...response.data.data, token: current });
      })
      .catch(async (err) => {
        if (cancelled) return;
        // A 401 here is recoverable; anything else keeps the persisted session, as it always has.
        if ((err as { response?: { status?: number } }).response?.status === 401) await rehome();
      })
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

/**
 * The session named a workspace this person is no longer in. Move them to one they are.
 *
 * **Why this is worth code.** A membership can be revoked while somebody is signed in, and it is now
 * an ordinary event rather than an edge case: being taken off a side project says nothing about the
 * business they actually run. Without this the global 401 handler signs them out, and they land on
 * the OTP screen — a support ticket wearing a login form.
 *
 * The recovery is safe because the *identity* half of the token is still good; only its workspace
 * claim is stale. `GET /auth/workspaces` is mounted on `requireSession` for exactly that reason and
 * answers from the database, so this is not the client choosing from a list it invented.
 *
 * If there is nothing to recover to — no memberships left, or the identity itself is finished — this
 * does what the global handler would have done. That path is why `/auth/me` may opt out of it: the
 * sign-out is not skipped, only deferred until it is known to be the right answer.
 */
const rehome = async (): Promise<void> => {
  try {
    const response = await api.get<{ data: { workspaces: AuthWorkspace[] } }>(
      '/auth/workspaces', { handles401: true },
    );
    const workspaces = response.data.data.workspaces;
    // A suspended workspace cannot be entered, so landing in one would be an immediate dead end.
    const next = workspaces.find((workspace) => !workspace.isSuspended) ?? workspaces[0];
    if (next) {
      toast.info(`You are no longer in that workspace. Opening ${next.businessName}.`);
      await switchWorkspace(next.id);
      return;
    }
  } catch {
    // Fall through: the session is finished, not merely misdirected.
  }

  useAuthStore.getState().clear();
  hardNavigate('/login');
};
