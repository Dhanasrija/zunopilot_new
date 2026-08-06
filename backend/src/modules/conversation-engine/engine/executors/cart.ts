import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../../../../config/prisma.js';
import { NODE_CONFIG_SCHEMAS } from '../../domain/node-types.js';
import { NodeConfigError, type WorkflowNodeExecutor } from '../types.js';

// Basket and order nodes.
//
// The basket lives in workflow variables, not the `Cart` table — see the note
// in domain/node-types.ts. The short version: the routing chain hands any
// in-flight `Cart` row to the legacy state machine before a workflow gets a
// look in, so a workflow writing to `Cart` would be hijacked on the next
// message. Two order paths, one row, no contention.

type AddItemConfig = z.infer<typeof NODE_CONFIG_SCHEMAS.CART_ADD_ITEM>;
type SummaryConfig = z.infer<typeof NODE_CONFIG_SCHEMAS.CART_SUMMARY>;
type CreateOrderConfig = z.infer<typeof NODE_CONFIG_SCHEMAS.CREATE_ORDER>;

export interface BasketLine {
  itemId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

/** Ids arrive from a list tap prefixed (`item:<uuid>`). Accept either form. */
const bareId = (raw: unknown): string => {
  const value = String(raw ?? '').trim();
  return value.startsWith('item:') ? value.slice(5) : value;
};

const basketFrom = (variables: Record<string, unknown>, key: string): BasketLine[] => {
  const raw = variables[key];
  return Array.isArray(raw) ? raw as BasketLine[] : [];
};

const basketTotal = (lines: BasketLine[]): number =>
  lines.reduce((sum, line) => sum + line.lineTotal, 0);

export const cartAddItemExecutor: WorkflowNodeExecutor<
  AddItemConfig,
  { lines: number; total: number }
> = {
  type: 'CART_ADD_ITEM',
  validateConfig: (config) => NODE_CONFIG_SCHEMAS.CART_ADD_ITEM.parse(config),

  execute: async ({ config, tenantId, variables, logger }) => {
    const itemId = bareId(variables[config.itemVariable]);
    if (!itemId) throw new NodeConfigError(`No item id in {{vars.${config.itemVariable}}}`);

    // Scoped by tenant: an item id is a uuid a customer could in principle
    // replay from another workspace's list.
    const item = await prisma.menuItem.findFirst({ where: { id: itemId, tenantId } });
    if (!item) throw new NodeConfigError('That item is no longer available');

    const rawQty = config.quantityVariable ? variables[config.quantityVariable] : 1;
    // Quantity often arrives as `qty:2` from a button tap.
    const parsed = Number(String(rawQty ?? '1').replace(/^qty:/, ''));
    const quantity = Number.isFinite(parsed) && parsed > 0 ? Math.min(Math.floor(parsed), 99) : 1;

    // Price is read from the catalogue, never from a variable — a price that
    // came through the conversation is a price the customer could influence.
    const unitPrice = Number(item.basePrice);
    const basket = basketFrom(variables, config.cartVariable);

    const existing = basket.find((line) => line.itemId === item.id);
    const next = existing
      ? basket.map((line) => (line.itemId === item.id
        ? { ...line, quantity: line.quantity + quantity, lineTotal: (line.quantity + quantity) * unitPrice }
        : line))
      : [...basket, {
        itemId: item.id,
        name: item.name,
        quantity,
        unitPrice,
        lineTotal: quantity * unitPrice,
      }];

    logger.debug('Added to basket', { itemId: item.id, quantity, lines: next.length });

    return {
      status: 'SUCCESS',
      output: { lines: next.length, total: basketTotal(next) },
      variablesPatch: { [config.cartVariable]: next },
    };
  },
};

export const cartSummaryExecutor: WorkflowNodeExecutor<
  SummaryConfig,
  { summary: string; total: number; lines: number }
> = {
  type: 'CART_SUMMARY',
  validateConfig: (config) => NODE_CONFIG_SCHEMAS.CART_SUMMARY.parse(config),

  execute: async ({ config, variables }) => {
    const basket = basketFrom(variables, config.cartVariable);

    if (!basket.length) {
      return {
        status: 'SUCCESS',
        output: { summary: config.emptyText, total: 0, lines: 0 },
        variablesPatch: { [config.outputVariable]: config.emptyText },
      };
    }

    const total = basketTotal(basket);
    const summary = [
      ...basket.map((line) => `• ${line.quantity} × ${line.name} — ₹${line.lineTotal.toFixed(0)}`),
      `\n*Total: ₹${total.toFixed(0)}*`,
    ].join('\n');

    return {
      status: 'SUCCESS',
      output: { summary, total, lines: basket.length },
      variablesPatch: { [config.outputVariable]: summary },
    };
  },
};

export const createOrderExecutor: WorkflowNodeExecutor<
  CreateOrderConfig,
  { orderId: string; orderNumber: number; total: number }
> = {
  type: 'CREATE_ORDER',
  validateConfig: (config) => NODE_CONFIG_SCHEMAS.CREATE_ORDER.parse(config),

  execute: async ({ config, tenantId, contact, variables, dryRun, logger, idempotencyKey }) => {
    const basket = basketFrom(variables, config.cartVariable);
    if (!basket.length) throw new NodeConfigError('Cannot place an order with an empty basket');

    const subtotal = basketTotal(basket);
    const customerName = config.customerNameVariable
      ? String(variables[config.customerNameVariable] ?? '').trim()
      : '';
    const address = config.addressVariable
      ? String(variables[config.addressVariable] ?? '').trim()
      : '';

    if (dryRun) {
      logger.info('Dry run: order not created');
      return {
        status: 'SUCCESS',
        output: { orderId: 'dry-run', orderNumber: 0, total: subtotal },
        variablesPatch: {
          [config.outputVariable]: { orderNumber: 0, total: subtotal, dryRun: true },
        },
        nextHandle: 'success',
      };
    }

    // Replay guard. The node's idempotency key is stable across retries of the
    // same step, so a worker that crashed after committing the order does not
    // create a second one on the way back.
    const already = await prisma.order.findFirst({
      where: { tenantId, customerId: contact.id, notes: { contains: idempotencyKey } },
      select: { id: true, orderNumber: true },
    });
    if (already) {
      logger.info('Order already created for this step, not repeating', { orderId: already.id });
      return {
        status: 'SUCCESS',
        output: { orderId: already.id, orderNumber: already.orderNumber, total: subtotal },
        variablesPatch: {
          [config.outputVariable]: { orderId: already.id, orderNumber: already.orderNumber, total: subtotal },
        },
        nextHandle: 'success',
      };
    }

    const order = await prisma.order.create({
      data: {
        tenantId,
        customerId: contact.id,
        customerName: customerName || contact.name || 'Customer',
        contactPhone: contact.phone || contact.waId,
        deliveryAddress: address || 'Not provided',
        subtotal: new Prisma.Decimal(subtotal),
        totalAmount: new Prisma.Decimal(subtotal),
        notes: `workflow:${idempotencyKey}`,
        items: {
          create: basket.map((line) => ({
            itemId: line.itemId,
            itemName: line.name,
            quantity: line.quantity,
            unitPrice: new Prisma.Decimal(line.unitPrice),
            lineTotal: new Prisma.Decimal(line.lineTotal),
          })),
        },
      },
    });

    logger.info('Order created by workflow', { orderId: order.id, orderNumber: order.orderNumber });

    return {
      status: 'SUCCESS',
      output: { orderId: order.id, orderNumber: order.orderNumber, total: subtotal },
      variablesPatch: {
        [config.outputVariable]: {
          orderId: order.id,
          orderNumber: order.orderNumber,
          total: subtotal,
        },
      },
      nextHandle: 'success',
    };
  },
};
