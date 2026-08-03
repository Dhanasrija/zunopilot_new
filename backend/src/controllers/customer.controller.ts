import { queryString } from '../utils/query.js';
import { tenantIdOf } from '../middleware/auth.js';
import type { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';

// `waId` is the WhatsApp identity: the phone number in international format with
// no '+', spaces, or leading zeros. Staff will type it any number of ways, so
// normalize rather than rejecting.
const normalizeWaId = (raw: unknown): string => String(raw || '').replace(/\D/g, '').replace(/^0+/, '');

// Module 10: CRM.
export const createCustomer = asyncHandler(async (req, res) => {
  const { waId, name, phone } = req.body;

  const normalized = normalizeWaId(waId);
  if (normalized.length < 8) {
    throw ApiError.badRequest('Enter the full WhatsApp number including country code, e.g. 917702000350');
  }

  const existing = await prisma.customer.findFirst({
    where: { tenantId: tenantIdOf(req), waId: normalized },
  });
  if (existing) throw ApiError.conflict('A customer with this WhatsApp number already exists');

  try {
    const customer = await prisma.customer.create({
      data: {
        tenantId: tenantIdOf(req),
        waId: normalized,
        name: name?.trim() || null,
        phone: phone?.trim() || normalized,
        // lastSeenAt stays null on purpose: this customer has never messaged us,
        // so there is no 24-hour service window. Faking a timestamp here would
        // make the Inbox look sendable when a free-form send would in fact fail.
      },
    });
    res.status(201).json({ success: true, data: customer });
  } catch (err: any) {
    // Two concurrent creates can both pass the check above; the unique index is
    // the real guard.
    if (err.code === 'P2002') {
      throw ApiError.conflict('A customer with this WhatsApp number already exists');
    }
    throw err;
  }
});

export const updateCustomer = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { name, phone } = req.body;

  // Scoped read before the write. Never `update({ where: { id } })` on a
  // tenant-owned row — that is how another tenant edits your data by guessing a
  // UUID.
  const existing = await prisma.customer.findFirst({ where: { id, tenantId: tenantIdOf(req) } });
  if (!existing) throw ApiError.notFound('Customer not found');

  // Deliberately not editable:
  //  - waId: it is the identity the webhook upserts against. Changing it would
  //    orphan this record from its conversation and could collide with another.
  //  - lifetimeSpend: derived by incrementing on DELIVERED orders. Hand-editing
  //    it would silently corrupt revenue analytics.
  const data: Prisma.CustomerUpdateInput = {};
  if (name !== undefined) data.name = name?.trim() || null;
  if (phone !== undefined) data.phone = phone?.trim() || null;
  if (!Object.keys(data).length) throw ApiError.badRequest('Nothing to update');

  const customer = await prisma.customer.update({ where: { id }, data });
  res.json({ success: true, data: customer });
});

export const listCustomers = asyncHandler(async (req, res) => {
  const search = queryString(req.query.search);
  const where: Prisma.CustomerWhereInput = { tenantId: tenantIdOf(req) };
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
    where: { id, tenantId: tenantIdOf(req) },
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
  const customer = await prisma.customer.findFirst({ where: { id, tenantId: tenantIdOf(req) } });
  if (!customer) throw ApiError.notFound();
  const messages = await prisma.message.findMany({
    where: { customerId: id },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  res.json({ success: true, data: messages });
});
