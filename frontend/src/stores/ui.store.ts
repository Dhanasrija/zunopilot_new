import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// Layout preferences.
//
// **Separate from `auth.store`, under its own key.** Two reasons, both practical: a layout
// choice is not session data, and `clear()` on logout wipes the auth blob — folding this in
// would silently reset somebody's sidebar every time they signed out.
//
// Only the *collapsed* state lives here. The mobile drawer's open/closed state is local
// component state on purpose: restoring "open" on load would mean reloading a phone into an
// overlay covering the page, which is a bug rather than a remembered preference.

interface UiState {
  /** Desktop only — below `lg` the sidebar is a drawer and this is ignored. */
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      // Expanded by default: a first-time user should see the labels.
      sidebarCollapsed: false,
      toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
    }),
    { name: 'zp-ui' },
  ),
);
