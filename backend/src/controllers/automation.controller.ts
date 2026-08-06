import { tenantIdOf } from '../middleware/auth.js';
import { prisma } from '../config/prisma.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';

export const listKeywordRules = asyncHandler(async (req, res) => {
  const rules = await prisma.keywordRule.findMany({
    where: { tenantId: tenantIdOf(req) },
    orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
  });
  res.json({ success: true, data: rules });
});

export const createKeywordRule = asyncHandler(async (req, res) => {
  const { keywords, response, priority = 0, isActive = true } = req.body;
  const rule = await prisma.keywordRule.create({
    data: {
      tenantId: tenantIdOf(req),
      keywords: keywords.map((k: string) => String(k).toLowerCase()),
      response,
      priority,
      isActive,
    },
  });
  res.status(201).json({ success: true, data: rule });
});

export const updateKeywordRule = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const rule = await prisma.keywordRule.findFirst({ where: { id, tenantId: tenantIdOf(req) } });
  if (!rule) throw ApiError.notFound('Rule not found');
  const { keywords, response, priority, isActive } = req.body;
  const updated = await prisma.keywordRule.update({
    where: { id },
    data: {
      ...(keywords !== undefined && { keywords: keywords.map((k: string) => String(k).toLowerCase()) }),
      ...(response !== undefined && { response }),
      ...(priority !== undefined && { priority }),
      ...(isActive !== undefined && { isActive }),
    },
  });
  res.json({ success: true, data: updated });
});

export const deleteKeywordRule = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const rule = await prisma.keywordRule.findFirst({ where: { id, tenantId: tenantIdOf(req) } });
  if (!rule) throw ApiError.notFound('Rule not found');
  await prisma.keywordRule.delete({ where: { id } });
  res.json({ success: true });
});

export const getFallback = asyncHandler(async (req, res) => {
  const fb = await prisma.fallbackRule.findUnique({ where: { tenantId: tenantIdOf(req) } });
  res.json({ success: true, data: fb });
});

export const updateFallback = asyncHandler(async (req, res) => {
  const { response } = req.body;
  const fb = await prisma.fallbackRule.upsert({
    where: { tenantId: tenantIdOf(req) },
    update: { response },
    create: { tenantId: tenantIdOf(req), response },
  });
  res.json({ success: true, data: fb });
});
