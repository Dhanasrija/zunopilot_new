import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

/*
 * The Meta transport is stubbed, and *why* is a finding rather than a convenience.
 *
 * The degraded path runs the legacy `handleInboundMessage`, whose `sendFallback` imports
 * `whatsapp.service.ts` **directly** instead of going through `whatsappProviderFor`. That
 * abstraction exists precisely so a channel with no real credentials gets a mock sender — its
 * own comment says "a demo channel would be handed the Meta adapter and every send would 400 on
 * a fake token" — but the legacy service was written before it and never adopted it. So this
 * test's simulated channel produces a real HTTPS call to graph.facebook.com and a 401.
 *
 * `ordering.service.ts` has the same gap. Neither is in scope here, and neither is a problem for
 * a real tenant with a real token; both mean demo and simulated channels attempt live sends.
 * Stubbed at the module boundary so this suite tests the switch rather than the network.
 */
vi.mock('../../services/whatsapp.service.js', () => ({
  sendTextMessage: vi.fn(async () => ({ messaging_product: 'whatsapp', messages: [{ id: 'stub.1' }] })),
  sendInteractiveList: vi.fn(async () => ({ messaging_product: 'whatsapp', messages: [{ id: 'stub.2' }] })),
  sendInteractiveButtons: vi.fn(async () => ({ messaging_product: 'whatsapp', messages: [{ id: 'stub.3' }] })),
  sendLocationRequest: vi.fn(async () => ({ messaging_product: 'whatsapp', messages: [{ id: 'stub.4' }] })),
  sendTemplate: vi.fn(async () => ({ messaging_product: 'whatsapp', messages: [{ id: 'stub.5' }] })),
  graphHttp: { get: vi.fn(), post: vi.fn() },
}));

/*
 * **The legacy router, and why "no LLM call is made" was not true.**
 *
 * `FORBIDDEN_LLM` below guards the *engine's* provider, installed through `setLlmProvider`.
 * `services/router.service.ts` does not use it — it builds its own OpenAI client at module
 * scope. So a whole classifier sat outside the apparatus this file calls "the whole
 * apparatus", and the degraded path called it on every message.
 *
 * The second reason it hid: the legacy call is `isRouterEnabled() ? routeMessage(...) : null`,
 * and `isRouterEnabled()` is `Boolean(client)` — false wherever no API key is configured,
 * which is every CI run. The branch could only execute somewhere with a real key. It reached
 * production and was found in a live log:
 *
 *   11:36:26  Router classified message  intent "fallback"  usage.completion_tokens 10
 *
 * on a workspace whose AI_AGENT module was off. So this mock forces `isRouterEnabled()` true
 * — the state a real deployment is always in — and counts the calls.
 */
const legacyRouter = vi.hoisted(() => ({ calls: 0 }));

vi.mock('../../services/router.service.js', () => ({
  isRouterEnabled: () => true,
  routeMessage: async () => {
    legacyRouter.calls += 1;
    // Null means "router declined", so the legacy path degrades to keyword matching exactly
    // as it would with the model switched off. The count is the assertion, not the answer.
    return null;
  },
}));

import { prisma } from '../../config/prisma.js';
import { buildApp } from '../../app.js';
import { signToken } from '../../utils/jwt.js';
import { ROLE_PERMISSIONS } from '../../config/permissions.js';
import { aiAgentGate } from './module.service.js';
import { setLlmProvider } from '../conversation-engine/providers/llm.js';
import type { LLMProvider } from '../conversation-engine/providers/llm.js';
import { routeInboundMessage } from '../conversation-engine/routing/index.js';

// The AI agent kill switch.
//
// The claim being tested is "no LLM call is made", and the only honest way to test that is to
// make an LLM call impossible to survive. So the provider installed below **throws on every
// method**. A test that asserted on a reasonCode or a decision row would pass just as happily
// if the model had been called and its answer discarded — which is the version of this feature
// that costs money while looking like it works.
//
// Two switches, ANDed. `AI_AGENT` in TenantModule is the operator's ceiling and only the super
// admin console writes it; `Tenant.aiAgentEnabled` is the workspace's own preference. The
// interesting cases are the asymmetric ones.

const app = buildApp();

const TENANT = 'cccccccc-c000-0000-0000-00000000c001';
const CHANNEL_ID = 'ai-switch-test-channel';

let ownerToken: string;
let channelId: string;
let contactId: string;
let conversationId: string;

/**
 * A provider that cannot be used.
 *
 * If any code path reaches a model, the message becomes an exception instead of a reply and the
 * test fails loudly. This is the whole apparatus.
 */
const FORBIDDEN_LLM: LLMProvider = {
  name: 'forbidden',
  complete: async () => { throw new Error('LLM was called while the AI agent was disabled'); },
  completeStructured: async () => { throw new Error('LLM was called while the AI agent was disabled'); },
};

const wipe = () => prisma.tenant.deleteMany({ where: { id: TENANT } });

const seed = async () => {
  const tenant = await prisma.tenant.create({
    data: {
      id: TENANT,
      businessName: 'Switch Test Kitchen',
      category: 'RESTAURANT',
      roles: {
        create: [{
          name: 'Owner', permissions: [...ROLE_PERMISSIONS.OWNER], isOwner: true, isSystem: true,
        }],
      },
      users: { create: [{ phone: '15550006001', fullName: 'Owner', role: 'OWNER' }] },
      // The tenant's own fallback line — what a customer must receive when AI is off.
      fallback: { create: { response: 'A colleague will be with you shortly.' } },
    },
    include: { users: true, roles: true },
  });

  await prisma.user.update({
    where: { id: tenant.users[0].id },
    data: { roleId: tenant.roles[0].id },
  });
  ownerToken = signToken({ userId: tenant.users[0].id });

  // `mock-token-` marks the channel as simulated, so sends are swallowed rather than reaching
  // Meta with a credential that does not exist.
  const channel = await prisma.whatsappAccount.create({
    data: {
      tenantId: TENANT,
      phoneNumberId: CHANNEL_ID,
      wabaId: 'ai-switch-test-waba',
      displayPhone: '+1 555 000 6002',
      accessToken: 'mock-token-not-a-credential',
    },
  });
  channelId = channel.id;

  const contact = await prisma.customer.create({
    data: { tenantId: TENANT, waId: '15550006010', name: 'Asked A Question' },
  });
  contactId = contact.id;

  conversationId = (await prisma.conversation.create({
    data: { tenantId: TENANT, customerId: contact.id, status: 'OPEN' },
  })).id;
};

/** The operator's half. Written the way the super admin console writes it. */
const setOperatorModule = (enabled: boolean) => prisma.tenantModule.upsert({
  where: { tenantId_module: { tenantId: TENANT, module: 'AI_AGENT' } },
  update: { enabled },
  create: { tenantId: TENANT, module: 'AI_AGENT', enabled },
});

/** The workspace's half. */
const setOwnerPreference = (aiAgentEnabled: boolean) => prisma.tenant.update({
  where: { id: TENANT }, data: { aiAgentEnabled },
});

/** Send an open-ended message — the only kind that would ever reach a model. */
const askSomethingOpenEnded = async () => {
  const [tenant, channel, contact, conversation] = await Promise.all([
    prisma.tenant.findUniqueOrThrow({ where: { id: TENANT } }),
    prisma.whatsappAccount.findUniqueOrThrow({ where: { id: channelId } }),
    prisma.customer.findUniqueOrThrow({ where: { id: contactId } }),
    prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } }),
  ]);

  const message = await prisma.message.create({
    data: {
      tenantId: TENANT,
      conversationId,
      customerId: contactId,
      direction: 'INBOUND',
      type: 'TEXT',
      status: 'RECEIVED',
      body: 'do you deliver to the airport on sundays',
    },
  });

  return routeInboundMessage({
    tenant,
    channel,
    contact,
    conversation,
    message: {
      id: message.id, body: message.body ?? '', type: 'text', payload: null, interactive: null,
    },
  });
};

beforeEach(async () => {
  await wipe();
  await seed();
  setLlmProvider(FORBIDDEN_LLM);
  legacyRouter.calls = 0;
});

afterEach(() => { setLlmProvider(null); });

afterAll(async () => {
  await wipe();
  await prisma.$disconnect();
});

describe('the gate', () => {
  it('**is on by default, so no existing workspace loses its agent**', async () => {
    // The backward-compatibility claim. A tenant with no TenantModule row and the column default
    // must behave exactly as it did before this feature existed.
    expect(await prisma.tenantModule.findFirst({ where: { tenantId: TENANT } })).toBeNull();
    await expect(aiAgentGate(TENANT)).resolves.toEqual({ allowed: true });
  });

  it('**refuses when the operator has revoked it, whatever the workspace wants**', async () => {
    await setOperatorModule(false);
    await setOwnerPreference(true);
    await expect(aiAgentGate(TENANT)).resolves.toEqual({
      allowed: false, reason: 'DISABLED_BY_OPERATOR',
    });
  });

  it('refuses when the workspace has turned it off', async () => {
    await setOperatorModule(true);
    await setOwnerPreference(false);
    await expect(aiAgentGate(TENANT)).resolves.toEqual({
      allowed: false, reason: 'DISABLED_BY_OWNER',
    });
  });

  it('**blames the operator when both are off**, because that is the one the owner cannot fix', async () => {
    await setOperatorModule(false);
    await setOwnerPreference(false);
    await expect(aiAgentGate(TENANT)).resolves.toEqual({
      allowed: false, reason: 'DISABLED_BY_OPERATOR',
    });
  });
});

describe('an open-ended message with the agent switched off', () => {
  it('**never reaches a model, and the customer still gets an answer**', async () => {
    // The load-bearing test. The installed provider throws, so surviving this at all proves no
    // model was consulted — by the router, by the general response, by anything.
    await setOwnerPreference(false);

    const outcome = await askSomethingOpenEnded();

    expect(outcome.handled).toBe(true);
    expect(outcome.reasonCode).toBe('AI_DISABLED_BY_OWNER');

    /*
     * The customer was actually spoken to — asserted on the send, with the workspace's own
     * fallback text, rather than on an Inbox row.
     *
     * Worth being precise about why. The legacy degrade path sends through
     * `whatsapp.service.ts` directly and **does not persist an outbound Message**; only the
     * engine's `mirrorOutbound` wrapper does that, and the legacy service predates it. So a
     * degraded reply reaches the customer but does not appear in the conversation history the
     * team reads. That is pre-existing behaviour, not something this switch introduced, and it
     * is the second consequence of the same provider-bypass noted at the top of this file.
     * Asserting on a Message row here would have tested that gap instead of this feature.
     */
    const { sendTextMessage } = await import('../../services/whatsapp.service.js');
    expect(sendTextMessage).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendTextMessage).mock.calls[0][0]).toMatchObject({
      to: '15550006010',
      body: 'A colleague will be with you shortly.',
    });
  });

  it('carries the operator reason through to the routing decision', async () => {
    await setOperatorModule(false);

    const outcome = await askSomethingOpenEnded();
    expect(outcome.reasonCode).toBe('AI_DISABLED_BY_OPERATOR');

    // Recorded, so "why did my bot stop using AI" is answerable from the console.
    const decision = await prisma.routingDecision.findFirst({
      where: { conversationId }, orderBy: { createdAt: 'desc' },
    });
    expect(decision?.reasonCode).toBe('AI_DISABLED_BY_OPERATOR');
    expect(decision?.source).toBe('FALLBACK');
  });

  it('records no AI usage, since none was consumed', async () => {
    await setOwnerPreference(false);
    await askSomethingOpenEnded();

    // `recordAiInteraction` sits after the gate, so a skipped call must not be billed. Fire-and
    // -forget upstream, hence the small settle.
    await new Promise((resolve) => { setTimeout(resolve, 200); });
    const counters = await prisma.usageCounter.findMany({ where: { tenantId: TENANT } });
    const interactions = counters.reduce((sum, row) => sum + (row.aiInteractions ?? 0), 0);
    expect(interactions).toBe(0);
  });
});

describe('the owner’s switch against the operator’s ceiling', () => {
  it('**cannot lift it, and does not touch the module row**', async () => {
    await setOperatorModule(false);

    const res = await request(app)
      .patch('/api/tenant/me')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ aiAgentEnabled: true });
    expect(res.status).toBe(200);

    // Their preference is stored — turning it back on should be one click if we restore access.
    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: TENANT } });
    expect(tenant.aiAgentEnabled).toBe(true);

    // But the ceiling is untouched, and the effective answer is still no. Asserted on the row,
    // because a handler that merely hid the change in its response would still have made it.
    const row = await prisma.tenantModule.findUniqueOrThrow({
      where: { tenantId_module: { tenantId: TENANT, module: 'AI_AGENT' } },
    });
    expect(row.enabled).toBe(false);
    await expect(aiAgentGate(TENANT)).resolves.toEqual({
      allowed: false, reason: 'DISABLED_BY_OPERATOR',
    });
  });

  it('the owner can turn their own half off and on through the API', async () => {
    const off = await request(app)
      .patch('/api/tenant/me')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ aiAgentEnabled: false });
    expect(off.status).toBe(200);
    expect((await prisma.tenant.findUniqueOrThrow({ where: { id: TENANT } })).aiAgentEnabled).toBe(false);

    await request(app)
      .patch('/api/tenant/me')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ aiAgentEnabled: true });
    expect((await prisma.tenant.findUniqueOrThrow({ where: { id: TENANT } })).aiAgentEnabled).toBe(true);
  });

  it('**rejects the string "false" rather than reading it as true**', async () => {
    // Every other field on this route is a string, so `"false"` arriving from a form would be
    // truthy and switch the agent *on* while appearing to turn it off.
    await request(app)
      .patch('/api/tenant/me')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ aiAgentEnabled: 'false' });
    expect((await prisma.tenant.findUniqueOrThrow({ where: { id: TENANT } })).aiAgentEnabled).toBe(false);
  });
});

describe('what the session tells the browser', () => {
  it('sends both halves separately, so Settings can say which one is off', async () => {
    await setOperatorModule(false);
    await setOwnerPreference(true);

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    // The workspace's own answer is yes...
    expect(res.body.data.tenant.aiAgentEnabled).toBe(true);
    // ...and the operator's is no. Flattened into one boolean, the UI could not tell a customer
    // whether they turned it off or we did.
    expect(res.body.data.modules).not.toContain('AI_AGENT');
  });

  it('includes the module when nobody has revoked it', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(res.body.data.modules).toContain('AI_AGENT');
  });
});

describe('the legacy router, which the switch did not reach', () => {
  it('**is not called when the operator has revoked the agent**', async () => {
    // The production failure, as a test. AI_AGENT off, and a model was still consulted —
    // `degradeToNonAi` handed the message to `handleInboundMessage`, which gated its own
    // classifier on "is an API key configured" rather than on this workspace's permission.
    await setOperatorModule(false);

    await askSomethingOpenEnded();

    expect(legacyRouter.calls).toBe(0);
  });

  it('**is not called when the workspace has switched it off**', async () => {
    await setOwnerPreference(false);
    await askSomethingOpenEnded();
    expect(legacyRouter.calls).toBe(0);
  });

  it('the customer is still answered — silence was never the intent', async () => {
    await setOwnerPreference(false);
    await askSomethingOpenEnded();

    const replies = await prisma.message.findMany({
      where: { tenantId: TENANT, direction: 'OUTBOUND' },
    });
    expect(replies.map((m) => m.body)).toContain('A colleague will be with you shortly.');
  });
});

describe('what the Inbox sees', () => {
  it('**records the bot reply, so an agent can see what was already said**', async () => {
    /*
     * The second half of the same report: the customer received an answer and the Inbox
     * showed nothing. Every reply in `automation.service.ts` went out through
     * `sendTextMessage` and was never written to `Message` — so an agent opening the thread
     * saw the customer's question and no response, and answered something the bot had
     * already handled.
     *
     * In production the give-away was three status callbacks at 11:36:29–30 for a message
     * with no row behind it.
     */
    await setOwnerPreference(false);

    await askSomethingOpenEnded();

    const outbound = await prisma.message.findMany({
      where: { tenantId: TENANT, conversationId, direction: 'OUTBOUND' },
    });
    expect(outbound).toHaveLength(1);
    expect(outbound[0].body).toBe('A colleague will be with you shortly.');
    // Null `sentByUserId` is what marks a row as the bot rather than a person — the
    // distinction the shared inbox is built on.
    expect(outbound[0].sentByUserId).toBeNull();
    expect(outbound[0].type).toBe('TEXT');
  });

  it('threads the reply onto the same conversation as the question', async () => {
    // A reply hung off a new conversation would be as invisible to the agent as no reply.
    await setOwnerPreference(false);
    await askSomethingOpenEnded();

    expect(await prisma.conversation.count({ where: { tenantId: TENANT } })).toBe(1);
  });
});
