import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import { prisma } from '../../../config/prisma.js';
import { templateById } from '../domain/templates.js';
import { publishedOrderingWorkflow } from './index.js';

// Which journey an ordering intent goes down.
//
// `GENERAL_RESPONSE` can return the `SHOW_MENU` sentinel when a customer asks
// about the menu, and it used to call the legacy cart FSM unconditionally. So
// "show me the menu" and "I want to place an order" took two different journeys
// on the same tenant, and editing the order workflow only changed one of them.
//
// The fix picks the published order workflow when there is one. These tests pin
// the selection, because it is the part with a wrong answer available: a draft
// someone is still building must never start answering customers, and a
// published workflow that has nothing to do with ordering must never be
// mistaken for one.

const TEST_TENANT = '77777777-7777-7777-7777-777777777777';

let assistantId: string;

const template = templateById('order_place')!;
const faqTemplate = templateById('faq_escalation')!;

/** Publish a definition the way `POST /workflows/:id/publish` would. */
const publish = async (args: {
  name: string;
  slug: string;
  definition: unknown;
  priority?: number;
  status?: 'PUBLISHED' | 'DRAFT';
}) => {
  const workflow = await prisma.workflow.create({
    data: {
      tenantId: TEST_TENANT,
      assistantId,
      name: args.name,
      slug: args.slug,
      category: 'CONVERSATION',
      status: args.status ?? 'PUBLISHED',
      priority: args.priority ?? 50,
    },
  });
  const version = await prisma.workflowVersion.create({
    data: {
      workflowId: workflow.id,
      version: 1,
      definition: args.definition as Prisma.InputJsonValue,
      publishedAt: new Date(),
    },
  });

  // A DRAFT deliberately keeps `publishedVersionId` null — that is exactly the
  // state the selection has to refuse.
  if ((args.status ?? 'PUBLISHED') === 'PUBLISHED') {
    await prisma.workflow.update({
      where: { id: workflow.id },
      data: { publishedVersionId: version.id },
    });
  }

  return workflow.id;
};

const seed = async () => {
  await prisma.tenant.create({
    data: { id: TEST_TENANT, businessName: 'Ordering Intent Test', category: 'RESTAURANT' },
  });

  const channel = await prisma.whatsappAccount.create({
    data: {
      tenantId: TEST_TENANT,
      wabaId: 'waba-ordering-intent',
      phoneNumberId: 'pn-ordering-intent',
      accessToken: 'mock-token-ordering-intent',
      displayPhone: '+1 555 000 0077',
    },
  });

  const assistant = await prisma.assistant.create({
    data: { tenantId: TEST_TENANT, whatsappChannelId: channel.id, name: 'Ordering Intent Assistant' },
  });
  assistantId = assistant.id;
};

const wipe = async () => {
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

describe('choosing the journey for an ordering intent', () => {
  it('has nothing to offer a workspace with no workflows, so the FSM still handles it', async () => {
    expect(await publishedOrderingWorkflow(assistantId)).toBeNull();
  });

  it('picks the published order workflow', async () => {
    const workflowId = await publish({
      name: template.name,
      slug: template.suggestedSlug,
      definition: template.definition,
    });

    expect(await publishedOrderingWorkflow(assistantId)).toBe(workflowId);
  });

  it('refuses a draft — an unpublished graph must not start answering customers', async () => {
    await publish({
      name: template.name,
      slug: template.suggestedSlug,
      definition: template.definition,
      status: 'DRAFT',
    });

    expect(await publishedOrderingWorkflow(assistantId)).toBeNull();
  });

  it('does not mistake an unrelated published workflow for an ordering one', async () => {
    await publish({
      name: faqTemplate.name,
      slug: faqTemplate.suggestedSlug,
      definition: faqTemplate.definition,
    });

    expect(await publishedOrderingWorkflow(assistantId)).toBeNull();
  });

  it('breaks a tie on priority, the same way the router does', async () => {
    await publish({
      name: 'Old order flow',
      slug: 'order_place_old',
      definition: template.definition,
      priority: 10,
    });
    const preferred = await publish({
      name: 'Current order flow',
      slug: 'order_place_current',
      definition: template.definition,
      priority: 90,
    });

    expect(await publishedOrderingWorkflow(assistantId)).toBe(preferred);
  });

  it('recognises a hand-built flow that only hands off to the FSM', async () => {
    // `START_ORDERING` is the other way a graph can own ordering — the two-node
    // handoff the template used to be. Someone still running that shape must get
    // their workflow, not have it bypassed.
    const workflowId = await publish({
      name: 'Handoff to cart',
      slug: 'order_handoff',
      definition: {
        nodes: [
          { id: 'entry', type: 'ASSISTANT_ROUTE_ENTRY', config: {}, position: { x: 0, y: 0 }, name: 'Entry' },
          { id: 'hand', type: 'START_ORDERING', config: {}, position: { x: 0, y: 90 }, name: 'Start ordering' },
        ],
        edges: [{ id: 'entry->hand', source: 'entry', target: 'hand' }],
      },
    });

    expect(await publishedOrderingWorkflow(assistantId)).toBe(workflowId);
  });
});
