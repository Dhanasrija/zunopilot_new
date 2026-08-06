import { queryString } from '../utils/query.js';
import { tenantIdOf } from '../middleware/auth.js';
import { prisma } from '../config/prisma.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';

// ---- Categories ----
export const listCategories = asyncHandler(async (req, res) => {
  const cats = await prisma.menuCategory.findMany({
    where: { tenantId: tenantIdOf(req) },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    include: { _count: { select: { items: true } } },
  });
  res.json({ success: true, data: cats });
});

export const createCategory = asyncHandler(async (req, res) => {
  const { name, description, sortOrder, isActive } = req.body;
  const cat = await prisma.menuCategory.create({
    data: { tenantId: tenantIdOf(req), name, description, sortOrder, isActive },
  });
  res.status(201).json({ success: true, data: cat });
});

/*
 * Why the update handlers below name every field instead of forwarding `req.body`.
 *
 * They used to pass `req.body` straight to Prisma. The ownership check above it is real —
 * you cannot reach another tenant's row — but the *payload* was never filtered, and these
 * routes validate with express-validator, which checks the fields it is told about and
 * leaves everything else untouched. `tenantId` is a plain scalar column, and Prisma's
 * unchecked update input accepts it, so:
 *
 *     PATCH /api/menu/categories/<my-own-id>  {"name":"x","tenantId":"<someone-else's>"}
 *
 * moved the row into another workspace. Not a read of anyone else's data, but a write
 * across the tenant boundary, which is the same wall.
 *
 * The Zod helpers in `middleware/validate.ts` reassign `req.body` to the parsed value and
 * strip unknown keys, which is why the engine's `data: req.body` calls are safe. These
 * routes are on the older express-validator path, so the whitelist has to be here — the
 * same shape `customer.controller.ts` and `workflow.controller.ts` already use.
 */
export const updateCategory = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const cat = await prisma.menuCategory.findFirst({ where: { id, tenantId: tenantIdOf(req) } });
  if (!cat) throw ApiError.notFound();
  const { name, description, sortOrder, isActive } = req.body;
  const updated = await prisma.menuCategory.update({
    where: { id },
    data: { name, description, sortOrder, isActive },
  });
  res.json({ success: true, data: updated });
});

export const deleteCategory = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const cat = await prisma.menuCategory.findFirst({ where: { id, tenantId: tenantIdOf(req) } });
  if (!cat) throw ApiError.notFound();
  await prisma.menuCategory.delete({ where: { id } });
  res.json({ success: true });
});

interface AddonOptionInput {
  name: string;
  priceDelta?: number | string;
  sortOrder?: number;
}

// ---- Items ----
export const listItems = asyncHandler(async (req, res) => {
  const categoryId = queryString(req.query.categoryId);
  const items = await prisma.menuItem.findMany({
    where: { tenantId: tenantIdOf(req), ...(categoryId ? { categoryId } : {}) },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    include: { category: true, addonGroups: { include: { group: { include: { options: true } } } } },
  });
  res.json({ success: true, data: items });
});

export const createItem = asyncHandler(async (req, res) => {
  const {
    categoryId, name, description, basePrice, imageUrl,
    inStock = true, sortOrder = 0, addonGroupIds = [],
    attributes,           // arbitrary JSON shaped by frontend per category
  } = req.body;
  const category = await prisma.menuCategory.findFirst({ where: { id: categoryId, tenantId: tenantIdOf(req) } });
  if (!category) throw ApiError.badRequest('Invalid category');
  const item = await prisma.menuItem.create({
    data: {
      tenantId: tenantIdOf(req),
      categoryId,
      name,
      description,
      basePrice,
      imageUrl,
      inStock,
      sortOrder,
      attributes: attributes ?? undefined,
      addonGroups: { create: addonGroupIds.map((groupId: string) => ({ groupId })) },
    },
  });
  res.status(201).json({ success: true, data: item });
});

export const updateItem = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const item = await prisma.menuItem.findFirst({ where: { id, tenantId: tenantIdOf(req) } });
  if (!item) throw ApiError.notFound();
  const {
    addonGroupIds, categoryId, name, description, basePrice, imageUrl, inStock, sortOrder,
    attributes,
  } = req.body;

  // A move between categories is allowed, but only to one of this tenant's own. `createItem`
  // has always checked this; the update path took whatever UUID it was handed, so an item
  // could be filed under a category belonging to someone else.
  if (categoryId !== undefined && categoryId !== item.categoryId) {
    const category = await prisma.menuCategory.findFirst({
      where: { id: categoryId, tenantId: tenantIdOf(req) },
    });
    if (!category) throw ApiError.badRequest('Invalid category');
  }

  if (addonGroupIds) {
    await prisma.menuItemAddonGroup.deleteMany({ where: { itemId: id } });
    await prisma.menuItemAddonGroup.createMany({
      data: addonGroupIds.map((groupId: string) => ({ itemId: id, groupId })),
    });
  }
  const updated = await prisma.menuItem.update({
    where: { id },
    data: {
      categoryId, name, description, basePrice, imageUrl, inStock, sortOrder,
      // `undefined` leaves the column alone; `null` would erase it, and express-validator
      // does not distinguish "absent" from "explicitly null" for an optional JSON field.
      attributes: attributes ?? undefined,
    },
  });
  res.json({ success: true, data: updated });
});

export const deleteItem = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const item = await prisma.menuItem.findFirst({ where: { id, tenantId: tenantIdOf(req) } });
  if (!item) throw ApiError.notFound();
  await prisma.menuItem.delete({ where: { id } });
  res.json({ success: true });
});

// ---- Addon groups ----
export const listAddonGroups = asyncHandler(async (req, res) => {
  const groups = await prisma.addonGroup.findMany({
    where: { tenantId: tenantIdOf(req) },
    include: { options: true },
    orderBy: { createdAt: 'desc' },
  });
  res.json({ success: true, data: groups });
});

export const createAddonGroup = asyncHandler(async (req, res) => {
  const { name, minSelect = 0, maxSelect = 1, options = [] } = req.body;
  const group = await prisma.addonGroup.create({
    data: {
      tenantId: tenantIdOf(req),
      name,
      minSelect,
      maxSelect,
      options: { create: options.map((o: AddonOptionInput, i: number) => ({ name: o.name, priceDelta: o.priceDelta || 0, sortOrder: o.sortOrder ?? i })) },
    },
    include: { options: true },
  });
  res.status(201).json({ success: true, data: group });
});

export const updateAddonGroup = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const group = await prisma.addonGroup.findFirst({ where: { id, tenantId: tenantIdOf(req) } });
  if (!group) throw ApiError.notFound();
  const { name, minSelect, maxSelect, options } = req.body;
  if (options) {
    await prisma.addonOption.deleteMany({ where: { groupId: id } });
    await prisma.addonOption.createMany({
      data: options.map((o: AddonOptionInput, i: number) => ({ groupId: id, name: o.name, priceDelta: o.priceDelta || 0, sortOrder: o.sortOrder ?? i })),
    });
  }
  const updated = await prisma.addonGroup.update({
    where: { id },
    data: { name, minSelect, maxSelect },
    include: { options: true },
  });
  res.json({ success: true, data: updated });
});

export const deleteAddonGroup = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const group = await prisma.addonGroup.findFirst({ where: { id, tenantId: tenantIdOf(req) } });
  if (!group) throw ApiError.notFound();
  await prisma.addonGroup.delete({ where: { id } });
  res.json({ success: true });
});
