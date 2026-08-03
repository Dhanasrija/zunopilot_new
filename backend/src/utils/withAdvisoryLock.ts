import { prisma, type PrismaTx } from '../config/prisma.js';

/**
 * Serialize a block of work per key using a Postgres transaction-scoped
 * advisory lock.
 *
 * Needed because the webhook acks Meta with a 200 *before* processing (Meta
 * requires a fast ack), so several deliveries for the same customer can be
 * in-flight at once. A plain find-then-create lets two handlers both miss and
 * both insert — which produced duplicate OPEN conversations, one orphaned with
 * zero messages.
 *
 * Transaction-scoped (`pg_advisory_xact_lock`) rather than session-scoped, so
 * the lock is always released on commit or rollback — no unlock to leak.
 *
 * `hashtext()` returns int4, so distinct keys can collide. A collision only
 * makes two unrelated customers serialize for a few milliseconds; it cannot
 * produce a wrong result.
 *
 * @param key Lock identity, e.g. `wa:<tenantId>:<waId>`.
 * @param fn  Work to run while holding the lock. Must use the supplied `tx`,
 *            not the global client, or it will run outside the lock.
 */
export const withAdvisoryLock = <T>(
  key: string,
  fn: (tx: PrismaTx) => Promise<T>,
  options: { timeoutMs?: number } = {},
): Promise<T> =>
  prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
      return fn(tx);
    },
    // Keep the critical section short: only cheap upsert/find/create belong in
    // here. Outbound HTTP (Meta) and the automation engine must stay outside, or
    // one slow send would block every other message from that customer.
    { timeout: options.timeoutMs ?? 10_000, maxWait: options.timeoutMs ?? 10_000 },
  );
