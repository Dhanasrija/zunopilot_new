import { prisma } from '../config/prisma.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { dispatchOrderTemplate } from '../services/template.service.js';

const ALLOWED_TRANSITIONS = {
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

  const customer = await prisma.customer.findFirst({ where: { id: customerId, tenantId: req.tenantId } });
  if (!customer) throw ApiError.badRequest('Customer not found');

  if (!Array.isArray(items) || !items.length) throw ApiError.badRequest('At least one item required');

  // Resolve menu items and compute totals
  const menuItems = await prisma.menuItem.findMany({
    where: { id: { in: items.map((i) => i.itemId) }, tenantId: req.tenantId, inStock: true },
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
      tenantId: req.tenantId,
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

export const listOrders = asyncHandler(async (req, res) => {
  const { status, since } = req.query;
  const where = { tenantId: req.tenantId };
  if (status) where.status = status;
  if (since) where.placedAt = { gte: new Date(since) };

  const orders = await prisma.order.findMany({
    where,
    include: {
      customer: { select: { id: true, name: true, waId: true, phone: true } },
      items: { include: { addons: true } },
    },
    orderBy: { placedAt: 'desc' },
    take: 200,
  });
  res.json({ success: true, data: orders });
});

export const getOrder = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const order = await prisma.order.findFirst({
    where: { id, tenantId: req.tenantId },
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
  const order = await prisma.order.findFirst({ where: { id, tenantId: req.tenantId } });
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
