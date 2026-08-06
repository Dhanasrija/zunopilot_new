import { z } from 'zod';
import { prisma } from '../../../../config/prisma.js';
import { NODE_CONFIG_SCHEMAS } from '../../domain/node-types.js';
import { NodeConfigError, type WorkflowNodeExecutor } from '../types.js';

// Reading and writing the tenant's own ZunoPilot data.
//
// Deliberately a short list of named resources rather than a query builder.
// A workflow is tenant-authored, and the moment an operator can express a
// filter, they can express one that returns another customer's order. So the
// filters are ours and only the values are theirs.
//
// **Every order access is scoped to the customer in this conversation**, with
// no configuration to widen it. That is the whole security model of these two
// nodes: a customer who guesses an order number learns nothing, because the
// query never matches outside their own rows.

type LookupConfig = z.infer<typeof NODE_CONFIG_SCHEMAS.DATABASE_LOOKUP>;
type WriteConfig = z.infer<typeof NODE_CONFIG_SCHEMAS.DATABASE_WRITE>;

/**
 * Statuses a customer may still cancel from.
 *
 * Once it is out for delivery the food has been made and dispatched —
 * cancelling then is a commercial decision, not an automated one, so those
 * cases go to a person via the node's error branch.
 */
const CANCELLABLE = new Set(['NEW', 'ACCEPTED', 'PREPARING']);

const orderNumberFrom = (raw: unknown): number | null => {
  const digits = String(raw ?? '').replace(/[^0-9]/g, '');
  if (!digits) return null;
  const parsed = Number(digits);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
};

const orderSummary = (order: {
  id: string;
  orderNumber: number;
  status: string;
  totalAmount: unknown;
  deliveryAddress: string;
  placedAt: Date;
  items: Array<{ itemName: string; quantity: number }>;
}) => ({
  id: order.id,
  orderNumber: order.orderNumber,
  status: order.status,
  total: Number(order.totalAmount),
  deliveryAddress: order.deliveryAddress,
  placedAt: order.placedAt.toISOString(),
  items: order.items.map((i) => `${i.quantity} × ${i.itemName}`),
  summary: order.items.map((i) => `${i.quantity} × ${i.itemName}`).join(', '),
});

export const databaseLookupExecutor: WorkflowNodeExecutor<
  LookupConfig,
  { found: boolean; count: number }
> = {
  type: 'DATABASE_LOOKUP',
  validateConfig: (config) => NODE_CONFIG_SCHEMAS.DATABASE_LOOKUP.parse(config),

  execute: async ({ config, tenantId, contact, logger }) => {
    const patch: Record<string, unknown> = {};
    let found = false;
    let count = 0;

    switch (config.resource) {
      case 'order': {
        const orderNumber = orderNumberFrom(config.query);
        if (orderNumber === null) {
          // Not a crash — the customer typed something that is not an order
          // number, and the graph's error branch should re-ask.
          logger.debug('No usable order number in the lookup query');
          break;
        }
        const order = await prisma.order.findFirst({
          // tenant *and* customer. Neither is optional.
          where: { tenantId, customerId: contact.id, orderNumber },
          include: { items: { select: { itemName: true, quantity: true } } },
        });
        if (order) {
          found = true;
          count = 1;
          patch[config.outputVariable] = orderSummary(order);
        }
        break;
      }

      case 'recent_orders': {
        const orders = await prisma.order.findMany({
          where: { tenantId, customerId: contact.id },
          orderBy: { placedAt: 'desc' },
          take: config.limit,
          include: { items: { select: { itemName: true, quantity: true } } },
        });
        found = orders.length > 0;
        count = orders.length;
        patch[config.outputVariable] = orders.map(orderSummary);
        if (config.itemsVariable) {
          patch[config.itemsVariable] = orders.map((order) => ({
            id: String(order.orderNumber),
            title: `Order #${order.orderNumber}`,
            description: `${order.status} · ₹${Number(order.totalAmount).toFixed(0)}`,
          }));
        }
        break;
      }

      case 'menu_item': {
        // The catalogue is public to anyone who can message the number, so this
        // one is tenant-scoped only.
        const term = String(config.query ?? '').trim();
        const items = await prisma.menuItem.findMany({
          where: {
            tenantId,
            inStock: true,
            ...(term ? { name: { contains: term, mode: 'insensitive' as const } } : {}),
          },
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
          take: config.limit,
        });
        found = items.length > 0;
        count = items.length;
        patch[config.outputVariable] = items.map((item) => ({
          id: item.id,
          name: item.name,
          price: Number(item.basePrice),
        }));
        if (config.itemsVariable) {
          patch[config.itemsVariable] = items.map((item) => ({
            id: `item:${item.id}`,
            title: item.name,
            description: `₹${Number(item.basePrice).toFixed(0)}`,
          }));
        }
        break;
      }

      default: {
        const exhaustive: never = config.resource;
        throw new NodeConfigError(`Unknown resource "${String(exhaustive)}"`);
      }
    }

    return {
      status: 'SUCCESS',
      output: { found, count },
      variablesPatch: patch,
      // "Nothing found" is a branch, not a failure. An order-status flow needs
      // to say "I couldn't find that one" rather than fall over.
      nextHandle: found ? 'success' : 'error',
    };
  },
};

export const databaseWriteExecutor: WorkflowNodeExecutor<
  WriteConfig,
  { changed: boolean; reason?: string }
> = {
  type: 'DATABASE_WRITE',
  validateConfig: (config) => NODE_CONFIG_SCHEMAS.DATABASE_WRITE.parse(config),

  execute: async ({ config, tenantId, contact, dryRun, logger }) => {
    const orderNumber = orderNumberFrom(config.target);
    if (orderNumber === null) {
      return {
        status: 'SUCCESS',
        output: { changed: false, reason: 'NO_ORDER_NUMBER' },
        variablesPatch: { [config.outputVariable]: { changed: false, reason: 'NO_ORDER_NUMBER' } },
        nextHandle: 'error',
      };
    }

    const order = await prisma.order.findFirst({
      where: { tenantId, customerId: contact.id, orderNumber },
      select: { id: true, orderNumber: true, status: true },
    });

    if (!order) {
      return {
        status: 'SUCCESS',
        output: { changed: false, reason: 'NOT_FOUND' },
        variablesPatch: { [config.outputVariable]: { changed: false, reason: 'NOT_FOUND' } },
        nextHandle: 'error',
      };
    }

    if (!CANCELLABLE.has(order.status)) {
      // Already on its way, already delivered, or already cancelled. Saying so
      // is far better than a silent no-op that looks like success.
      const reason = order.status === 'CANCELLED' ? 'ALREADY_CANCELLED' : 'TOO_LATE';
      return {
        status: 'SUCCESS',
        output: { changed: false, reason },
        variablesPatch: {
          [config.outputVariable]: { changed: false, reason, status: order.status, orderNumber },
        },
        nextHandle: 'error',
      };
    }

    if (dryRun) {
      logger.info('Dry run: order not cancelled');
      return {
        status: 'SUCCESS',
        output: { changed: true },
        variablesPatch: {
          [config.outputVariable]: { changed: true, orderNumber, status: 'CANCELLED', dryRun: true },
        },
        nextHandle: 'success',
      };
    }

    // Conditional on the status we just read, so two messages racing cannot
    // both cancel — the second matches nothing and reports TOO_LATE.
    const { count } = await prisma.order.updateMany({
      where: { id: order.id, status: { in: [...CANCELLABLE] as never } },
      data: { status: 'CANCELLED' },
    });

    if (!count) {
      return {
        status: 'SUCCESS',
        output: { changed: false, reason: 'TOO_LATE' },
        variablesPatch: { [config.outputVariable]: { changed: false, reason: 'TOO_LATE', orderNumber } },
        nextHandle: 'error',
      };
    }

    logger.info('Order cancelled by workflow', { orderNumber });

    return {
      status: 'SUCCESS',
      output: { changed: true },
      variablesPatch: {
        [config.outputVariable]: { changed: true, orderNumber, status: 'CANCELLED' },
      },
      nextHandle: 'success',
    };
  },
};
