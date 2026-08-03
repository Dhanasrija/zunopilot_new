import { OrderStatus } from '@prisma/client';
import { queryEnum, queryInt, queryOffset, queryString } from '../utils/query.js';
import { tenantIdOf } from '../middleware/auth.js';
import type { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { dispatchOrderTemplate } from '../services/template.service.js';

const ALLOWED_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  NEW: ['ACCEPTED', 'CANCELLED'],
  ACCEPTED: ['PREPARING', 'CANCELLED'],
  PREPARING: ['READY', 'CANCELLED'],
  READY: ['OUT_FOR_DELIVERY', 'CANCELLED'],
  OUT_FOR_DELIVERY: ['DELIVERED', 'CANCELLED'],
  DELIVERED: [],
  CANCELLED: [],
};

export const createOrder = asyncHandler(async (req, res) => {
  const { customerId, items, deliveryAddress, notes } = req.body;

  const customer = await prisma.customer.findFirst({ where: { id: customerId, tenantId: tenantIdOf(req) } });
  if (!customer) throw ApiError.badRequest('Customer not found');

  if (!Array.isArray(items) || !items.length) throw ApiError.badRequest('At least one item required');

  // Resolve menu items and compute totals
  const menuItems = await prisma.menuItem.findMany({
    where: { id: { in: items.map((i) => i.itemId) }, tenantId: tenantIdOf(req), inStock: true },
  });

  const menuMap = Object.fromEntries(menuItems.map((m) => [m.id, m]));
  let subtotal = 0;
  const orderItemsData = items.map((i) => {
    const mi = menuMap[i.itemId];
    if (!mi) throw ApiError.badRequest(`Item ${i.itemId} not found or out of stock`);
    const unitPrice = Number(mi.basePrice);
    const lineTotal = unitPrice * i.quantity;
    subtotal += lineTotal;
    return { itemId: mi.id, itemName: mi.name, quantity: i.quantity, unitPrice, lineTotal };
  });

  const order = await prisma.order.create({
    data: {
      tenantId: tenantIdOf(req),
      customerId: customer.id,
      customerName: customer.name || 'Customer',
      deliveryAddress: deliveryAddress || '',
      contactPhone: customer.phone || customer.waId,
      subtotal,
      totalAmount: subtotal,
      notes: notes || null,
      items: { create: orderItemsData },
    },
    include: { items: true, customer: true },
  });

  // Fire-and-forget ORDER_CREATED template to the customer
  dispatchOrderTemplate(order.id, 'NEW').catch(() => {});

  res.status(201).json({ success: true, data: order });
});

/**
 * Everything that narrows the order list, in one place.
 *
 * All of this used to happen **in the browser**, over a hard `take: 200`. That was
 * correct while a workspace had fewer than 200 orders and quietly wrong above it: the
 * oldest orders vanished with no indication, the "of N orders" label counted only what
 * had been fetched, and the CSV export wrote the truncated set. Filtering has to happen
 * where the rows are.
 *
 * A date *range* rather than only `since`, because the page offers Today / Yesterday /
 * Last 7 days and "yesterday" needs an upper bound as well as a lower one.
 */
const orderListWhere = (req: Parameters<typeof tenantIdOf>[0]): Prisma.OrderWhereInput => {
  const status = queryEnum(req.query.status, Object.values(OrderStatus));
  const since = queryString(req.query.since);
  const until = queryString(req.query.until);
  const search = queryString(req.query.search)?.trim();

  const where: Prisma.OrderWhereInput = { tenantId: tenantIdOf(req) };
  if (status) where.status = status;
  if (since || until) {
    where.placedAt = {
      ...(since ? { gte: new Date(since) } : {}),
      ...(until ? { lt: new Date(until) } : {}),
    };
  }
  if (search) {
    where.OR = [
      { customerName: { contains: search, mode: 'insensitive' } },
      { contactPhone: { contains: search } },
      // `orderNumber` is an Int, so it only participates when the query is numeric —
      // `equals` on a non-number throws in the driver rather than simply not matching.
      //
      // **Exact, where the client-side version matched substrings.** That was
      // `String(o.orderNumber).includes(q)`, so "165" also returned #1654 and #2165.
      // Reproducing it in SQL needs a cast to text on every row, which cannot use the
      // index — and substring-matching an identifier is mostly noise anyway. A
      // deliberate change, not an oversight.
      ...(/^\d+$/.test(search) ? [{ orderNumber: Number.parseInt(search, 10) }] : []),
    ];
  }
  return where;
};

export const listOrders = asyncHandler(async (req, res) => {
  const where = orderListWhere(req);
  // Same shape the operator console has used since it was built: `data` plus a `meta`
  // carrying the real total, so a page-number control can be honest about how many
  // pages exist. See `listTenants` in super-admin.controller.ts.
  const take = queryInt(req.query.take, 50);
  const skip = queryOffset(req.query.skip);

  const [orders, total] = await Promise.all([
    prisma.order.findMany({
      where,
      include: {
        customer: { select: { id: true, name: true, waId: true, phone: true } },
        items: { include: { addons: true } },
      },
      orderBy: { placedAt: 'desc' },
      take,
      skip,
    }),
    prisma.order.count({ where }),
  ]);
  res.json({ success: true, data: orders, meta: { total, take, skip } });
});

/**
 * The four numbers on the stats cards, over **every** order in the date range.
 *
 * Its own endpoint rather than part of the list response, for one reason that matters:
 * the cards count each status side by side, so they cannot be derived from a
 * status-filtered query — and they must not be derived from the current *page* either,
 * which is exactly the bug this replaces. Revenue in particular was the sum of at most
 * 200 rows and simply understated the total.
 *
 * Deliberately ignores the `status` and `search` filters and honours only the dates,
 * matching what the page's own range label claims the numbers cover.
 */
export const getOrderSummary = asyncHandler(async (req, res) => {
  const since = queryString(req.query.since);
  const until = queryString(req.query.until);

  const where: Prisma.OrderWhereInput = { tenantId: tenantIdOf(req) };
  if (since || until) {
    where.placedAt = {
      ...(since ? { gte: new Date(since) } : {}),
      ...(until ? { lt: new Date(until) } : {}),
    };
  }

  const [byStatus, totals] = await Promise.all([
    prisma.order.groupBy({ by: ['status'], where, _count: { _all: true } }),
    prisma.order.aggregate({ where, _sum: { totalAmount: true }, _count: { _all: true } }),
  ]);

  const count = (status: OrderStatus) =>
    byStatus.find((row) => row.status === status)?._count._all ?? 0;

  res.json({
    success: true,
    data: {
      newOrders: count('NEW'),
      // Matches what the card has always shown: accepted and preparing are one
      // "in the kitchen" number.
      preparing: count('ACCEPTED') + count('PREPARING'),
      delivered: count('DELIVERED'),
      // A string, because `Decimal` does not survive JSON as a number without losing
      // precision. The page already reads amounts through `Number(...)`.
      revenue: (totals._sum.totalAmount ?? 0).toString(),
      total: totals._count._all,
    },
  });
});

export const getOrder = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const order = await prisma.order.findFirst({
    where: { id, tenantId: tenantIdOf(req) },
    include: {
      customer: true,
      items: { include: { addons: true } },
    },
  });
  if (!order) throw ApiError.notFound();
  res.json({ success: true, data: order });
});

export const updateOrderStatus = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  const order = await prisma.order.findFirst({ where: { id, tenantId: tenantIdOf(req) } });
  if (!order) throw ApiError.notFound();
  const allowed = ALLOWED_TRANSITIONS[order.status] || [];
  if (!allowed.includes(status)) {
    throw ApiError.badRequest(`Cannot move from ${order.status} to ${status}`);
  }

  const updated = await prisma.order.update({ where: { id }, data: { status } });

  // Update customer lifetime spend on DELIVERED.
  if (status === 'DELIVERED') {
    await prisma.customer.update({
      where: { id: order.customerId },
      data: { lifetimeSpend: { increment: order.totalAmount } },
    });
  }

  // Fire-and-forget template dispatch.
  dispatchOrderTemplate(updated.id, status).catch(() => {});

  res.json({ success: true, data: updated });
});
