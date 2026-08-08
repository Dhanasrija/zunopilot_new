import { describe, expect, it, vi, beforeEach } from 'vitest';
import { useAuthStore, type AuthWorkspace } from '@/stores/auth.store';

/*
 * Changing which workspace a session acts in.
 *
 * The dangerous half of this feature is not the switch, it is the moment *around* it: a token in
 * `localStorage`, polls that keep firing until the page unloads, and a cache full of the workspace
 * being left. Four properties, in the order they hurt:
 *
 *   1. **The token is written only after the server accepts.** Writing first leaves the app holding a
 *      credential it never proved — every request 401s and the person is signed out of a workspace
 *      they never left.
 *   2. **Nothing else goes out during the switch.** `window.location.assign` only *queues*
 *      navigation, so the Inbox's one-second poll would carry the new token to a page still showing
 *      the old workspace — 403s where the new role is narrower, and a 401 signs them out.
 *   3. **The cache is emptied and the page reloads.** 179 query keys carry no tenant.
 *   4. **A failed switch changes nothing**, including the gate: the app keeps working where it was.
 */

vi.mock('@/lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
}));
vi.mock('@/lib/navigation', () => ({ hardNavigate: vi.fn() }));

const { api } = await import('@/lib/api');
const { hardNavigate } = await import('@/lib/navigation');
const { queryClient } = await import('@/lib/query-client');
const { switchWorkspace, leaveWorkspace } = await import('@/lib/workspace');
const { mayRequest, endSwitch } = await import('@/lib/request-gate');

const workspace = (id: string, name: string): AuthWorkspace => ({
  id,
  businessName: name,
  logoUrl: null,
  roleName: 'Owner',
  isOwner: true,
  joinedAt: '2026-01-01T00:00:00.000Z',
  isSuspended: false,
  isCurrent: false,
});

const ALPHA = workspace('t-alpha', 'Alpha Trading');
const BRAVO = workspace('t-bravo', 'Bravo Trading');

/** What the switch endpoint answers with: a token plus a whole session for that workspace. */
const bravoSession = {
  data: {
    data: {
      token: 'token-for-bravo',
      user: { id: 'u1', fullName: 'Two Hats', phone: '15550001', email: null, role: 'AGENT', emailVerified: false, country: 'IN' },
      tenant: { id: 't-bravo', businessName: 'Bravo Trading', category: null, categoryId: null, categoryLabel: null },
      profileComplete: true,
      permissions: ['inbox:read'],
      modules: [],
      workspaces: [ALPHA, { ...BRAVO, isCurrent: true }],
    },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  endSwitch();
  localStorage.setItem('token', 'token-for-alpha');
  useAuthStore.setState({
    token: 'token-for-alpha',
    user: null,
    tenant: { id: 't-alpha', businessName: 'Alpha Trading', category: null, categoryId: null, categoryLabel: null },
    profileComplete: true,
    permissions: ['team:manage'],
    modules: [],
    workspaces: [{ ...ALPHA, isCurrent: true }, BRAVO],
  });
});

describe('switching workspace', () => {
  it('**adopts the new session only after the server has accepted it**', async () => {
    let tokenDuringRequest: string | null = null;
    vi.mocked(api.post).mockImplementation(async () => {
      // What the request itself carried. `api.ts` reads this on every request, so the old token is
      // the only correct thing to be holding at this instant.
      tokenDuringRequest = localStorage.getItem('token');
      return bravoSession as never;
    });

    await switchWorkspace('t-bravo');

    expect(tokenDuringRequest).toBe('token-for-alpha');
    expect(localStorage.getItem('token')).toBe('token-for-bravo');
    expect(useAuthStore.getState().tenant?.businessName).toBe('Bravo Trading');
    // The new workspace's permissions, not the old ones merged with them.
    expect(useAuthStore.getState().permissions).toEqual(['inbox:read']);
  });

  it('**empties the cache and reloads, rather than navigating in place**', async () => {
    queryClient.setQueryData(['customers'], [{ id: 'alpha-customer' }]);
    vi.mocked(api.post).mockResolvedValue(bravoSession as never);

    await switchWorkspace('t-bravo');

    // Not merely invalidated: another workspace's rows must not be renderable at all.
    expect(queryClient.getQueryData(['customers'])).toBeUndefined();
    // The dashboard, never the current path — `/leads/:id` in the new workspace is somebody else's
    // record or a 404.
    expect(hardNavigate).toHaveBeenCalledWith('/dashboard');
  });

  it('**blocks every other request from the moment it starts**', async () => {
    /*
     * The property that stops a successful switch from ending in a sign-out. Asserted at the gate
     * rather than through axios, because the gate is what `api.ts` consults on every request.
     */
    let gateDuringRequest = true;
    vi.mocked(api.post).mockImplementation(async () => {
      gateDuringRequest = mayRequest('/inbox/conversations');
      return bravoSession as never;
    });

    await switchWorkspace('t-bravo');

    expect(gateDuringRequest).toBe(false);
    // Still closed afterwards: this document is on its way out and should ask for nothing more.
    expect(mayRequest('/inbox/conversations')).toBe(false);
    // Except the switch itself, or a failed one could not be retried.
    expect(mayRequest('/auth/workspaces/switch')).toBe(true);
  });

  it('**leaves the session untouched when the server refuses**', async () => {
    vi.mocked(api.post).mockRejectedValue(new Error('Workspace not found'));

    await expect(switchWorkspace('t-nope')).rejects.toThrow('Workspace not found');

    expect(localStorage.getItem('token')).toBe('token-for-alpha');
    expect(useAuthStore.getState().tenant?.businessName).toBe('Alpha Trading');
    expect(hardNavigate).not.toHaveBeenCalled();
    // And the app keeps working: a refused switch must not leave every later request blocked.
    expect(mayRequest('/inbox/conversations')).toBe(true);
  });
});

describe('leaving a workspace', () => {
  it('**moves to what remains when it was the open one**', async () => {
    vi.mocked(api.delete).mockResolvedValue({ data: { data: { workspaces: [BRAVO] } } } as never);
    vi.mocked(api.post).mockResolvedValue(bravoSession as never);

    await leaveWorkspace('t-alpha');

    expect(api.delete).toHaveBeenCalledWith('/auth/workspaces/t-alpha');
    // Holding a token for a workspace it is no longer in is not a state to leave the app in.
    expect(api.post).toHaveBeenCalledWith('/auth/workspaces/switch', { tenantId: 't-bravo' });
    expect(hardNavigate).toHaveBeenCalledWith('/dashboard');
  });

  it('**does not land in a suspended workspace**', async () => {
    /*
     * A suspended workspace refuses the switch with a 403, so taking the first row blindly would end
     * a successful "leave" on an error toast and a session still pointing at the workspace just left.
     */
    const suspended = { ...workspace('t-frozen', 'Frozen Trading'), isSuspended: true };
    vi.mocked(api.delete).mockResolvedValue({
      data: { data: { workspaces: [suspended, BRAVO] } },
    } as never);
    vi.mocked(api.post).mockResolvedValue(bravoSession as never);

    await leaveWorkspace('t-alpha');

    expect(api.post).toHaveBeenCalledWith('/auth/workspaces/switch', { tenantId: 't-bravo' });
  });

  it('only updates the list when it was some other workspace', async () => {
    vi.mocked(api.delete).mockResolvedValue({
      data: { data: { workspaces: [{ ...ALPHA, isCurrent: true }] } },
    } as never);

    await leaveWorkspace('t-bravo');

    expect(useAuthStore.getState().workspaces).toEqual([{ ...ALPHA, isCurrent: true }]);
    // Nothing to move to, so nothing moves — the session is still valid where it is.
    expect(api.post).not.toHaveBeenCalled();
    expect(hardNavigate).not.toHaveBeenCalled();
  });
});
