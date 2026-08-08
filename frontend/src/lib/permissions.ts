import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth.store';

// What the signed-in user may do.
//
// Fetched from the server rather than mirrored here. A second copy of the
// matrix in the frontend is a copy that drifts, and the failure mode is the
// worst kind: a button that looks available and 403s, or one that is hidden
// from someone who is actually allowed.
//
// The server is still the enforcement point. This only decides what to render.

export type Permission =
  | 'inbox:read' | 'inbox:reply' | 'inbox:assign_self' | 'inbox:assign_others'
  | 'inbox:toggle_automation' | 'inbox:add_note' | 'inbox:delete'
  | 'customers:read' | 'customers:write' | 'orders:read' | 'orders:write'
  | 'catalogue:read' | 'catalogue:write'
  | 'workflows:read' | 'workflows:author' | 'workflows:publish'
  | 'connectors:read' | 'connectors:author' | 'connectors:delete'
  | 'analytics:read' | 'settings:read' | 'settings:write' | 'channel:manage'
  | 'team:read' | 'team:manage' | 'roles:manage'
  | 'workflows:delete' | 'templates:write' | 'templates:delete'
  | 'automation:write' | 'channel:disconnect'
  | 'impersonation:manage'
  // Optional modules. Only meaningful in a workspace that has been given the
  // module — the routes 404 regardless of who holds the permission.
  | 'leads:read' | 'leads:write' | 'leads:assign' | 'leads:delete'
  | 'campaigns:read' | 'campaigns:write' | 'campaigns:send'
  | 'tickets:read' | 'tickets:write' | 'tickets:assign' | 'tickets:close';

export type Role = 'OWNER' | 'MANAGER' | 'AGENT';

export interface RoleDescription { label: string; blurb: string }

interface MyPermissions {
  /** The workspace's own role — a name it chose, not an enum value. */
  roleId: string | null;
  roleName: string;
  isOwner: boolean;
  permissions: Permission[];
  /** @deprecated The legacy enum, for anything not yet migrated. */
  role: Role;
  roles: Record<Role, RoleDescription>;
}

export const usePermissions = () => {
  const { data, isLoading } = useQuery({
    queryKey: ['me', 'permissions'],
    queryFn: () => api.get<{ data: MyPermissions }>('/team/me/permissions').then((r) => r.data.data),
    // Rarely changes, and every screen asks. A role change takes effect on the
    // next load, which is the same moment the server starts refusing anyway.
    staleTime: 5 * 60_000,
  });

  // The session is the authority on *what this person may do*.
  //
  // Both this endpoint and `/auth/me` derive the list from the same
  // `resolvePermissions`, so they cannot disagree about content — but they can
  // about freshness, and two lists that are usually identical are exactly the
  // pair that eventually is not. `ProtectedRoute` re-reads the session on every
  // app load, so it is the fresher of the two. This hook keeps serving the role
  // *metadata* (name, isOwner, the role catalogue), which the session does not
  // carry.
  const sessionPermissions = useAuthStore((s) => s.permissions);

  return {
    role: data?.role,
    roleName: data?.roleName,
    isOwner: data?.isOwner ?? false,
    roles: data?.roles,
    isLoading,
    /**
     * Optimistic before anything has loaded, so a screen does not flash its
     * empty state and then fill in. The server refuses anything this gets wrong.
     */
    can: (permission: Permission) => {
      if (sessionPermissions.length > 0) return sessionPermissions.includes(permission);
      return !data || data.permissions.includes(permission);
    },
  };
};
