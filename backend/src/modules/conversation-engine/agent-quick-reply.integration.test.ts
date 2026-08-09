import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import crypto from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { buildApp } from '../../app.js';
import type { WorkflowDefinition } from './domain/definition.js';
import { mockProviderFor } from './providers/whatsapp.js';
import { quickReplyButtonId } from './agent-reply-id.js';
import { signToken } from '../../utils/jwt.js';
import { seedMemberships } from '../../test-support/members.js';
import { seedDefaultRoles } from '../../services/role.service.js';

/*
 * A customer taps a button a human agent sent them.
 *
 * ── Why this file is almost entirely negative assertions ─────────────────────
 *
 * Because the feature's whole risk is that **something else answers first**. An inbound reply id
 * is a shared namespace: the ordering state machine dispatches on seven prefixes, a workflow node
 * matches ids it offered, an operator's BUTTON_PAYLOAD rule exact-matches literals, and the AI
 * router reads the button's title as if the customer had typed it. Every one of those is upstream
 * of, or adjacent to, an agent's button — and none of them fails loudly when it takes the wrong
 * message. They answer.
 *
 * Two of them do worse than answer. In `COLLECTING_NAME` and `COLLECTING_ADDRESS` the cart does not
 * look at the reply id at all: it takes the button's **title** as the customer's answer. So a tap on
 * an agent's "Delivery" button mid-checkout writes `Delivery` in as the delivery address on a real
 * order. That case has its own test and its own name below, because it is the one that costs money.
 *
 * So the shape here is: set up each thief, tap the button, and assert the thief did not move.
 *
 * ── What is real ─────────────────────────────────────────────────────────────
 *
 * Everything except pg-boss: the signed webhook, Express, Postgres, the claim, the message write,
 * the guard, the engine. The job is run by hand with the id the controller actually enqueued, so
 * the producer/consumer contract is asserted rather than assumed — the same arrangement as
 * `inbound-e2e.integration.test.ts`, which this borrows its harness from.
 */

const enqueued: Array<{ queue: string; data: unknown }> = [];

vi.mock('./jobs/queue.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./jobs/queue.js')>();
  return {
    ...actual,
    enqueue: async (queue: string, data: unknown) => {
      enqueued.push({ queue, data });
      return 'mock-job-id';
    },
  };
});

const { handleProcessInboundMessage } = await import('./jobs/handlers/process-inbound.js');

const app = buildApp();

const TENANT = 'eeeeeeee-0000-0000-0000-0000000000f1';
const PHONE_NUMBER_ID = 'pn-qr-inbound';
const CUSTOMER_WA_ID = '15550007777';

/** A workflow whose first act is to speak, so "it ran" is unambiguous evidence. */
const definition: WorkflowDefinition = {
  schemaVersion: '1.0',
  entryNodeId: 'entry',
  nodes: [
    { id: 'entry', type: 'ASSISTANT_ROUTE_ENTRY', position: { x: 0, y: 0 }, config: { acceptedIntents: [] } },
    {
      id: 'ask',
      type: 'SEND_WHATSAPP_MESSAGE',
      position: { x: 0, y: 1 },
      config: { body: 'Which day suits you?' },
    },
    { id: 'done', type: 'END_WORKFLOW', position: { x: 0, y: 2 }, config: { outcome: 'COMPLETED' } },
  ],
  edges: [
    { id: 'e1', source: 'entry', target: 'ask' },
    { id: 'e2', source: 'ask', target: 'done' },
  ],
};

let channelId: string;
let workflowId: string;
let assistantId: string;
let customerId: string;
let conversationId: string;
/** The button that starts a workflow, and the one that does not. */
let boundButtonId: string;
let plainButtonId: string;
/** For the round trip at the end, which sends through the real API before tapping. */
let ownerToken: string;

const wipe = async () => {
  await prisma.tenant.deleteMany({ where: { id: TENANT } });
  await prisma.webhookEvent.deleteMany({ where: { externalEventId: { contains: 'wamid.qr.' } } });
};

const seed = async () => {
  await prisma.tenant.create({
    data: { id: TENANT, businessName: 'Quick Reply Kitchen', category: 'RESTAURANT' },
  });

  const channel = await prisma.whatsappAccount.create({
    data: {
      tenantId: TENANT,
      wabaId: 'waba-qr',
      phoneNumberId: PHONE_NUMBER_ID,
      accessToken: 'token-qr',
      displayPhone: '+1 555 000 7777',
    },
  });
  channelId = channel.id;

  const workflow = await prisma.workflow.create({
    data: {
      tenantId: TENANT,
      name: 'Booking (quick reply)',
      slug: `booking_qr_${Date.now()}`,
      category: 'CONVERSATION',
      status: 'PUBLISHED',
    },
  });
  workflowId = workflow.id;

  const version = await prisma.workflowVersion.create({
    data: {
      workflowId: workflow.id,
      version: 1,
      definition: definition as unknown as Prisma.InputJsonValue,
      publishedAt: new Date(),
    },
  });
  await prisma.workflow.update({
    where: { id: workflow.id }, data: { publishedVersionId: version.id },
  });

  const assistant = await prisma.assistant.create({
    data: {
      tenantId: TENANT, whatsappChannelId: channel.id, name: 'QR Assistant', status: 'ACTIVE',
    },
  });
  assistantId = assistant.id;

  const set = await prisma.quickReply.create({
    data: {
      tenantId: TENANT,
      name: 'Book a slot',
      body: 'Would you like to book a slot?',
      buttons: {
        create: [
          { label: 'Yes, book', position: 0, workflowId: workflow.id },
          { label: 'Not now', position: 1 },
        ],
      },
    },
    include: { buttons: { orderBy: { position: 'asc' } } },
  });
  boundButtonId = set.buttons[0]!.id;
  plainButtonId = set.buttons[1]!.id;

  await seedDefaultRoles(prisma, TENANT);
  const ownerRole = await prisma.role.findFirstOrThrow({ where: { tenantId: TENANT, isOwner: true } });
  const owner = await prisma.user.create({
    data: { tenantId: TENANT, phone: '15558807001', fullName: 'Owner', role: 'OWNER', roleId: ownerRole.id },
  });
  await seedMemberships();
  ownerToken = signToken({ userId: owner.id, tenantId: TENANT });

  const customer = await prisma.customer.create({
    data: { tenantId: TENANT, waId: CUSTOMER_WA_ID, name: 'Asha' },
  });
  customerId = customer.id;
  const conversation = await prisma.conversation.create({
    data: {
      tenantId: TENANT,
      customerId: customer.id,
      assistantId: assistant.id,
      /*
       * **Live by default, and that is a decision about this file rather than about the product.**
       *
       * The realistic state is `HUMAN_TAKEOVER` — an agent who sends buttons is in a thread they
       * are handling. But `process-inbound` returns before routing for a paused conversation, so
       * seeding it that way makes every "something else steals the tap" test below pass with no
       * guard at all. The mutation check found exactly that: with `handleAgentQuickReply` disabled,
       * the two cart tests still passed.
       *
       * So the theft tests run against a live conversation where the theft is genuinely possible,
       * and the two tests that are actually *about* the takeover pause it themselves.
       */
      status: 'OPEN',
      automationPaused: false,
      lastMessageAt: new Date(),
    },
  });
  conversationId = conversation.id;
};

/** Meta's payload for a tap on a reply button, as it really arrives. */
const tapPayload = (wamid: string, replyId: string, title: string) => ({
  object: 'whatsapp_business_account',
  entry: [{
    id: 'waba-qr',
    changes: [{
      field: 'messages',
      value: {
        messaging_product: 'whatsapp',
        metadata: { display_phone_number: '15550007777', phone_number_id: PHONE_NUMBER_ID },
        contacts: [{ wa_id: CUSTOMER_WA_ID, profile: { name: 'Asha' } }],
        messages: [{
          id: wamid,
          from: CUSTOMER_WA_ID,
          type: 'interactive',
          interactive: { type: 'button_reply', button_reply: { id: replyId, title } },
          timestamp: '1785000000',
        }],
      },
    }],
  }],
});

/** The same, typed rather than tapped — for the property that pins the guard's scope. */
const textPayload = (wamid: string, text: string) => ({
  object: 'whatsapp_business_account',
  entry: [{
    id: 'waba-qr',
    changes: [{
      field: 'messages',
      value: {
        messaging_product: 'whatsapp',
        metadata: { display_phone_number: '15550007777', phone_number_id: PHONE_NUMBER_ID },
        contacts: [{ wa_id: CUSTOMER_WA_ID, profile: { name: 'Asha' } }],
        messages: [{
          id: wamid, from: CUSTOMER_WA_ID, type: 'text', text: { body: text }, timestamp: '1785000000',
        }],
      },
    }],
  }],
});

const deliver = async (body: unknown) => {
  const secret = process.env.META_APP_SECRET ?? '';
  expect(secret, 'META_APP_SECRET must be set — an unsigned webhook is refused').not.toBe('');
  const raw = JSON.stringify(body);
  return request(app)
    .post('/api/webhook')
    .set('Content-Type', 'application/json')
    .set('x-hub-signature-256', `sha256=${crypto.createHmac('sha256', secret).update(raw).digest('hex')}`)
    .send(raw);
};

const waitFor = async <T>(what: string, read: () => Promise<T | null>, timeoutMs = 5_000): Promise<T> => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    const value = await read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => { setTimeout(resolve, 25); });
  }
};

/**
 * Deliver a payload and run the job the controller enqueued for it.
 *
 * Named `deliverAndRun`, not `process` — a local `process` shadows Node's global inside every
 * helper below it, and `process.env.META_APP_SECRET` in `deliver` then reads a property off this
 * function. Every test failed with the same baffling message.
 */
const deliverAndRun = async (body: unknown, wamid: string) => {
  expect((await deliver(body)).status).toBe(200);
  const event = await waitFor(`the event for ${wamid}`, () => prisma.webhookEvent.findFirst({
    where: { externalEventId: { contains: wamid } },
  }));
  await waitFor('the job to be enqueued', async () => (enqueued.length ? enqueued : null));
  await handleProcessInboundMessage(enqueued[enqueued.length - 1]!.data as { webhookEventId: string });
  return prisma.webhookEvent.findUniqueOrThrow({ where: { id: event.id } });
};

/** Put the conversation in the state an agent handling it would leave it in. */
const takeOver = () => prisma.conversation.update({
  where: { id: conversationId },
  data: { automationPaused: true, status: 'HUMAN_TAKEOVER' },
});

const instances = () => prisma.workflowInstance.count({ where: { conversationId } });
const sent = () => mockProviderFor(channelId).sent;

beforeEach(async () => {
  await wipe();
  enqueued.length = 0;
  await seed();
  mockProviderFor(channelId).reset();
});

afterAll(async () => {
  await wipe();
  await prisma.$disconnect();
});

describe('a tap on a button with nothing bound to it', () => {
  it('**lands in the thread as the customer’s own words, and starts nothing**', async () => {
    const event = await deliverAndRun(
      tapPayload('wamid.qr.1', quickReplyButtonId(plainButtonId), 'Not now'), 'wamid.qr.1',
    );

    expect(event.processingStatus).toBe('PROCESSED');

    const message = await prisma.message.findFirstOrThrow({
      where: { tenantId: TENANT, waMessageId: 'wamid.qr.1' },
    });
    expect(message.direction).toBe('INBOUND');
    expect(message.type).toBe('INTERACTIVE');
    // The label, which is what the agent will read in the Inbox. Indistinguishable from the
    // customer having typed it, which is the whole point of an unbound button.
    expect(message.body).toBe('Not now');

    expect(await instances()).toBe(0);
    // Nothing was said back. A bot replying to an answer meant for the agent is the failure this
    // feature has to avoid.
    expect(sent()).toHaveLength(0);
  });

  it('leaves the conversation with the agent', async () => {
    // The takeover is untouched: only a *bound* button hands the thread back, and this is not one.
    await takeOver();
    await deliverAndRun(tapPayload('wamid.qr.2', quickReplyButtonId(plainButtonId), 'Not now'), 'wamid.qr.2');

    const conversation = await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } });
    expect(conversation.automationPaused).toBe(true);
    expect(conversation.status).toBe('HUMAN_TAKEOVER');
  });

  it('**is not stolen by a cart that is mid-order**', async () => {
    /*
     * Without the guard: routing Step 0 hands any message to the ordering FSM while the cart is
     * not IDLE, the id matches none of its seven prefixes, and the customer is told "Sorry, I
     * expected a selection. Type *Menu* to restart" — the bot contradicting the agent in the same
     * thread.
     */
    await prisma.cart.create({
      data: { customerId, tenantId: TENANT, state: 'REVIEWING_CART' },
    });

    await deliverAndRun(tapPayload('wamid.qr.3', quickReplyButtonId(plainButtonId), 'Not now'), 'wamid.qr.3');

    const cart = await prisma.cart.findUniqueOrThrow({ where: { customerId } });
    expect(cart.state).toBe('REVIEWING_CART');
    expect(sent()).toHaveLength(0);
  });

  it('**does not become the delivery address**', async () => {
    /*
     * The one that costs money, and the reason the guard is where it is.
     *
     * In `COLLECTING_ADDRESS` the ordering FSM ignores the reply id entirely and takes the message
     * **text** — which for a tap is the button's title. So without the guard, a customer answering
     * the agent's "Delivery or pickup?" would have `Delivery` written in as the address on a real
     * order, and the cart would advance toward checkout on the strength of it.
     */
    await prisma.cart.create({
      data: { customerId, tenantId: TENANT, state: 'COLLECTING_ADDRESS', customerName: 'Asha' },
    });

    await deliverAndRun(tapPayload('wamid.qr.4', quickReplyButtonId(plainButtonId), 'Delivery'), 'wamid.qr.4');

    const cart = await prisma.cart.findUniqueOrThrow({ where: { customerId } });
    expect(cart.deliveryAddr).toBeNull();
    expect(cart.state).toBe('COLLECTING_ADDRESS');
  });

  it('**is not stolen by an operator’s rule that names the very id**', async () => {
    // Adversarial and cheap. A uuid will not be typed into a rule by accident, but this pins the
    // guard above `matchDeterministicRule` so nobody can reorder them later without noticing.
    await prisma.routingRule.create({
      data: {
        assistantId,
        name: 'Steal it',
        type: 'BUTTON_PAYLOAD',
        workflowId,
        configuration: { payloads: [quickReplyButtonId(plainButtonId)] },
        priority: 100,
      },
    });

    await deliverAndRun(tapPayload('wamid.qr.5', quickReplyButtonId(plainButtonId), 'Not now'), 'wamid.qr.5');

    expect(await instances()).toBe(0);
    expect(sent()).toHaveLength(0);
  });
});

describe('a tap on a button bound to a workflow', () => {
  it('**starts it, and hands the conversation back to the bot**', async () => {
    /*
     * From `HUMAN_TAKEOVER`, which is the normal case: an agent who offers a button is in a thread
     * they are handling. Handing it back is deliberate — a workflow started into a paused
     * conversation would be deaf, because the customer's next message hits the same early return
     * and the instance waits forever. The composer says so in words before Send.
     */
    await takeOver();

    await deliverAndRun(
      tapPayload('wamid.qr.6', quickReplyButtonId(boundButtonId), 'Yes, book'), 'wamid.qr.6',
    );

    const conversation = await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } });
    expect(conversation.automationPaused).toBe(false);
    expect(conversation.status).toBe('OPEN');

    expect(await instances()).toBe(1);
    // The workflow spoke, which is the unambiguous evidence that the walker ran.
    expect(sent().map((m) => m.body)).toContain('Which day suits you?');
  });

  it('records the decision as a deterministic one an operator can recognise', async () => {
    await deliverAndRun(
      tapPayload('wamid.qr.7', quickReplyButtonId(boundButtonId), 'Yes, book'), 'wamid.qr.7',
    );

    const decision = await prisma.routingDecision.findFirstOrThrow({ where: { conversationId } });
    // Not a new RoutingSource value: an exact id match with no model involved *is* deterministic,
    // and `reasonCode` is what tells the timeline which mechanism it was.
    expect(decision.source).toBe('DETERMINISTIC');
    expect(decision.reasonCode).toBe('AGENT_QUICK_REPLY');
    expect(decision.selectedWorkflowId).toBe(workflowId);
  });

  it('**will not start a workflow that has been unpublished**', async () => {
    /*
     * The binding survives an unpublish — `workflowId` is only cleared on delete — so a workspace
     * that pauses a workflow while leaving the button in an agent's list would otherwise be
     * starting a draft on a live customer.
     */
    await prisma.workflow.update({ where: { id: workflowId }, data: { status: 'DRAFT' } });

    await deliverAndRun(
      tapPayload('wamid.qr.8', quickReplyButtonId(boundButtonId), 'Yes, book'), 'wamid.qr.8',
    );

    expect(await instances()).toBe(0);
    // Nothing was said either: the tap is the agent's to answer.
    expect(sent()).toHaveLength(0);
  });

  it('handles a tap on a button that has since been deleted', async () => {
    // The prefix is proof we sent it. The one thing that must not happen is the ordering flow or
    // the router being handed it as a consolation prize.
    await prisma.quickReplyButton.delete({ where: { id: boundButtonId } });

    const event = await deliverAndRun(
      tapPayload('wamid.qr.9', quickReplyButtonId(boundButtonId), 'Yes, book'), 'wamid.qr.9',
    );

    expect(event.processingStatus).toBe('PROCESSED');
    expect(await instances()).toBe(0);
    expect(sent()).toHaveLength(0);
  });

  it('**belongs to one workspace only**', async () => {
    /*
     * A reply id arrives from the outside world. Nothing but this lookup proves the button belongs
     * to the workspace the conversation is in, and a tenant-blind `findUnique` would let a button
     * id learned anywhere start a workflow in somebody else's workspace.
     */
    const other = await prisma.tenant.create({
      data: { id: 'eeeeeeee-0000-0000-0000-0000000000f2', businessName: 'Not Yours', category: 'RESTAURANT' },
    });
    try {
      const stranger = await prisma.quickReply.create({
        data: {
          tenantId: other.id,
          name: 'Theirs',
          body: 'Theirs',
          buttons: { create: [{ label: 'Tap', position: 0 }] },
        },
        include: { buttons: true },
      });

      await deliverAndRun(
        tapPayload('wamid.qr.10', quickReplyButtonId(stranger.buttons[0]!.id), 'Tap'), 'wamid.qr.10',
      );

      // Unresolvable *in this workspace*, so recorded and nothing else — never resolved against
      // the other workspace's row.
      expect(await instances()).toBe(0);
      expect(sent()).toHaveLength(0);
    } finally {
      await prisma.tenant.deleteMany({ where: { id: other.id } });
    }
  });
});

describe('what the guard deliberately does not cover', () => {
  it('**a typed answer is still routed as it always was**', async () => {
    /*
     * Pins the scope. Widening the guard to catch the *title* as well would mean remembering "an
     * agent is awaiting an answer" on the conversation — which is auto-pause under another name,
     * with all its coverage problems. A typed message is indistinguishable from any other typed
     * message, and that is the reason the buttons exist.
     *
     * Asserted through the takeover: the message is recorded and nothing runs, exactly as any typed
     * message into a taken-over thread behaves. The guard did not touch it.
     */
    const event = await deliverAndRun(textPayload('wamid.qr.11', 'not now'), 'wamid.qr.11');

    expect(event.processingStatus).toBe('PROCESSED');
    const message = await prisma.message.findFirstOrThrow({
      where: { tenantId: TENANT, waMessageId: 'wamid.qr.11' },
    });
    expect(message.type).toBe('TEXT');

    /*
     * **A decision was recorded**, which is the positive evidence that routing ran.
     *
     * Asserting "nothing started" instead would pass whether the guard let the message through or
     * swallowed it — the two outcomes look identical from outside. This one only holds if the chain
     * really saw it.
     */
    const decisions = await prisma.routingDecision.findMany({ where: { conversationId } });
    expect(decisions.length).toBeGreaterThan(0);
    expect(decisions.every((d) => d.reasonCode !== 'AGENT_QUICK_REPLY')).toBe(true);
  });

  it('**withdrawing consent still wins over an outstanding question**', async () => {
    // STOP outranks everything, which is why the consent check stays above the guard.
    await deliverAndRun(textPayload('wamid.qr.12', 'STOP'), 'wamid.qr.12');

    const customer = await prisma.customer.findUniqueOrThrow({ where: { id: customerId } });
    expect(customer.optedOutAt).not.toBeNull();
  });
});

describe('the whole round trip', () => {
  it('**an agent sends a set through the API, and the tap on it starts the workflow**', async () => {
    /*
     * The two halves joined, because each is convincing on its own and neither proves they agree.
     * Everything above hand-crafts the reply id from a row; this one takes the id **the send
     * actually put on the wire** and feeds it back through a signed webhook.
     *
     * The failure it exists to catch is the quiet one: a send that mints its own ids, or a mirror
     * that records different ones. The pills would still look right in the thread and every tap
     * would stop resolving.
     */
    // The window has to be open, so the customer must have written first.
    await prisma.message.create({
      data: {
        tenantId: TENANT,
        conversationId,
        customerId,
        direction: 'INBOUND',
        type: 'TEXT',
        status: 'RECEIVED',
        body: 'Hello',
        createdAt: new Date(Date.now() - 60 * 60 * 1000),
      },
    });
    const set = await prisma.quickReply.findFirstOrThrow({ where: { tenantId: TENANT } });

    const sendRes = await request(app)
      .post(`/api/inbox/conversations/${conversationId}/quick-reply`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ quickReplyId: set.id })
      .expect(201);

    // Read the id off what was recorded, not off the row — that is the point.
    const offered = (sendRes.body.data.payload as {
      outbound: { options: { id: string; title: string }[] };
    }).outbound.options;
    const yes = offered.find((o) => o.title === 'Yes, book')!;
    expect(yes).toBeDefined();

    await deliverAndRun(tapPayload('wamid.qr.20', yes.id, yes.title), 'wamid.qr.20');

    expect(await instances()).toBe(1);
    expect(sent().map((m) => m.body)).toContain('Which day suits you?');
  });
});
