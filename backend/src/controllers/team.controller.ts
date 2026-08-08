import { Prisma, UserRole } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../config/prisma.js';
import { logger } from '../config/logger.js';
import { notifyAddedToWorkspace } from '../modules/notifications/notification.producers.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { countryFromPhone, normalisePhone } from '../services/otp.service.js';
import { ApiError } from '../utils/ApiError.js';
import { tenantIdOf, userOf } from '../middleware/auth.js';
import { ROLE_DESCRIPTIONS, permissionsFor } from '../config/permissions.js';
import { assertCanAddTeamMember } from '../modules/billing/limits.js';
// `NO_ADMIN_LEFT` is deliberately not used here. This screen's refusal is about one named
// person — "This is the only person who can manage the team" — while the role editor's is about
// an edit to a role. Same guard, different sentence, because the reader's next move differs.
import { activeAdminCount, revokeMembership, syncMembership } from '../services/membership.service.js';

// Team management.
//
// Three guard rails run through every write here, and each exists because the
// failure it prevents is unrecoverable from inside the product:
//
//   1. A workspace can never lose its last active owner. Otherwise nobody can
//      manage the team, the channel or billing, and the only fix is a support
//      ticket and a database console.
//   2. You cannot demote or deactivate yourself. Same reason, arrived at by
//      accident rather than by malice.
//   3. Everything is scoped to the caller's tenant. A user id from another
//      workspace must read as "not found", not as a target.

/**
 * The closest legacy enum value for a custom role.
 *
 * `User.role` cannot be dropped in an additive migration, so it is kept roughly in
 * step for anything that still reads it — and as the fallback in `requireAuth` when
 * a user somehow has no `roleId`. It is a *label*, not a policy: "Kitchen staff"
 * with two inbox permissions maps to AGENT, and nothing enforces on that.
 */
const legacyEnumFor = (role: { isOwner: boolean; permissions: string[] }): UserRole => {
  if (role.isOwner || role.permissions.includes('team:manage')) return 'OWNER';
  if (role.permissions.includes('workflows:author') || role.permissions.includes('catalogue:write')) {
    return 'MANAGER';
  }
  return 'AGENT';
};

const memberSelect = {
  id: true,
  // The login identifier, so the team screen shows how each person gets in.
  phone: true,
  email: true,
  fullName: true,
  roleId: true,
  assignedRole: { select: { id: true, name: true, isOwner: true, permissions: true } },
  /** @deprecated The legacy enum. Still selected only as the fallback label. */
  role: true,
  isActive: true,
  emailVerified: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

const inviteSchema = z.object({
  /**
   * The colleague's mobile number — this is how they sign in.
   *
   * Required, because it is the login identifier. There is no password to hand
   * over any more: they enter this number, get a code, and they are in. Which
   * also means an invite no longer depends on email delivery the product does not
   * have.
   */
  phone: z.string().trim().min(6).max(24),
  /** Optional. Used for invoices and notices, never to sign in. */
  email: z.string().trim().email().max(200).optional().or(z.literal('')),
  fullName: z.string().min(1).max(120),
  /** One of the workspace's own roles. */
  roleId: z.string().min(1),
});

const updateSchema = z.object({
  /*
   * **`fullName` is deliberately absent.**
   *
   * One shared profile means editing it here would rename that person in *every* workspace they
   * belong to — so an admin in one business could rename somebody as their colleagues in another
   * business see them. People edit their own name through `PUT /auth/profile`.
   */
  roleId: z.string().min(1).optional(),
  isActive: z.boolean().optional(),
});

/**
 * Deactivate a member, and hand their open conversations back.
 *
 * **One implementation on purpose.** Both `PATCH { isActive: false }` and
 * `DELETE /:userId` mean "this person is out", and they used to differ: only the
 * delete path freed their conversations, and the UI called the patch one. So a
 * deactivated colleague kept every conversation assigned to them — customers
 * waiting on somebody who could no longer sign in, and invisible because the
 * inbox showed them as owned.
 *
 * Both routes now come through here, so the two cannot drift again.
 */
/**
 * One member of this workspace, in the shape the team screen reads.
 *
 * Asked of the membership: a user id that belongs to somebody in another workspace, or to somebody
 * whose login merely happens to be rooted here, is **not** a member of this one and must read as
 * "not found" rather than as a target.
 */
const memberOf = async (tenantId: string, userId: string) => {
  const membership = await prisma.membership.findUnique({
    where: { userId_tenantId: { userId, tenantId } },
    select: {
      isActive: true,
      roleId: true,
      legacyRole: true,
      assignedRole: { select: { id: true, name: true, isOwner: true, permissions: true } },
      user: { select: { id: true, phone: true, email: true, fullName: true, emailVerified: true } },
    },
  });
  if (!membership) return null;

  return {
    ...membership.user,
    roleId: membership.roleId,
    assignedRole: membership.assignedRole,
    role: membership.legacyRole,
    isActive: membership.isActive,
  };
};

// The removal itself lives in `membership.service` as `revokeMembership`. There are two doors out
// of a workspace now — an admin removing somebody, and that person leaving from their own switcher
// — and they must end in the same state, including the reminder and notification cleanup.

// `activeAdminCount` used to live here, in a near-identical copy of the one in
// `role.controller`. Both now come from `membership.service`, so "who can still administer this
// workspace" has one answer — and it keeps having one when membership moves off `User`.

export const listTeam = asyncHandler(async (req, res) => {
  /*
   * The roster is a list of **memberships**, not of logins.
   *
   * It used to be `user.findMany({ where: { tenantId } })`, which answers "logins created in this
   * workspace" — not the same list once a person can join from elsewhere. A colleague attached by
   * the invite below would have been **missing from the Team screen while holding a working
   * session**, so the workspace's own owner could neither see them nor take them off.
   *
   * Ordered by `joinedAt` rather than the account's `createdAt`: the question here is when this
   * person joined *this* workspace, which may be long after their account was made somewhere else.
   */
  const memberships = await prisma.membership.findMany({
    where: { tenantId: tenantIdOf(req) },
    select: {
      isActive: true,
      joinedAt: true,
      roleId: true,
      legacyRole: true,
      assignedRole: { select: { id: true, name: true, isOwner: true, permissions: true } },
      user: { select: { id: true, phone: true, email: true, fullName: true, emailVerified: true } },
    },
    orderBy: [{ isActive: 'desc' }, { joinedAt: 'asc' }],
  });

  // Flattened into the shape the team screen already reads, so the client needs no change: the
  // per-workspace facts come from the membership, the identity from the login.
  const members = memberships.map((membership) => ({
    ...membership.user,
    roleId: membership.roleId,
    assignedRole: membership.assignedRole,
    /** @deprecated The legacy enum, per workspace now. Still only a label. */
    role: membership.legacyRole,
    isActive: membership.isActive,
    createdAt: membership.joinedAt,
  }));

  // Conversation counts per member, so the team screen can show who is carrying
  // the load rather than just who exists.
  const assigned = await prisma.conversation.groupBy({
    by: ['assignedAgentId'],
    where: { tenantId: tenantIdOf(req), status: { in: ['OPEN', 'HUMAN_TAKEOVER'] } },
    _count: { _all: true },
  });
  const openByUser = new Map(assigned.map((row) => [row.assignedAgentId, row._count._all]));

  res.json({
    success: true,
    data: members.map((member) => ({
      ...member,
      openConversations: openByUser.get(member.id) ?? 0,
      isYou: member.id === userOf(req).id,
    })),
    meta: { roles: ROLE_DESCRIPTIONS },
  });
});

export const inviteMember = asyncHandler(async (req, res) => {
  const body = inviteSchema.parse(req.body);
  const tenantId = tenantIdOf(req);

  // Seat limit before the uniqueness check, so a workspace that is full is told
  // that rather than told the address is taken.
  await assertCanAddTeamMember(tenantId);

  const phone = normalisePhone(body.phone);
  const email = body.email?.trim().toLowerCase() || null;

  /*
   * ── A number that already has an account is **attached**, not refused ──────
   *
   * This used to be a flat conflict: `phone` is globally unique, so any number registered anywhere
   * on the platform could not be invited, and the message stayed generic so it did not reveal which
   * workspace held it. That was correct given a login could only ever be in one workspace. It is
   * the reason somebody running two businesses had to use two phone numbers.
   *
   * Now the login is reused and a **membership** is added. Three things follow, and each is a
   * deliberate choice rather than a consequence:
   *
   *   • **Already a member here is still a conflict.** Inviting the same person twice is a mistake,
   *     and silently doing nothing would look like it worked.
   *   • **A revoked membership is revived rather than duplicated.** `@@unique([userId, tenantId])`
   *     makes that structural: one row per person per workspace, reused, so the team screen cannot
   *     show somebody twice.
   *   • **Their own name wins.** One shared profile means the name typed here is only used for a
   *     number new to the platform. Overwriting an existing person's name from another workspace's
   *     invite form would rename them everywhere.
   */
  const existing = await prisma.user.findUnique({
    where: { phone },
    include: { memberships: { where: { tenantId } } },
  });

  if (existing?.memberships.some((membership) => membership.isActive)) {
    throw ApiError.conflict('That person is already on this team');
  }

  /*
   * The email check only applies to a **new** login.
   *
   * For an existing one the address is already theirs, and refusing "already in use" against the
   * person you are inviting would be nonsense. It stays for a genuinely new account, where two
   * accounts claiming one address is the thing being prevented.
   */
  if (email && !existing) {
    const byEmail = await prisma.user.findFirst({ where: { email } });
    if (byEmail) throw ApiError.conflict('That email address is already in use');
  }

  const role = await prisma.role.findFirst({ where: { id: body.roleId, tenantId } });
  if (!role) throw ApiError.badRequest('Choose a role for them');

  if (existing) {
    /*
     * Revive or create the membership, in one statement.
     *
     * `joinedAt` is reset on a rejoin: they are joining now, and the team screen orders by it. The
     * login itself is untouched — not their name, not their email, not `User.isActive`, and
     * certainly not `homeTenantId`, which records where the account came from.
     */
    const membership = await prisma.membership.upsert({
      where: { userId_tenantId: { userId: existing.id, tenantId } },
      create: {
        userId: existing.id,
        tenantId,
        roleId: role.id,
        legacyRole: legacyEnumFor(role),
        invitedById: userOf(req).id,
      },
      update: {
        isActive: true,
        revokedAt: null,
        joinedAt: new Date(),
        roleId: role.id,
        legacyRole: legacyEnumFor(role),
        invitedById: userOf(req).id,
      },
    });

    logger.info('Existing login attached to a workspace', {
      tenantId, userId: existing.id, membershipId: membership.id, byUserId: userOf(req).id,
    });

    /*
     * Tell them.
     *
     * **Only for an attached login**, not a brand-new one: somebody whose account was just created
     * by this invite has no other workspace to be surprised from, and their first sight of the
     * product is this workspace. An existing person is being given access to a business they may
     * never have heard of, and the only record of who did it would otherwise be a log line.
     *
     * Through `notifyQuietly`, so a bell that cannot be written never fails the invite.
     */
    const workspace = await prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId }, select: { businessName: true },
    });
    await notifyAddedToWorkspace({
      tenantId,
      userId: existing.id,
      businessName: workspace.businessName || 'a ZunoPilot workspace',
      addedByName: userOf(req).fullName || 'Someone',
    });

    const attached = await memberOf(tenantId, existing.id);
    /*
     * `attached: true` so the toast can tell the truth *after* the fact.
     *
     * "They can sign in with their mobile number now" is wrong here — they already could, and what
     * happened is that a stranger's existing account gained immediate access to this workspace.
     * The client needs to be able to say so.
     */
    res.status(201).json({ success: true, data: attached, meta: { attached: true } });
    return;
  }

  const member = await prisma.user.create({
    data: {
      tenantId,
      phone,
      email,
      // Derived from the number, the same way it is at signup — no IP lookup, and
      // right even when they are invited while travelling.
      country: countryFromPhone(phone),
      fullName: body.fullName.trim(),
      roleId: role.id,
      // The legacy enum, kept roughly in step so anything still reading it sees
      // something sensible. Nothing enforces on it any more.
      role: legacyEnumFor(role),
      // No password at all. They sign in with a code sent to the number above,
      // so there is nothing to generate, hand over, or ask them to change.
      passwordHash: null,
      // An address entered by somebody else is not verified by them entering it.
      emailVerified: false,
    },
    select: memberSelect,
  });

  // `invitedById` is the one thing a membership knows that `User` has nowhere to record.
  await syncMembership(member.id, { invitedById: userOf(req).id });

  res.status(201).json({ success: true, data: member, meta: { attached: false } });
});

export const updateMember = asyncHandler(async (req, res) => {
  const body = updateSchema.parse(req.body);
  const tenantId = tenantIdOf(req);
  const actor = userOf(req);

  const member = await memberOf(tenantId, req.params.userId!);
  if (!member) throw ApiError.notFound('Team member not found');

  // Does this person currently administer the workspace, and would the change take
  // that away? Asked of their role's permissions, because "owner" is no longer a
  // fixed thing.
  const administers = member.assignedRole?.isOwner
    || member.assignedRole?.permissions.includes('team:manage')
    || false;

  let nextRole = null;
  if (body.roleId !== undefined) {
    nextRole = await prisma.role.findFirst({ where: { id: body.roleId, tenantId } });
    if (!nextRole) throw ApiError.badRequest('That role does not exist in this workspace');
  }

  const wouldStopAdministering = administers && (
    body.isActive === false
    || (nextRole !== null && !nextRole.isOwner && !nextRole.permissions.includes('team:manage'))
  );

  if (wouldStopAdministering && (await activeAdminCount(tenantId, { excludingUserId: member.id })) === 0) {
    throw ApiError.badRequest(
      'This is the only person who can manage the team. Give someone else a role that '
      + 'can, first.',
    );
  }

  if (member.id === actor.id) {
    // Locking yourself out is always a mistake, and always one nobody else in
    // the workspace can undo if you were the only owner.
    if (body.roleId !== undefined && body.roleId !== member.roleId) {
      throw ApiError.badRequest('You cannot change your own role. Ask another owner.');
    }
    if (body.isActive === false) {
      throw ApiError.badRequest('You cannot deactivate your own account.');
    }
  }

  // Reactivating consumes a seat just as inviting does.
  if (body.isActive === true && !member.isActive) await assertCanAddTeamMember(tenantId);

  // Deactivation goes through the shared path so their conversations are freed,
  // whichever endpoint was used.
  if (body.isActive === false && member.isActive) {
    await revokeMembership(tenantId, member.id);
  }

  /*
   * **The membership for this workspace, not the login.**
   *
   * This wrote the role onto `User` and then mirrored it with `syncMembership`, which copies the
   * user row onto their *home* membership. For a colleague who joined from another workspace that
   * writes the new role into **the wrong workspace** — changing what they can do somewhere else and
   * leaving this workspace unchanged. It was invisible while every membership was a home membership.
   *
   * `User.role` and `User.roleId` are no longer written here at all. They describe the login's
   * origin, and the per-workspace answer lives on the membership.
   */
  await prisma.membership.update({
    where: { userId_tenantId: { userId: member.id, tenantId } },
    data: {
      ...(nextRole ? { roleId: nextRole.id, legacyRole: legacyEnumFor(nextRole) } : {}),
      // Already applied above when deactivating; this covers reactivation.
      ...(body.isActive === true ? { isActive: true, revokedAt: null } : {}),
    },
  });

  const updated = await memberOf(tenantId, member.id);
  res.json({ success: true, data: updated });
});

/**
 * Deactivate rather than delete.
 *
 * A user is referenced by every conversation they were assigned and every
 * internal note they wrote. Deleting the row would either cascade that history
 * away or fail on a foreign key; deactivating revokes access immediately —
 * `requireAuth` refuses an inactive user on the next request — and keeps the
 * record of who did what.
 */
export const removeMember = asyncHandler(async (req, res) => {
  const tenantId = tenantIdOf(req);
  const actor = userOf(req);

  const member = await memberOf(tenantId, req.params.userId!);
  if (!member) throw ApiError.notFound('Team member not found');

  if (member.id === actor.id) throw ApiError.badRequest('You cannot remove your own account.');
  const administers = member.assignedRole?.isOwner
    || member.assignedRole?.permissions.includes('team:manage')
    || false;
  if (administers && (await activeAdminCount(tenantId, { excludingUserId: member.id })) === 0) {
    throw ApiError.badRequest(
      'This is the only person who can manage the team. Give someone else a role that can, first.',
    );
  }

  await revokeMembership(tenantId, member.id);

  res.json({ success: true });
});

/** Who the caller is and what they may do. The UI reads this to hide the rest. */
export const myPermissions = asyncHandler(async (req, res) => {
  const user = userOf(req);
  const role = await prisma.role.findFirst({
    where: { id: user.roleId ?? '', tenantId: user.tenantId },
    select: { id: true, name: true, isOwner: true },
  });

  res.json({
    success: true,
    data: {
      /** The role's own name now — "Kitchen staff", not an enum value. */
      roleId: role?.id ?? null,
      roleName: role?.name ?? user.role,
      isOwner: role?.isOwner ?? user.role === 'OWNER',
      // Resolved by `requireAuth` from the workspace's own role, so the UI hides
      // exactly what the server would refuse. Still one source of truth.
      permissions: req.permissions ?? permissionsFor(user.role),
      /** @deprecated The legacy enum, for anything not yet migrated. */
      role: user.role,
      roles: ROLE_DESCRIPTIONS,
    },
  });
});
