import { prisma } from '../config/prisma.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';

// ---- Categories ----
export const listCategories = asyncHandler(async (req, res) => {
  const cats = await prisma.menuCategory.findMany({
    where: { tenantId: req.tenantId },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    include: { _count: { select: { items: true } } },
  });
  res.json({ success: true, data: cats });
});

export const createCategory = asyncHandler(async (req, res) => {
  const { name, description, sortOrder, isActive } = req.body;
  const cat = await prisma.menuCategory.create({
    data: { tenantId: req.tenantId, name, description, sortOrder, isActive },
  });
  res.status(201).json({ success: true, data: cat });
});

export const updateCategory = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const cat = await prisma.menuCategory.findFirst({ where: { id, tenantId: req.tenantId } });
  if (!cat) throw ApiError.notFound();
  const updated = await prisma.menuCategory.update({ where: { id }, data: req.body });
  res.json({ success: true, data: updated });
});

export const deleteCategory = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const cat = await prisma.menuCategory.findFirst({ where: { id, tenantId: req.tenantId } });
  if (!cat) throw ApiError.notFound();
  await prisma.menuCategory.delete({ where: { id } });
  res.json({ success: true });
});

// ---- Items ----
export const listItems = asyncHandler(async (req, res) => {
  const { categoryId } = req.query;
  const items = await prisma.menuItem.findMany({
    where: { tenantId: req.tenantId, ...(categoryId && { categoryId }) },
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
  const category = await prisma.menuCategory.findFirst({ where: { id: categoryId, tenantId: req.tenantId } });
  if (!category) throw ApiError.badRequest('Invalid category');
  const item = await prisma.menuItem.create({
    data: {
      tenantId: req.tenantId,
      categoryId,
      name,
      description,
      basePrice,
      imageUrl,
      inStock,
      sortOrder,
      attributes: attributes ?? undefined,
      addonGroups: { create: addonGroupIds.map((groupId) => ({ groupId })) },
    },
  });
  res.status(201).json({ success: true, data: item });
});

export const updateItem = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const item = await prisma.menuItem.findFirst({ where: { id, tenantId: req.tenantId } });
  if (!item) throw ApiError.notFound();
  const { addonGroupIds, ...rest } = req.body;
  if (addonGroupIds) {
    await prisma.menuItemAddonGroup.deleteMany({ where: { itemId: id } });
    await prisma.menuItemAddonGroup.createMany({
      data: addonGroupIds.map((groupId) => ({ itemId: id, groupId })),
    });
  }
  const updated = await prisma.menuItem.update({ where: { id }, data: rest });
  res.json({ success: true, data: updated });
});

export const deleteItem = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const item = await prisma.menuItem.findFirst({ where: { id, tenantId: req.tenantId } });
  if (!item) throw ApiError.notFound();
  await prisma.menuItem.delete({ where: { id } });
  res.json({ success: true });
});

// ---- Addon groups ----
export const listAddonGroups = asyncHandler(async (req, res) => {
  const groups = await prisma.addonGroup.findMany({
    where: { tenantId: req.tenantId },
    include: { options: true },
    orderBy: { createdAt: 'desc' },
  });
  res.json({ success: true, data: groups });
});

export const createAddonGroup = asyncHandler(async (req, res) => {
  const { name, minSelect = 0, maxSelect = 1, options = [] } = req.body;
  const group = await prisma.addonGroup.create({
    data: {
      tenantId: req.tenantId,
      name,
      minSelect,
      maxSelect,
      options: { create: options.map((o, i) => ({ name: o.name, priceDelta: o.priceDelta || 0, sortOrder: o.sortOrder ?? i })) },
    },
    include: { options: true },
  });
  res.status(201).json({ success: true, data: group });
});

export const updateAddonGroup = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const group = await prisma.addonGroup.findFirst({ where: { id, tenantId: req.tenantId } });
  if (!group) throw ApiError.notFound();
  const { name, minSelect, maxSelect, options } = req.body;
  if (options) {
    await prisma.addonOption.deleteMany({ where: { groupId: id } });
    await prisma.addonOption.createMany({
      data: options.map((o, i) => ({ groupId: id, name: o.name, priceDelta: o.priceDelta || 0, sortOrder: o.sortOrder ?? i })),
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
  const group = await prisma.addonGroup.findFirst({ where: { id, tenantId: req.tenantId } });
  if (!group) throw ApiError.notFound();
  await prisma.addonGroup.delete({ where: { id } });
  res.json({ success: true });
});
