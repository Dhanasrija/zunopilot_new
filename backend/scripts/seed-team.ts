#!/usr/bin/env tsx
import { prisma } from '../src/config/prisma.js';

// Add a manager and an agent to a tenant, so the shared inbox and the role
// rules can be exercised with more than one person in the workspace.
//   npx tsx scripts/seed-team.ts <tenantId>
//
// Both get a phone, because the point of these two is to *sign in* as somebody
// other than the owner. Numbers come from the reserved US 555 range, which is
// set aside for fiction and routes to no handset — so re-running this can never
// send a real person a code, and can never collide with a real customer's
// number on the global unique index. No password: no login path accepts one.

const main = async () => {
  const tenantId = process.argv[2];
  if (!tenantId) { console.error('Usage: npx tsx scripts/seed-team.ts <tenantId>'); process.exit(1); }

  for (const [email, phone, fullName, role] of [
    ['manager@zunokitchen.test', '15550001002', 'Priya Manager', 'MANAGER'],
    ['agent@zunokitchen.test', '15550001003', 'Sam Agent', 'AGENT'],
  ] as const) {
    await prisma.user.upsert({
      where: { email },
      update: { tenantId, phone, role, isActive: true },
      create: { tenantId, email, phone, fullName, role, emailVerified: true },
    });
    console.log(`  ✓ ${fullName} <${email}> ${role} — sign in with ${phone}`);
  }
};

main().catch((e: Error) => { console.error(e.message); process.exit(1); }).finally(() => prisma.$disconnect());
