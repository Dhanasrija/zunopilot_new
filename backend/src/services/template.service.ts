import { prisma } from '../config/prisma.js';
import { sendTemplate } from './whatsapp.service.js';
import { logger } from '../config/logger.js';
import type { OrderStatus, TemplateTrigger } from '@prisma/client';

const STATUS_TO_TRIGGER: Partial<Record<OrderStatus, TemplateTrigger>> = {
  NEW: 'ORDER_CREATED',
  ACCEPTED: 'ORDER_ACCEPTED',
  PREPARING: 'ORDER_PREPARING',
  READY: 'ORDER_READY',
  OUT_FOR_DELIVERY: 'ORDER_OUT_FOR_DELIVERY',
  DELIVERED: 'ORDER_DELIVERED',
  CANCELLED: 'ORDER_CANCELLED',
};

// Fired when order status changes — sends matching utility template.
export const dispatchOrderTemplate = async (orderId: string, newStatus: OrderStatus): Promise<void> => {
  try {
    const trigger = STATUS_TO_TRIGGER[newStatus];
    if (!trigger) return;
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { customer: true, tenant: { include: { whatsappAccounts: true, templates: true } } },
    });
    const waAccount = order?.tenant?.whatsappAccounts?.[0];
    if (!order || !waAccount) return;
    const template = order.tenant.templates.find((t) => t.trigger === trigger && t.isActive);
    if (!template) {
      logger.info('No active template for trigger', { trigger, tenantId: order.tenantId });
      return;
    }
    await sendTemplate({
      accessToken: waAccount.accessToken,
      phoneNumberId: waAccount.phoneNumberId,
      to: order.customer.waId,
      templateName: template.metaTemplate,
      language: template.language,
      components: [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: order.customerName },
            { type: 'text', text: String(order.orderNumber) },

          ],
        },
      ],
    });
    logger.info('Template message sent successfully', {
      trigger,
      templateName: template.metaTemplate,
      orderId: order.id,
      orderNumber: order.orderNumber,
      customerId: order.customer.id,
      customerWaId: order.customer.waId,
    });
  } catch (err: any) {
    logger.error('dispatchOrderTemplate failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
};
