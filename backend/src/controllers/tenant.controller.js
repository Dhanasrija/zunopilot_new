import { prisma } from '../config/prisma.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const getProfile = asyncHandler(async (req, res) => {
  const tenant = await prisma.tenant.findUnique({ where: { id: req.tenantId } });
  res.json({ success: true, data: tenant });
});

export const updateProfile = asyncHandler(async (req, res) => {
  const { businessName, category, contactNumber, address, website, logoUrl } = req.body;
  const tenant = await prisma.tenant.update({
    where: { id: req.tenantId },
    data: { businessName, category, contactNumber, address, website, logoUrl },
  });
  res.json({ success: true, data: tenant });
});

export const listStaff = asyncHandler(async (req, res) => {
  const users = await prisma.user.findMany({
    where: { tenantId: req.tenantId },
    select: { id: true, email: true, fullName: true, role: true, isActive: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  });
  res.json({ success: true, data: users });
});
