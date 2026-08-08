import { z } from 'zod';
import type { UserRole } from '@prisma/client';
import { membershipOf, resolvePermissions, userOf } from '../middleware/auth.js';
import { enabledModulesFor } from '../modules/modules/module.service.js';
import { prisma } from '../config/prisma.js';
import { logger } from '../config/logger.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { signToken, signTokenFor } from '../utils/jwt.js';
import {
  countryFromPhone, normalisePhone, requestOtp, verifyOtp,
} from '../services/otp.service.js';
import { ownerRoleFor } from '../services/role.service.js';
import { syncMembership } from '../services/membership.service.js';

// Customer authentication: phone plus a one-time code, and nothing else.
//
// **Sign-up and sign-in are the same request.** A phone number either has an
// account or gets one, which removes the whole "already registered?" branch and
// the class of bug where someone signs up twice with two spellings of their email.
//
// Passwords are gone for customers. `User.passwordHash` stays nullable and unset —
// super admins still use one, deliberately, because the operator console must not
// depend on the same delivery path as customers.
//
// What comes back from verification includes `profileComplete`, so the client
// knows whether to show a dashboard or the profile form. The server decides that,
// because the client should not be inferring it from whichever fields it happens
// to have loaded.

const phoneSchema = z.object({
  phone: z.string().trim().min(6).max(24),
});

const verifySchema = phoneSchema.extend({
  code: z.string().trim().regex(/^\d{4,8}$/, 'Enter the code from your SMS'),
});

/**
 * What the client is told about this session.
 *
 * Carries **capabilities** as well as identity — `permissions` (what this person
 * may do) and `modules` (what this workspace has been given). Both exist so the
 * app can avoid rendering a link that 403s or 404s; neither is a security
 * boundary. `requirePermission` and `requireModule` remain the enforcement point,
 * and this is the same data they read, so the two cannot drift into a menu that
 * disagrees with the API.
 *
 * Async because module state is a row, not something on the token: an operator
 * turning a module off takes effect on the next request rather than at token
 * expiry.
 */
/*
 * **Takes the membership, not the user.**
 *
 * It used to take a user with `tenant` and `assignedRole` inlined, which was coherent while a login
 * had exactly one of each. It is not any more: `requireAuth` resolves *which* workspace a request is
 * acting in, and a session view built from the user row would report the workspace the login happens
 * to be rooted in — so somebody signed into their second business would be told the name, category,
 * modules and permissions of their first. The screen would be wrong about which business it was
 * showing, which is the worst version of this bug available.
 */
const sessionView = async (membership: {
  legacyRole: UserRole;
  assignedRole: { isOwner: boolean; permissions: string[] } | null;
  user: {
    id: string; phone: string | null; email: string | null; fullName: string;
    emailVerified: boolean; country: string | null;
  };
  tenant: {
    id: string; businessName: string; onboardingCompletedAt: Date | null;
    maskCustomerNumbers: boolean;
    aiAgentEnabled: boolean;
    businessCategory: {
      id: string; key: string; label: string;
      catalogueNoun: string | null; catalogueItemNoun: string | null;
    } | null;
  };
}) => {
  const user = { ...membership.user, tenant: membership.tenant };
  return ({
  user: {
    id: user.id,
    phone: user.phone,
    email: user.email,
    fullName: user.fullName,
    /*
     * The legacy enum from **this membership**, not from the user row.
     *
     * Still a label rather than policy — the client shows a role name from `permissions` and
     * `workspaces[].roleName` — but it has to be the label for the workspace they are actually in.
     */
    role: membership.legacyRole,
    emailVerified: user.emailVerified,
    country: user.country,
  },
  tenant: {
    id: user.tenant.id,
    businessName: user.tenant.businessName,
    // The key is what code matches on; the label is what a person reads.
    category: user.tenant.businessCategory?.key ?? null,
    categoryId: user.tenant.businessCategory?.id ?? null,
    categoryLabel: user.tenant.businessCategory?.label ?? null,
    /*
     * What this business calls the things it sells.
     *
     * Carried so the sidebar and the catalogue page read the same word from the same place.
     * They used to disagree: the page adapted with a hardcoded `grocery ? 'Products' : 'Menu'`
     * while the nav said "Menu" unconditionally, so a grocery workspace saw one word in the menu
     * and another on the page it opened.
     *
     * Defaulted here rather than in the browser, so every caller gets the same fallback and an
     * unconfigured category reads "Catalogue" instead of a restaurant's word.
     */
    catalogueNoun: user.tenant.businessCategory?.catalogueNoun ?? 'Catalogue',
    catalogueItemNoun: user.tenant.businessCategory?.catalogueItemNoun ?? 'Item',
    /**
     * Whether this workspace hides most of a customer's phone number.
     *
     * Carried so the UI can *explain* a masked number rather than showing bullets with no
     * reason. Combined with `customers:view_full_number` in `permissions` it also tells the
     * client whether *this* person is affected. Neither is a security boundary — the
     * redaction happens on the server, and this is only ever used to word a tooltip.
     */
    maskCustomerNumbers: user.tenant.maskCustomerNumbers,
    /**
     * This workspace's own half of the AI agent switch.
     *
     * Sent **alongside** `AI_AGENT` in `modules` rather than combined with it, because the two
     * off-states need different words. `modules` missing `AI_AGENT` means we switched it off and
     * they cannot change that; this field being false means they chose to. Flattening them into
     * one "AI is off" boolean would leave the Settings page unable to say which, and the honest
     * answer to "why is my bot not using AI" is exactly that distinction.
     */
    aiAgentEnabled: user.tenant.aiAgentEnabled,
  },
  permissions: resolvePermissions(membership.assignedRole, membership.legacyRole),
  modules: await enabledModulesFor(user.tenant.id),
  profileComplete: user.tenant.onboardingCompletedAt !== null,
  /**
   * Which workspace this session is acting in, and every workspace this login can reach.
   *
   * `tenant` above stays exactly as it was — the active one, in the shape the web store and the
   * mobile spec already read. This is additive beside it, following the convention every optional
   * field here already follows: a session minted before it existed simply will not carry it.
   *
   * `activeWorkspaceId` is redundant with `tenant.id` on purpose. The client needs to mark one row
   * in a list, and asking it to derive that by comparing against a differently-shaped object is how
   * "acting in A while the UI says B" gets written.
   */
  activeWorkspaceId: user.tenant.id,
  workspaces: await workspacesFor(user.id, user.tenant.id),
  });
};

/**
 * Every workspace this login can reach, newest-used first.
 *
 * Deliberately thin: what a switcher needs to draw a row and nothing more. No counts, no member
 * lists — those are per-workspace reads behind their own permissions, and putting them here would
 * mean one screen's needs dictating the shape of every session payload.
 */
const workspacesFor = async (userId: string, activeTenantId: string) => {
  const memberships = await prisma.membership.findMany({
    where: { userId, isActive: true },
    include: {
      tenant: { select: { id: true, businessName: true, logoUrl: true, isActive: true } },
      assignedRole: { select: { name: true, isOwner: true } },
    },
    orderBy: [{ lastSelectedAt: 'desc' }, { joinedAt: 'asc' }],
  });

  return memberships.map((membership) => ({
    id: membership.tenant.id,
    businessName: membership.tenant.businessName,
    logoUrl: membership.tenant.logoUrl,
    /*
     * The workspace's own name for the role — "Owner", "Shift lead" — not the legacy enum. A
     * switcher showing `AGENT` next to a role somebody renamed would be telling them their role is
     * something the Team screen says it is not.
     */
    roleName: membership.assignedRole?.name ?? null,
    isOwner: membership.assignedRole?.isOwner ?? false,
    joinedAt: membership.joinedAt,
    /*
     * Included even though a suspended workspace cannot be entered. Hiding it would make it vanish
     * from the switcher with no explanation, and "why did my other business disappear" is a worse
     * question than a row that says it is suspended.
     */
    isSuspended: !membership.tenant.isActive,
    isCurrent: membership.tenant.id === activeTenantId,
  }));
};

/*
 * Everything a session payload needs, hung off the **membership**.
 *
 * Replaces `sessionInclude`, which was user-shaped. That shape was the bug: a session built from
 * the user row reports whichever workspace the login is rooted in, so somebody signed into their
 * second business would be told the first one's name, category, modules and permissions.
 */
const membershipSessionInclude = {
  user: true,
  assignedRole: true,
  tenant: {
    include: {
      businessCategory: {
        select: {
          id: true, key: true, label: true, catalogueNoun: true, catalogueItemNoun: true,
        },
      },
    },
  },
} as const;

/** The session payload for one membership. One read, one shape, five call sites. */
const sessionFor = (membershipId: string) => prisma.membership.findUniqueOrThrow({
  where: { id: membershipId },
  include: membershipSessionInclude,
});


/**
 * Send a login code.
 *
 * Answers identically whether or not the number has an account. Telling a caller
 * "no account with that number" turns this endpoint into a way to enumerate which
 * of a leaked phone list are customers of ours.
 */
export const requestLoginCode = asyncHandler(async (req, res) => {
  const body = phoneSchema.parse(req.body);
  const result = await requestOtp(body.phone, req.ip ?? null);

  res.json({
    success: true,
    data: {
      expiresAt: result.expiresAt,
      resendAfterSeconds: result.resendAfterSeconds,
      channel: result.channel,
      // Present only outside production — see `echoAllowed()`. The client shows it
      // so testing does not spend real SMS.
      ...(result.code ? { devCode: result.code } : {}),
    },
  });
});

/**
 * Check the code, and sign in — creating the account on first use.
 *
 * A brand-new number gets a `Tenant` immediately, with an empty business name and
 * `onboardingCompletedAt` unset. Creating the workspace up front keeps
 * `User.tenantId` required, which is what stops a half-registered user existing
 * outside a workspace and reaching tenant-scoped code with no tenant.
 */
/**
 * The workspace a fresh login should land in.
 *
 * Most recently used, then longest-held. Shared with the switcher so "where do I end up" has one
 * answer whichever door somebody comes through.
 */
const landingMembershipFor = (userId: string) => prisma.membership.findFirst({
  where: { userId, isActive: true },
  include: { tenant: true },
  orderBy: [{ lastSelectedAt: 'desc' }, { joinedAt: 'asc' }],
});

export const verifyLoginCode = asyncHandler(async (req, res) => {
  const body = verifySchema.parse(req.body);
  const phone = await verifyOtp(body.phone, body.code);

  const existing = await prisma.user.findUnique({ where: { phone } });

  if (existing) {
    if (!existing.isActive) throw ApiError.forbidden('This account has been deactivated.');

    /*
     * Which workspace this login lands in.
     *
     * `lastSelectedAt desc, joinedAt asc` — where they were working last, falling back to the one
     * they have had longest. It matters as soon as a phone number can belong to several: signing
     * in should put somebody back where they were, not somewhere alphabetical.
     *
     * Suspension is now checked against the **chosen** workspace rather than the user's, and only
     * after choosing: one suspended workspace must not block a login whose other workspace is fine.
     */
    const landing = await landingMembershipFor(existing.id);
    if (!landing) {
      // No active membership anywhere. The account exists and can reach nothing — the honest
      // answer is the same as a deactivated one, because from the person's side it is.
      throw ApiError.forbidden('This account has been deactivated.');
    }
    if (!landing.tenant.isActive) {
      throw ApiError.forbidden('This workspace has been suspended. Please contact support.');
    }

    // A returning phone confirms the number again, which is the only thing an OTP
    // login can verify.
    await prisma.user.update({ where: { id: existing.id }, data: { emailVerified: existing.emailVerified } });
    // Remembered so the next login comes back here. Written on login and on an explicit switch
    // only — never per request, which would be a write on every call.
    await prisma.membership.update({
      where: { id: landing.id }, data: { lastSelectedAt: new Date() },
    });

    logger.info('Signed in with a login code', { userId: existing.id, tenantId: landing.tenantId });
    res.json({
      success: true,
      data: {
        // **The claim is what scopes the session.** Without it the request falls into
        // `requireAuth`'s legacy branch, which refuses anybody with more than one workspace.
        token: signToken({ userId: existing.id, tenantId: landing.tenantId }),
        ...await sessionView(await sessionFor(landing.id)),
        isNew: false,
      },
    });
    return;
  }

  const country = countryFromPhone(phone);

  const created = await prisma.tenant.create({
    data: {
      // Filled in on the profile page. Deliberately not a placeholder like
      // "My Business" — a blank field asks to be completed, a plausible-looking
      // default gets left alone and then appears on an invoice.
      businessName: '',
      /*
       * The workspace's starting roles.
       *
       * **Not seeded here any more.** This block used to re-implement `seedDefaultRoles` inline —
       * the same three names, permissions and sort orders, written out a second time — so the next
       * permission added to `ROLE_PERMISSIONS` would land in one place and not the other, and a
       * workspace created by signup would differ from one repaired by the role service. Seeded
       * just below instead, by the function that owns the question.
       */
      users: {
        create: { phone, fullName: '', role: 'OWNER', country },
      },
      fallback: {
        create: {
          response: "Sorry, I didn't catch that. Type 'Menu' to order, or 'Agent' to speak to our team.",
        },
      },
    },
    include: { users: true },
  });

  // Seed the workspace's roles and attach the founder to the owner one. Done after creation
  // rather than nested, because the role ids only exist once the tenant is written —
  // `ownerRoleFor` seeds and then picks.
  const ownerRole = await ownerRoleFor(created.id);
  if (ownerRole) {
    await prisma.user.update({
      where: { id: created.users[0].id },
      data: { roleId: ownerRole.id },
    });
  }

  // The founder's membership. After the role attach, so it copies the role rather than a null.
  await syncMembership(created.users[0].id);

  const founder = await prisma.membership.findFirstOrThrow({
    where: { userId: created.users[0].id, tenantId: created.id },
    select: { id: true },
  });
  const user = created.users[0]!;

  logger.info('New workspace created from a login code', {
    userId: user.id, tenantId: created.id, country,
  });

  res.status(201).json({
    success: true,
    data: {
      token: signToken({ userId: user.id, tenantId: created.id }),
      ...await sessionView(await sessionFor(founder.id)),
      isNew: true,
    },
  });
});

const profileSchema = z.object({
  businessName: z.string().trim().min(2).max(120),
  businessCategoryId: z.string().min(1),
  fullName: z.string().trim().min(2).max(120),
  contactNumber: z.string().trim().max(24).optional(),
  website: z.string().trim().max(200).optional(),
  /** Optional — the phone is the identifier, so nothing depends on this. */
  email: z.string().trim().email().max(200).optional().or(z.literal('')),
});

/**
 * Complete the profile.
 *
 * Also usable later to edit it, so there is one code path for "set up" and
 * "change" rather than two that can validate differently.
 */
export const completeProfile = asyncHandler(async (req, res) => {
  const body = profileSchema.parse(req.body);
  const actor = userOf(req);

  const category = await prisma.businessCategory.findFirst({
    where: { id: body.businessCategoryId, isActive: true },
  });
  if (!category) throw ApiError.badRequest('Choose a business category');

  const email = body.email?.trim() || null;
  if (email && email !== actor.email) {
    // Unique when present, so a clash has to be reported rather than thrown as a
    // raw constraint error.
    const clash = await prisma.user.findFirst({ where: { email, id: { not: actor.id } } });
    if (clash) throw ApiError.conflict('That email address is already in use.');
  }

  await prisma.$transaction([
    prisma.tenant.update({
      where: { id: actor.tenantId },
      data: {
        businessName: body.businessName,
        businessCategoryId: category.id,
        contactNumber: body.contactNumber || null,
        website: body.website || null,
        onboardingCompletedAt: new Date(),
      },
    }),
    prisma.user.update({
      where: { id: actor.id },
      data: {
        fullName: body.fullName,
        email,
        // An address supplied here is unverified. Claiming otherwise would let
        // someone assert an address they do not control.
        emailVerified: email ? false : actor.emailVerified,
      },
    }),
  ]);

  // Re-read the membership `requireAuth` resolved, so the response describes the workspace this
  // request was acting in rather than whichever one the login is rooted in.
  res.json({ success: true, data: await sessionView(await sessionFor(membershipOf(req).id)) });
});

/** The categories a workspace may choose from. Public: the signup form needs it. */
export const listBusinessCategories = asyncHandler(async (_req, res) => {
  const categories = await prisma.businessCategory.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
    select: { id: true, key: true, label: true, description: true },
  });
  res.json({ success: true, data: categories });
});

export const me = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await sessionView(await sessionFor(membershipOf(req).id)) });
});

/** Kept so an existing verification link still works. Email is optional now. */
export const verifyEmail = asyncHandler(async (req, res) => {
  const token = z.object({ token: z.string().min(1) }).parse(req.body).token;
  const user = await prisma.user.findFirst({ where: { verifyToken: token } });
  if (!user) throw ApiError.badRequest('Invalid verification token');
  await prisma.user.update({
    where: { id: user.id },
    data: { emailVerified: true, verifyToken: null },
  });
  res.json({ success: true, message: 'Email verified' });
});

export { normalisePhone };

// ── The workspace switcher ────────────────────────────────────────────────────
//
// **Both routes mount on `requireSession`, not `requireAuth`.** That is not an optimisation, it is
// the whole reason `requireSession` exists: `requireAuth` refuses a session whose workspace has been
// suspended, and refuses a legacy token belonging to somebody with several workspaces. If these two
// endpoints sat behind it, either state would be a dead end whose only exit is a support ticket —
// the person could see nothing and change nothing, including the thing that would fix it.
//
// The shape is `startImpersonation`'s, with the grant machinery removed: mint a short-lived token
// carrying the chosen workspace and let the client swap it. So there is **no mutable server-side
// "current workspace"** — nothing to drift between two tabs, and nothing to reconcile after a crash.

/** Every workspace this login can reach. Answers even when the active one is suspended. */
export const listWorkspaces = asyncHandler(async (req, res) => {
  const actor = userOf(req);
  // The workspace the token names, so the client can mark one row. Unvalidated and cosmetic — see
  // `req.claimedTenantId`. A claim for a workspace they are not in simply matches nothing.
  res.json({
    success: true,
    data: { workspaces: await workspacesFor(actor.id, req.claimedTenantId ?? '') },
  });
});

const switchSchema = z.object({ tenantId: z.string().min(1) });

export const switchWorkspace = asyncHandler(async (req, res) => {
  const body = switchSchema.parse(req.body);
  const actor = userOf(req);

  /*
   * A support session may never hop.
   *
   * The workspace consented to one operator viewing *one* workspace, for a bounded window. Letting
   * that token reach a second one would make the consent model decoration. There is deliberately no
   * flag to opt into this, the same way there is no writable variant of a support session.
   */
  if (req.impersonation) {
    throw ApiError.forbidden('A support session cannot change workspace.');
  }

  const membership = await prisma.membership.findUnique({
    where: { userId_tenantId: { userId: actor.id, tenantId: body.tenantId } },
    include: { tenant: true },
  });

  /*
   * **404, never 403.** "You are not a member of it" and "it does not exist" must be indistinguishable
   * or this endpoint enumerates workspaces by id: feed it uuids and the status code tells you which
   * ones are real.
   */
  if (!membership || !membership.isActive) throw ApiError.notFound('Workspace not found');
  if (!membership.tenant.isActive) {
    throw ApiError.forbidden('This workspace has been suspended. Please contact support.');
  }

  /*
   * The new token inherits the old one's expiry rather than starting a fresh lifetime — otherwise
   * two workspaces buy an indefinite session by ping-ponging between them. See `signTokenFor`.
   */
  const remaining = Math.floor(((req.tokenExp ?? 0) * 1000 - Date.now()) / 1000);
  if (remaining <= 0) throw ApiError.unauthorized('Invalid or expired token');

  await prisma.membership.update({
    where: { id: membership.id }, data: { lastSelectedAt: new Date() },
  });

  logger.info('Workspace switched', { userId: actor.id, tenantId: membership.tenantId });

  res.json({
    success: true,
    data: {
      token: signTokenFor({ userId: actor.id, tenantId: membership.tenantId }, remaining),
      // Exactly what a fresh login into this workspace would return, so the client adopts it
      // wholesale rather than merging two shapes.
      ...await sessionView(await sessionFor(membership.id)),
    },
  });
});
