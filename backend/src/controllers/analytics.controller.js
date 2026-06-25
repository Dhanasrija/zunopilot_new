import { prisma } from '../config/prisma.js';
import { asyncHandler } from '../utils/asyncHandler.js';

// Module 11: Core analytics dashboard metrics.
export const overview = asyncHandler(async (req, res) => {
  const tenantId = req.tenantId;
  const since = req.query.since ? new Date(req.query.since) : new Date(Date.now() - 30 * 86400_000);

  const [activeConversations, totalOrders, deliveredOrders, takeoverCount, totalConversations, revenueAgg] = await Promise.all([
    prisma.conversation.count({ where: { tenantId, status: { in: ['OPEN', 'HUMAN_TAKEOVER'] } } }),
    prisma.order.count({ where: { tenantId, placedAt: { gte: since } } }),
    prisma.order.count({ where: { tenantId, status: 'DELIVERED', placedAt: { gte: since } } }),
    prisma.conversation.count({ where: { tenantId, status: 'HUMAN_TAKEOVER', createdAt: { gte: since } } }),
    prisma.conversation.count({ where: { tenantId, createdAt: { gte: since } } }),
    prisma.order.aggregate({
      _sum: { totalAmount: true },
      where: { tenantId, status: { not: 'CANCELLED' }, placedAt: { gte: since } },
    }),
  ]);

  const takeoverRate = totalConversations > 0 ? takeoverCount / totalConversations : 0;

  res.json({
    success: true,
    data: {
      since,
      activeConversations,
      totalOrders,
      deliveredOrders,
      grossRevenue: revenueAgg._sum.totalAmount || 0,
      humanTakeoverRate: Number(takeoverRate.toFixed(3)),
    },
  });
});

export const ordersByDay = asyncHandler(async (req, res) => {
  const tenantId = req.tenantId;
  const since = req.query.since ? new Date(req.query.since) : new Date(Date.now() - 14 * 86400_000);
  const rows = await prisma.$queryRaw`
    SELECT date_trunc('day', "placedAt")::date AS day,
           COUNT(*)::int                       AS orders,
           COALESCE(SUM("totalAmount"), 0)::float AS revenue
      FROM "Order"
     WHERE "tenantId" = ${tenantId} AND "placedAt" >= ${since}
  GROUP BY day
  ORDER BY day ASC;
  `;
  res.json({ success: true, data: rows });
});
