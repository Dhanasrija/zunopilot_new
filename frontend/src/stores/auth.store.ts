import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface AuthUser {
  id: string;
  /** The login identifier, E.164 digits. */
  phone: string | null;
  /** Optional — captured on the profile page, never used to sign in. */
  email: string | null;
  fullName: string;
  role: 'OWNER' | 'MANAGER' | 'AGENT';
  emailVerified: boolean;
  /** ISO alpha-2, derived from the phone's calling code at signup. */
  country: string | null;
}

export interface AuthTenant {
  id: string;
  businessName: string;
  /** The stable category key, or null until the profile is completed. */
  category: string | null;
  categoryId: string | null;
  categoryLabel: string | null;
}

/** A permission key from the server's `config/permissions.ts`. */
export type Permission = string;

/** An optional module an operator has switched on for this workspace. */
export type ModuleKey = 'MARKETING' | 'LEADS' | 'SUPPORT';

interface AuthState {
  token: string | null;
  user: AuthUser | null;
  tenant: AuthTenant | null;
  /**
   * Whether the profile form has been completed.
   *
   * Decided by the server and carried here, so routing is not inferred from
   * whichever fields happen to be loaded — a half-set-up workspace must not land
   * on a dashboard of zeroes.
   */
  profileComplete: boolean;
  /**
   * What this person may do, and what this workspace has.
   *
   * Both come from the server on every sign-in and every `/auth/me`, and exist
   * only so the app can avoid rendering a link that 403s or 404s. **Neither is a
   * security boundary** — the API enforces both independently, so tampering with
   * what is in localStorage buys nothing but a broken menu.
   */
  permissions: Permission[];
  modules: ModuleKey[];
  setSession: (data: {
    token: string; user: AuthUser; tenant: AuthTenant; profileComplete?: boolean;
    permissions?: Permission[]; modules?: ModuleKey[];
  }) => void;
  clear: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      tenant: null,
      profileComplete: false,
      permissions: [],
      modules: [],
      setSession: ({ token, user, tenant, profileComplete, permissions, modules }) => {
        localStorage.setItem('token', token);
        set({
          token,
          user,
          tenant,
          profileComplete: profileComplete ?? true,
          permissions: permissions ?? [],
          modules: modules ?? [],
        });
      },
      clear: () => {
        localStorage.removeItem('token');
        set({
          token: null, user: null, tenant: null, profileComplete: false,
          permissions: [], modules: [],
        });
      },
    }),
    { name: 'wa-auth' }
  )
);

/**
 * Whether the signed-in user holds a permission.
 *
 * Undefined means "no requirement", so a caller can pass an optional key without
 * branching. A session persisted before capabilities existed has an empty list;
 * that hides nav items until the next `/auth/me`, which is the safe direction —
 * the alternative is showing links that immediately fail.
 */
export const useCan = (permission?: Permission): boolean => {
  const permissions = useAuthStore((s) => s.permissions);
  return permission === undefined || permissions.includes(permission);
};

/** Whether this workspace has an optional module. */
export const useHasModule = (module?: ModuleKey): boolean => {
  const modules = useAuthStore((s) => s.modules);
  return module === undefined || modules.includes(module);
};
