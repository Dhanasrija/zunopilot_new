import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../config/prisma.js';
import { ROLE_PERMISSIONS } from '../config/permissions.js';

// The roles a brand-new workspace starts with.
//
// Every tenant needs its own `Role` rows before anyone can be invited — there is
// nothing to assign otherwise. So this runs at tenant creation, and the migration
// did the same thing for workspaces that already existed.
//
// The three are seeded from `ROLE_PERMISSIONS` rather than hardcoded here, so
// "what does Manager mean out of the box" has exactly one answer. They are marked
// `isSystem` only so the UI can say where they came from — a workspace is free to
// rename them, change what they grant, or delete them.

type Client = PrismaClient | Prisma.TransactionClient;

export const DEFAULT_ROLE_NAMES = {
  OWNER: 'Owner',
  MANAGER: 'Manager',
  AGENT: 'Agent',
} as const;

const DESCRIPTIONS = {
  OWNER: 'Full access, including the team, settings and the WhatsApp connection.',
  MANAGER: 'Runs the day to day: inbox, catalogue, orders, workflows and connectors.',
  AGENT: 'Answers customers in the shared inbox, and handles their orders.',
} as const;

/**
 * Create the starting roles for a workspace, and return them.
 *
 * Idempotent: a role whose name is already taken is left alone, so calling this
 * twice cannot produce duplicates or reset a workspace's customisations.
 *
 * The owner role carries `isOwner`, which is what makes it all-permissions,
 * uneditable and undeletable — the floor that stops a workspace locking itself out.
 * Its `permissions` column is written for completeness and never read.
 */
export const seedDefaultRoles = async (client: Client, tenantId: string) => {
  const existing = await client.role.findMany({ where: { tenantId }, select: { name: true } });
  const taken = new Set(existing.map((role) => role.name));

  const wanted = [
    { key: 'OWNER', sortOrder: 10, isOwner: true },
    { key: 'MANAGER', sortOrder: 20, isOwner: false },
    { key: 'AGENT', sortOrder: 30, isOwner: false },
  ] as const;

  for (const { key, sortOrder, isOwner } of wanted) {
    const name = DEFAULT_ROLE_NAMES[key];
    if (taken.has(name)) continue;
    await client.role.create({
      data: {
        tenantId,
        name,
        description: DESCRIPTIONS[key],
        permissions: [...ROLE_PERMISSIONS[key]],
        isOwner,
        isSystem: true,
        sortOrder,
      },
    });
  }

  return client.role.findMany({
    where: { tenantId },
    orderBy: { sortOrder: 'asc' },
  });
};

/**
 * The role a workspace's first user gets.
 *
 * Seeds if needed, so a tenant created by any path ends up with roles. Falls back
 * to whatever role exists if the owner one is somehow missing, rather than leaving
 * the founding user with no role at all.
 */
export const ownerRoleFor = async (tenantId: string, client: Client = prisma) => {
  const roles = await seedDefaultRoles(client, tenantId);
  return roles.find((role) => role.isOwner) ?? roles[0] ?? null;
};
