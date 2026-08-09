import { tenantIdOf } from '../middleware/auth.js';
import { prisma } from '../config/prisma.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';

export const getProfile = asyncHandler(async (req, res) => {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantIdOf(req) } });
  res.json({ success: true, data: tenant });
});

export const updateProfile = asyncHandler(async (req, res) => {
  const {
    businessName, businessCategoryId, contactNumber, address, website, logoUrl,
    maskCustomerNumbers, aiAgentEnabled,
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

  /**
   * The workspace's half of the AI agent switch, on the same route for the same reason.
   *
   * **This writes only `Tenant.aiAgentEnabled`, never the `AI_AGENT` module row.** The module is
   * the operator's ceiling and only the super admin console may touch it; if this route could
   * write it, a workspace we had switched off could switch itself back on and the ceiling would
   * be decoration. So setting this to `true` while the module is off is accepted and stored — it
   * simply has no effect, and the Settings page says so rather than pretending otherwise.
   *
   * Same strict coercion as masking above, for the same `"false"` reason.
   */
  const aiAgent = aiAgentEnabled === undefined
    ? undefined
    : aiAgentEnabled === true || aiAgentEnabled === 'true';

  /*
   * The category, checked against the table before it is written.
   *
   * A uuid that is not a category — or one that is deactivated — would otherwise be stored as a
   * dangling relation the app then reads as "not set". `undefined` leaves it alone; explicit `null`
   * clears it, which is how a workspace says it has not chosen.
   */
  let categoryId: string | null | undefined;
  if (businessCategoryId !== undefined) {
    if (businessCategoryId === null) {
      categoryId = null;
    } else {
      const category = await prisma.businessCategory.findFirst({
        where: { id: businessCategoryId, isActive: true },
        select: { id: true },
      });
      if (!category) throw ApiError.badRequest('That business category does not exist');
      categoryId = category.id;
    }
  }

  const tenant = await prisma.tenant.update({
    where: { id: tenantIdOf(req) },
    data: {
      businessName,
      ...(categoryId === undefined ? {} : { businessCategoryId: categoryId }),
      contactNumber,
      address,
      /*
       * Blank means cleared, stored as `null`.
       *
       * An empty string here would be a value the rest of the app has to keep guarding against — a
       * logo `<img src="">` re-requests the page itself in some browsers, and a website link to `''`
       * points at nowhere while looking set.
       */
      ...(website === undefined ? {} : { website: website || null }),
      ...(logoUrl === undefined ? {} : { logoUrl: logoUrl || null }),
      ...(masking === undefined ? {} : { maskCustomerNumbers: masking }),
      ...(aiAgent === undefined ? {} : { aiAgentEnabled: aiAgent }),
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
