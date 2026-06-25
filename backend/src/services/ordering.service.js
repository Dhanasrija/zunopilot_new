import { prisma } from '../config/prisma.js';
import {
  sendTextMessage,
  sendInteractiveList,
  sendInteractiveButtons,
} from './whatsapp.service.js';
import { dispatchOrderTemplate } from './template.service.js';

// Helpers to format Meta interactive list/button rows.
const truncate = (s, n) => (s && s.length > n ? `${s.slice(0, n - 1)}…` : s);

export const startOrderingFlow = async ({ tenant, waAccount, customer }) => {
  const categories = await prisma.menuCategory.findMany({
    where: { tenantId: tenant.id, isActive: true },
    orderBy: { sortOrder: 'asc' },
    take: 10,
  });

  if (!categories.length) {
    await sendTextMessage({
      accessToken: waAccount.accessToken,
      phoneNumberId: waAccount.phoneNumberId,
      to: customer.waId,
      body: 'Our menu is currently empty. Please check back later.',
    });
    return;
  }

  await prisma.cart.upsert({
    where: { customerId: customer.id },
    update: { state: 'BROWSING_CATEGORY', context: {}, tenantId: tenant.id },
    create: { tenantId: tenant.id, customerId: customer.id, state: 'BROWSING_CATEGORY', context: {} },
  });

  await sendInteractiveList({
    accessToken: waAccount.accessToken,
    phoneNumberId: waAccount.phoneNumberId,
    to: customer.waId,
    header: 'Our Menu',
    body: 'Tap to pick a category.',
    button: 'View categories',
    sections: [{
      title: 'Categories',
      rows: categories.map((c) => ({
        id: `cat:${c.id}`,
        title: truncate(c.name, 24),
        description: truncate(c.description || '', 72),
      })),
    }],
  });
};

const sendItemsForCategory = async ({ tenant, waAccount, customer, categoryId }) => {
  const items = await prisma.menuItem.findMany({
    where: { tenantId: tenant.id, categoryId, inStock: true },
    orderBy: { sortOrder: 'asc' },
    take: 10,
  });
  if (!items.length) {
    await sendTextMessage({
      accessToken: waAccount.accessToken,
      phoneNumberId: waAccount.phoneNumberId,
      to: customer.waId,
      body: 'No items available in this category right now.',
    });
    return;
  }
  await sendInteractiveList({
    accessToken: waAccount.accessToken,
    phoneNumberId: waAccount.phoneNumberId,
    to: customer.waId,
    body: 'Pick an item to add.',
    button: 'View items',
    sections: [{
      title: 'Items',
      rows: items.map((i) => ({
        id: `item:${i.id}`,
        title: truncate(i.name, 24),
        description: truncate(`₹${i.basePrice} — ${i.description || ''}`, 72),
      })),
    }],
  });
};

const askQuantity = async ({ waAccount, customer, item }) => {
  await sendInteractiveButtons({
    accessToken: waAccount.accessToken,
    phoneNumberId: waAccount.phoneNumberId,
    to: customer.waId,
    body: `How many *${item.name}* (₹${item.basePrice})?`,
    buttons: [
      { id: `qty:1`, title: '1' },
      { id: `qty:2`, title: '2' },
      { id: `qty:3`, title: '3' },
    ],
  });
};

const sendCartSummary = async ({ tenant, waAccount, customer, cart }) => {
  const items = await prisma.cartItem.findMany({
    where: { cartId: cart.id },
    include: { item: true, addons: { include: { option: true } } },
  });
  if (!items.length) {
    await sendTextMessage({
      accessToken: waAccount.accessToken,
      phoneNumberId: waAccount.phoneNumberId,
      to: customer.waId,
      body: 'Your cart is empty. Type *Menu* to start.',
    });
    return;
  }
  const lines = items.map((ci) => {
    const addonStr = ci.addons.map((a) => `+${a.option.name}`).join(', ');
    const lineTotal = Number(ci.unitPrice) * ci.quantity
      + ci.addons.reduce((s, a) => s + Number(a.priceDelta), 0) * ci.quantity;
    return `${ci.quantity}× ${ci.item.name}${addonStr ? ' (' + addonStr + ')' : ''} — ₹${lineTotal.toFixed(2)}`;
  });
  const subtotal = lines.reduce((s, _l, i) => {
    const ci = items[i];
    return s + (Number(ci.unitPrice) * ci.quantity) + ci.addons.reduce((x, a) => x + Number(a.priceDelta), 0) * ci.quantity;
  }, 0);
  const body = `*Cart*\n${lines.join('\n')}\n\nTotal: ₹${subtotal.toFixed(2)}`;
  await sendInteractiveButtons({
    accessToken: waAccount.accessToken,
    phoneNumberId: waAccount.phoneNumberId,
    to: customer.waId,
    body,
    buttons: [
      { id: 'cart:checkout', title: 'Checkout' },
      { id: 'cart:add_more', title: 'Add more' },
      { id: 'cart:clear', title: 'Clear cart' },
    ],
  });
  await prisma.cart.update({ where: { id: cart.id }, data: { state: 'REVIEWING_CART' } });
};

const finalizeOrder = async ({ tenant, waAccount, customer, cart }) => {
  const items = await prisma.cartItem.findMany({
    where: { cartId: cart.id },
    include: { item: true, addons: { include: { option: true } } },
  });
  if (!items.length) return;

  let subtotal = 0;
  const orderItemsData = items.map((ci) => {
    const addonsTotal = ci.addons.reduce((s, a) => s + Number(a.priceDelta), 0);
    const lineTotal = (Number(ci.unitPrice) + addonsTotal) * ci.quantity;
    subtotal += lineTotal;
    return {
      itemId: ci.itemId,
      itemName: ci.item.name,
      quantity: ci.quantity,
      unitPrice: ci.unitPrice,
      lineTotal,
      addons: {
        create: ci.addons.map((a) => ({
          optionId: a.optionId,
          name: a.option.name,
          priceDelta: a.priceDelta,
        })),
      },
    };
  });

  const order = await prisma.order.create({
    data: {
      tenantId: tenant.id,
      customerId: customer.id,
      customerName: cart.customerName || customer.name || 'Customer',
      deliveryAddress: cart.deliveryAddr || '',
      contactPhone: customer.phone || customer.waId,
      subtotal,
      totalAmount: subtotal,
      items: { create: orderItemsData },
    },
  });

  await prisma.cartItemAddon.deleteMany({ where: { cartItem: { cartId: cart.id } } });
  await prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
  await prisma.cart.update({ where: { id: cart.id }, data: { state: 'IDLE', context: {}, customerName: null, deliveryAddr: null } });

  await sendTextMessage({
    accessToken: waAccount.accessToken,
    phoneNumberId: waAccount.phoneNumberId,
    to: customer.waId,
    body: `Order #${order.orderNumber} placed! Total ₹${Number(subtotal).toFixed(2)}. We'll send updates here.`,
  });
};

// Main dispatch — interprets interactive payloads + free text by cart state.
export const handleOrderingFlow = async ({ tenant, waAccount, customer, cart, message }) => {
  const interactive = message.payload?.interactive;
  const replyId = interactive?.list_reply?.id || interactive?.button_reply?.id;
  const text = (message.body || '').trim();

  // Allow "menu" anywhere to restart.
  if (text && /^menu$/i.test(text)) {
    return startOrderingFlow({ tenant, waAccount, customer });
  }

  switch (cart.state) {
    case 'BROWSING_CATEGORY': {
      if (replyId?.startsWith('cat:')) {
        const categoryId = replyId.split(':')[1];
        await prisma.cart.update({
          where: { id: cart.id },
          data: { state: 'BROWSING_ITEMS', context: { categoryId } },
        });
        return sendItemsForCategory({ tenant, waAccount, customer, categoryId });
      }
      break;
    }
    case 'BROWSING_ITEMS': {
      if (replyId?.startsWith('item:')) {
        const itemId = replyId.split(':')[1];
        const item = await prisma.menuItem.findUnique({ where: { id: itemId } });
        if (!item) break;
        await prisma.cart.update({
          where: { id: cart.id },
          data: { state: 'SELECTING_QUANTITY', context: { ...(cart.context || {}), itemId } },
        });
        return askQuantity({ waAccount, customer, item });
      }
      break;
    }
    case 'SELECTING_QUANTITY': {
      if (replyId?.startsWith('qty:')) {
        const qty = parseInt(replyId.split(':')[1], 10);
        const itemId = cart.context?.itemId;
        const item = await prisma.menuItem.findUnique({ where: { id: itemId } });
        if (!item) break;
        await prisma.cartItem.create({
          data: { cartId: cart.id, itemId: item.id, quantity: qty, unitPrice: item.basePrice },
        });
        return sendCartSummary({ tenant, waAccount, customer, cart });
      }
      break;
    }
    case 'REVIEWING_CART': {
      if (replyId === 'cart:checkout') {
        await prisma.cart.update({ where: { id: cart.id }, data: { state: 'COLLECTING_NAME' } });
        return sendTextMessage({
          accessToken: waAccount.accessToken,
          phoneNumberId: waAccount.phoneNumberId,
          to: customer.waId,
          body: 'Please reply with your *name* for the order.',
        });
      }
      if (replyId === 'cart:add_more') {
        await prisma.cart.update({ where: { id: cart.id }, data: { state: 'BROWSING_CATEGORY' } });
        return startOrderingFlow({ tenant, waAccount, customer });
      }
      if (replyId === 'cart:clear') {
        await prisma.cartItemAddon.deleteMany({ where: { cartItem: { cartId: cart.id } } });
        await prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
        await prisma.cart.update({ where: { id: cart.id }, data: { state: 'IDLE', context: {} } });
        return sendTextMessage({
          accessToken: waAccount.accessToken,
          phoneNumberId: waAccount.phoneNumberId,
          to: customer.waId,
          body: 'Cart cleared.',
        });
      }
      break;
    }
    case 'COLLECTING_NAME': {
      if (text) {
        await prisma.cart.update({
          where: { id: cart.id },
          data: { state: 'COLLECTING_ADDRESS', customerName: text },
        });
        return sendTextMessage({
          accessToken: waAccount.accessToken,
          phoneNumberId: waAccount.phoneNumberId,
          to: customer.waId,
          body: 'Thanks. Now share your *delivery address*.',
        });
      }
      break;
    }
    case 'COLLECTING_ADDRESS': {
      if (text) {
        const updated = await prisma.cart.update({
          where: { id: cart.id },
          data: { deliveryAddr: text, state: 'CHECKOUT_READY' },
        });
        await finalizeOrder({ tenant, waAccount, customer, cart: updated });
        return;
      }
      break;
    }
    default:
      break;
  }

  // Fallback inside flow
  await sendTextMessage({
    accessToken: waAccount.accessToken,
    phoneNumberId: waAccount.phoneNumberId,
    to: customer.waId,
    body: 'Sorry, I expected a selection. Type *Menu* to restart.',
  });
};

export { dispatchOrderTemplate };
