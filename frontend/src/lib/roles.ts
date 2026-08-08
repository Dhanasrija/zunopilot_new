import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { Permission } from '@/lib/permissions';
import { useAuthStore } from '@/stores/auth.store';

// The workspace's own roles.
//
// The permission *catalogue* is served by the API rather than duplicated here, for
// the same reason the permission list is: a permission added on the server has to
// appear in the editor without a frontend deploy, and a second copy of the
// vocabulary is a copy that drifts.

export interface PermissionMeta {
  key: Permission;
  label: string;
  hint?: string;
  sensitive?: boolean;
}

export interface PermissionGroup {
  group: string;
  blurb: string;
  permissions: PermissionMeta[];
}

export interface RoleRow {
  id: string;
  name: string;
  description: string | null;
  permissions: Permission[];
  isOwner: boolean;
  isSystem: boolean;
  sortOrder: number;
  members: number;
  createdAt: string;
}

export interface RolesResponse {
  roles: RoleRow[];
  groups: PermissionGroup[];
  /** What the signed-in person may hand out. Anything else is disabled, not hidden. */
  grantable: Permission[];
}

/*
 * Keyed by workspace, like `['me','permissions']` and unlike everything else — see the note there.
 *
 * A role belongs to one workspace, and the Team screen puts these `roleId`s straight into a `Select`
 * whose value it then sends back. Another workspace's ids there would be a form that cannot be
 * submitted, or worse a role assignment refused with a message about a role the person can see.
 */
export const useRoles = () => {
  const tenantId = useAuthStore((s) => s.tenant?.id);
  return useQuery({
    queryKey: ['roles', tenantId],
    queryFn: () => api.get<{ data: RoleRow[]; meta: { groups: PermissionGroup[]; grantable: Permission[] } }>('/roles')
      .then((r): RolesResponse => ({
        roles: r.data.data,
        groups: r.data.meta.groups,
        grantable: r.data.meta.grantable,
      })),
  });
};
