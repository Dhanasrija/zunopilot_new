import { prisma } from '../src/config/prisma.js';
import { syncMembership } from '../src/services/membership.service.js';

/*
 * Give a membership to any login that lacks one.
 *
 * The migration backfilled everything that existed when it ran, and every write path now syncs —
 * so in steady state this finds nothing. It exists for the gaps between those two facts:
 *
 *   • **The deploy window.** `prisma migrate deploy` runs, then the process restarts. A signup or
 *     an invite served by the *old* code in those few seconds creates a user with no membership.
 *   • A seed or a manual insert made before dual-write landed. That is how this script came to be
 *     written: the invariant test found exactly one such login from an earlier seed run.
 *
 * Idempotent — `syncMembership` upserts — so it is safe to run repeatedly, and safe to run against
 * production. Read-only for anything already correct.
 *
 *   npx tsx scripts/repair-memberships.ts
 */
const main = async () => {
  const orphans = await prisma.user.findMany({
    where: { memberships: { none: {} } },
    select: { id: true, phone: true, tenantId: true },
  });
  console.log(`logins without a membership: ${orphans.length}`);
  for (const user of orphans) {
    // eslint-disable-next-line no-await-in-loop
    await syncMembership(user.id);
    console.log(`  synced ${user.phone ?? user.id} in ${user.tenantId}`);
  }
  const remaining = await prisma.user.count({ where: { memberships: { none: {} } } });
  console.log(`remaining: ${remaining}`);
  await prisma.$disconnect();
};

void main();
