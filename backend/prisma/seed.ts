import { PrismaClient, UserRole, TemplateTrigger } from '@prisma/client';
import { assertSeedable } from './guard.js';

// The default demo workspace — the one `npm run prisma:seed` creates and the
// READMEs point a new developer at.
//
// Idempotent on the tenant, which is upserted by a fixed id.

const prisma = new PrismaClient();

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
/** Owner's sign-in number. Reserved US 555 range — see the `phone` comment below. */
const OWNER_PHONE = '15550000001';

const main = async () => {
  assertSeedable({ script: 'seed' });
  const existing = await prisma.tenant.findUnique({ where: { id: TENANT_ID } });

  const tenant = await prisma.tenant.upsert({
    where: { id: TENANT_ID },
    // A workspace seeded before categories became rows has neither a category
    // nor an onboarding stamp, and `update: {}` would leave it that way forever.
    // Converge those two, and nothing else — anything else here is the
    // developer's own data.
    update: {
      businessCategory: { connect: { key: 'RESTAURANT' } },
      // Stamped only if it was never set. Re-running a seed should not rewrite
      // when the workspace was set up.
      ...(existing?.onboardingCompletedAt ? {} : { onboardingCompletedAt: new Date() }),
    },
    create: {
      id: TENANT_ID,
      businessName: 'Demo Biryani House',
      // A row, not an enum value. This used to read `BusinessCategory.RESTAURANT`
      // from `@prisma/client`, which stopped being an enum when categories moved
      // into a table — so it silently resolved to `undefined` and the workspace
      // was seeded with no category at all.
      businessCategory: { connect: { key: 'RESTAURANT' } },
      // Without this the demo workspace is treated as a half-finished signup and
      // every sign-in lands on the onboarding form instead of the dashboard.
      onboardingCompletedAt: new Date(),
      contactNumber: '+919999999999',
      address: '123 Main Street, Hyderabad',
      website: 'https://demobiryani.example',
      // The owner is created below rather than nested here — see the comment there.
      fallback: {
        create: { response: "Sorry, I didn't catch that. Type 'Menu' to order, or 'Agent' to speak to our team." },
      },
      keywords: {
        create: [
          { keywords: ['timings', 'open', 'hours'], response: 'We are open daily from 11:00 AM to 11:00 PM.' },
          { keywords: ['location', 'address', 'where'], response: 'Find us at 123 Main Street, Hyderabad.' },
        ],
      },
      templates: {
        create: [
          { name: 'Order Accepted', trigger: TemplateTrigger.ORDER_ACCEPTED, metaTemplate: 'order_accepted', body: 'Your order has been accepted by the kitchen!' },
          { name: 'Out for Delivery', trigger: TemplateTrigger.ORDER_OUT_FOR_DELIVERY, metaTemplate: 'order_out_for_delivery', body: 'Good news! Your order is on the way.' },
        ],
      },
    },
  });

  // The owner, upserted separately rather than nested in the tenant.
  //
  // A nested `create` only runs when the tenant is new, so a demo workspace that
  // already exists would never pick up the phone — which is now the only way to
  // sign in. This is the whole reason the old seed's login stopped working.
  await prisma.user.upsert({
    where: { email: 'owner@demo.com' },
    update: {
      tenantId: tenant.id,
      phone: OWNER_PHONE,
      role: UserRole.OWNER,
      isActive: true,
      // Clear the hash an older seed left behind. No customer login path reads
      // it, so it is a credential that cannot be used but can still be stolen.
      passwordHash: null,
    },
    create: {
      tenantId: tenant.id,
      // The login identifier. Drawn from the reserved US 555 range, which is set
      // aside for fiction and routes to no handset — so a seed that runs on every
      // reset can never send a real person a code, and can never collide with a
      // real customer's number on the global unique index.
      phone: OWNER_PHONE,
      email: 'owner@demo.com',
      // No passwordHash: customers sign in with a phone and a one-time code, and
      // no login path accepts a password. Seeding one would only suggest a
      // credential that does not work.
      fullName: 'Demo Owner',
      role: UserRole.OWNER,
      emailVerified: true,
    },
  });

  // Menu only when there is none. `MenuCategory` has no unique key to upsert on,
  // so an unconditional create duplicates the whole menu on every re-run — and
  // deleting to rebuild would throw away whatever the developer added.
  const menuSeeded = await prisma.menuCategory.count({ where: { tenantId: tenant.id } });
  if (menuSeeded === 0) {
    const starters = await prisma.menuCategory.create({
      data: { tenantId: tenant.id, name: 'Starters', sortOrder: 1 },
    });
    const mains = await prisma.menuCategory.create({
      data: { tenantId: tenant.id, name: 'Mains', sortOrder: 2 },
    });

    await prisma.menuItem.createMany({
      data: [
        { tenantId: tenant.id, categoryId: starters.id, name: 'Paneer Tikka', basePrice: 220, description: 'Grilled cottage cheese.' },
        { tenantId: tenant.id, categoryId: mains.id, name: 'Chicken Biryani', basePrice: 320, description: 'Hyderabadi dum.' },
        { tenantId: tenant.id, categoryId: mains.id, name: 'Veg Biryani', basePrice: 260 },
      ],
    });
  }

  await prisma.customer.upsert({
    where: { tenantId_waId: { tenantId: tenant.id, waId: '917702000350' } },
    update: { name: 'Naveen', phone: '7702000350', lastSeenAt: new Date() },
    create: {
      tenantId: tenant.id,
      waId: '917702000350',
      name: 'Naveen',
      phone: '7702000350',
      lastSeenAt: new Date(),
    },
  });

  console.log(`
Seed complete.
  tenant   ${tenant.id}
  sign in  phone ${OWNER_PHONE} — needs OTP_ECHO=true, which returns the code:
           curl -s -XPOST localhost:4000/api/auth/otp \\
             -H 'Content-Type: application/json' -d '{"phone":"${OWNER_PHONE}"}'
`);
};

main().catch((e: Error) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
