import { PrismaClient, BusinessCategory, UserRole, TemplateTrigger } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const main = async () => {
  const passwordHash = await bcrypt.hash('Password123!', 10);

  const tenant = await prisma.tenant.upsert({
    where: { id: '00000000-0000-0000-0000-000000000001' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000001',
      businessName: 'Demo Biryani House',
      category: BusinessCategory.RESTAURANT,
      contactNumber: '+919999999999',
      address: '123 Main Street, Hyderabad',
      website: 'https://demobiryani.example',
      users: {
        create: {
          email: 'owner@demo.com',
          passwordHash,
          fullName: 'Demo Owner',
          role: UserRole.OWNER,
          emailVerified: true,
        },
      },
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

  console.log('Seed complete. Login: owner@demo.com / Password123!');
};

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
