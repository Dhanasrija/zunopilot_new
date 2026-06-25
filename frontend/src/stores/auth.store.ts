import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  role: 'OWNER' | 'MANAGER' | 'AGENT';
  emailVerified: boolean;
}

export interface AuthTenant {
  id: string;
  businessName: string;
  category: string;
}

interface AuthState {
  token: string | null;
  user: AuthUser | null;
  tenant: AuthTenant | null;
  setSession: (data: { token: string; user: AuthUser; tenant: AuthTenant }) => void;
  clear: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      tenant: null,
      setSession: ({ token, user, tenant }) => {
        localStorage.setItem('token', token);
        set({ token, user, tenant });
      },
      clear: () => {
        localStorage.removeItem('token');
        set({ token: null, user: null, tenant: null });
      },
    }),
    { name: 'wa-auth' }
  )
);
