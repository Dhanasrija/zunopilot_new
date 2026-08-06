import { PrismaClient } from '@prisma/client';
import { logger } from './logger.js';

export const prisma = new PrismaClient({
  log: [
    { emit: 'event', level: 'error' },
    { emit: 'event', level: 'warn' },
  ],
});

prisma.$on('error', (e) => logger.error('Prisma error', e));
prisma.$on('warn', (e) => logger.warn('Prisma warn', e));

/**
 * The type of a Prisma client inside `$transaction` — no nested `$transaction`,
 * no `$connect`. Repositories accept this so the same function works both
 * standalone and inside a transaction.
 */
export type PrismaTx = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

/** Either the root client or a transaction client. */
export type Db = PrismaClient | PrismaTx;
