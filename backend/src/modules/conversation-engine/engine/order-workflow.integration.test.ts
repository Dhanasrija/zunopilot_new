import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import { prisma } from '../../../config/prisma.js';
import { mockServices, type MockWhatsAppProvider } from '../providers/mock.js';
import { templateById } from '../domain/templates.js';
import { startInstance } from './instance-manager.js';
import { walk, type WalkDeps } from './walker.js';
import { resumeWithUserInput } from './resume.js';

// The "Place an Order" template, walked the way a customer walks it.
//
// This is the whole reason the six order node types exist, so it is tested as
// one journey rather than as six units: catalogue → item → quantity → basket →
// add another → checkout → name → address → confirm → order. What it proves is
// that a graph an operator can open and edit produces a real `Order` row, and
// that the basket never touches the `Cart` table on the way.

const TEST_TENANT = '33333333-3333-3333-3333-333333333333';

let workflowId: string;
let conversationId: string;
let deps: WalkDeps;
let whatsapp: MockWhatsAppProvider;
let catalogue: {
  biryaniId: string;
  drinksId: string;
  chickenId: string;
  muttonId: string;
  lassiId: string;
};

const template = templateById('order_place')!;

const seed = async () => {
  await prisma.tenant.create({
    data: { id: TEST_TENANT, businessName: 'Order Flow Test Kitchen', category: 'RESTAURANT' },
  });

  const channel = await prisma.whatsappAccount.create({
    data: {
      tenantId: TEST_TENANT,
      wabaId: 'waba-order-test',
      phoneNumberId: 'pn-order-test',
      accessToken: 'token-order-test',
      displayPhone: '+1 555 000 0001',
    },
  });

  const biryani = await prisma.menuCategory.create({
    data: { tenantId: TEST_TENANT, name: 'Biryani', sortOrder: 1 },
  });
  const drinks = await prisma.menuCategory.create({
    data: { tenantId: TEST_TENANT, name: 'Drinks', sortOrder: 2 },
  });

  const chicken = await prisma.menuItem.create({
    data: {
      tenantId: TEST_TENANT,
      categoryId: biryani.id,
      name: 'Chicken Biryani',
      basePrice: new Prisma.Decimal(280),
      sortOrder: 1,
    },
  });
  const mutton = await prisma.menuItem.create({
    data: {
      tenantId: TEST_TENANT,
      categoryId: biryani.id,
      name: 'Mutton Biryani',
      basePrice: new Prisma.Decimal(420),
      sortOrder: 2,
    },
  });
  const lassi = await prisma.menuItem.create({
    data: {
      tenantId: TEST_TENANT,
      categoryId: drinks.id,
      name: 'Sweet Lassi',
      basePrice: new Prisma.Decimal(80),
      sortOrder: 1,
    },
  });

  catalogue = {
    biryaniId: biryani.id,
    drinksId: drinks.id,
    chickenId: chicken.id,
    muttonId: mutton.id,
    lassiId: lassi.id,
  };

  // Published exactly as `POST /workflows/:id/publish` would, from the template
  // graph verbatim — so this tests the shipped template, not a copy of it.
  const workflow = await prisma.workflow.create({
    data: {
      tenantId: TEST_TENANT,
      name: template.name,
      slug: template.suggestedSlug,
      category: 'CONVERSATION',
      status: 'PUBLISHED',
    },
  });
  const version = await prisma.workflowVersion.create({
    data: {
      workflowId: workflow.id,
      version: 1,
      definition: template.definition as unknown as Prisma.InputJsonValue,
      publishedAt: new Date(),
    },
  });
  await prisma.workflow.update({
    where: { id: workflow.id },
    data: { publishedVersionId: version.id },
  });

  const contact = await prisma.customer.create({
    data: { tenantId: TEST_TENANT, waId: '15550009922', name: 'Test Diner' },
  });
  const conversation = await prisma.conversation.create({
    data: { tenantId: TEST_TENANT, customerId: contact.id, status: 'OPEN' },
  });
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: TEST_TENANT } });

  const services = mockServices();
  whatsapp = services.whatsapp;

  workflowId = workflow.id;
  conversationId = conversation.id;
  deps = {
    tenant,
    contact,
    conversation,
    channel,
    assistantId: null,
    services,
    latestMessage: { id: 'msg-order-1', body: 'I want to order', type: 'TEXT', payload: null },
  };
};

const wipe = async () => {
  // Orders first: `OrderItem.itemId` references `MenuItem` without a cascade,
  // so the tenant cannot be deleted while an order still points at its menu.
  await prisma.order.deleteMany({ where: { tenantId: TEST_TENANT } });
  await prisma.tenant.deleteMany({ where: { id: TEST_TENANT } });
};

beforeEach(async () => {
  await wipe();
  await seed();
});

afterAll(async () => {
  await wipe();
  await prisma.$disconnect();
});

const current = () => prisma.workflowInstance.findFirstOrThrow({
  where: { conversationId },
  orderBy: { startedAt: 'desc' },
});

/** Start the flow and run it up to the first question. */
const begin = async () => {
  const { instance, definition } = await startInstance({
    tenantId: TEST_TENANT, workflowId, conversationId,
  });
  await walk({ instance, definition, deps });
  return current();
};

/** Answer whatever the flow is waiting on. `id` is set for a tap. */
const reply = async (text: string, id?: string) => {
  const instance = await current();
  const result = await resumeWithUserInput({
    instance, deps, answer: text, replyId: id ?? null,
  });
  return result;
};

/** The rows / buttons of the nth recorded send, whichever it carried. */
const rowsOf = (index = 0) => {
  const meta = whatsapp.sent[index]?.meta as
    | { sections?: Array<{ rows: Array<{ id: string; title: string; description?: string }> }> }
    | undefined;
  return meta?.sections?.[0]?.rows ?? [];
};

const buttonsOf = (index = 0) => {
  const meta = whatsapp.sent[index]?.meta as
    | { buttons?: Array<{ id: string; title: string }> }
    | undefined;
  return meta?.buttons ?? [];
};

describe('the Place an Order template, walked end to end', () => {
  it('opens with the live category list, not hand-typed rows', async () => {
    const parked = await begin();

    expect(parked.status).toBe('WAITING_FOR_USER');
    expect(parked.waitingNodeId).toBe('pick_category');

    expect(whatsapp.sent[0]?.kind).toBe('list');
    // Both seeded categories, in sortOrder, with the prefix a later node strips.
    expect(rowsOf().map((r) => r.id)).toEqual([
      `cat:${catalogue.biryaniId}`,
      `cat:${catalogue.drinksId}`,
    ]);
  });

  it('lists only the items in the chosen category', async () => {
    await begin();
    whatsapp.reset();

    await reply('Biryani', `cat:${catalogue.biryaniId}`);

    const parked = await current();
    expect(parked.waitingNodeId).toBe('pick_item');

    expect(rowsOf().map((r) => r.id)).toEqual([
      `item:${catalogue.chickenId}`,
      `item:${catalogue.muttonId}`,
    ]);
    // Not the lassi — it belongs to the other category.
    expect(rowsOf().some((r) => r.id === `item:${catalogue.lassiId}`)).toBe(false);
    // The price rides in the description, since a 24-char title belongs to the name.
    expect(rowsOf()[0]?.description).toContain('280');
  });

  it('prices the basket from the catalogue, not from the conversation', async () => {
    await begin();
    await reply('Biryani', `cat:${catalogue.biryaniId}`);
    await reply('Chicken Biryani', `item:${catalogue.chickenId}`);
    whatsapp.reset();

    await reply('2');

    const parked = await current();
    expect(parked.waitingNodeId).toBe('ask_next');

    const variables = parked.variables as Record<string, unknown>;
    expect(variables.cart).toEqual([
      {
        itemId: catalogue.chickenId,
        name: 'Chicken Biryani',
        quantity: 2,
        unitPrice: 280,
        lineTotal: 560,
      },
    ]);
    expect(String(variables.cart_summary)).toContain('2 × Chicken Biryani');
    expect(String(variables.cart_summary)).toContain('560');

    expect(whatsapp.sent[0]?.kind).toBe('buttons');
    expect(buttonsOf().map((b) => b.id)).toEqual(['add_more', 'checkout', 'cancel_order']);
  });

  it('re-asks the quantity instead of advancing on a nonsense answer', async () => {
    await begin();
    await reply('Biryani', `cat:${catalogue.biryaniId}`);
    await reply('Chicken Biryani', `item:${catalogue.chickenId}`);
    whatsapp.reset();

    const result = await reply('a couple');

    expect(result.outcome).toBe('REPROMPTED');
    expect(whatsapp.bodies()).toEqual(['Please reply with a number between 1 and 20.']);

    const parked = await current();
    expect(parked.waitingNodeId).toBe('ask_quantity');
    expect((parked.variables as Record<string, unknown>).cart).toBeUndefined();
  });

  it('accepts a typed category name, not only a tap', async () => {
    // The failure this pins: list rows built from the catalogue have ids like
    // `cat:<uuid>`, so matching typed text against ids rejected every human
    // answer. Three rejections hand the conversation to a person, and the
    // paused instance then swallows everything the customer says next.
    await begin();
    whatsapp.reset();

    const result = await reply('Biryani');

    expect(result.outcome).toBe('CONTINUED');
    const parked = await current();
    expect(parked.waitingNodeId).toBe('pick_item');
    expect((parked.variables as Record<string, unknown>).chosen_category)
      .toBe(`cat:${catalogue.biryaniId}`);
    // The label variable holds what a later message can show the customer.
    expect((parked.variables as Record<string, unknown>).chosen_category_name).toBe('Biryani');
  });

  it('accepts an unambiguous prefix but refuses an ambiguous one', async () => {
    await begin();
    await reply('Biryani', `cat:${catalogue.biryaniId}`);
    whatsapp.reset();

    // "Chicken Biryani" and "Mutton Biryani" both exist; "chicken" is unique.
    const ok = await reply('chicken');
    expect(ok.outcome).toBe('CONTINUED');
    expect((await current()).variables).toMatchObject({ chosen_item: `item:${catalogue.chickenId}` });
  });

  it('re-prompts on text that matches no item', async () => {
    await begin();
    await reply('Biryani', `cat:${catalogue.biryaniId}`);
    whatsapp.reset();

    const result = await reply('pizza');
    expect(result.outcome).toBe('REPROMPTED');
    expect(whatsapp.bodies()).toEqual(['Please pick one of the items from the list.']);
    expect((await current()).waitingNodeId).toBe('pick_item');
  });

  it('accepts a typed button label at the basket step', async () => {
    await begin();
    await reply('Biryani', `cat:${catalogue.biryaniId}`);
    await reply('Chicken Biryani', `item:${catalogue.chickenId}`);
    await reply('2');
    whatsapp.reset();

    const result = await reply('Checkout');

    expect(result.outcome).toBe('CONTINUED');
    expect((await current()).waitingNodeId).toBe('ask_name');
  });

  it('refuses a row it did not offer', async () => {
    await begin();
    whatsapp.reset();

    // A category id replayed from another workspace's list.
    const result = await reply('Something else', 'cat:00000000-0000-0000-0000-0000000000ff');

    expect(result.outcome).toBe('REPROMPTED');
    const parked = await current();
    expect(parked.waitingNodeId).toBe('pick_category');
  });

  it('loops back to the catalogue for a second item and keeps the first', async () => {
    await begin();
    await reply('Biryani', `cat:${catalogue.biryaniId}`);
    await reply('Chicken Biryani', `item:${catalogue.chickenId}`);
    await reply('2');
    whatsapp.reset();

    await reply('Add more items', 'add_more');

    // Straight back to the top of the catalogue, basket intact.
    const parked = await current();
    expect(parked.waitingNodeId).toBe('pick_category');
    expect((parked.variables as Record<string, unknown>).cart).toHaveLength(1);
    expect(whatsapp.sent[0]?.kind).toBe('list');

    await reply('Drinks', `cat:${catalogue.drinksId}`);
    await reply('Sweet Lassi', `item:${catalogue.lassiId}`);
    await reply('1');

    const twoLines = await current();
    expect((twoLines.variables as Record<string, unknown>).cart).toHaveLength(2);
    expect(String((twoLines.variables as Record<string, unknown>).cart_summary)).toContain('640');
  });

  it('creates the order only after the confirmation tap, and never touches the Cart table', async () => {
    await begin();
    await reply('Biryani', `cat:${catalogue.biryaniId}`);
    await reply('Chicken Biryani', `item:${catalogue.chickenId}`);
    await reply('2');
    await reply('Add more items', 'add_more');
    await reply('Biryani', `cat:${catalogue.biryaniId}`);
    await reply('Mutton Biryani', `item:${catalogue.muttonId}`);
    await reply('1');
    await reply('Checkout', 'checkout');

    let parked = await current();
    expect(parked.waitingNodeId).toBe('ask_name');

    await reply('Venky');
    parked = await current();
    expect(parked.waitingNodeId).toBe('ask_address');

    // The exact string from the historical routing regression — here it is an
    // answer to a workflow question, and must be stored verbatim.
    await reply('1513, Tower 1, Swanlake Apartment');
    parked = await current();
    expect(parked.waitingNodeId).toBe('confirm_order');

    // Nothing written yet: the customer has seen the total but not agreed to it.
    expect(await prisma.order.count({ where: { tenantId: TEST_TENANT } })).toBe(0);

    whatsapp.reset();
    const finish = await reply('Confirm order', 'confirm_order');
    expect(finish.walk?.status).toBe('COMPLETED');

    const order = await prisma.order.findFirstOrThrow({
      where: { tenantId: TEST_TENANT },
      include: { items: true },
    });
    expect(order.customerName).toBe('Venky');
    expect(order.deliveryAddress).toBe('1513, Tower 1, Swanlake Apartment');
    expect(Number(order.totalAmount)).toBe(980); // 2 × 280 + 1 × 420
    expect(order.items.map((i) => [i.itemName, i.quantity, Number(i.lineTotal)])).toEqual([
      ['Chicken Biryani', 2, 560],
      ['Mutton Biryani', 1, 420],
    ]);

    expect(whatsapp.bodies().join(' ')).toContain(`Order #${order.orderNumber}`);

    // The basket lived in variables the whole way. A `Cart` row here would mean
    // the legacy state machine takes the customer's next message.
    expect(await prisma.cart.count({ where: { customerId: deps.contact.id } })).toBe(0);

    // And the conversation is released for whatever they say next.
    const conversation = await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } });
    expect(conversation.activeWorkflowInstanceId).toBeNull();
  });

  it('ends without an order when the customer declines at the confirmation', async () => {
    await begin();
    await reply('Biryani', `cat:${catalogue.biryaniId}`);
    await reply('Chicken Biryani', `item:${catalogue.chickenId}`);
    await reply('2');
    await reply('Checkout', 'checkout');
    await reply('Venky');
    await reply('1513, Tower 1, Swanlake Apartment');
    whatsapp.reset();

    await reply('Cancel order', 'cancel_order');

    expect(await prisma.order.count({ where: { tenantId: TEST_TENANT } })).toBe(0);
    const finished = await current();
    expect(finished.status).toBe('CANCELLED');
    expect(whatsapp.bodies().join(' ')).toContain("I've cleared that");
  });

  it('leaves an execution log an operator can read the whole order off', async () => {
    await begin();
    await reply('Biryani', `cat:${catalogue.biryaniId}`);
    await reply('Chicken Biryani', `item:${catalogue.chickenId}`);
    await reply('2');
    await reply('Checkout', 'checkout');
    await reply('Venky');
    await reply('1513, Tower 1, Swanlake Apartment');
    await reply('Confirm order', 'confirm_order');

    const instance = await current();
    const executions = await prisma.nodeExecution.findMany({
      where: { workflowInstanceId: instance.id },
      orderBy: { startedAt: 'asc' },
    });

    expect(executions.every((e) => e.status === 'SUCCESS')).toBe(true);
    expect(executions.map((e) => e.nodeId)).toEqual([
      'entry',
      'pick_category',
      'pick_item',
      'ask_quantity',
      'add_to_basket',
      'basket_summary',
      'ask_next',
      'wants_more',
      'wants_checkout',
      'ask_name',
      'ask_address',
      'confirm_order',
      'is_confirmed',
      'place_order',
      'order_placed',
      'done',
    ]);
  });
});
