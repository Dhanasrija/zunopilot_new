import { prisma } from '../src/config/prisma.js';
const main = async () => {
  const t = await prisma.tenant.findUniqueOrThrow({
    where: { id: '00000000-0000-0000-0000-000000000001' },
    select: { businessName: true, category: true, businessCategory: { select: { label: true } } },
  });
  console.log(`${t.businessName}: category now "${t.businessCategory?.label}" | legacy enum still ${t.category}`);
  await prisma.$disconnect();
};
main();
