import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

/*
 * Switching keyword replies off for a workspace that does not want them.
 *
 * **Two things are being pinned, and the second is the interesting one.**
 *
 * The ordinary half: the API refuses when the module is off. Hiding the page is a courtesy to
 * whoever is looking at the sidebar; a typed URL, a stale bookmark or a network tab all bypass a
 * hidden link, so the endpoints are what has to hold.
 *
 * The half worth reading: **the fallback message is deliberately outside this module.** It is
 * what a customer receives when nothing matched, so every workspace needs to edit it whether or
 * not it has a single keyword rule. Gating it too would leave a workspace stuck with a seeded
 * restaurant line — "Type 'Menu' to order" on a business that does not take orders — with
 * nowhere in the product to change it. That was the live complaint this module came from, so
 * the asymmetry is the feature, not an oversight, and it is asserted in both directions.
 *
 * The third half, so to speak: switching it off has to stop the rules **firing**, not merely
 * stop them being edited. A workspace watching replies go out that it can no longer see is
 * worse than either state on its own.
 */

vi.mock('../../services/whatsapp.service.js', () => ({
  sendTextMessage: vi.fn(async () => ({ messaging_product: 'whatsapp', messages: [{ id: 'stub.1' }] })),
  sendInteractiveList: vi.fn(async () => ({ messaging_product: 'whatsapp', messages: [{ id: 'stub.2' }] })),
  sendInteractiveButtons: vi.fn(async () => ({ messaging_product: 'whatsapp', messages: [{ id: 'stub.3' }] })),
  sendLocationRequest: vi.fn(async () => ({ messaging_product: 'whatsapp', messages: [{ id: 'stub.4' }] })),
  sendTemplate: vi.fn(async () => ({ messaging_product: 'whatsapp', messages: [{ id: 'stub.5' }] })),
  graphHttp: { get: vi.fn(), post: vi.fn() },
}));

// The legacy LLM router would otherwise classify the test message. Counting its calls is not
// this file's job — `ai-agent-switch.integration.test.ts` owns that — but it must not run.
vi.mock('../../services/router.service.js', () => ({
  isRouterEnabled: () => false,
  routeMessage: async () => null,
}));

import { prisma } from '../../config/prisma.js';
import { buildApp } from '../../app.js';
import { signToken } from '../../utils/jwt.js';
import { ROLE_PERMISSIONS } from '../../config/permissions.js';
import { handleInboundMessage } from '../../services/automation.service.js';

const app = buildApp();

const TENANT = 'eeeeeeee-e000-0000-0000-00000000e001';
const FALLBACK = 'A colleague will be with you shortly.';

let ownerToken: string;
let customerId: string;
let conversationId: string;
let ruleId: string;

/** Everything the keyword half reaches through. */
const KEYWORD_ROUTES = [
  { name: 'list', method: 'get' as const, path: '/api/automation/keywords' },
  { name: 'create', method: 'post' as const, path: '/api/automation/keywords' },
  { name: 'update', method: 'patch' as const, path: '/api/automation/keywords/some-id' },
  { name: 'delete', method: 'delete' as const, path: '/api/automation/keywords/some-id' },
];

const wipe = () => prisma.tenant.deleteMany({ where: { id: TENANT } });

const seed = async () => {
  const tenant = await prisma.tenant.create({
    data: {
      id: TENANT,
      businessName: 'Quiet Consultancy',
      roles: {
        create: [{
          name: 'Owner', permissions: [...ROLE_PERMISSIONS.OWNER], isOwner: true, isSystem: true,
        }],
      },
      users: { create: [{ phone: '15550009001', fullName: 'Owner', role: 'OWNER' }] },
      fallback: { create: { response: FALLBACK } },
      keywords: { create: { keywords: ['hours', 'open'], response: 'We are open 11am to 11pm.' } },
      whatsappAccounts: {
        create: {
          wabaId: 'kw-test-waba',
          phoneNumberId: 'kw-test-phone',
          accessToken: 'mock-token-not-a-credential',
        },
      },
    },
    include: { users: true, roles: true, keywords: true },
  });
  await prisma.user.update({
    where: { id: tenant.users[0].id },
    data: { roleId: tenant.roles[0].id },
  });
  ownerToken = signToken({ userId: tenant.users[0].id });
  ruleId = tenant.keywords[0].id;

  const customer = await prisma.customer.create({
    data: { tenantId: TENANT, waId: '15550009010', name: 'Asked A Question' },
  });
  customerId = customer.id;
  conversationId = (await prisma.conversation.create({
    data: { tenantId: TENANT, customerId: customer.id, status: 'OPEN' },
  })).id;
};

const setKeywordRules = (enabled: boolean) => prisma.tenantModule.upsert({
  where: { tenantId_module: { tenantId: TENANT, module: 'KEYWORD_RULES' } },
  update: { enabled },
  create: { tenantId: TENANT, module: 'KEYWORD_RULES', enabled },
});

/** Drive a real inbound message through the legacy path the degrade uses. */
const sayToTheBot = async (body: string) => {
  const [tenant, customer, conversation] = await Promise.all([
    prisma.tenant.findUniqueOrThrow({ where: { id: TENANT } }),
    prisma.customer.findUniqueOrThrow({ where: { id: customerId } }),
    prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } }),
  ]);
  const message = await prisma.message.create({
    data: {
      tenantId: TENANT,
      conversationId,
      customerId,
      direction: 'INBOUND',
      type: 'TEXT',
      status: 'RECEIVED',
      body,
    },
  });
  await handleInboundMessage({
    tenant, customer, conversation, message: message as never, useAi: false,
  });
};

/** What the bot has said in this conversation, oldest first. */
const repliesSoFar = async () => (await prisma.message.findMany({
  where: { tenantId: TENANT, direction: 'OUTBOUND' },
  orderBy: { createdAt: 'asc' },
})).map((m) => m.body);

beforeEach(async () => {
  await wipe();
  await seed();
});

afterAll(async () => {
  await wipe();
  await prisma.$disconnect();
});

describe('the default', () => {
  it('**is on with no TenantModule row at all**', async () => {
    // Backward compatibility. Keyword rules already answer in every workspace, so an
    // off-by-default module would mute all of them the moment this deploys.
    expect(await prisma.tenantModule.findFirst({ where: { tenantId: TENANT } })).toBeNull();

    await request(app).get('/api/automation/keywords')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
  });

  it('appears in the session, so the page knows to show the rules', async () => {
    const res = await request(app).get('/api/auth/me')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(res.body.data.modules).toContain('KEYWORD_RULES');
  });
});

describe('with the module switched off', () => {
  beforeEach(() => setKeywordRules(false));

  for (const route of KEYWORD_ROUTES) {
    it(`refuses the ${route.name} route with 404`, async () => {
      // 404 rather than 403: confirming the feature exists and this workspace cannot have it is
      // a roadmap leak. Writes are covered as well as reads — a gate that only hides the list
      // is not a gate.
      await request(app)[route.method](route.path)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ keywords: ['x'], response: 'y' })
        .expect(404);
    });
  }

  it('**still serves the fallback message, read and write**', async () => {
    // The asymmetry. Every workspace needs to control what a customer gets when nothing
    // matched, module or no module.
    const read = await request(app).get('/api/automation/fallback')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(read.body.data.response).toBe(FALLBACK);

    await request(app).put('/api/automation/fallback')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ response: 'Someone will call you back today.' })
      .expect(200);

    expect((await prisma.fallbackRule.findUniqueOrThrow({ where: { tenantId: TENANT } })).response)
      .toBe('Someone will call you back today.');
  });

  it('**stops the rules firing, not just being edited**', async () => {
    await sayToTheBot('what are your hours');

    // The rule would have answered with its own text. The customer still gets an answer, and
    // it is the workspace's fallback.
    expect(await repliesSoFar()).toEqual([FALLBACK]);
  });

  it('**still lets a customer reach a human** — the escape words are not FAQs', async () => {
    // `HUMAN_KEYWORDS` is hardcoded, not a KeywordRule. Switching a workspace's FAQs off must
    // never strand somebody mid-conversation.
    await sayToTheBot('agent');

    expect(await repliesSoFar()).toEqual(['Connecting you to a team member. They will reply shortly.']);
    expect((await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } })).status)
      .toBe('HUMAN_TAKEOVER');
  });

  it('drops out of the session', async () => {
    const res = await request(app).get('/api/auth/me')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(res.body.data.modules).not.toContain('KEYWORD_RULES');
  });

  it('answers 401 before 404, so the gate is not an unauthenticated probe', async () => {
    await request(app).get('/api/automation/keywords').expect(401);
  });

  it('**deletes nothing** — the rules are waiting if it is switched back on', async () => {
    expect(await prisma.keywordRule.count({ where: { tenantId: TENANT } })).toBe(1);

    await setKeywordRules(true);

    const res = await request(app).get('/api/automation/keywords')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].id).toBe(ruleId);

    await sayToTheBot('what are your hours');
    expect(await repliesSoFar()).toEqual(['We are open 11am to 11pm.']);
  });
});

describe('with the module on', () => {
  beforeEach(() => setKeywordRules(true));

  it('the rule answers', async () => {
    await sayToTheBot('what are your hours');
    expect(await repliesSoFar()).toEqual(['We are open 11am to 11pm.']);
  });

  it('**a partial PATCH is enough to flip the switch**', async () => {
    // The validator used to demand `keywords` and `response` on every update, so a toggle had
    // to resend the whole rule — a lost update the moment two people edit one.
    await request(app).patch(`/api/automation/keywords/${ruleId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ isActive: false })
      .expect(200);

    const rule = await prisma.keywordRule.findUniqueOrThrow({ where: { id: ruleId } });
    expect(rule.isActive).toBe(false);
    expect(rule.response).toBe('We are open 11am to 11pm.');
  });

  it('refuses a PATCH that changes nothing, rather than reporting a save that did not happen', async () => {
    await request(app).patch(`/api/automation/keywords/${ruleId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({})
      .expect(400);
  });
});
