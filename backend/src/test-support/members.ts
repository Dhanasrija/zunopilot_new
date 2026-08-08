import { prisma } from '../config/prisma.js';
import { syncMembershipsForTenant } from '../services/membership.service.js';

/*
 * Memberships for test fixtures.
 *
 * ── Why fixtures need this at all ────────────────────────────────────────────
 *
 * In the product, every path that creates a user also writes a `Membership` — signup, invite, the
 * team screen, the operator console. Fixtures bypass all of that and insert users straight into
 * Postgres, so they produce accounts that could not exist in production: a login belonging to no
 * workspace. That works today, because `requireAuth` reads `User.tenantId`. It stops working the
 * moment it reads memberships, and the symptom is every suite failing with 401 at once — which
 * says nothing about what is wrong.
 *
 * ── Why this is a helper and not a global hook ───────────────────────────────
 *
 * The tempting version is a `prisma.$use` middleware in a vitest setup file, mirroring every
 * `user.create` automatically: one edit instead of thirty-four, and future fixtures get it free.
 *
 * **It would also break the tests that matter.** Four mutations in the previous commit — deleting
 * the membership sync from signup, from invite, from deactivation, from a role change — are caught
 * because those paths assert the membership they write. A middleware that created memberships for
 * *any* user insert would satisfy those assertions no matter what the production code did, and all
 * four mutations would go quiet. A convenience that disarms the tests protecting the thing it is a
 * convenience for is not worth having.
 *
 * So: an explicit call, and `membership-fixtures.test.ts` fails the build if a suite creates users
 * without one.
 */

/**
 * Give every login that lacks one a membership, as the product would have.
 *
 * **Takes no arguments on purpose.** Fixtures build workspaces in a dozen different shapes — some
 * nest `users: { create: … }` inside a `tenant.create`, some insert directly, some do both across
 * several tenants — and a variant that needed the tenant ids would have to be threaded correctly
 * through every one of them. Thirty-two chances to pass the wrong constant, for no gain.
 *
 * Instead it asks the database which logins are missing a membership and fixes those. Idempotent,
 * so it is safe to run before every test rather than reasoning about which fixture hook created
 * what. The test database holds tens of rows, so the scan costs nothing.
 *
 * Pass tenant ids only if you want to *re-sync* people who already have memberships — a role
 * changed behind the API's back, say.
 */
export const seedMemberships = async (...tenantIds: string[]): Promise<number> => {
  if (tenantIds.length > 0) {
    let total = 0;
    for (const tenantId of tenantIds) {
      // eslint-disable-next-line no-await-in-loop
      total += await syncMembershipsForTenant(tenantId);
    }
    return total;
  }

  const orphans = await prisma.user.findMany({
    where: { memberships: { none: {} } },
    select: { id: true, tenantId: true },
  });
  for (const user of orphans) {
    // eslint-disable-next-line no-await-in-loop
    await syncMembershipsForTenant(user.tenantId);
  }
  return orphans.length;
};

/**
 * A user plus their membership, for fixtures that add one person at a time.
 *
 * Thin on purpose — it takes the same `data` a fixture would have passed to `prisma.user.create`,
 * so adopting it is a rename rather than a rewrite, and nothing about the user is hidden from the
 * reader.
 */
export const seedUser = async (
  data: Parameters<typeof prisma.user.create>[0]['data'] & { tenantId: string },
) => {
  const user = await prisma.user.create({ data });
  await syncMembershipsForTenant(data.tenantId);
  return user;
};
