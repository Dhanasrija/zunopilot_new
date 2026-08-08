import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { useAuthStore } from '@/stores/auth.store';
import { testQueryClient } from '@/test/render';
import ProtectedRoute from './ProtectedRoute';

/*
 * What happens when the workspace a session names is no longer one this person is in.
 *
 * **A membership can be revoked while somebody is signed in**, and under memberships that is ordinary
 * rather than exceptional: being taken off a side project says nothing about the business you run. The
 * global 401 handler's answer — clear the session, go to the login screen — is right for an expired
 * token and wrong for this, because the identity is still perfectly good.
 *
 * Two properties, and the second is the one that would rot silently:
 *
 *   1. A 401 from `/auth/me` re-homes into a workspace that is still real, and only signs out when
 *      there is nothing left.
 *   2. The session adopts the token from `localStorage`, not the one this render started with —
 *      otherwise a re-home or a switch in another tab stores one workspace's credential beside
 *      another's name and permissions.
 */

vi.mock('@/lib/api', () => ({ api: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } }));
vi.mock('@/lib/navigation', () => ({ hardNavigate: vi.fn() }));
vi.mock('@/lib/workspace', () => ({ switchWorkspace: vi.fn().mockResolvedValue(undefined) }));
vi.mock('sonner', () => ({ toast: { info: vi.fn(), error: vi.fn(), success: vi.fn() } }));

const { api } = await import('@/lib/api');
const { hardNavigate } = await import('@/lib/navigation');
const { switchWorkspace } = await import('@/lib/workspace');

const unauthorised = Object.assign(new Error('not a member of that workspace'), {
  response: { status: 401 },
});

const session = (name: string) => ({
  data: {
    data: {
      user: { id: 'u1', fullName: 'Two Hats', phone: '15550001', email: null, role: 'OWNER', emailVerified: false, country: 'IN' },
      tenant: { id: 't-alpha', businessName: name, category: null, categoryId: null, categoryLabel: null },
      profileComplete: true,
      permissions: ['team:manage'],
      modules: [],
      workspaces: [],
    },
  },
});

const renderGuarded = () => render(
  <QueryClientProvider client={testQueryClient()}>
    {/* The future flags only silence v7 deprecation warnings; they change nothing asserted here. */}
    <MemoryRouter
      initialEntries={['/dashboard']}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <Routes>
        <Route element={<ProtectedRoute />}>
          <Route path="/dashboard" element={<div>Dashboard</div>} />
        </Route>
        <Route path="/login" element={<div>Sign in</div>} />
      </Routes>
    </MemoryRouter>
  </QueryClientProvider>,
);

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.setItem('token', 'token-for-alpha');
  useAuthStore.setState({
    token: 'token-for-alpha', user: null, profileComplete: true,
    tenant: { id: 't-alpha', businessName: 'Alpha Trading', category: null, categoryId: null, categoryLabel: null },
    permissions: [], modules: [], workspaces: [],
  });
});

describe('a session whose workspace membership was revoked', () => {
  it('**opens a workspace that is still real instead of signing out**', async () => {
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url === '/auth/me') throw unauthorised;
      return {
        data: {
          data: {
            workspaces: [
              { id: 't-charlie', businessName: 'Charlie Trading', logoUrl: null, roleName: 'Owner', isOwner: true, joinedAt: '2026-01-01', isSuspended: false, isCurrent: false },
            ],
          },
        },
      } as never;
    });

    renderGuarded();

    // Asked of the server, not chosen from a list the client had lying around: `/auth/workspaces` is
    // on `requireSession`, so it answers for an identity whose workspace claim is stale.
    await waitFor(() => expect(switchWorkspace).toHaveBeenCalledWith('t-charlie'));
    expect(hardNavigate).not.toHaveBeenCalledWith('/login');
    expect(useAuthStore.getState().token).toBe('token-for-alpha');
  });

  it('signs out when there is nothing left to open', async () => {
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url === '/auth/me') throw unauthorised;
      return { data: { data: { workspaces: [] } } } as never;
    });

    renderGuarded();

    // The sign-out is not skipped by `handles401`, only deferred until it is known to be the answer.
    await waitFor(() => expect(hardNavigate).toHaveBeenCalledWith('/login'));
    expect(useAuthStore.getState().token).toBeNull();
    expect(switchWorkspace).not.toHaveBeenCalled();
  });

  it('**stores the token that is current, not the one this render began with**', async () => {
    // As if a switch in another tab had already written a new token by the time `/auth/me` answered.
    vi.mocked(api.get).mockImplementation(async () => {
      localStorage.setItem('token', 'token-written-elsewhere');
      return session('Alpha Trading') as never;
    });

    renderGuarded();

    await waitFor(() => expect(useAuthStore.getState().token).toBe('token-written-elsewhere'));
  });
});
