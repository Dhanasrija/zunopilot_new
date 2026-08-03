import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { prisma } from '../../../../config/prisma.js';
import { databaseLookupExecutor, databaseWriteExecutor } from './database.js';
import type { NodeExecutionContext } from '../types.js';

// Against real Postgres, because the property that matters is a query
// predicate: an order lookup must never match a row belonging to someone else.

const TENANT = '88888888-8888-8888-8888-888888888888';

let mine: string;
let theirs: string;
let myOrderNumber: number;
let theirOrderNumber: number;

const wipe = async () => {
  await prisma.order.deleteMany({ where: { tenantId: TENANT } });
  await prisma.tenant.deleteMany({ where: { id: TENANT } });
};

const makeOrder = async (customerId: string, status: 'NEW' | 'OUT_FOR_DELIVERY' | 'CANCELLED') => {
  const order = await prisma.order.create({
    data: {
      tenantId: TENANT,
      customerId,
      customerName: 'Test',
      deliveryAddress: '1 Test Lane',
      status,
      subtotal: new Prisma.Decimal(280),
      totalAmount: new Prisma.Decimal(280),
      items: {
        create: [{
          itemId: (await prisma.menuItem.findFirstOrThrow({ where: { tenantId: TENANT } })).id,
          itemName: 'Chicken Biryani',
          quantity: 1,
          unitPrice: new Prisma.Decimal(280),
          lineTotal: new Prisma.Decimal(280),
        }],
      },
    },
  });
  return order.orderNumber;
};

beforeEach(async () => {
  await wipe();
  await prisma.tenant.create({
    data: { id: TENANT, businessName: 'DB Node Test', category: 'RESTAURANT' },
  });
  const category = await prisma.menuCategory.create({ data: { tenantId: TENANT, name: 'Mains' } });
  await prisma.menuItem.create({
    data: {
      tenantId: TENANT, categoryId: category.id, name: 'Chicken Biryani', basePrice: new Prisma.Decimal(280),
    },
  });

  const a = await prisma.customer.create({ data: { tenantId: TENANT, waId: '15550001111' } });
  const b = await prisma.customer.create({ data: { tenantId: TENANT, waId: '15550002222' } });
  mine = a.id;
  theirs = b.id;
  myOrderNumber = await makeOrder(mine, 'NEW');
  theirOrderNumber = await makeOrder(theirs, 'NEW');
});

afterAll(async () => {
  await wipe();
  await prisma.$disconnect();
});

const contextFor = <T>(config: T, customerId: string) => ({
  config,
  tenantId: TENANT,
  contact: { id: customerId, waId: '15550001111' },
  dryRun: false,
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
} as unknown as NodeExecutionContext<T>);

const lookup = (query: string, customerId = mine, resource = 'order') =>
  databaseLookupExecutor.execute(contextFor(
    databaseLookupExecutor.validateConfig({ resource, query, outputVariable: 'record' }),
    customerId,
  ));

const cancel = (target: string, customerId = mine) =>
  databaseWriteExecutor.execute(contextFor(
    databaseWriteExecutor.validateConfig({ operation: 'cancel_order', target, outputVariable: 'result' }),
    customerId,
  ));

describe('looking up an order', () => {
  it('finds the customer\'s own order', async () => {
    const result = await lookup(String(myOrderNumber));
    expect(result.nextHandle).toBe('success');
    expect(result.variablesPatch?.record).toMatchObject({
      orderNumber: myOrderNumber, status: 'NEW', total: 280,
    });
  });

  it('tolerates the customer typing "#1042" or "order 1042"', async () => {
    expect((await lookup(`#${myOrderNumber}`)).nextHandle).toBe('success');
    expect((await lookup(`order ${myOrderNumber}`)).nextHandle).toBe('success');
  });

  it('CANNOT see another customer\'s order, even with the right number', async () => {
    // The whole security model of this node. There is no configuration that
    // widens the scope, so a customer who guesses a number learns nothing.
    const result = await lookup(String(theirOrderNumber));
    expect(result.nextHandle).toBe('error');
    expect(result.variablesPatch?.record).toBeUndefined();
  });

  it('takes the error branch for a number that does not exist', async () => {
    expect((await lookup('999999')).nextHandle).toBe('error');
  });

  it('takes the error branch for text that is not a number at all', async () => {
    expect((await lookup('my biryani order')).nextHandle).toBe('error');
  });

  it('lists only this customer\'s recent orders', async () => {
    const result = await databaseLookupExecutor.execute(contextFor(
      databaseLookupExecutor.validateConfig({
        resource: 'recent_orders', outputVariable: 'orders', itemsVariable: 'rows', limit: 10,
      }),
      mine,
    ));
    expect(result.output).toMatchObject({ count: 1 });
    expect(result.variablesPatch?.rows).toEqual([
      { id: String(myOrderNumber), title: `Order #${myOrderNumber}`, description: 'NEW · ₹280' },
    ]);
  });
});

describe('cancelling an order', () => {
  it('cancels the customer\'s own cancellable order', async () => {
    const result = await cancel(String(myOrderNumber));
    expect(result.nextHandle).toBe('success');
    const order = await prisma.order.findFirstOrThrow({
      where: { tenantId: TENANT, orderNumber: myOrderNumber },
    });
    expect(order.status).toBe('CANCELLED');
  });

  it('CANNOT cancel another customer\'s order', async () => {
    const result = await cancel(String(theirOrderNumber));
    expect(result.nextHandle).toBe('error');
    expect(result.variablesPatch?.result).toMatchObject({ reason: 'NOT_FOUND' });

    const untouched = await prisma.order.findFirstOrThrow({
      where: { tenantId: TENANT, orderNumber: theirOrderNumber },
    });
    expect(untouched.status).toBe('NEW');
  });

  it('refuses once the order is out for delivery, and says why', async () => {
    const late = await makeOrder(mine, 'OUT_FOR_DELIVERY');
    const result = await cancel(String(late));
    expect(result.nextHandle).toBe('error');
    expect(result.variablesPatch?.result).toMatchObject({ reason: 'TOO_LATE', status: 'OUT_FOR_DELIVERY' });
  });

  it('distinguishes "already cancelled" from "too late"', async () => {
    const done = await makeOrder(mine, 'CANCELLED');
    const result = await cancel(String(done));
    expect(result.variablesPatch?.result).toMatchObject({ reason: 'ALREADY_CANCELLED' });
  });

  it('cancels once when two messages race', async () => {
    // The update is conditional on the status just read, so the loser matches
    // nothing rather than both reporting success.
    const [first, second] = await Promise.all([
      cancel(String(myOrderNumber)),
      cancel(String(myOrderNumber)),
    ]);
    const outcomes = [first.nextHandle, second.nextHandle].sort();
    expect(outcomes).toEqual(['error', 'success']);
  });

  it('changes nothing on a dry run', async () => {
    const result = await databaseWriteExecutor.execute({
      ...contextFor(
        databaseWriteExecutor.validateConfig({ operation: 'cancel_order', target: String(myOrderNumber) }),
        mine,
      ),
      dryRun: true,
    } as never);

    expect(result.nextHandle).toBe('success');
    const order = await prisma.order.findFirstOrThrow({
      where: { tenantId: TENANT, orderNumber: myOrderNumber },
    });
    expect(order.status).toBe('NEW');
  });
});
