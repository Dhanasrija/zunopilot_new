import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../config/prisma.js';
import { ApiError } from '../utils/ApiError.js';

// Who belongs to a workspace, and what that lets them do.
//
// **Three questions were each being asked in several places, written out by hand every time.**
// This file gives each of them one definition:
//
//   1. *Is this person an active member of this workspace?* — five assignee checks and two team
//      lookups, all with the same `{ id, tenantId, isActive: true }` predicate and no shared
//      helper. Getting one of them wrong parks a live customer, lead or ticket with somebody who
//      cannot see it.
//   2. *How many people can still administer this workspace?* — the guard that stops the last
//      admin being removed, implemented twice and near-identically in `team.controller` and
//      `role.controller`.
//   3. *How many seats are in use?* — `limits.ts` enforces it and `billing.controller.ts`
//      displays it, with the same predicate duplicated. Those two drifting apart means a
//      workspace is told it has room and then refused, or the reverse.
//
// **This exists before the `Membership` table, on purpose.** Every function here queries `User`
// today, because `User.tenantId` is still where membership lives. When that moves, the bodies in
// this file change and the ten-odd call sites do not — which is the point of landing it as its own
// commit rather than as part of the schema change.

type Client = PrismaClient | Prisma.TransactionClient;

/**
 * One sentence, used everywhere.
 *
 * Five of the seven sites already said exactly this; the sixth said "Invalid agent", which named
 * a field rather than the problem and gave the reader nothing to act on. This is the better copy,
 * and none of the messages was load-bearing anywhere.
 */
const NOT_A_MEMBER = 'That person is not an active member of this workspace';

/**
 * The person, if they are an active member of this workspace. Otherwise a 400.
 *
 * **Scoped to the tenant, which is the whole job.** A user id arriving in a request body is
 * attacker-chosen, so assigning without this check would let a conversation, lead, ticket or
 * reminder be handed to somebody in another workspace — where it is invisible to everyone who
 * could act on it, and visible to somebody who should not see it.
 *
 * 400 rather than 404: the caller sent a value this workspace cannot use, and a 404 would imply
 * the *conversation* or *ticket* was missing. The two team-screen lookups deliberately answer 404
 * instead, because there the id is the subject of the request rather than one of its fields.
 *
 * Returns `fullName` because three of the call sites immediately write it into a timeline entry
 * ("Assigned to Priya Rao"), and a second query for it would be a second chance to forget the
 * tenant filter.
 */
export const requireActiveMember = async (
  tenantId: string,
  userId: string,
  client: Client = prisma,
): Promise<{ id: string; fullName: string }> => {
  const member = await client.user.findFirst({
    where: { id: userId, tenantId, isActive: true },
    select: { id: true, fullName: true },
  });
  if (!member) throw ApiError.badRequest(NOT_A_MEMBER);
  return member;
};

/**
 * The roles in this workspace that confer administration.
 *
 * **Asks about permissions, not the legacy enum.** With custom roles "owner" stopped being a
 * fixed thing, and the property that actually matters is whether anybody left can reach the team
 * screen. An owner role counts implicitly — `Role.permissions` is documented as unread when
 * `isOwner` is set, so it cannot be found by the `has` filter alone.
 */
const adminRoleIdsOf = async (tenantId: string, client: Client): Promise<string[]> => {
  const roles = await client.role.findMany({
    where: { tenantId, OR: [{ isOwner: true }, { permissions: { has: 'team:manage' } }] },
    select: { id: true },
  });
  return roles.map((role) => role.id);
};

/**
 * How many active people can still administer this workspace.
 *
 * `excludingUserId` answers the question the callers actually have — *would this change leave
 * nobody?* — so they can ask it before writing rather than reasoning about off-by-one after.
 *
 * `client` matters: `role.controller` calls this **inside a transaction, after its write**, so it
 * sees the state that would result. Passing `prisma` there would read the pre-write state and the
 * guard would pass on exactly the edit it exists to refuse.
 */
export const activeAdminCount = async (
  tenantId: string,
  { excludingUserId, client = prisma }: { excludingUserId?: string; client?: Client } = {},
): Promise<number> => {
  const adminRoleIds = await adminRoleIdsOf(tenantId, client);
  if (adminRoleIds.length === 0) return 0;

  return client.user.count({
    where: {
      tenantId,
      isActive: true,
      roleId: { in: adminRoleIds },
      ...(excludingUserId ? { id: { not: excludingUserId } } : {}),
    },
  });
};

/** The message shown when a change would leave nobody able to manage the workspace. */
export const NO_ADMIN_LEFT = 'That would leave nobody able to manage the team. Give someone a role with '
  + '"Add people, change their role, deactivate them" first.';

/**
 * Seats in use in this workspace.
 *
 * **One definition, because two were disagreeing about nothing.** `assertCanAddTeamMember`
 * enforces the plan's limit against this number and the billing page displays it; written out
 * separately, a change to one silently makes the meter and the gate tell different stories.
 *
 * Counts *active* people only, which is why reactivating somebody consumes a seat exactly as
 * inviting does.
 */
export const countSeats = (tenantId: string, client: Client = prisma): Promise<number> =>
  client.user.count({ where: { tenantId, isActive: true } });
