import { tenantIdOf } from '../middleware/auth.js';
import { prisma } from '../config/prisma.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const getProfile = asyncHandler(async (req, res) => {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantIdOf(req) } });
  res.json({ success: true, data: tenant });
});

export const updateProfile = asyncHandler(async (req, res) => {
  const {
    businessName, category, contactNumber, address, website, logoUrl, maskCustomerNumbers,
  } = req.body;

  /**
   * Number masking, on this existing route rather than a new one.
   *
   * `PATCH /tenant/me` is already behind `settings:write`, which is **owner-only in the
   * default roles** — Agent and Manager hold `settings:read` alone. So "only the owner can
   * turn this on or off" needs no new guard, and a workspace that deliberately grants
   * `settings:write` to a custom role has made that choice knowingly.
   *
   * Coerced to a strict boolean rather than passed through: every other field here is a
   * string, so a client sending `"false"` would otherwise be truthy and switch masking *on*
   * while appearing to turn it off.
   */
  const masking = maskCustomerNumbers === undefined
    ? undefined
    : maskCustomerNumbers === true || maskCustomerNumbers === 'true';

  const tenant = await prisma.tenant.update({
    where: { id: tenantIdOf(req) },
    data: {
      businessName,
      category,
      contactNumber,
      address,
      website,
      logoUrl,
      ...(masking === undefined ? {} : { maskCustomerNumbers: masking }),
    },
  });
  res.json({ success: true, data: tenant });
});

export const listStaff = asyncHandler(async (req, res) => {
  const users = await prisma.user.findMany({
    where: { tenantId: tenantIdOf(req) },
    select: { id: true, email: true, fullName: true, role: true, isActive: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  });
  res.json({ success: true, data: users });
});
