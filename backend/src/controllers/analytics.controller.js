import { prisma } from '../config/prisma.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const pctChange = (curr, prev) =>
  prev === 0 ? null : Number(((curr - prev) / prev * 100).toFixed(1));

// ── Overview (with prev-period trend) ────────────────────────────────────────
export const overview = asyncHandler(async (req, res) => {
  const tenantId = req.tenantId;
  const since    = new Date(Date.now() - 30 * 86400_000);
  const prevSince = new Date(Date.now() - 60 * 86400_000);

  const [
    activeConversations,
    totalOrders, deliveredOrders, revenueAgg,
    prevOrders, prevDelivered, prevRevenueAgg,
    totalConversations, takeoverCount,
  ] = await Promise.all([
    prisma.conversation.count({ where: { tenantId, status: { in: ['OPEN', 'HUMAN_TAKEOVER'] } } }),
    // current period
    prisma.order.count({ where: { tenantId, placedAt: { gte: since } } }),
    prisma.order.count({ where: { tenantId, status: 'DELIVERED', placedAt: { gte: since } } }),
    prisma.order.aggregate({ _sum: { totalAmount: true }, where: { tenantId, status: { not: 'CANCELLED' }, placedAt: { gte: since } } }),
    // previous period
    prisma.order.count({ where: { tenantId, placedAt: { gte: prevSince, lt: since } } }),
    prisma.order.count({ where: { tenantId, status: 'DELIVERED', placedAt: { gte: prevSince, lt: since } } }),
    prisma.order.aggregate({ _sum: { totalAmount: true }, where: { tenantId, status: { not: 'CANCELLED' }, placedAt: { gte: prevSince, lt: since } } }),
    // takeover rate
    prisma.conversation.count({ where: { tenantId, createdAt: { gte: since } } }),
    prisma.conversation.count({ where: { tenantId, status: 'HUMAN_TAKEOVER', createdAt: { gte: since } } }),
  ]);

  const grossRevenue = Number(revenueAgg._sum.totalAmount || 0);
  const prevRevenue  = Number(prevRevenueAgg._sum.totalAmount || 0);

  res.json({
    success: true,
    data: {
      since,
      activeConversations,
      totalOrders,     totalOrdersTrend:     pctChange(totalOrders,     prevOrders),
      deliveredOrders, deliveredOrdersTrend: pctChange(deliveredOrders, prevDelivered),
      grossRevenue,    grossRevenueTrend:    pctChange(grossRevenue,    prevRevenue),
      humanTakeoverRate: totalConversations > 0
        ? Number((takeoverCount / totalConversations).toFixed(3)) : 0,
    },
  });
});

// ── Orders by day (line chart) ────────────────────────────────────────────────
export const ordersByDay = asyncHandler(async (req, res) => {
  const tenantId = req.tenantId;
  const since = req.query.since ? new Date(req.query.since) : new Date(Date.now() - 30 * 86400_000);
  const rows = await prisma.$queryRaw`
    SELECT date_trunc('day', "placedAt")::date   AS day,
           COUNT(*)::int                          AS orders,
           COALESCE(SUM("totalAmount"), 0)::float AS revenue
      FROM "Order"
     WHERE "tenantId" = ${tenantId} AND "placedAt" >= ${since}
  GROUP BY day
  ORDER BY day ASC;
  `;
  res.json({ success: true, data: rows });
});

// ── Orders by status (donut chart) ───────────────────────────────────────────
export const ordersByStatus = asyncHandler(async (req, res) => {
  const tenantId = req.tenantId;
  const since = new Date(Date.now() - 30 * 86400_000);
  const statuses = ['NEW', 'ACCEPTED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED'];
  const counts = await Promise.all(
    statuses.map((status) => prisma.order.count({ where: { tenantId, status, placedAt: { gte: since } } }))
  );
  res.json({ success: true, data: statuses.map((status, i) => ({ status, count: counts[i] })) });
});

// ── Message performance stats ─────────────────────────────────────────────────
export const messageStats = asyncHandler(async (req, res) => {
  const tenantId = req.tenantId;
  const since = new Date(Date.now() - 30 * 86400_000);
  const prevSince = new Date(Date.now() - 60 * 86400_000);

  const base = { tenantId, direction: 'OUTBOUND', createdAt: { gte: since } };
  const prevBase = { tenantId, direction: 'OUTBOUND', createdAt: { gte: prevSince, lt: since } };

  const [sent, delivered, read, failed, prevSent, prevFailed] = await Promise.all([
    prisma.message.count({ where: { ...base, status: { in: ['SENT', 'DELIVERED', 'READ'] } } }),
    prisma.message.count({ where: { ...base, status: { in: ['DELIVERED', 'READ'] } } }),
    prisma.message.count({ where: { ...base, status: 'READ' } }),
    prisma.message.count({ where: { ...base, status: 'FAILED' } }),
    prisma.message.count({ where: { ...prevBase, status: { in: ['SENT', 'DELIVERED', 'READ'] } } }),
    prisma.message.count({ where: { ...prevBase, status: 'FAILED' } }),
  ]);

  const deliveryRate = sent > 0 ? Number((delivered / sent * 100).toFixed(1)) : 0;
  const readRate     = sent > 0 ? Number((read     / sent * 100).toFixed(1)) : 0;

  res.json({
    success: true,
    data: {
      sent,       sentTrend:    pctChange(sent,    prevSent),
      delivered,
      read,
      failed,     failedTrend:  pctChange(failed,  prevFailed),
      deliveryRate,
      readRate,
    },
  });
});

// ── Recent orders ─────────────────────────────────────────────────────────────
export const recentOrders = asyncHandler(async (req, res) => {
  const tenantId = req.tenantId;
  const orders = await prisma.order.findMany({
    where: { tenantId },
    orderBy: { placedAt: 'desc' },
    take: 5,
    include: { customer: { select: { name: true, phone: true, waId: true } } },
  });
  res.json({ success: true, data: orders });
});
