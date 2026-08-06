import { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { ApiError } from '../../utils/ApiError.js';

// Curated customer lists.
//
// Every function here takes `tenantId` as its first argument and uses it in the `where`.
// That is not ceremony: `CustomerList.id` is a uuid a caller supplies, so without it a
// workspace could read or edit another workspace's list by guessing — and `customerIds`
// arrives as an array from the client, which is the sharper edge (see `addMembers`).

export const listInclude = {
  _count: { select: { members: true } },
} satisfies Prisma.CustomerListInclude;

/** Every list in the workspace, newest first, each with how many people are on it. */
export const allLists = (tenantId: string) => prisma.customerList.findMany({
  where: { tenantId },
  include: listInclude,
  orderBy: { createdAt: 'desc' },
});

/**
 * Resolve a list, or 404.
 *
 * `findFirst` with the tenant in the where, never `findUnique` on the id alone — the
 * whole point is that another workspace's id must not resolve.
 */
export const listOf = async (tenantId: string, listId: string) => {
  const list = await prisma.customerList.findFirst({
    where: { id: listId, tenantId },
    include: listInclude,
  });
  if (!list) throw ApiError.notFound('List not found');
  return list;
};

const isNameTaken = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError
  && error.code === 'P2002'
  && String((error.meta as { target?: unknown })?.target ?? '').includes('name');

export const createList = async (
  tenantId: string,
  input: { name: string; description?: string | null; createdByUserId: string },
) => {
  try {
    return await prisma.customerList.create({
      data: {
        tenantId,
        name: input.name,
        description: input.description ?? null,
        createdByUserId: input.createdByUserId,
      },
      include: listInclude,
    });
  } catch (error) {
    // `@@unique([tenantId, name])` surfaces as P2002. Translated here because the raw
    // Prisma message names a database index, which tells the person typing a name
    // nothing about what to do.
    if (isNameTaken(error)) {
      throw ApiError.badRequest(`A list called "${input.name}" already exists.`);
    }
    throw error;
  }
};

export const updateList = async (
  tenantId: string,
  listId: string,
  input: { name?: string; description?: string | null },
) => {
  await listOf(tenantId, listId);
  try {
    return await prisma.customerList.update({
      where: { id: listId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
      },
      include: listInclude,
    });
  } catch (error) {
    if (isNameTaken(error)) {
      throw ApiError.badRequest(`A list called "${input.name}" already exists.`);
    }
    throw error;
  }
};

/**
 * Delete the list.
 *
 * Memberships go with it through the cascade; **customers do not**. Worth stating because
 * "delete list" is a button somebody will click expecting the opposite of what it does if
 * the wording is even slightly off.
 */
export const deleteList = async (tenantId: string, listId: string) => {
  await listOf(tenantId, listId);
  await prisma.customerList.delete({ where: { id: listId } });
};

export interface MemberPage {
  members: Array<{
    id: string;
    addedAt: Date;
    customer: {
      id: string;
      name: string | null;
      waId: string;
      phone: string | null;
      lastSeenAt: Date | null;
      marketingOptIn: boolean;
      optedOutAt: Date | null;
    };
  }>;
  total: number;
}

/** One page of a list's members. Same `data` + total shape as the customer and order lists. */
export const listMembers = async (
  tenantId: string,
  listId: string,
  page: { take: number; skip: number },
): Promise<MemberPage> => {
  await listOf(tenantId, listId);
  const where = { listId };

  const [members, total] = await Promise.all([
    prisma.customerListMember.findMany({
      where,
      orderBy: { addedAt: 'desc' },
      take: page.take,
      skip: page.skip,
      select: {
        id: true,
        addedAt: true,
        customer: {
          select: {
            id: true,
            name: true,
            waId: true,
            phone: true,
            lastSeenAt: true,
            // Surfaced so the screen can be honest about who a campaign would actually
            // reach, rather than implying that being on a list is enough.
            marketingOptIn: true,
            optedOutAt: true,
          },
        },
      },
    }),
    prisma.customerListMember.count({ where }),
  ]);

  return { members, total };
};

export interface MembershipChange {
  /** How many rows the operation actually changed. */
  changed: number;
  /** Requested ids that are not customers of this workspace, and were ignored. */
  rejected: number;
}

/**
 * Add customers to a list.
 *
 * **The ids are filtered to this workspace's customers before anything is written.** This
 * is the one place a caller hands over a list of primary keys, so taking them at face
 * value would let one workspace pull another's customers onto its own list — and then
 * name that list as a campaign audience. The count of what was dropped is returned rather
 * than silently swallowed.
 *
 * `skipDuplicates` against `@@unique([listId, customerId])` makes re-adding a no-op, so
 * the same request can be retried and "add these 40" does not care which of them are
 * already there.
 */
export const addMembers = async (
  tenantId: string,
  listId: string,
  customerIds: string[],
  addedByUserId: string,
): Promise<MembershipChange> => {
  await listOf(tenantId, listId);

  const owned = await prisma.customer.findMany({
    where: { tenantId, id: { in: customerIds } },
    select: { id: true },
  });

  const result = await prisma.customerListMember.createMany({
    data: owned.map((customer) => ({ listId, customerId: customer.id, addedByUserId })),
    skipDuplicates: true,
  });

  return { changed: result.count, rejected: customerIds.length - owned.length };
};

/**
 * Remove customers from a list.
 *
 * Scoped by `listId`, which is already tenant-checked, so an id from elsewhere simply
 * matches nothing. Deletes memberships only — never the customer.
 */
export const removeMembers = async (
  tenantId: string,
  listId: string,
  customerIds: string[],
): Promise<MembershipChange> => {
  await listOf(tenantId, listId);
  const result = await prisma.customerListMember.deleteMany({
    where: { listId, customerId: { in: customerIds } },
  });
  return { changed: result.count, rejected: 0 };
};

/** Which lists a customer is on, for the detail panel. */
export const listsForCustomer = async (tenantId: string, customerId: string) =>
  prisma.customerList.findMany({
    where: { tenantId, members: { some: { customerId } } },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });
