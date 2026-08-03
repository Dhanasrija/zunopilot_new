import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { Permission } from '@/lib/permissions';

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

export const useRoles = () => useQuery({
  queryKey: ['roles'],
  queryFn: () => api.get<{ data: RoleRow[]; meta: { groups: PermissionGroup[]; grantable: Permission[] } }>('/roles')
    .then((r): RolesResponse => ({
      roles: r.data.data,
      groups: r.data.meta.groups,
      grantable: r.data.meta.grantable,
    })),
});
