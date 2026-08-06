// Seeds a single customer onto the existing demo tenant.
// Run with: npx tsx prisma/seed-customer.js
//
// `tsx` rather than plain `node`, because the guard it imports is TypeScript. Worth the
// change: this is the one seed script not wired to an npm script, which makes it the one most
// likely to be run by hand in whatever shell happens to be open.

import { PrismaClient } from '@prisma/client';
import { assertSeedable } from './guard.js';

const prisma = new PrismaClient();

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
// WhatsApp wa_id is E.164 without the leading "+". For an Indian number this
// means the country code (91) followed by the 10-digit local number.
const WA_ID = '16315551181';
const PHONE = '6315551181';

const main = async () => {
  assertSeedable({ script: 'seed-customer' });

  const tenant = await prisma.tenant.findUnique({ where: { id: TENANT_ID } });
  if (!tenant) {
    throw new Error(`Tenant ${TENANT_ID} not found — run npm run prisma:seed first.`);
  }

  const customer = await prisma.customer.upsert({
    where: { tenantId_waId: { tenantId: TENANT_ID, waId: WA_ID } },
    update: { name: 'Naveen', phone: PHONE, lastSeenAt: new Date() },
    create: {
      tenantId: TENANT_ID,
      waId: WA_ID,
      name: 'Test Account',
      phone: PHONE,
      lastSeenAt: new Date(),
    },
  });

  console.log('Customer seeded:', { id: customer.id, waId: customer.waId, phone: customer.phone });
};

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
