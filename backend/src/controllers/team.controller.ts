import { Prisma, UserRole } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../config/prisma.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { countryFromPhone, normalisePhone } from '../services/otp.service.js';
import { ApiError } from '../utils/ApiError.js';
import { tenantIdOf, userOf } from '../middleware/auth.js';
import { ROLE_DESCRIPTIONS, permissionsFor } from '../config/permissions.js';
import { assertCanAddTeamMember } from '../modules/billing/limits.js';
// `NO_ADMIN_LEFT` is deliberately not used here. This screen's refusal is about one named
// person — "This is the only person who can manage the team" — while the role editor's is about
// an edit to a role. Same guard, different sentence, because the reader's next move differs.
import { activeAdminCount } from '../services/membership.service.js';

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
  fullName: z.string().min(1).max(120).optional(),
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
const deactivateMember = (tenantId: string, userId: string) => prisma.$transaction([
  prisma.user.update({ where: { id: userId }, data: { isActive: false } }),
  prisma.conversation.updateMany({
    where: { tenantId, assignedAgentId: userId, status: { in: ['OPEN', 'HUMAN_TAKEOVER'] } },
    data: { assignedAgentId: null },
  }),
]);

// `activeAdminCount` used to live here, in a near-identical copy of the one in
// `role.controller`. Both now come from `membership.service`, so "who can still administer this
// workspace" has one answer — and it keeps having one when membership moves off `User`.

export const listTeam = asyncHandler(async (req, res) => {
  const members = await prisma.user.findMany({
    where: { tenantId: tenantIdOf(req) },
    select: memberSelect,
    orderBy: [{ isActive: 'desc' }, { createdAt: 'asc' }],
  });

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

  // `phone` is globally unique, not unique per tenant, so a number already in
  // another workspace cannot be invited here. Saying which workspace would leak
  // it, so the message stays generic.
  const byPhone = await prisma.user.findUnique({ where: { phone } });
  if (byPhone) throw ApiError.conflict('That mobile number is already in use');

  if (email) {
    const byEmail = await prisma.user.findFirst({ where: { email } });
    if (byEmail) throw ApiError.conflict('That email address is already in use');
  }

  const role = await prisma.role.findFirst({ where: { id: body.roleId, tenantId } });
  if (!role) throw ApiError.badRequest('Choose a role for them');

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

  res.status(201).json({ success: true, data: member });
});

export const updateMember = asyncHandler(async (req, res) => {
  const body = updateSchema.parse(req.body);
  const tenantId = tenantIdOf(req);
  const actor = userOf(req);

  const member = await prisma.user.findFirst({
    where: { id: req.params.userId, tenantId },
    select: memberSelect,
  });
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
    await deactivateMember(tenantId, member.id);
  }

  const updated = await prisma.user.update({
    where: { id: member.id },
    data: {
      ...(body.fullName !== undefined ? { fullName: body.fullName.trim() } : {}),
      ...(nextRole ? { roleId: nextRole.id, role: legacyEnumFor(nextRole) } : {}),
      // Already applied above when deactivating; this covers reactivation.
      ...(body.isActive === true ? { isActive: true } : {}),
    },
    select: memberSelect,
  });

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

  const member = await prisma.user.findFirst({
    where: { id: req.params.userId, tenantId },
    select: memberSelect,
  });
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

  await deactivateMember(tenantId, member.id);

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
