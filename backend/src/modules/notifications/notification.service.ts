import { Prisma, type Notification, type NotificationKind, type NotificationPreference } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { logger } from '../../config/logger.js';

// Notifications.
//
// **What this is for.** Before it, an inbound WhatsApp message produced no signal
// unless someone had the Inbox open — that page polls itself every second, and that
// was the entire mechanism. Close the tab and messages arrived in silence.
//
// Three ideas carry the whole module:
//
//   1. **A null recipient means the workspace.** A customer's message belongs to
//      whoever picks it up. Addressing it to one person would mean it goes unanswered
//      whenever that person is away, which is the opposite of what a shared inbox is.
//   2. **Everything is deduped on the source event.** Two code paths handle inbound
//      messages and pg-boss retries failed jobs, so "notify" has to be idempotent or
//      one message becomes three.
//   3. **Notifying must never break the thing being notified about.** Every producer
//      calls through `notifyQuietly`, which swallows its own failures. A customer's
//      message getting stored matters infinitely more than the bell.

/** What a producer supplies. Rendered text, because a notification records what was true. */
export interface NotifyInput {
  tenantId: string;
  /** Null or omitted addresses the whole workspace. */
  userId?: string | null;
  kind: NotificationKind;
  title: string;
  body: string;
  /**
   * Relative path only, e.g. `/inbox?c=<id>`.
   *
   * Enforced rather than documented: an absolute URL here would be an open redirect
   * the moment it reached a push payload someone could click.
   */
  link?: string | null;
  conversationId?: string | null;
  /** Idempotency. Use the provider's id for the event, never a timestamp. */
  dedupeKey?: string | null;
}

/** Strips anything that is not a same-site path. */
const safeLink = (link: string | null | undefined): string | null => {
  if (!link) return null;
  // A leading `//` is protocol-relative and goes off-site, so one slash exactly.
  if (!link.startsWith('/') || link.startsWith('//')) return null;
  return link.slice(0, 500);
};

/**
 * Record a notification, at most once per `dedupeKey`.
 *
 * Returns the row, or `null` when an identical one already existed. The caller can
 * use that to decide whether to spend a push send.
 */
export const notify = async (input: NotifyInput): Promise<Notification | null> => {
  try {
    return await prisma.notification.create({
      data: {
        tenantId: input.tenantId,
        userId: input.userId ?? null,
        kind: input.kind,
        title: input.title.slice(0, 200),
        body: input.body.slice(0, 500),
        link: safeLink(input.link),
        conversationId: input.conversationId ?? null,
        dedupeKey: input.dedupeKey ?? null,
      },
    });
  } catch (err) {
    // P2002 on (tenantId, dedupeKey) is the success case for a retry: the
    // notification already exists, so there is nothing to do and nothing wrong.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return null;
    throw err;
  }
};

/**
 * Notify without ever failing the caller.
 *
 * **Use this from producers, always.** The inbound message path must not lose a
 * customer's message because a notification row could not be written — the bell is a
 * convenience and the message is the product.
 */
export const notifyQuietly = async (input: NotifyInput): Promise<Notification | null> => {
  try {
    return await notify(input);
  } catch (err) {
    logger.error('Could not record a notification', {
      tenantId: input.tenantId,
      kind: input.kind,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
};

/**
 * What this user should see: their own notifications plus the workspace's.
 *
 * Written once here rather than at each call site, because getting it wrong in either
 * direction is bad — too narrow and a shared inbox goes quiet, too broad and one
 * tenant reads another's.
 */
const visibleTo = (tenantId: string, userId: string): Prisma.NotificationWhereInput => ({
  tenantId,
  OR: [{ userId }, { userId: null }],
});

export const unreadCountFor = (tenantId: string, userId: string): Promise<number> =>
  prisma.notification.count({ where: { ...visibleTo(tenantId, userId), readAt: null } });

export const listFor = (
  tenantId: string,
  userId: string,
  { limit = 30, unreadOnly = false }: { limit?: number; unreadOnly?: boolean } = {},
): Promise<Notification[]> => prisma.notification.findMany({
  where: { ...visibleTo(tenantId, userId), ...(unreadOnly ? { readAt: null } : {}) },
  orderBy: { createdAt: 'desc' },
  take: Math.min(limit, 100),
});

/**
 * Mark one as read.
 *
 * **Scoped by `visibleTo`, so this cannot mark someone else's.** The id alone is not
 * authorisation: it arrives from a client.
 *
 * Note the honest limitation of a shared row: marking a workspace-wide notification
 * read marks it read for *everyone*. That is a deliberate simplification — the
 * alternative is a join table of per-user read state for rows that are mostly read
 * once by whoever is on shift. If per-person read state is wanted later, that table
 * is the change, not this function.
 */
export const markRead = async (
  tenantId: string,
  userId: string,
  notificationId: string,
): Promise<number> => {
  const { count } = await prisma.notification.updateMany({
    where: { ...visibleTo(tenantId, userId), id: notificationId, readAt: null },
    data: { readAt: new Date() },
  });
  return count;
};

export const markAllRead = async (tenantId: string, userId: string): Promise<number> => {
  const { count } = await prisma.notification.updateMany({
    where: { ...visibleTo(tenantId, userId), readAt: null },
    data: { readAt: new Date() },
  });
  return count;
};

/**
 * Mark everything about one conversation as read.
 *
 * **This is what keeps the bell honest.** The badge on a conversation row and the count on
 * the bell are two different columns describing the same fact — "nobody has looked at this
 * yet" — and before this they were cleared by different actions. Reading a thread zeroed
 * `Conversation.unreadCount`; the notification about it stayed unread until someone
 * separately clicked it in the bell. So the bell said 8 while the Inbox said nothing was
 * waiting, and neither number was wrong on its own terms.
 *
 * Takes a `client` so the caller can run it inside the same transaction as the conversation
 * reset. Two `updateMany`s that can half-succeed are exactly how the two counters drifted in
 * the first place.
 *
 * Scoped by `visibleTo`, which does real work here beyond authorisation: a `HANDOFF_REQUESTED`
 * addressed to a *named* colleague is not cleared by someone else opening the thread. Their
 * notification is about their own queue, not about whether the messages have been seen.
 *
 * Not limited to `MESSAGE_RECEIVED`. An order or a handoff raised on a thread you have just
 * read and dealt with is also no longer news, and filtering by kind would leave the bell
 * holding rows whose only link is a conversation the agent has already worked.
 */
export const markReadForConversation = async (
  tenantId: string,
  userId: string,
  conversationId: string,
  client: Prisma.TransactionClient = prisma,
): Promise<number> => {
  const { count } = await client.notification.updateMany({
    where: { ...visibleTo(tenantId, userId), conversationId, readAt: null },
    data: { readAt: new Date() },
  });
  return count;
};

// ── Preferences ───────────────────────────────────────────────────────────────

/**
 * This user's preferences, created on first read.
 *
 * Lazily rather than at signup, so accounts that predate this module behave like
 * everyone else instead of needing a backfill. `upsert` rather than find-then-create
 * because two tabs polling at once would race the create.
 */
export const preferencesFor = (userId: string): Promise<NotificationPreference> =>
  prisma.notificationPreference.upsert({
    where: { userId },
    update: {},
    create: { userId },
  });

/** Which preference flag governs a kind. Exhaustive by construction. */
const KIND_FLAG: Record<NotificationKind, keyof NotificationPreference> = {
  MESSAGE_RECEIVED: 'messageReceived',
  HANDOFF_REQUESTED: 'handoffRequested',
  ORDER_CREATED: 'orderCreated',
};

/** Does this person want to be told about this kind, on this channel? */
export const wants = (
  preference: NotificationPreference,
  kind: NotificationKind,
  channel: 'inApp' | 'browser' | 'push',
): boolean => Boolean(preference[KIND_FLAG[kind]]) && Boolean(preference[channel]);

export const updatePreferences = (
  userId: string,
  patch: Partial<Pick<
    NotificationPreference,
    'inApp' | 'browser' | 'push' | 'messageReceived' | 'handoffRequested' | 'orderCreated'
  >>,
): Promise<NotificationPreference> => prisma.notificationPreference.upsert({
  where: { userId },
  update: patch,
  create: { userId, ...patch },
});

/**
 * Everyone who should be pushed about a notification.
 *
 * A workspace-wide notification reaches every active user in the tenant; a targeted
 * one reaches its recipient. Preferences are applied by the caller, which needs the
 * rows anyway to find subscriptions.
 */
export const recipientsOf = async (notification: Notification): Promise<string[]> => {
  if (notification.userId) return [notification.userId];
  /*
   * Everybody who can reach this workspace — memberships, not logins rooted here.
   *
   * `user.findMany({ where: { tenantId } })` would miss a colleague who joined from another
   * workspace, so they would never be told about an inbound message while being fully able to
   * answer it. And it would reach somebody whose login was created here but who has since been
   * removed.
   */
  const memberships = await prisma.membership.findMany({
    where: { tenantId: notification.tenantId, isActive: true, user: { isActive: true } },
    select: { userId: true },
  });
  return memberships.map((membership) => membership.userId);
};
