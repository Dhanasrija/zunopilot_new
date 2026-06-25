import { prisma } from '../config/prisma.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';

// Module 10: CRM.
export const listCustomers = asyncHandler(async (req, res) => {
  const { search } = req.query;
  const where = { tenantId: req.tenantId };
  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { waId: { contains: search } },
      { phone: { contains: search } },
    ];
  }
  const customers = await prisma.customer.findMany({
    where,
    orderBy: { lastSeenAt: 'desc' },
    take: 200,
    include: { _count: { select: { orders: true, messages: true } } },
  });
  res.json({ success: true, data: customers });
});

export const getCustomer = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const customer = await prisma.customer.findFirst({
    where: { id, tenantId: req.tenantId },
    include: {
      orders: { orderBy: { placedAt: 'desc' }, take: 50, include: { items: true } },
      conversations: { orderBy: { lastMessageAt: 'desc' }, take: 10 },
    },
  });
  if (!customer) throw ApiError.notFound();
  res.json({ success: true, data: customer });
});

export const getCustomerMessages = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const customer = await prisma.customer.findFirst({ where: { id, tenantId: req.tenantId } });
  if (!customer) throw ApiError.notFound();
  const messages = await prisma.message.findMany({
    where: { customerId: id },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  res.json({ success: true, data: messages });
});
