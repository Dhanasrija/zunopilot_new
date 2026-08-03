import { prisma, type Db } from '../config/prisma.js';
import type { WhatsappAccount } from '@prisma/client';

// A tenant used to have exactly one WhatsApp channel (`tenantId` was `@unique`).
// Module 12 relaxes that: an Assistant binds to a specific channel, and a
// workspace may run more than one number.
//
// Everything written before that change assumed one, and "the tenant's channel"
// is still the right answer for those callers — the legacy ordering flow, the
// template dispatcher, the inbox reply box. Rather than scatter `findFirst`
// across a dozen files, they all come through here. When those surfaces become
// channel-aware, this is the single seam to change.

/**
 * The default channel for a tenant: the earliest connected one.
 *
 * Deliberately deterministic — picking by `connectedAt` means the answer does
 * not change when an unrelated row is touched, so a tenant with two numbers
 * always gets the same one until the caller is made channel-aware.
 */
export const channelForTenant = (
  tenantId: string,
  db: Db = prisma,
): Promise<WhatsappAccount | null> =>
  db.whatsappAccount.findFirst({
    where: { tenantId },
    orderBy: { connectedAt: 'asc' },
  });

/** As above, but throws rather than returning null. */
export const requireChannelForTenant = async (
  tenantId: string,
  db: Db = prisma,
): Promise<WhatsappAccount> => {
  const channel = await channelForTenant(tenantId, db);
  if (!channel) throw new Error(`Tenant ${tenantId} has no connected WhatsApp channel`);
  return channel;
};
