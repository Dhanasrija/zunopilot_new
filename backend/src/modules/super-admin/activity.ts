import { prisma } from '../../config/prisma.js';

// A workspace's history.
//
// **Derived from the authoritative rows, not from newly-added instrumentation.**
// That is the whole design decision here, and it is worth stating plainly: a
// tenant signed up on some date, connected a number on another, and has been
// answering messages since — all of that is already recorded, in
// `User.createdAt`, `WhatsappAccount.connectedAt`, `Message`, `Payment` and
// friends. Emitting a new event row on each of those actions from today onward
// would produce a timeline that is empty for every workspace that already
// exists, and that would stay subtly wrong forever wherever a code path forgot
// to emit.
//
// Deriving instead means the timeline is correct retroactively and cannot drift
// from what actually happened, because it *is* what happened. The cost is that
// only facts the schema already keeps can be shown — which is why `AuditEvent`
// exists alongside for operator actions, the one category nothing else records.
//
// High-volume rows are aggregated rather than listed. A workspace with 40,000
// messages does not need 40,000 timeline entries; it needs "first message here,
// and this is the daily shape since".

export type ActivityKind =
  | 'tenant.created'
  | 'user.signup'
  | 'whatsapp.connected'
  | 'whatsapp.reconnected'
  | 'message.first'
  | 'automation.triggered'
  | 'workflow.published'
  | 'plan.started'
  | 'payment.succeeded'
  | 'payment.failed'
  | 'invoice.issued'
  | 'handoff.requested'
  | 'admin.action';

export interface ActivityEntry {
  at: string;
  kind: ActivityKind;
  title: string;
  detail?: string;
  /** Set when the entry stands for more than one underlying row. */
  count?: number;
}

const iso = (date: Date): string => date.toISOString();

/**
 * One tenant's timeline, newest first.
 *
 * `limit` caps the *returned* list, not the sources — each source is bounded
 * independently so one chatty category cannot crowd out the rest. A tenant with
 * 500 routing decisions should still show its signup.
 */
export const tenantActivity = async (
  tenantId: string,
  limit = 120,
): Promise<ActivityEntry[]> => {
  const [
    tenant, users, channels, firstMessage, routing, published, subscription,
    payments, invoices, handoffs, adminEvents,
  ] = await Promise.all([
    prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { businessName: true, createdAt: true, category: true },
    }),
    prisma.user.findMany({
      where: { tenantId },
      select: {
        fullName: true, email: true, phone: true, role: true, createdAt: true, isActive: true,
      },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.whatsappAccount.findMany({
      where: { tenantId },
      select: {
        displayPhone: true, phoneNumberId: true, connectedAt: true, updatedAt: true,
        tokenExpiresAt: true,
      },
      orderBy: { connectedAt: 'asc' },
    }),
    prisma.message.findFirst({
      where: { tenantId },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true, direction: true },
    }),
    // What the automation actually decided, which is the useful reading of
    // "a message triggered something". Capped — this is the chattiest source.
    prisma.routingDecision.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: 40,
      select: {
        createdAt: true, source: true, decision: true, reasonCode: true, confidence: true,
        selectedWorkflow: { select: { name: true } },
      },
    }),
    prisma.workflowVersion.findMany({
      where: { workflow: { tenantId }, publishedAt: { not: null } },
      orderBy: { publishedAt: 'desc' },
      take: 20,
      select: { publishedAt: true, version: true, workflow: { select: { name: true } } },
    }),
    prisma.subscription.findUnique({
      where: { tenantId },
      select: { plan: true, interval: true, status: true, createdAt: true, assignedNote: true },
    }),
    prisma.payment.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: 25,
      select: {
        createdAt: true, paidAt: true, status: true, amountPaise: true, plan: true, interval: true,
        failureReason: true,
      },
    }),
    prisma.invoice.findMany({
      where: { tenantId },
      orderBy: { issuedAt: 'desc' },
      take: 25,
      select: { issuedAt: true, number: true, totalPaise: true },
    }),
    prisma.humanHandoff.findMany({
      where: { tenantId },
      orderBy: { startedAt: 'desc' },
      take: 20,
      select: { startedAt: true, reason: true, status: true },
    }),
    prisma.auditEvent.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: 40,
      select: {
        createdAt: true, action: true, summary: true,
        superAdmin: { select: { fullName: true } },
      },
    }),
  ]);

  const entries: ActivityEntry[] = [];
  const rupees = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

  if (tenant) {
    entries.push({
      at: iso(tenant.createdAt),
      kind: 'tenant.created',
      title: 'Workspace created',
      detail: `${tenant.businessName} · ${tenant.category.replace(/_/g, ' ').toLowerCase()}`,
    });
  }

  for (const user of users) {
    entries.push({
      at: iso(user.createdAt),
      kind: 'user.signup',
      // `fullName` is empty until the profile page is completed, so a signup that
      // never finished shows the number rather than an unattributed blank.
      title: `${user.fullName || 'Someone'} joined as ${user.role.toLowerCase()}`,
      detail: [user.phone, user.email].filter(Boolean).join(' · ')
        + (user.isActive ? '' : ' · deactivated since'),
    });
  }

  for (const channel of channels) {
    entries.push({
      at: iso(channel.connectedAt),
      kind: 'whatsapp.connected',
      title: 'WhatsApp number connected',
      detail: `${channel.displayPhone ?? 'unknown number'} · id ${channel.phoneNumberId}`,
    });
    // A later `updatedAt` on a channel is a token refresh or a reconnect. Worth
    // showing separately, because "connected once in March" and "reconnected
    // yesterday" mean very different things when someone reports it is broken.
    if (channel.updatedAt.getTime() - channel.connectedAt.getTime() > 60_000) {
      entries.push({
        at: iso(channel.updatedAt),
        kind: 'whatsapp.reconnected',
        title: 'WhatsApp connection updated',
        detail: `${channel.displayPhone ?? channel.phoneNumberId} · token refreshed or reconnected`,
      });
    }
  }

  if (firstMessage) {
    entries.push({
      at: iso(firstMessage.createdAt),
      kind: 'message.first',
      title: 'First message',
      detail: firstMessage.direction === 'INBOUND'
        ? 'A customer messaged them for the first time'
        : 'They sent their first message',
    });
  }

  for (const decision of routing) {
    // Never the customer's message text — this surface is read by operators, and
    // the same reasoning that keeps bodies out of `ConnectorCall` applies here.
    const what = decision.selectedWorkflow?.name
      ?? decision.decision.replace(/_/g, ' ').toLowerCase();
    entries.push({
      at: iso(decision.createdAt),
      kind: 'automation.triggered',
      title: `Automation: ${what}`,
      detail: [
        decision.source.replace(/_/g, ' ').toLowerCase(),
        decision.reasonCode.replace(/_/g, ' ').toLowerCase(),
        decision.confidence == null ? null : `confidence ${decision.confidence}`,
      ].filter(Boolean).join(' · '),
    });
  }

  for (const version of published) {
    if (!version.publishedAt) continue;
    entries.push({
      at: iso(version.publishedAt),
      kind: 'workflow.published',
      title: `Published “${version.workflow.name}” v${version.version}`,
    });
  }

  if (subscription) {
    entries.push({
      at: iso(subscription.createdAt),
      kind: 'plan.started',
      title: `${subscription.plan} plan · ${subscription.interval.toLowerCase()}`,
      detail: subscription.status === 'MANUAL'
        ? `assigned by an administrator${subscription.assignedNote ? ` — ${subscription.assignedNote}` : ''}`
        : `status ${subscription.status.toLowerCase()}`,
    });
  }

  for (const payment of payments) {
    const succeeded = payment.status === 'PAID';
    // `CREATED` is a checkout that was started and never finished — someone
    // closed the tab. Calling that "failed" reads as a payment problem and sends
    // support looking for one that does not exist.
    const abandoned = payment.status === 'CREATED';
    entries.push({
      at: iso(payment.paidAt ?? payment.createdAt),
      kind: succeeded ? 'payment.succeeded' : 'payment.failed',
      title: succeeded
        ? `Paid ${rupees(payment.amountPaise)}`
        : abandoned
          ? `Checkout started, not completed — ${rupees(payment.amountPaise)}`
          : `Payment ${payment.status.toLowerCase()} — ${rupees(payment.amountPaise)}`,
      detail: [
        `${payment.plan} ${payment.interval.toLowerCase()}`,
        payment.failureReason,
      ].filter(Boolean).join(' · '),
    });
  }

  for (const invoice of invoices) {
    entries.push({
      at: iso(invoice.issuedAt),
      kind: 'invoice.issued',
      title: `Invoice ${invoice.number}`,
      detail: rupees(invoice.totalPaise),
    });
  }

  for (const handoff of handoffs) {
    entries.push({
      at: iso(handoff.startedAt),
      kind: 'handoff.requested',
      title: 'Handed to a human',
      detail: [handoff.reason, handoff.status.toLowerCase()].filter(Boolean).join(' · '),
    });
  }

  for (const event of adminEvents) {
    entries.push({
      at: iso(event.createdAt),
      kind: 'admin.action',
      title: event.summary,
      detail: `${event.action}${event.superAdmin ? ` · by ${event.superAdmin.fullName}` : ''}`,
    });
  }

  return entries
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, limit);
};

/**
 * Daily message counts, for the shape of a workspace's traffic.
 *
 * Grouped in Postgres rather than pulled and counted in Node — a busy tenant has
 * hundreds of thousands of messages, and the only thing wanted here is one number
 * per day.
 */
export const dailyMessageCounts = async (
  tenantId: string,
  days = 30,
): Promise<Array<{ date: string; inbound: number; outbound: number }>> => {
  const rows = await prisma.$queryRaw<Array<{
    day: Date; direction: string; count: bigint;
  }>>`
    SELECT date_trunc('day', "createdAt") AS day, "direction", COUNT(*)::bigint AS count
    FROM "Message"
    WHERE "tenantId" = ${tenantId}
      AND "createdAt" >= NOW() - (${days} || ' days')::interval
    GROUP BY 1, 2
    ORDER BY 1 ASC
  `;

  const byDay = new Map<string, { date: string; inbound: number; outbound: number }>();
  for (const row of rows) {
    const date = row.day.toISOString().slice(0, 10);
    const entry = byDay.get(date) ?? { date, inbound: 0, outbound: 0 };
    if (row.direction === 'INBOUND') entry.inbound = Number(row.count);
    else entry.outbound = Number(row.count);
    byDay.set(date, entry);
  }

  return [...byDay.values()];
};
