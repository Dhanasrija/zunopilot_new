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
  /*
   * Asked of `Membership`, not `User`.
   *
   * Both conditions have to hold: an **active membership in this workspace**, and a login that has
   * not been switched off globally. They are different switches — `Membership.isActive` means "out
   * of this workspace", `User.isActive` is the operator's kill switch — and checking only one would
   * either let a suspended login be handed work, or let somebody removed from this workspace keep
   * receiving it.
   */
  const membership = await client.membership.findFirst({
    where: { userId, tenantId, isActive: true, user: { isActive: true } },
    select: { user: { select: { id: true, fullName: true } } },
  });
  if (!membership) throw ApiError.badRequest(NOT_A_MEMBER);
  return membership.user;
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

  return client.membership.count({
    where: {
      tenantId,
      isActive: true,
      user: { isActive: true },
      roleId: { in: adminRoleIds },
      ...(excludingUserId ? { userId: { not: excludingUserId } } : {}),
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
  /*
   * Memberships, not users.
   *
   * A person in two workspaces consumes **one seat in each**, which is the honest answer: each
   * workspace gets a seat's worth of use out of them, and neither should be billed for the other's
   * team. `user: { isActive: true }` too, so a globally suspended login stops consuming a seat
   * anywhere rather than being billed in workspaces it cannot reach.
   */
  client.membership.count({ where: { tenantId, isActive: true, user: { isActive: true } } });

// ── Keeping `Membership` in step with `User` ──────────────────────────────────
//
// **A transition state, and deliberately one-directional.** `User` is still the source of truth
// for which workspace somebody is in and what they may do; `Membership` is written alongside it so
// that by the time anything *reads* memberships, the table is already correct for every account —
// including ones created after the backfill ran.
//
// The rule that makes this safe: `syncMembership` **derives** everything from the user row rather
// than taking values from its caller. A call site cannot pass the wrong role or forget `isActive`,
// because it does not pass them at all. The cost is one extra read on a handful of low-frequency
// paths — signup, invite, a role change, a deactivation — which is the right trade for "the two
// cannot disagree".

/**
 * Create or update this person's membership so it matches their user row.
 *
 * Idempotent, and safe to call after any write to a user. Call it **inside the same transaction**
 * as that write where one exists, or a failure halfway leaves the two out of step — which is the
 * whole thing this function is for.
 *
 * `invitedById` is the one value that cannot be derived, because `User` has nowhere to record who
 * added somebody. It is only meaningful on the first write and is ignored afterwards.
 */
export const syncMembership = async (
  userId: string,
  { client = prisma, invitedById }: { client?: Client; invitedById?: string | null } = {},
): Promise<void> => {
  const user = await client.user.findUnique({
    where: { id: userId },
    select: { tenantId: true, roleId: true, role: true, isActive: true, createdAt: true },
  });
  // Not an error. A caller that deleted the user, or raced one, has nothing to sync — and this
  // must never be the reason a write path fails.
  if (!user) return;

  const where = { userId_tenantId: { userId, tenantId: user.tenantId } };
  const existing = await client.membership.findUnique({
    where,
    select: { id: true, isActive: true, revokedAt: true },
  });

  if (!existing) {
    await client.membership.create({
      data: {
        userId,
        tenantId: user.tenantId,
        roleId: user.roleId,
        legacyRole: user.role,
        isActive: user.isActive,
        // The account's own creation time, matching what the backfill did, so the team screen's
        // ordering does not depend on whether a row came from the migration or from this path.
        joinedAt: user.createdAt,
        revokedAt: user.isActive ? null : new Date(),
        invitedById: invitedById ?? null,
      },
    });
    return;
  }

  await client.membership.update({
    where,
    data: {
      roleId: user.roleId,
      legacyRole: user.role,
      isActive: user.isActive,
      /*
       * `revokedAt` marks *when they left*, so it moves only on a transition.
       *
       * Recomputing it on every sync would push the timestamp forward each time anything else
       * about a revoked person changed — so "left in March" would silently become "left today",
       * and the team screen would be confidently wrong about something nobody would think to
       * check.
       */
      ...(user.isActive
        ? { revokedAt: null }
        : (existing.isActive || existing.revokedAt === null ? { revokedAt: new Date() } : {})),
    },
  });
};

/**
 * Sync every member of one workspace.
 *
 * For the seeds, which build a whole tenant with users nested inside a single `tenant.create` and
 * so have no convenient moment to sync each person individually. One call at the end is both
 * shorter and harder to get wrong than threading a sync through each nested create — and it stays
 * correct if a seed later adds another user.
 *
 * Also the shape a one-off repair would take, if a write path is ever found that forgot to sync.
 */
export const syncMembershipsForTenant = async (
  tenantId: string,
  client: Client = prisma,
): Promise<number> => {
  const users = await client.user.findMany({ where: { tenantId }, select: { id: true } });
  for (const user of users) {
    // Sequential on purpose. These are seeds and repairs, never a hot path, and each call does a
    // read then a write — running them in parallel buys nothing and makes a failure harder to read.
    // eslint-disable-next-line no-await-in-loop
    await syncMembership(user.id, { client });
  }
  return users.length;
};

/**
 * Take somebody out of one workspace, and tidy up after them.
 *
 * **One definition, because there are now two doors out.** An admin removing a colleague and a
 * person leaving on their own end in exactly the same state, and the cleanup below is the part that
 * is easy to get half-right: written out twice, one of the two doors eventually forgets a line and
 * a workspace keeps handing reminders to somebody who cannot open it.
 *
 * What it does **not** do is touch `User.isActive`. That is the operator's global kill switch;
 * leaving one workspace is not leaving the product.
 *
 * Runs in a transaction because the four writes describe a single fact. A half-applied revoke is
 * how the two unread counters drifted apart in the notifications module.
 */
export const revokeMembership = (
  tenantId: string,
  userId: string,
  client: Client = prisma,
): Promise<void> => {
  const run = async (tx: Client) => {
    await tx.membership.update({
      where: { userId_tenantId: { userId, tenantId } },
      data: {
        isActive: false,
        revokedAt: new Date(),
        /*
         * Forget that they were last here.
         *
         * `lastSelectedAt` decides where a fresh login lands, and the row survives being revoked so
         * that rejoining is a reactivation rather than a new membership. Left set, somebody who left a
         * workspace and was later added back would **land in the one they walked out of** — and so
         * would anybody removed and reinstated. The workspace they actually work in is the one they
         * chose most recently and still belong to.
         */
        lastSelectedAt: null,
      },
    });

    // Their open conversations go back to the shared pool rather than sitting with a name that can
    // no longer answer them.
    await tx.conversation.updateMany({
      where: { tenantId, assignedAgentId: userId, status: { in: ['OPEN', 'HUMAN_TAKEOVER'] } },
      data: { assignedAgentId: null },
    });

    /*
     * The cascade that no longer fires.
     *
     * `Reminder.assigneeId` and `Notification.userId` are the only `onDelete: Cascade` user foreign
     * keys, and they were correct while removing somebody meant flipping `User.isActive` and never
     * deleting the row. Leaving a workspace is not a login delete, so without these two lines a
     * revoked person keeps reminders and an unread badge for a workspace they can no longer open.
     *
     * Deliberately not touched: `Lead.ownerId` and `Ticket.assigneeId` stay assigned, exactly as
     * they did before memberships existed. Reassigning somebody's pipeline is a decision for the
     * workspace, not a side effect of their departure.
     */
    await tx.reminder.deleteMany({ where: { tenantId, assigneeId: userId } });
    await tx.notification.deleteMany({ where: { tenantId, userId } });
  };

  // Already inside one? Join it. `$transaction` exists only on the top-level client, and calling it
  // on a transaction client is a runtime error rather than a type error — hence the check.
  const top = client as Partial<PrismaClient>;
  return typeof top.$transaction === 'function' ? top.$transaction(run) : run(client);
};
