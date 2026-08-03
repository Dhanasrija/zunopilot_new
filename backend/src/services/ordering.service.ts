import { prisma } from '../config/prisma.js';
import {
  sendTextMessage,
  sendInteractiveList,
  sendInteractiveButtons,
  sendLocationRequest,
} from './whatsapp.service.js';
import { dispatchOrderTemplate } from './template.service.js';
import { logger } from '../config/logger.js';
import type { Cart, Customer, InboundMessage, Tenant, WhatsappAccount } from '../types/domain.js';
import type { CartItem, MenuItem, Prisma } from '@prisma/client';

/** The cart-item shape `loadCartItems` returns: the row plus what it prices from. */
type CartLine = CartItem & {
  item: MenuItem;
  addons: Array<{ optionId: string; priceDelta: Prisma.Decimal; option?: { name: string } | null }>;
};

/**
 * `Cart.context` is a Prisma `Json` column, so it arrives as `JsonValue` — which
 * cannot be spread or indexed. This is the shape the flow actually writes into
 * it; `cartContext()` narrows once so the call sites stay readable.
 */
interface CartContext {
  itemId?: string;
  cartItemId?: string;
  categoryId?: string;
  pinLabel?: string;
  [key: string]: unknown;
}

const cartContext = (cart: Cart): CartContext =>
  (cart.context && typeof cart.context === 'object' && !Array.isArray(cart.context)
    ? cart.context as CartContext
    : {});

/** The four rows every step of the ordering flow needs. */
interface FlowContext {
  tenant: Tenant;
  waAccount: WhatsappAccount;
  customer: Customer;
}

// Helpers to format Meta interactive list/button rows.
const truncate = (s: string | null | undefined, n: number): string =>
  !s ? '' : (s && s.length > n ? `${s.slice(0, n - 1)}…` : s);

export const startOrderingFlow = async ({ tenant, waAccount, customer }: FlowContext): Promise<void> => {
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

const sendItemsForCategory = async ({ tenant, waAccount, customer, categoryId }: FlowContext & { categoryId: string }): Promise<void> => {
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

const askQuantity = async ({ waAccount, customer, item }: Omit<FlowContext, 'tenant'> & { item: MenuItem }): Promise<void> => {
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

// Per-line total, add-ons included. Single definition so the cart summary, the
// edit list and finalizeOrder can never disagree about what a line costs.
const lineTotalOf = (ci: CartLine): number =>
  (Number(ci.unitPrice) + ci.addons.reduce((s: number, a: { priceDelta: Prisma.Decimal }) => s + Number(a.priceDelta), 0)) * ci.quantity;

const loadCartItems = (cartId: string): Promise<CartLine[]> =>
  prisma.cartItem.findMany({
    where: { cartId },
    include: { item: true, addons: { include: { option: true } } },
    orderBy: { createdAt: 'asc' },
  });

const sendCartSummary = async ({ tenant, waAccount, customer, cart }: FlowContext & { cart: Cart }): Promise<void> => {
  const items = await loadCartItems(cart.id);
  if (!items.length) {
    await prisma.cart.update({
      where: { id: cart.id },
      data: { state: 'IDLE', context: {}, customerName: null, deliveryAddr: null, deliveryLat: null, deliveryLng: null },
    });
    await sendTextMessage({
      accessToken: waAccount.accessToken,
      phoneNumberId: waAccount.phoneNumberId,
      to: customer.waId,
      body: 'Your cart is empty. Type *Menu* to start.',
    });
    return;
  }
  const lines = items.map((ci: CartLine) => {
    const addonStr = ci.addons.map((a) => `+${a.option?.name ?? ''}`).join(', ');
    return `${ci.quantity}× ${ci.item.name}${addonStr ? ' (' + addonStr + ')' : ''} — ₹${lineTotalOf(ci).toFixed(2)}`;
  });
  const subtotal = items.reduce((s, ci) => s + lineTotalOf(ci), 0);
  const body = `*Cart*\n${lines.join('\n')}\n\nTotal: ₹${subtotal.toFixed(2)}`;

  // Meta allows a maximum of 3 reply buttons, so "Clear cart" moves inside the
  // edit list to make room for editing — the far more common need. Clearing is
  // still reachable, one tap deeper.
  await sendInteractiveButtons({
    accessToken: waAccount.accessToken,
    phoneNumberId: waAccount.phoneNumberId,
    to: customer.waId,
    body,
    buttons: [
      { id: 'cart:checkout', title: 'Checkout' },
      { id: 'cart:add_more', title: 'Add more' },
      { id: 'cart:edit', title: 'Edit cart' },
    ],
  });
  await prisma.cart.update({ where: { id: cart.id }, data: { state: 'REVIEWING_CART' } });
};

// Meta caps an interactive list at 10 rows in total, so 9 item rows leave room
// for the "Clear entire cart" row.
const MAX_EDIT_ROWS = 9;

const sendCartEditList = async ({ tenant, waAccount, customer, cart }: FlowContext & { cart: Cart }): Promise<void> => {
  const items = await loadCartItems(cart.id);
  if (!items.length) {
    await sendCartSummary({ tenant, waAccount, customer, cart });
    return;
  }

  const shown = items.slice(0, MAX_EDIT_ROWS);
  if (items.length > MAX_EDIT_ROWS) {
    logger.warn('Cart edit list truncated to Meta row limit', {
      cartId: cart.id,
      items: items.length,
      shown: shown.length,
    });
  }

  const rows = shown.map((ci: CartLine) => ({
    id: `edit:${ci.id}`,
    title: truncate(`${ci.quantity}× ${ci.item.name}`, 24),
    description: truncate(`₹${lineTotalOf(ci).toFixed(2)} — tap to change qty or remove`, 72),
  }));
  rows.push({ id: 'cart:clear', title: 'Clear entire cart', description: 'Remove everything and start over' });

  await sendInteractiveList({
    accessToken: waAccount.accessToken,
    phoneNumberId: waAccount.phoneNumberId,
    to: customer.waId,
    header: 'Edit cart',
    body:
      items.length > MAX_EDIT_ROWS
        ? `Showing the first ${MAX_EDIT_ROWS} of ${items.length} items. Pick one to change.`
        : 'Pick the item you want to change.',
    button: 'Choose item',
    sections: [{ title: 'Your items', rows }],
  });
};

// Quantity options as a list rather than buttons: buttons cap at 3 (which is why
// the add-to-cart step only offers 1/2/3), a list gives 1–9 plus Remove.
const sendItemQtyList = async ({ waAccount, customer, cartItem }: Omit<FlowContext, 'tenant'> & { cartItem: CartLine }): Promise<void> => {
  const rows = Array.from({ length: 9 }, (_, i) => ({
    id: `setqty:${cartItem.id}:${i + 1}`,
    title: `Set quantity to ${i + 1}`,
    description: `₹${((Number(cartItem.unitPrice) + cartItem.addons.reduce((s: number, a: { priceDelta: Prisma.Decimal }) => s + Number(a.priceDelta), 0)) * (i + 1)).toFixed(2)}`,
  }));
  rows.push({
    id: `removeitem:${cartItem.id}`,
    title: 'Remove from cart',
    description: `Take ${truncate(cartItem.item.name, 40)} out of the cart`,
  });

  await sendInteractiveList({
    accessToken: waAccount.accessToken,
    phoneNumberId: waAccount.phoneNumberId,
    to: customer.waId,
    header: truncate(cartItem.item.name, 60),
    body: `Currently ${cartItem.quantity} in your cart. What would you like instead?`,
    button: 'Choose',
    sections: [{ title: 'Quantity', rows }],
  });
};

// Ask for the delivery address with WhatsApp's native location picker, falling
// back to a plain text prompt. The fallback matters: `location_request_message`
// is unavailable on some accounts, and without it a failed send would strand the
// customer mid-checkout having already given their name.
const askForAddress = async ({ waAccount, customer }: Omit<FlowContext, 'tenant'>): Promise<void> => {
  try {
    await sendLocationRequest({
      accessToken: waAccount.accessToken,
      phoneNumberId: waAccount.phoneNumberId,
      to: customer.waId,
      body: 'Thanks. Now your *delivery address* — tap below to share your location, or just type it out.',
    });
  } catch (err: any) {
    logger.warn('Location request unavailable, asking for a typed address', {
      error: err.response?.data?.error?.message || err.message,
    });
    void await sendTextMessage({
      accessToken: waAccount.accessToken,
      phoneNumberId: waAccount.phoneNumberId,
      to: customer.waId,
      body: 'Thanks. Now share your *delivery address*.',
    });
  }
};

// Not every address needs a unit — a standalone house, a shop, an office block.
// Matched on the whole trimmed message so a real unit can't trip it.
const SKIP_WORDS = new Set(['skip', 'none', 'no', 'na', 'n/a', '-', 'nil']);

const askForUnitDetail = async ({ waAccount, customer, label }: Omit<FlowContext, 'tenant'> & { label: string }): Promise<void> => {
  const gotIt = label ? `Got it — *${label}*.` : 'Got your location.';
  void await sendTextMessage({
    accessToken: waAccount.accessToken,
    phoneNumberId: waAccount.phoneNumberId,
    to: customer.waId,
    body:
      `${gotIt}\n\nNow the *flat / tower / block* so our driver can find your door ` +
      `— for example "Flat 302, Tower 1".\n\nReply *skip* if it isn't needed.`,
  });
};

const finalizeOrder = async ({ tenant, waAccount, customer, cart }: FlowContext & { cart: Cart }): Promise<void> => {
  const items = await prisma.cartItem.findMany({
    where: { cartId: cart.id },
    include: { item: true, addons: { include: { option: true } } },
  });
  if (!items.length) return;

  let subtotal = 0;
  const orderItemsData = items.map((ci: CartLine) => {
    const lineTotal = lineTotalOf(ci);
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
          name: a.option?.name ?? '',
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
      deliveryLat: cart.deliveryLat,
      deliveryLng: cart.deliveryLng,
      contactPhone: customer.phone || customer.waId,
      subtotal,
      totalAmount: subtotal,
      items: { create: orderItemsData },
    },
  });

  await prisma.cartItemAddon.deleteMany({ where: { cartItem: { cartId: cart.id } } });
  await prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
  await prisma.cart.update({
    where: { id: cart.id },
    data: { state: 'IDLE', context: {}, customerName: null, deliveryAddr: null, deliveryLat: null, deliveryLng: null },
  });

  // The conversational receipt. Kept as a session message because it is the only
  // thing that carries the total — the ORDER_CREATED template takes just a name
  // and an order number, and its parameter list is fixed by Meta approval.
  await sendTextMessage({
    accessToken: waAccount.accessToken,
    phoneNumberId: waAccount.phoneNumberId,
    to: customer.waId,
    body: `Order #${order.orderNumber} placed! Total ₹${Number(subtotal).toFixed(2)}. We'll send updates here.`,
  });

  // An order placed over WhatsApp is still an order created, so it fires the same
  // trigger as one raised from the dashboard (`order.controller.ts`). Without
  // this a tenant's ORDER_CREATED template worked for orders their staff typed
  // in and silently did nothing for the ones their customers placed themselves.
  //
  // A tenant with no active ORDER_CREATED template is unaffected —
  // `dispatchOrderTemplate` returns early — so this adds a second message only
  // for tenants who deliberately configured one. It never throws (it logs its
  // own failures), so awaiting it cannot break the order that has already been
  // committed.
  await dispatchOrderTemplate(order.id, 'NEW');
};

// Main dispatch — interprets interactive payloads + free text by cart state.
export const handleOrderingFlow = async ({ tenant, waAccount, customer, cart, message }: FlowContext & {
  cart: Cart;
  message: InboundMessage;
}): Promise<void> => {
  const interactive = message.payload?.interactive;
  const replyId = interactive?.list_reply?.id || interactive?.button_reply?.id;
  const text = (message.body || '').trim();

  // Allow "menu" anywhere to restart.
  if (text && /^menu$/i.test(text)) {
    await startOrderingFlow({ tenant, waAccount, customer });
    return;
  }

  switch (cart.state) {
    case 'BROWSING_CATEGORY': {
      if (replyId?.startsWith('cat:')) {
        const categoryId = replyId.split(':')[1];
        await prisma.cart.update({
          where: { id: cart.id },
          data: { state: 'BROWSING_ITEMS', context: { categoryId } },
        });
        await sendItemsForCategory({ tenant, waAccount, customer, categoryId });
        return;
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
          data: { state: 'SELECTING_QUANTITY', context: { ...cartContext(cart), itemId } },
        });
        await askQuantity({ waAccount, customer, item });
        return;
      }
      break;
    }
    case 'SELECTING_QUANTITY': {
      if (replyId?.startsWith('qty:')) {
        const qty = parseInt(replyId.split(':')[1], 10);
        const itemId = cartContext(cart).itemId;
        const item = itemId ? await prisma.menuItem.findUnique({ where: { id: itemId } }) : null;
        if (!item) break;
        await prisma.cartItem.create({
          data: { cartId: cart.id, itemId: item.id, quantity: qty, unitPrice: item.basePrice },
        });
        await sendCartSummary({ tenant, waAccount, customer, cart });
        return;
      }
      break;
    }
    case 'REVIEWING_CART': {
      if (replyId === 'cart:checkout') {
        await prisma.cart.update({ where: { id: cart.id }, data: { state: 'COLLECTING_NAME' } });
        void await sendTextMessage({
          accessToken: waAccount.accessToken,
          phoneNumberId: waAccount.phoneNumberId,
          to: customer.waId,
          body: 'Please reply with your *name* for the order.',
        });
      }
      if (replyId === 'cart:add_more') {
        await prisma.cart.update({ where: { id: cart.id }, data: { state: 'BROWSING_CATEGORY' } });
        await startOrderingFlow({ tenant, waAccount, customer });
        return;
      }
      if (replyId === 'cart:clear') {
        await prisma.cartItemAddon.deleteMany({ where: { cartItem: { cartId: cart.id } } });
        await prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
        await prisma.cart.update({ where: { id: cart.id }, data: { state: 'IDLE', context: {} } });
        void await sendTextMessage({
          accessToken: waAccount.accessToken,
          phoneNumberId: waAccount.phoneNumberId,
          to: customer.waId,
          body: 'Cart cleared.',
        });
      }

      // ── Editing an existing line ──────────────────────────────────────────
      // The whole edit sub-flow stays in REVIEWING_CART: the customer is still
      // reviewing, and the reply-ID prefixes are unambiguous, so this needs no
      // new CartState values and therefore no migration.

      if (replyId === 'cart:edit') {
        await sendCartEditList({ tenant, waAccount, customer, cart });
        return;
      }

      if (replyId?.startsWith('edit:')) {
        const cartItemId = replyId.slice('edit:'.length);
        const cartItem = await prisma.cartItem.findFirst({
          where: { id: cartItemId, cartId: cart.id }, // scoped to this cart
          include: { item: true, addons: { include: { option: true } } },
        });
        if (!cartItem) return sendCartSummary({ tenant, waAccount, customer, cart });
        await sendItemQtyList({ waAccount, customer, cartItem });
        return;
      }

      if (replyId?.startsWith('setqty:')) {
        const [, cartItemId, rawQty] = replyId.split(':');
        const quantity = parseInt(rawQty, 10);
        if (!Number.isInteger(quantity) || quantity < 1) {
          await sendCartSummary({ tenant, waAccount, customer, cart });
          return;
        }
        // updateMany scopes by cartId, so a crafted id cannot touch another
        // customer's cart.
        const { count } = await prisma.cartItem.updateMany({
          where: { id: cartItemId, cartId: cart.id },
          data: { quantity },
        });
        if (!count) logger.warn('setqty for unknown cart item', { cartItemId, cartId: cart.id });
        await sendCartSummary({ tenant, waAccount, customer, cart });
        return;
      }

      if (replyId?.startsWith('removeitem:')) {
        const cartItemId = replyId.slice('removeitem:'.length);
        const owned = await prisma.cartItem.findFirst({ where: { id: cartItemId, cartId: cart.id } });
        if (owned) {
          await prisma.cartItemAddon.deleteMany({ where: { cartItemId: owned.id } });
          await prisma.cartItem.delete({ where: { id: owned.id } });
        }
        // sendCartSummary resets the cart to IDLE when the last line is removed.
        await sendCartSummary({ tenant, waAccount, customer, cart });
        return;
      }

      break;
    }
    case 'COLLECTING_NAME': {
      // A shared pin is not a name — re-prompt rather than storing the place label.
      if (message.payload?.location) break;
      if (text) {
        await prisma.cart.update({
          where: { id: cart.id },
          data: { state: 'COLLECTING_ADDRESS', customerName: text },
        });
        await askForAddress({ waAccount, customer });
        return;
      }
      break;
    }
    case 'COLLECTING_ADDRESS': {
      // Preferred: a pin from WhatsApp's native picker. A pin gets the driver to
      // the building — so we then ask for the flat/tower/block to get them to the
      // door, rather than placing the order straight away.
      const loc = message.payload?.location;
      if (loc && loc.latitude != null && loc.longitude != null) {
        const label = [loc.name, loc.address].filter(Boolean).join(', ') || null;
        await prisma.cart.update({
          where: { id: cart.id },
          data: {
            deliveryLat: loc.latitude,
            deliveryLng: loc.longitude,
            // Keep the readable label out of deliveryAddr until it is combined
            // with the unit details, so a half-finished address is never used.
            context: { ...cartContext(cart), pinLabel: label },
            state: 'COLLECTING_ADDRESS_DETAIL',
          },
        });
        await askForUnitDetail({ waAccount, customer, label: label ?? '' });
        return;
      }
      // Typed address still accepted, and taken as complete — someone who types
      // it out has already included whatever detail they wanted.
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
    case 'COLLECTING_ADDRESS_DETAIL': {
      const loc = message.payload?.location;
      // A second pin means they are correcting the first — replace and re-ask.
      if (loc && loc.latitude != null && loc.longitude != null) {
        const label = [loc.name, loc.address].filter(Boolean).join(', ') || null;
        await prisma.cart.update({
          where: { id: cart.id },
          data: {
            deliveryLat: loc.latitude,
            deliveryLng: loc.longitude,
            context: { ...cartContext(cart), pinLabel: label },
          },
        });
        await askForUnitDetail({ waAccount, customer, label: label ?? '' });
        return;
      }

      if (text) {
        const pinLabel = cartContext(cart).pinLabel || null;
        const coords = `${cart.deliveryLat}, ${cart.deliveryLng}`;
        const skipped = SKIP_WORDS.has(text.toLowerCase());

        // Unit first: it is the part the driver reads last and needs most.
        // The bare-coordinate string is only a last resort, since deliveryAddress
        // is non-null and the pin is already stored in its own columns.
        const composed = skipped
          ? (pinLabel || coords)
          : [text, pinLabel].filter(Boolean).join(' — ');

        const updated = await prisma.cart.update({
          where: { id: cart.id },
          data: { deliveryAddr: composed, state: 'CHECKOUT_READY' },
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
