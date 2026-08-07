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

  /**
   * What this business calls the things it sells — "Menu", "Products", "Services".
   *
   * Comes from the workspace's category, already defaulted by the server to "Catalogue" when
   * that category has no word set, so callers never need a fallback of their own. Two nouns
   * because the screen needs both: "Add Product" and "Product Category" cannot be derived from
   * "Products" without pluralisation rules.
   *
   * Optional only because a session minted before this existed will not carry it.
   */
  catalogueNoun?: string;
  catalogueItemNoun?: string;
  /**
   * Whether this workspace hides most of a customer's phone number from team members.
   *
   * For wording a tooltip, not for deciding anything. The redaction happens on the server —
   * a masked response has already had the digits removed before it reaches this store, so
   * flipping this in devtools reveals nothing.
   *
   * Optional because a session minted before this field existed will not carry it.
   */
  maskCustomerNumbers?: boolean;

  /**
   * Whether this workspace *wants* the AI agent answering customers.
   *
   * Only half the answer. The other half is `AI_AGENT` in `modules`, which is ours to grant and
   * theirs to live with; both must be on for a model call to happen. Kept separate rather than
   * merged so Settings can say which one is off — "we switched this off" and "you switched this
   * off" are different sentences and only one of them is the workspace's problem.
   *
   * Optional because a session minted before this field existed will not carry it. Read it as
   * `?? true`, matching the column default.
   */
  aiAgentEnabled?: boolean;
}

/** A permission key from the server's `config/permissions.ts`. */
export type Permission = string;

/**
 * A module an operator controls for this workspace.
 *
 * The first three are add-ons, absent until granted. `AI_AGENT`, `ECOMMERCE` and
 * `KEYWORD_RULES` are the inverse: present for everyone, absent only where we have revoked them.
 */
export type ModuleKey =
  | 'MARKETING' | 'LEADS' | 'SUPPORT' | 'AI_AGENT' | 'ECOMMERCE' | 'KEYWORD_RULES';

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

/**
 * What this workspace calls the things it sells.
 *
 * One accessor so the sidebar and the catalogue page cannot drift apart again — they used to,
 * with the page adapting on a hardcoded `grocery ? 'Products' : 'Menu'` while the nav said
 * "Menu" to everyone. The server has already applied the generic fallback; the defaults here
 * only cover a session persisted before the field existed.
 */
export const useCatalogueNouns = (): { noun: string; item: string; items: string } => {
  const tenant = useAuthStore((s) => s.tenant);
  const item = tenant?.catalogueItemNoun || 'Item';
  return {
    noun: tenant?.catalogueNoun || 'Catalogue',
    item,
    items: pluralise(item),
  };
};

/**
 * Enough English to pluralise an operator-chosen noun.
 *
 * Not a general pluraliser and not trying to be — it covers the shapes a catalogue noun
 * actually takes (Item, Product, Service, Dish, Category) and would get "Person" wrong. The
 * alternative was a third column asking an operator to type the plural of a word they just
 * typed the singular of, which is a worse trade for a word that appears on one tab.
 *
 * If a category ever needs an irregular plural, that third column is the fix.
 */
const pluralise = (word: string): string => {
  if (/[^aeiou]y$/i.test(word)) return `${word.slice(0, -1)}ies`;
  if (/(s|x|z|ch|sh)$/i.test(word)) return `${word}es`;
  return `${word}s`;
};
