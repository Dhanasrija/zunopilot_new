import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import crypto from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { buildApp } from '../../app.js';
import type { WorkflowDefinition } from './domain/definition.js';
import { mockProviderFor } from './providers/whatsapp.js';

/*
 * One customer message, from Meta's HTTP request to the reply that goes back out.
 *
 * **Every link in this chain was already tested; the joins between them were not.** The
 * webhook route had security tests only — signature, verify handshake, unknown
 * `phone_number_id`. Payload parsing was a unit test. `handleProcessInboundMessage` was tested
 * against `WebhookEvent` rows a fixture had written by hand. The engine was entered at
 * `startInstance()`. So four suites each proved their own middle, and nothing proved that what
 * one hands over is what the next accepts.
 *
 * That is not a theoretical gap. The seams here are exactly where the shapes are easy to get
 * wrong: the controller writes a `payload` JSON blob that `payloadOf` has to recognise, it
 * enqueues a `{ webhookEventId }` the handler has to accept, and the handler builds the
 * `interactive` shape the ordering state machine reads. A rename on either side of any of those
 * passes both suites and breaks the product.
 *
 * ── What is real here, and the one thing that is not ─────────────────────────
 *
 * Real: the Express app and its middleware, HMAC verification against the raw body, Postgres,
 * the `WebhookEvent` write, the advisory-lock claim, contact and conversation resolution, the
 * message write, the routing chain, the workflow engine, and the walker.
 *
 * Mocked: **pg-boss, and only pg-boss.** The controller answers Meta and then continues
 * asynchronously, so a real queue would put a poll interval between the request and the reply
 * and make this test a race. Instead `enqueue` is captured and the job is then run by hand
 * **with the id the controller actually enqueued** — so the producer/consumer contract is still
 * asserted rather than assumed. Nothing else is stubbed; WhatsApp and the LLM are already the
 * mock adapters `env.ts` forces under NODE_ENV=test.
 *
 * The route chosen is the deterministic one (a KEYWORD rule, step 2 of the router). The AI step
 * has its own suite; putting a model in the middle of a chain test would mean a failure here
 * could be a routing regression or a plumbing regression, and the point of this file is to tell
 * those apart.
 */

/** Every `enqueue` the controller makes, in order. Filled by the mock below. */
const enqueued: Array<{ queue: string; data: unknown }> = [];

vi.mock('./jobs/queue.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./jobs/queue.js')>();
  return {
    ...actual,
    // Capture instead of connecting. `QUEUES`, the payload types and everything else stay real,
    // so the queue *name* the controller picks is still the real constant.
    enqueue: async (queue: string, data: unknown) => {
      enqueued.push({ queue, data });
      return 'mock-job-id';
    },
  };
});

// Imported after the mock so the handler's own `enqueue` import is the captured one.
const { handleProcessInboundMessage } = await import('./jobs/handlers/process-inbound.js');
const { QUEUES } = await import('./jobs/queue.js');

const app = buildApp();

const TENANT = 'eeeeeeee-0000-0000-0000-0000000000e1';
const PHONE_NUMBER_ID = 'pn-e2e-inbound';
const CUSTOMER_WA_ID = '15550004321';

/**
 * A workflow whose first act is to speak.
 *
 * `SEND_WHATSAPP_MESSAGE` straight after the entry node is deliberate: it means the outbound
 * message recorded by the mock provider is unambiguous evidence that the walker ran, rather
 * than something the router could have emitted on its own.
 */
const definition: WorkflowDefinition = {
  schemaVersion: '1.0',
  entryNodeId: 'entry',
  nodes: [
    { id: 'entry', type: 'ASSISTANT_ROUTE_ENTRY', position: { x: 0, y: 0 }, config: { acceptedIntents: [] } },
    {
      id: 'confirm',
      type: 'SEND_WHATSAPP_MESSAGE',
      position: { x: 0, y: 1 },
      config: { body: 'Your order is out for delivery.' },
    },
    { id: 'done', type: 'END_WORKFLOW', position: { x: 0, y: 2 }, config: { outcome: 'COMPLETED' } },
  ],
  edges: [
    { id: 'e1', source: 'entry', target: 'confirm' },
    { id: 'e2', source: 'confirm', target: 'done' },
  ],
};

let channelId: string;

const wipe = () => prisma.tenant.deleteMany({ where: { id: TENANT } });

const seed = async () => {
  await prisma.tenant.create({
    data: { id: TENANT, businessName: 'E2E Kitchen', category: 'RESTAURANT' },
  });

  const channel = await prisma.whatsappAccount.create({
    data: {
      tenantId: TENANT,
      wabaId: 'waba-e2e',
      phoneNumberId: PHONE_NUMBER_ID,
      accessToken: 'token-e2e',
      displayPhone: '+1 555 000 4321',
    },
  });
  channelId = channel.id;

  const workflow = await prisma.workflow.create({
    data: {
      tenantId: TENANT,
      name: 'Order tracking (e2e)',
      slug: `order_tracking_e2e_${Date.now()}`,
      category: 'CONVERSATION',
      status: 'PUBLISHED',
    },
  });

  const version = await prisma.workflowVersion.create({
    data: {
      workflowId: workflow.id,
      version: 1,
      definition: definition as unknown as Prisma.InputJsonValue,
      publishedAt: new Date(),
    },
  });
  await prisma.workflow.update({
    where: { id: workflow.id },
    data: { publishedVersionId: version.id },
  });

  const assistant = await prisma.assistant.create({
    data: {
      tenantId: TENANT,
      whatsappChannelId: channel.id,
      name: 'E2E Assistant',
      status: 'ACTIVE',
    },
  });

  // Step 2 of the router. No model is consulted for this message.
  await prisma.routingRule.create({
    data: {
      assistantId: assistant.id,
      name: 'Track an order',
      type: 'KEYWORD',
      workflowId: workflow.id,
      // `word`, not `contains` — the enum is ['whole','word'] and a bad value is swallowed by
      // the matcher's try/catch, so a typo here makes the rule silently never fire and the
      // message falls through to the AI router. Which is exactly what happened first time.
      configuration: { keywords: ['track'], match: 'word', caseSensitive: false },
      priority: 100,
    },
  });
};

/** Meta's payload for one inbound text, as it really arrives. */
const inboundPayload = (wamid: string, text: string) => ({
  object: 'whatsapp_business_account',
  entry: [{
    id: 'waba-e2e',
    changes: [{
      field: 'messages',
      value: {
        messaging_product: 'whatsapp',
        metadata: { display_phone_number: '15550004321', phone_number_id: PHONE_NUMBER_ID },
        contacts: [{ wa_id: CUSTOMER_WA_ID, profile: { name: 'Asha' } }],
        messages: [{
          id: wamid,
          from: CUSTOMER_WA_ID,
          type: 'text',
          text: { body: text },
          timestamp: '1785000000',
        }],
      },
    }],
  }],
});

/** POST it the way Meta does: raw body, HMAC over those exact bytes. */
const deliver = async (body: unknown) => {
  const secret = process.env.META_APP_SECRET ?? '';
  // Guarded rather than skipped. A skipped chain test is indistinguishable from a passing one
  // in a summary, and this is the file that is supposed to notice when the chain breaks.
  expect(
    secret,
    'META_APP_SECRET must be set for this suite — an unsigned webhook is refused, so without '
    + 'it nothing reaches the pipeline and every assertion below would fail obscurely.',
  ).not.toBe('');

  const raw = JSON.stringify(body);
  return request(app)
    .post('/api/webhook')
    .set('Content-Type', 'application/json')
    .set('x-hub-signature-256', `sha256=${crypto.createHmac('sha256', secret).update(raw).digest('hex')}`)
    .send(raw);
};

/**
 * Wait for the controller's post-response work.
 *
 * `receiveWebhook` sends 200 and *then* persists and enqueues, so supertest resolving proves
 * nothing about the write. Polling rather than a fixed sleep: a fixed sleep is either flaky on a
 * slow machine or wasted time on a fast one.
 */
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

const eventFor = (wamid: string) => () => prisma.webhookEvent.findFirst({
  where: { externalEventId: { contains: wamid } },
});

beforeEach(async () => {
  await wipe();
  enqueued.length = 0;
  await seed();
  mockProviderFor(channelId).reset();
  // WebhookEvent has no tenant FK, so wiping the tenant does not take it with it.
  await prisma.webhookEvent.deleteMany({ where: { externalEventId: { contains: 'wamid.e2e.' } } });
});

afterAll(async () => {
  await wipe();
  await prisma.webhookEvent.deleteMany({ where: { externalEventId: { contains: 'wamid.e2e.' } } });
  await prisma.$disconnect();
});

describe('a customer message, from Meta’s POST to the reply', () => {
  it('**runs the whole chain: signed webhook → event → job → router → engine → outbound send**', async () => {
    const res = await deliver(inboundPayload('wamid.e2e.1', 'track my order please'));
    // Meta is acked immediately; the work continues behind the response.
    expect(res.status).toBe(200);

    // ── Link 1: the controller persisted the event ───────────────────────────
    const event = await waitFor('the webhook event to be recorded', eventFor('wamid.e2e.1'));
    expect(event.processingStatus).toBe('PENDING');

    // ── Link 2: and enqueued exactly that event, on the real queue name ──────
    //
    // This is the producer/consumer contract, and the reason the queue is captured rather than
    // bypassed: the id below is the one the controller chose, not one the test invented.
    await waitFor('the job to be enqueued', async () => (enqueued.length ? enqueued : null));
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0].queue).toBe(QUEUES.processInboundMessage);
    expect(enqueued[0].data).toEqual({ webhookEventId: event.id });

    // ── Link 3: the handler accepts that payload and drains it ───────────────
    await handleProcessInboundMessage(enqueued[0].data as { webhookEventId: string });

    expect((await prisma.webhookEvent.findUniqueOrThrow({ where: { id: event.id } })).processingStatus)
      .toBe('PROCESSED');

    // ── Link 4: the contact and conversation exist, built from the payload ───
    const contact = await prisma.customer.findUniqueOrThrow({
      where: { tenantId_waId: { tenantId: TENANT, waId: CUSTOMER_WA_ID } },
    });
    /*
     * Taken from `contacts[].profile.name`, which is a field only the real normaliser reads.
     *
     * `waProfileName`, and this assertion used to name `name` instead. That single column held
     * both WhatsApp's profile name and the operator's own label, and the upsert overwrote it on
     * every message — see "the customer's two names" below for what that cost.
     */
    expect(contact.waProfileName).toBe('Asha');

    const conversation = await prisma.conversation.findFirstOrThrow({
      where: { tenantId: TENANT, customerId: contact.id },
    });

    // ── Link 5: the inbound message was stored against it ────────────────────
    const inbound = await prisma.message.findFirstOrThrow({
      where: { tenantId: TENANT, waMessageId: 'wamid.e2e.1' },
    });
    expect(inbound.direction).toBe('INBOUND');
    expect(inbound.body).toBe('track my order please');
    expect(inbound.conversationId).toBe(conversation.id);

    // ── Link 6: the keyword rule started the workflow and pinned it ──────────
    const instance = await prisma.workflowInstance.findFirstOrThrow({
      where: { conversationId: conversation.id },
    });
    expect(instance.status).toBe('COMPLETED');

    // ── Link 7: and the reply actually went out ──────────────────────────────
    //
    // The payoff. Nothing before this file asserted that a message arriving at the HTTP door
    // produces a message leaving through the sender.
    const sent = mockProviderFor(channelId).sent;
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      to: CUSTOMER_WA_ID,
      kind: 'text',
      body: 'Your order is out for delivery.',
    });
  });

  it('**a redelivery of the same message does not answer the customer twice**', async () => {
    /*
     * Meta retries any webhook it does not see a 200 for quickly enough, and it retries with the
     * same `wamid`. Two defences exist and they live on opposite sides of the seam: the
     * `WebhookEvent` unique index in the controller, and the wamid check in `persistMessage` for
     * a pg-boss retry that got past it. Neither suite can show the customer only hears once,
     * because that is a property of the two together.
     */
    await deliver(inboundPayload('wamid.e2e.2', 'track my order'));
    const event = await waitFor('the first delivery', eventFor('wamid.e2e.2'));
    await waitFor('the first enqueue', async () => (enqueued.length ? enqueued : null));
    await handleProcessInboundMessage({ webhookEventId: event.id });

    expect(mockProviderFor(channelId).sent).toHaveLength(1);

    // The identical delivery, byte for byte.
    const before = enqueued.length;
    await deliver(inboundPayload('wamid.e2e.2', 'track my order'));
    // Nothing new to wait for, so give the controller room to do the wrong thing if it would.
    await new Promise((resolve) => { setTimeout(resolve, 300); });

    // The duplicate was recognised, so no second job was queued...
    expect(enqueued.length).toBe(before);
    // ...only one event exists...
    expect(await prisma.webhookEvent.count({
      where: { externalEventId: { contains: 'wamid.e2e.2' } },
    })).toBe(1);
    // ...one message was stored...
    expect(await prisma.message.count({
      where: { tenantId: TENANT, waMessageId: 'wamid.e2e.2' },
    })).toBe(1);
    // ...and the customer was answered exactly once.
    expect(mockProviderFor(channelId).sent).toHaveLength(1);

    // Belt and braces: even re-running the job by hand, as pg-boss would on a retry, must not
    // produce a second reply.
    await handleProcessInboundMessage({ webhookEventId: event.id });
    expect(mockProviderFor(channelId).sent).toHaveLength(1);
  });

  it('**a forged signature never reaches the pipeline at all**', async () => {
    // The signature check is already unit-tested. What is asserted here is different and only
    // visible from outside: that a refusal at the door means *nothing downstream ran* — no
    // event, no job, no customer, no reply.
    const raw = JSON.stringify(inboundPayload('wamid.e2e.3', 'track my order'));
    const res = await request(app)
      .post('/api/webhook')
      .set('Content-Type', 'application/json')
      .set('x-hub-signature-256', `sha256=${crypto.createHmac('sha256', 'not-the-app-secret').update(raw).digest('hex')}`)
      .send(raw);

    expect(res.status).toBe(401);
    await new Promise((resolve) => { setTimeout(resolve, 300); });

    expect(await prisma.webhookEvent.count({ where: { externalEventId: { contains: 'wamid.e2e.3' } } })).toBe(0);
    expect(enqueued).toHaveLength(0);
    expect(await prisma.customer.count({ where: { tenantId: TENANT } })).toBe(0);
    expect(mockProviderFor(channelId).sent).toHaveLength(0);
  });

  it('**a paused conversation is not answered, even though the message is still stored**', async () => {
    /*
     * The agent-takeover guarantee, end to end.
     *
     * Each half is easy to get right alone and the combination is what matters: an agent who has
     * taken a conversation over must still see what the customer said, and the bot must stay
     * silent. A change that made the handler return early *before* `persistMessage` would keep
     * this suite's outbound assertion green and silently lose customer messages.
     */
    await deliver(inboundPayload('wamid.e2e.4', 'track my order'));
    const first = await waitFor('the first event', eventFor('wamid.e2e.4'));
    await waitFor('the first enqueue', async () => (enqueued.length ? enqueued : null));
    await handleProcessInboundMessage({ webhookEventId: first.id });
    expect(mockProviderFor(channelId).sent).toHaveLength(1);

    // An agent takes over.
    const conversation = await prisma.conversation.findFirstOrThrow({ where: { tenantId: TENANT } });
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { automationPaused: true },
    });
    mockProviderFor(channelId).reset();
    enqueued.length = 0;

    await deliver(inboundPayload('wamid.e2e.5', 'track my order again'));
    const second = await waitFor('the second event', eventFor('wamid.e2e.5'));
    await waitFor('the second enqueue', async () => (enqueued.length ? enqueued : null));
    await handleProcessInboundMessage({ webhookEventId: second.id });

    // Stored, so the agent can read it.
    const stored = await prisma.message.findFirstOrThrow({
      where: { tenantId: TENANT, waMessageId: 'wamid.e2e.5' },
    });
    expect(stored.body).toBe('track my order again');
    // And nothing was said back.
    expect(mockProviderFor(channelId).sent).toHaveLength(0);
  });
});

describe('the customer’s two names', () => {
  /*
   * `Customer.name` used to hold both WhatsApp's profile name and the operator's own label, and
   * the upsert below wrote the profile name over it **on every message**. So an agent who typed
   * "Ravi — accounts, chases invoices" kept it until the customer next said anything, which for
   * an active customer is minutes.
   *
   * Asserted through the real webhook rather than by calling the upsert, because the bug was in
   * the shape of the write and only the whole path proves which field it lands in.
   */

  it('**records WhatsApp’s profile name without touching the operator’s label**', async () => {
    const label = 'Ravi — accounts, chases invoices';

    // First contact: the customer is created, and only the profile name is known.
    const first = await waitFor('the first event', async () => {
      await deliver(inboundPayload('wamid.e2e.name1', 'hello'));
      return prisma.webhookEvent.findFirst({ where: { externalEventId: { contains: 'wamid.e2e.name1' } } });
    });
    await handleProcessInboundMessage({ webhookEventId: first.id });

    const created = await prisma.customer.findFirstOrThrow({ where: { tenantId: TENANT } });
    expect(created.waProfileName).toBe('Asha');
    // **Null, not the profile name.** That emptiness is what makes the two distinguishable — a
    // create that copied the profile name into `name` would make every customer look labelled.
    expect(created.name).toBeNull();

    // An agent labels them.
    await prisma.customer.update({ where: { id: created.id }, data: { name: label } });

    // The customer messages again. Under the old code this was the moment the label died.
    const second = await waitFor('the second event', async () => {
      await deliver(inboundPayload('wamid.e2e.name2', 'still there?'));
      return prisma.webhookEvent.findFirst({ where: { externalEventId: { contains: 'wamid.e2e.name2' } } });
    });
    await handleProcessInboundMessage({ webhookEventId: second.id });

    const after = await prisma.customer.findUniqueOrThrow({ where: { id: created.id } });
    expect(after.name).toBe(label);
    expect(after.waProfileName).toBe('Asha');
    // And it really did process the second message, so the assertion above is not vacuous.
    expect(after.lastSeenAt!.getTime()).toBeGreaterThanOrEqual(created.lastSeenAt!.getTime());
  });
});
