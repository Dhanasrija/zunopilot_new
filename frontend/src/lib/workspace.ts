import { api } from '@/lib/api';
import { hardNavigate } from '@/lib/navigation';
import { queryClient } from '@/lib/query-client';
import { beginSwitch, endSwitch } from '@/lib/request-gate';
import {
  useAuthStore, type AuthTenant, type AuthUser, type AuthWorkspace, type ModuleKey,
  type Permission,
} from '@/stores/auth.store';

/*
 * Changing which workspace this session is acting in.
 *
 * ── Not in the store, and not in a component ─────────────────────────────────
 *
 * `api.ts` imports the auth store, so the store cannot import `api` — a switch action written as a
 * store method would be a cycle. And it is not a hook: it is called from a menu item, does a network
 * round trip, and ends by leaving the page, none of which wants a React lifecycle.
 *
 * ── A switch is a hard page load ─────────────────────────────────────────────
 *
 * There are 179 `queryKey` sites across some seventy roots and none of them carries a tenant. The
 * cache holds the *other* workspace's conversations, orders, customers and templates, and a reload
 * is the only thing that empties it with certainty. It also resets four things nothing else does:
 * `useNotifications`' announced/primed refs, the Inbox's selected conversation, `useAuthedMedia`'s
 * blob URLs, and every in-flight request.
 *
 * The alternative — threading a tenant id through 179 keys — is one omission away from showing one
 * workspace's data under another's name, and the omission would be invisible.
 */

interface SessionData {
  user: AuthUser;
  tenant: AuthTenant;
  profileComplete: boolean;
  permissions: Permission[];
  modules: ModuleKey[];
  workspaces: AuthWorkspace[];
}

/**
 * Change workspace, then reload into it.
 *
 * **Gate, ask, then write — in that order.** Writing the token before the server has accepted is the
 * mistake available here: a refused switch would leave the app holding a credential it never proved,
 * every request would 401, and the person would be signed out of a workspace they never left.
 * `SupportSession.tsx` writes first because it has no session to validate against; this has one.
 *
 * Resolves only in the failure case. On success the page is on its way out.
 */
export const switchWorkspace = async (tenantId: string): Promise<void> => {
  beginSwitch();
  try {
    const response = await api.post<{ data: SessionData & { token: string } }>(
      '/auth/workspaces/switch', { tenantId },
    );
    const { token, ...session } = response.data.data;

    useAuthStore.getState().setSession({ token, ...session });
    // Belt and braces beside the reload: `assign` only *queues* navigation, so components can still
    // render from the old workspace's cache in the moments before unload.
    queryClient.clear();
    /*
     * **Always the dashboard, never the current path.**
     *
     * `/leads/:id`, `/orders/:id` and `/templates/:id/edit` have no capability guard, so carrying the
     * path across would ask the new workspace for the old one's record — a 404 as the first thing
     * somebody sees, or worse, a page that half-renders. The dashboard exists in every workspace and
     * for every role.
     */
    hardNavigate('/dashboard');
  } catch (err) {
    // The switch failed, so this document keeps working in the workspace it was already in.
    endSwitch();
    throw err;
  }
};

/**
 * Leave a workspace.
 *
 * Leaving the one currently open means the session is holding a token for a workspace it is no longer
 * in, so it has to move: the server returns what remains, and the first of those is where a fresh
 * login would land. Leaving some *other* workspace only changes the list.
 */
export const leaveWorkspace = async (tenantId: string): Promise<void> => {
  const response = await api.delete<{ data: { workspaces: AuthWorkspace[] } }>(
    `/auth/workspaces/${tenantId}`,
  );
  const remaining = response.data.data.workspaces;

  const wasCurrent = useAuthStore.getState().tenant?.id === tenantId;
  if (!wasCurrent) {
    // Nothing to move to; just stop offering it. `setSession` needs a whole session, so this is the
    // one place that writes `workspaces` on its own.
    useAuthStore.setState({ workspaces: remaining });
    return;
  }

  const next = remaining.find((workspace) => !workspace.isSuspended) ?? remaining[0];
  // The server refuses to let anybody leave their only workspace, so `remaining` cannot be empty
  // here — but reading `[0]` of an empty array and navigating to `undefined` is not a failure mode
  // worth leaving to a server guard alone.
  if (!next) {
    useAuthStore.getState().clear();
    hardNavigate('/login');
    return;
  }
  await switchWorkspace(next.id);
};
