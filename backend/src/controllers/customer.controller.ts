import { queryEnum, queryInt, queryOffset, queryString } from '../utils/query.js';
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

/**
 * Clean a tag list before it is stored.
 *
 * **Lowercased, and that is the load-bearing part.** A `CUSTOMER_TAG` routing rule
 * compares strings, so `VIP` saved next to `vip` means a rule matching one silently stops
 * firing for the other — a failure with no error and no log line. Trimmed and de-duplicated
 * for the same reason, and capped so a client cannot store an unbounded array on a row
 * that is read on every inbound message.
 */
const MAX_TAGS = 20;
const MAX_TAG_LENGTH = 30;

const normaliseTags = (input: unknown): string[] => {
  if (!Array.isArray(input)) throw ApiError.badRequest('Tags must be a list');
  const cleaned = input
    .filter((tag): tag is string => typeof tag === 'string')
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean);

  for (const tag of cleaned) {
    if (tag.length > MAX_TAG_LENGTH) {
      throw ApiError.badRequest(`"${tag}" is too long — tags are ${MAX_TAG_LENGTH} characters or fewer`);
    }
  }

  const unique = [...new Set(cleaned)];
  if (unique.length > MAX_TAGS) {
    throw ApiError.badRequest(`A customer can have at most ${MAX_TAGS} tags`);
  }
  return unique;
};

export const updateCustomer = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { name, phone, tags } = req.body;

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
  // Replaces the whole set rather than merging. The editor sends the tags it wants the
  // customer to end up with, so removing one is just sending a shorter list — a merge
  // would make removal impossible without a second endpoint.
  if (tags !== undefined) data.tags = { set: normaliseTags(tags) };
  if (!Object.keys(data).length) throw ApiError.badRequest('Nothing to update');

  const customer = await prisma.customer.update({ where: { id }, data });
  res.json({ success: true, data: customer });
});

export const listCustomers = asyncHandler(async (req, res) => {
  const search = queryString(req.query.search);
  const listId = queryString(req.query.listId);
  const tag = queryString(req.query.tag);
  const status = queryEnum(req.query.status, ['subscribed', 'pending', 'unsubscribed'] as const);
  const where: Prisma.CustomerWhereInput = { tenantId: tenantIdOf(req) };
  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { waId: { contains: search } },
      { phone: { contains: search } },
      // Tags too, because the field says "Search name, phone, tag". Lowercased to match
      // how they are stored — `has` is exact, so an uppercased query would never hit.
      { tags: { has: search.trim().toLowerCase() } },
    ];
  }
  // Narrow to one curated list. `tenantId` is already in the where, so a list id from
  // another workspace matches nothing rather than leaking its members — the join cannot
  // reach a customer this workspace does not own.
  if (listId) where.listMemberships = { some: { listId } };
  // Exact containment, served by the GIN index on the column.
  if (tag) where.tags = { has: tag.trim().toLowerCase() };
  // Consent state, which is derived rather than stored — so it is expressed here as the
  // conditions the row must satisfy, matching how `audienceWhere` reads it.
  if (status === 'unsubscribed') where.optedOutAt = { not: null };
  if (status === 'subscribed') { where.marketingOptIn = true; where.optedOutAt = null; }
  if (status === 'pending') { where.marketingOptIn = false; where.optedOutAt = null; }
  // Was a bare `take: 200` with no offset and no total, so a workspace with more than
  // 200 customers simply never saw the rest — and nothing on the page said so. Same
  // `data` + `meta` shape the operator console uses, which is what lets a page-number
  // control state how many pages there really are.
  const take = queryInt(req.query.take, 50);
  const skip = queryOffset(req.query.skip);

  const [customers, total] = await Promise.all([
    prisma.customer.findMany({
      where,
      orderBy: { lastSeenAt: 'desc' },
      take,
      skip,
      include: {
        _count: { select: { orders: true, messages: true } },
        // The newest conversation only, for the "last message" column. `lastMessageAt`
        // lives on Conversation rather than Customer, so it has to be reached for — one
        // row per customer, not the whole thread.
        conversations: {
          orderBy: { lastMessageAt: 'desc' },
          take: 1,
          select: { lastMessageAt: true },
        },
      },
    }),
    prisma.customer.count({ where }),
  ]);

  res.json({
    success: true,
    // Flattened, so the client reads one field instead of reaching into a one-element
    // array and rediscovering why it is an array.
    data: customers.map(({ conversations, ...customer }) => ({
      ...customer,
      lastMessageAt: conversations[0]?.lastMessageAt ?? null,
    })),
    meta: { total, take, skip },
  });
});

/**
 * Every tag in use in the workspace, for the filter menu.
 *
 * Distinct values of an array column, which Prisma cannot express — hence the raw query.
 * `tenantId` is bound as a parameter rather than interpolated: it comes from the token
 * here, but a raw string concatenation in a tenant-scoped query is a habit worth not
 * having.
 */
export const listCustomerTags = asyncHandler(async (req, res) => {
  const rows = await prisma.$queryRaw<Array<{ tag: string; count: bigint }>>`
    SELECT UNNEST("tags") AS tag, COUNT(*) AS count
    FROM "Customer"
    WHERE "tenantId" = ${tenantIdOf(req)}
    GROUP BY tag
    ORDER BY count DESC, tag ASC
  `;
  res.json({
    success: true,
    // `COUNT(*)` comes back as a BigInt, which `JSON.stringify` throws on.
    data: rows.map((row) => ({ tag: row.tag, count: Number(row.count) })),
  });
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
