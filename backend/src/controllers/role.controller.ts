import type { Request } from 'express';
import { z } from 'zod';
import { prisma } from '../config/prisma.js';
import { logger } from '../config/logger.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { holds, tenantIdOf, userOf } from '../middleware/auth.js';
import {
  PERMISSIONS, PERMISSION_GROUPS, isPermission, type Permission,
} from '../config/permissions.js';

// Roles a workspace defines for itself.
//
// The vocabulary of permissions is fixed in code — it is what the routes enforce,
// so it cannot be invented at runtime. What a workspace chooses is which of them
// each of its own roles holds.
//
// Three guard rails, and each one exists because the alternative is a workspace
// nobody can administer:
//
//   1. **Somebody must always be able to manage the team.** Checked after every
//      change, not before — the question is whether the *result* leaves an active
//      user holding `team:manage`, which a "will this be fine" check computed from
//      the old state gets wrong.
//   2. **You cannot grant what you do not hold.** Otherwise anyone with
//      `roles:manage` writes themselves a role with `settings:write` and buys a
//      plan, which is privilege escalation with extra steps.
//   3. **The owner role is untouchable.** Not editable, not deletable, and holds
//      every permission implicitly. It is the floor that makes the other two
//      recoverable.

const roleSelect = {
  id: true,
  name: true,
  description: true,
  permissions: true,
  isOwner: true,
  isSystem: true,
  sortOrder: true,
  createdAt: true,
  _count: { select: { users: true } },
} as const;

const nameSchema = z.string().trim().min(2).max(60);

const createSchema = z.object({
  name: nameSchema,
  description: z.string().trim().max(300).optional(),
  permissions: z.array(z.string()).max(PERMISSIONS.length).default([]),
});

const updateSchema = z.object({
  name: nameSchema.optional(),
  description: z.string().trim().max(300).nullish(),
  permissions: z.array(z.string()).max(PERMISSIONS.length).optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
});

const idShape = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const requireRoleRow = async (tenantId: string, roleId: string | undefined) => {
  if (!roleId || !idShape.test(roleId)) throw ApiError.badRequest('Not a role id');
  const role = await prisma.role.findFirst({ where: { id: roleId, tenantId } });
  if (!role) throw ApiError.notFound('Role not found');
  return role;
};

/** Reject unknown keys loudly rather than silently dropping them. */
const cleanPermissions = (input: string[]): Permission[] => {
  const unknown = input.filter((key) => !isPermission(key));
  if (unknown.length) {
    throw ApiError.badRequest(`Not a permission: ${unknown.slice(0, 3).join(', ')}`);
  }
  return [...new Set(input)] as Permission[];
};

/**
 * Guard rail 2 — nobody grants a permission they do not hold.
 *
 * An owner holds everything, so this never obstructs them. It only bites when a
 * workspace has delegated `roles:manage` to a narrower role, which is exactly when
 * it should.
 */
const assertMayGrant = (req: Request, requested: Permission[]) => {
  const escalating = requested.filter((permission) => !holds(req, permission));
  if (escalating.length) {
    throw ApiError.forbidden(
      `You cannot grant a permission you do not have yourself: ${escalating.slice(0, 3).join(', ')}`,
    );
  }
};

/**
 * Guard rail 1 — the workspace keeps an administrator.
 *
 * Run **after** the write, inside the same transaction, so it sees the state that
 * would result. An owner role counts implicitly.
 */
const assertStillAdministrable = async (
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  tenantId: string,
) => {
  // Two explicit queries rather than a relation filter: which roles confer
  // administration is a question about roles, and asking it separately keeps the
  // implicit "owner holds everything" rule in one readable place.
  const adminRoles = await tx.role.findMany({
    where: {
      tenantId,
      OR: [{ isOwner: true }, { permissions: { has: 'team:manage' } }],
    },
    select: { id: true },
  });

  const admins = adminRoles.length === 0 ? 0 : await tx.user.count({
    where: { tenantId, isActive: true, roleId: { in: adminRoles.map((r) => r.id) } },
  });

  if (admins === 0) {
    throw ApiError.badRequest(
      'That would leave nobody able to manage the team. Give someone a role with '
      + '"Add people, change their role, deactivate them" first.',
    );
  }
};

export const listRoles = asyncHandler(async (req, res) => {
  const tenantId = tenantIdOf(req);

  const roles = await prisma.role.findMany({
    where: { tenantId },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    select: roleSelect,
  });

  res.json({
    success: true,
    data: roles.map((role) => ({
      id: role.id,
      name: role.name,
      description: role.description,
      // An owner role's stored list is not what is enforced, so report what it
      // actually grants rather than what happens to be in the column.
      permissions: role.isOwner ? [...PERMISSIONS] : role.permissions.filter(isPermission),
      isOwner: role.isOwner,
      isSystem: role.isSystem,
      sortOrder: role.sortOrder,
      members: role._count.users,
      createdAt: role.createdAt,
    })),
    meta: {
      // The catalogue the editor renders. Served rather than duplicated in the
      // frontend, so a permission added here appears there without a deploy.
      groups: PERMISSION_GROUPS,
      // What the caller may hand out. The UI disables the rest instead of letting
      // someone tick a box that will be refused.
      grantable: PERMISSIONS.filter((permission) => holds(req, permission)),
    },
  });
});

export const createRole = asyncHandler(async (req, res) => {
  const tenantId = tenantIdOf(req);
  const body = createSchema.parse(req.body);
  const permissions = cleanPermissions(body.permissions);
  assertMayGrant(req, permissions);

  const clash = await prisma.role.findFirst({ where: { tenantId, name: body.name } });
  if (clash) throw ApiError.conflict(`A role called "${body.name}" already exists`);

  const role = await prisma.role.create({
    data: {
      tenantId,
      name: body.name,
      description: body.description ?? null,
      permissions,
      // Only ever seeded, never created here: a second owner role would make
      // "which one is untouchable" ambiguous.
      isOwner: false,
      isSystem: false,
      sortOrder: 100,
    },
    select: roleSelect,
  });

  logger.info('Role created', { tenantId, roleId: role.id, permissions: permissions.length });
  res.status(201).json({ success: true, data: role });
});

export const updateRole = asyncHandler(async (req, res) => {
  const tenantId = tenantIdOf(req);
  const existing = await requireRoleRow(tenantId, req.params.roleId);
  const body = updateSchema.parse(req.body);

  if (existing.isOwner) {
    // Refused rather than partially honoured. An owner role that can be narrowed is
    // not a floor, and this is the only thing standing between a workspace and
    // locking itself out irrecoverably.
    throw ApiError.badRequest(
      'The owner role always has full access and cannot be changed. Create another role instead.',
    );
  }

  const permissions = body.permissions === undefined
    ? undefined
    : cleanPermissions(body.permissions);
  if (permissions) assertMayGrant(req, permissions);

  if (body.name && body.name !== existing.name) {
    const clash = await prisma.role.findFirst({ where: { tenantId, name: body.name } });
    if (clash) throw ApiError.conflict(`A role called "${body.name}" already exists`);
  }

  const role = await prisma.$transaction(async (tx) => {
    const updated = await tx.role.update({
      where: { id: existing.id },
      data: {
        ...(body.name === undefined ? {} : { name: body.name }),
        ...(body.description === undefined ? {} : { description: body.description ?? null }),
        ...(permissions === undefined ? {} : { permissions }),
        ...(body.sortOrder === undefined ? {} : { sortOrder: body.sortOrder }),
      },
      select: roleSelect,
    });

    // Removing `team:manage` from the role every administrator happens to be on is
    // the realistic way to lock a workspace out, so the check runs here.
    await assertStillAdministrable(tx, tenantId);
    return updated;
  });

  logger.info('Role updated', { tenantId, roleId: role.id });
  res.json({ success: true, data: role });
});

export const deleteRole = asyncHandler(async (req, res) => {
  const tenantId = tenantIdOf(req);
  const role = await requireRoleRow(tenantId, req.params.roleId);

  if (role.isOwner) throw ApiError.badRequest('The owner role cannot be deleted.');

  const members = await prisma.user.count({ where: { tenantId, roleId: role.id } });
  if (members > 0) {
    // Deleting would null their `roleId` and drop them to the legacy fallback,
    // silently changing what those people can do. Moving them first is the
    // decision, and it belongs to a person.
    throw ApiError.conflict(
      `${members} ${members === 1 ? 'person is' : 'people are'} on "${role.name}". `
      + 'Move them to another role first.',
    );
  }

  await prisma.role.delete({ where: { id: role.id } });

  logger.info('Role deleted', { tenantId, roleId: role.id });
  res.json({ success: true });
});

export { assertStillAdministrable };
