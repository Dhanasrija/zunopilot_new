import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { prisma } from '../../config/prisma.js';
import { buildApp } from '../../app.js';
import { signToken } from '../../utils/jwt.js';
import { ROLE_PERMISSIONS } from '../../config/permissions.js';
import { consentIntentOf, handleConsentKeyword, mayReceiveMarketing } from './consent.service.js';
import { sendCampaignBatch } from './campaign.service.js';

// Marketing.
//
// Consent is the subject of most of this file, and that is the right weight. A
// campaign that fails to send is an inconvenience; a campaign that reaches
// somebody who said STOP is how the WhatsApp number gets reported and eventually
// suspended, which takes every other feature down with it.

const app = buildApp();

const TENANT_A = 'aaaaaaaa-c000-0000-0000-000000000001';
const TENANT_B = 'aaaaaaaa-c000-0000-0000-000000000002';

let ownerA: string;
let agentA: string;
let ownerB: string;

const wipe = async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [TENANT_A, TENANT_B] } } });
};

const makeTenant = async (id: string, name: string, base: string) => {
  const tenant = await prisma.tenant.create({
    data: {
      id,
      businessName: name,
      onboardingCompletedAt: new Date(),
      roles: {
        create: [
          { name: 'Owner', permissions: [...ROLE_PERMISSIONS.OWNER], isOwner: true, isSystem: true },
          { name: 'Agent', permissions: [...ROLE_PERMISSIONS.AGENT], isSystem: true, sortOrder: 30 },
        ],
      },
      users: {
        create: [
          { phone: `${base}1`, fullName: `${name} Owner`, role: 'OWNER' },
          { phone: `${base}2`, fullName: `${name} Agent`, role: 'AGENT' },
        ],
      },
      modules: { create: { module: 'MARKETING', enabled: true } },
      // `mock-token-` means the mock provider, always. Nothing in this file can
      // reach Meta.
      whatsappAccounts: {
        create: {
          wabaId: `waba-${base}`, phoneNumberId: `pn-${base}`,
          accessToken: 'mock-token-not-a-credential',
        },
      },
    },
    include: { users: { orderBy: { phone: 'asc' } }, roles: true },
  });

  const ownerRole = tenant.roles.find((r) => r.isOwner)!;
  const agentRole = tenant.roles.find((r) => !r.isOwner)!;
  await prisma.user.update({ where: { id: tenant.users[0].id }, data: { roleId: ownerRole.id } });
  await prisma.user.update({ where: { id: tenant.users[1].id }, data: { roleId: agentRole.id } });

  return {
    ownerToken: signToken({ userId: tenant.users[0].id }),
    agentToken: signToken({ userId: tenant.users[1].id }),
  };
};

const makeCustomer = (tenantId: string, waId: string, consent: {
  marketingOptIn?: boolean; optedOutAt?: Date | null;
} = {}) => prisma.customer.create({
  data: {
    tenantId,
    waId,
    phone: waId,
    marketingOptIn: consent.marketingOptIn ?? true,
    optedOutAt: consent.optedOutAt ?? null,
  },
});

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

/** An approved template plus a campaign built on it. */
const makeCampaign = async (token: string, name = 'Diwali offer') => {
  const template = await request(app).post('/api/campaigns/templates').set(auth(token)).send({
    name: `${name} template`,
    metaTemplate: 'diwali_offer_v1',
    bodyPreview: '20% off everything this week.',
    status: 'APPROVED',
  }).expect(201);

  const campaign = await request(app).post('/api/campaigns').set(auth(token)).send({
    name, templateId: template.body.data.id,
  }).expect(201);

  return { templateId: template.body.data.id as string, campaignId: campaign.body.data.id as string };
};

beforeEach(async () => {
  await wipe();
  const a = await makeTenant(TENANT_A, 'Alpha', '1555c1000');
  const b = await makeTenant(TENANT_B, 'Beta', '1555c2000');
  ownerA = a.ownerToken;
  agentA = a.agentToken;
  ownerB = b.ownerToken;
});

afterAll(async () => {
  await wipe();
  await prisma.$disconnect();
});

describe('recognising an opt-out', () => {
  it('matches the whole message, case-insensitively', () => {
    for (const text of ['STOP', 'stop', ' Stop ', 'unsubscribe', 'STOP.']) {
      expect(consentIntentOf(text)).toBe('opt_out');
    }
  });

  it('does not fire on a sentence that merely contains the word', () => {
    // Substring matching would opt someone out for "please stop by at 6" —
    // removing a customer who never asked to leave, and silently.
    for (const text of ['please stop by at 6', 'do not stop the delivery', 'bus stop near me']) {
      expect(consentIntentOf(text)).toBeNull();
    }
  });

  it('recognises the way back in', () => {
    expect(consentIntentOf('START')).toBe('opt_in');
    expect(consentIntentOf('subscribe')).toBe('opt_in');
  });
});

describe('STOP', () => {
  it('records the refusal and confirms it, consuming the message', async () => {
    const customer = await makeCustomer(TENANT_A, '15557000001');
    const conversation = await prisma.conversation.create({
      data: { tenantId: TENANT_A, customerId: customer.id, status: 'OPEN' },
    });

    const handled = await handleConsentKeyword(
      { tenantId: TENANT_A, customerId: customer.id, conversationId: conversation.id, waId: customer.waId },
      'STOP',
    );

    // True means the caller stops: no keyword rules, no workflow, no model.
    expect(handled).toBe(true);

    const after = await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } });
    expect(after.marketingOptIn).toBe(false);
    expect(after.optedOutAt).not.toBeNull();

    // And they are told it worked.
    const confirmation = await prisma.message.findFirst({
      where: { conversationId: conversation.id, direction: 'OUTBOUND' },
    });
    expect(confirmation?.body).toContain('unsubscribed');
  });

  it('leaves an ordinary message alone', async () => {
    const customer = await makeCustomer(TENANT_A, '15557000002');
    const conversation = await prisma.conversation.create({
      data: { tenantId: TENANT_A, customerId: customer.id, status: 'OPEN' },
    });

    const handled = await handleConsentKeyword(
      { tenantId: TENANT_A, customerId: customer.id, conversationId: conversation.id, waId: customer.waId },
      'I want to order a biryani',
    );
    expect(handled).toBe(false);
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } })).optedOutAt).toBeNull();
  });

  it('can be reversed by START', async () => {
    const customer = await makeCustomer(TENANT_A, '15557000003', {
      marketingOptIn: false, optedOutAt: new Date(),
    });
    const conversation = await prisma.conversation.create({
      data: { tenantId: TENANT_A, customerId: customer.id, status: 'OPEN' },
    });

    await handleConsentKeyword(
      { tenantId: TENANT_A, customerId: customer.id, conversationId: conversation.id, waId: customer.waId },
      'START',
    );

    const after = await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } });
    expect(after.marketingOptIn).toBe(true);
    expect(after.optedOutAt).toBeNull();
  });

  it('is not undone by the customer simply messaging again', async () => {
    // The inbound path opts a customer in **on create only**. Putting
    // `marketingOptIn` in the upsert's `update` branch instead would restore
    // consent on the customer's very next message — including the STOP that
    // removed them, and every message after it. This asserts the create-only
    // rule by simulating exactly that: an existing, opted-out customer whose
    // record is touched again.
    const customer = await makeCustomer(TENANT_A, '15557000005');
    const conversation = await prisma.conversation.create({
      data: { tenantId: TENANT_A, customerId: customer.id, status: 'OPEN' },
    });
    await handleConsentKeyword(
      { tenantId: TENANT_A, customerId: customer.id, conversationId: conversation.id, waId: customer.waId },
      'STOP',
    );

    // The same upsert the inbound path runs on every message.
    await prisma.customer.upsert({
      where: { tenantId_waId: { tenantId: TENANT_A, waId: customer.waId } },
      update: { lastSeenAt: new Date() },
      create: {
        tenantId: TENANT_A, waId: customer.waId, phone: customer.waId,
        marketingOptIn: true, optInSource: 'inbound_message',
      },
    });

    const after = await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } });
    expect(after.marketingOptIn).toBe(false);
    expect(after.optedOutAt).not.toBeNull();
    expect(mayReceiveMarketing(after)).toBe(false);
  });

  it('survives a later flag flip — optedOutAt is the authority', async () => {
    // Something that re-imports contacts, or a well-meaning bulk update, might set
    // `marketingOptIn` back to true. The explicit refusal must outlive it.
    const customer = await makeCustomer(TENANT_A, '15557000004', {
      marketingOptIn: true, optedOutAt: new Date(),
    });
    expect(mayReceiveMarketing(customer)).toBe(false);
  });
});

describe('the boundary', () => {
  it('404s every route for a workspace without the module', async () => {
    await prisma.tenantModule.updateMany({
      where: { tenantId: TENANT_A, module: 'MARKETING' }, data: { enabled: false },
    });
    await request(app).get('/api/campaigns').set(auth(ownerA)).expect(404);
  });

  it('lets an agent read but never send', async () => {
    // The seeded Agent holds campaigns:read only — sending is the widest-blast
    // action in the product and starts with the owner.
    const { campaignId } = await makeCampaign(ownerA);
    await request(app).get('/api/campaigns').set(auth(agentA)).expect(200);
    await request(app).post(`/api/campaigns/${campaignId}/start`).set(auth(agentA)).expect(403);
    await request(app).post('/api/campaigns').set(auth(agentA))
      .send({ name: 'Nope', templateId: campaignId }).expect(403);
  });

  it('never returns another workspace’s campaigns', async () => {
    const { campaignId } = await makeCampaign(ownerA);
    await request(app).get(`/api/campaigns/${campaignId}`).set(auth(ownerB)).expect(404);
    const list = await request(app).get('/api/campaigns').set(auth(ownerB)).expect(200);
    expect(list.body.data).toHaveLength(0);
  });

  it('refuses a template from another workspace', async () => {
    const { templateId } = await makeCampaign(ownerA);
    await request(app).post('/api/campaigns').set(auth(ownerB))
      .send({ name: 'Borrowed', templateId }).expect(400);
  });
});

describe('the audience', () => {
  it('counts only opted-in customers, and reports who is excluded', async () => {
    await makeCustomer(TENANT_A, '15557100001');
    await makeCustomer(TENANT_A, '15557100002');
    await makeCustomer(TENANT_A, '15557100003', { marketingOptIn: false });
    await makeCustomer(TENANT_A, '15557100004', { optedOutAt: new Date() });

    const preview = await request(app).post('/api/campaigns/audience-preview')
      .set(auth(ownerA)).send({}).expect(200);

    expect(preview.body.data.reachable).toBe(2);
    // Shown deliberately: a business that only sees "reachable" has no idea it is
    // talking to half its customers.
    expect(preview.body.data.excludedNoConsent).toBe(2);
  });

  it('refuses to start with nobody to send to', async () => {
    await makeCustomer(TENANT_A, '15557100005', { marketingOptIn: false });
    const { campaignId } = await makeCampaign(ownerA);

    const response = await request(app)
      .post(`/api/campaigns/${campaignId}/start`).set(auth(ownerA)).expect(400);
    expect(response.body.message).toContain('opted out');
  });

  it('refuses to start on an unapproved template', async () => {
    await makeCustomer(TENANT_A, '15557100006');
    const template = await request(app).post('/api/campaigns/templates').set(auth(ownerA)).send({
      name: 'Not approved yet', metaTemplate: 'draft_v1', bodyPreview: 'Hello',
    }).expect(201);
    const campaign = await request(app).post('/api/campaigns').set(auth(ownerA))
      .send({ name: 'Too early', templateId: template.body.data.id }).expect(201);

    const response = await request(app)
      .post(`/api/campaigns/${campaign.body.data.id}/start`).set(auth(ownerA)).expect(400);
    expect(response.body.message).toContain('approved');
  });

  it('is frozen at start, so someone added later is not swept in', async () => {
    await makeCustomer(TENANT_A, '15557100010');
    const { campaignId } = await makeCampaign(ownerA);
    await request(app).post(`/api/campaigns/${campaignId}/start`).set(auth(ownerA)).expect(200);

    // Joins after the audience was materialised.
    await makeCustomer(TENANT_A, '15557100011');

    expect(await prisma.campaignRecipient.count({ where: { campaignId } })).toBe(1);
  });

  it('starting twice does not double up the recipients', async () => {
    await makeCustomer(TENANT_A, '15557100020');
    await makeCustomer(TENANT_A, '15557100021');
    const { campaignId } = await makeCampaign(ownerA);

    await request(app).post(`/api/campaigns/${campaignId}/start`).set(auth(ownerA)).expect(200);
    // Second start is refused because it is already SENDING — and even if the
    // status check were bypassed, the unique index makes it a no-op.
    await request(app).post(`/api/campaigns/${campaignId}/start`).set(auth(ownerA)).expect(400);

    expect(await prisma.campaignRecipient.count({ where: { campaignId } })).toBe(2);
  });
});

describe('sending', () => {
  it('delivers to opted-in customers and threads into the Inbox', async () => {
    const customer = await makeCustomer(TENANT_A, '15557200001');
    const { campaignId } = await makeCampaign(ownerA);
    await request(app).post(`/api/campaigns/${campaignId}/start`).set(auth(ownerA)).expect(200);

    const outcome = await sendCampaignBatch(campaignId, 25);
    expect(outcome.sent).toBe(1);
    expect(outcome.remaining).toBe(0);

    // A campaign send is a message like any other — a reply must land in a
    // thread, not open an orphan.
    const conversation = await prisma.conversation.findFirst({
      where: { tenantId: TENANT_A, customerId: customer.id },
    });
    expect(conversation).not.toBeNull();
    expect(await prisma.message.count({
      where: { conversationId: conversation!.id, direction: 'OUTBOUND' },
    })).toBe(1);

    // And the campaign closes itself out.
    expect((await prisma.campaign.findUniqueOrThrow({ where: { id: campaignId } })).status).toBe('SENT');
  });

  it('**skips somebody who opted out after the audience was built**', async () => {
    // The single most important behaviour in this module. Minutes can pass
    // between freezing the audience and reaching a row, and a customer is most
    // likely to reply STOP in exactly that window — because a campaign just
    // landed.
    const staying = await makeCustomer(TENANT_A, '15557200010');
    const leaving = await makeCustomer(TENANT_A, '15557200011');
    const { campaignId } = await makeCampaign(ownerA);
    await request(app).post(`/api/campaigns/${campaignId}/start`).set(auth(ownerA)).expect(200);

    expect(await prisma.campaignRecipient.count({ where: { campaignId } })).toBe(2);

    // They say STOP after the list was frozen but before the send reaches them.
    const conversation = await prisma.conversation.create({
      data: { tenantId: TENANT_A, customerId: leaving.id, status: 'OPEN' },
    });
    await handleConsentKeyword(
      { tenantId: TENANT_A, customerId: leaving.id, conversationId: conversation.id, waId: leaving.waId },
      'STOP',
    );

    const outcome = await sendCampaignBatch(campaignId, 25);

    expect(outcome.sent).toBe(1);
    expect(outcome.skipped).toBe(1);

    const skipped = await prisma.campaignRecipient.findFirstOrThrow({
      where: { campaignId, customerId: leaving.id },
    });
    // Recorded as skipped, not failed — a refusal honoured is not an error, and
    // nobody should ever "retry" it.
    expect(skipped.status).toBe('SKIPPED_OPTED_OUT');

    const sent = await prisma.campaignRecipient.findFirstOrThrow({
      where: { campaignId, customerId: staying.id },
    });
    expect(sent.status).toBe('SENT');
  });

  it('sends nothing at all once paused', async () => {
    await makeCustomer(TENANT_A, '15557200020');
    await makeCustomer(TENANT_A, '15557200021');
    const { campaignId } = await makeCampaign(ownerA);
    await request(app).post(`/api/campaigns/${campaignId}/start`).set(auth(ownerA)).expect(200);
    await request(app).post(`/api/campaigns/${campaignId}/pause`).set(auth(ownerA)).expect(200);

    const outcome = await sendCampaignBatch(campaignId, 25);
    expect(outcome.sent).toBe(0);
    expect(await prisma.campaignRecipient.count({
      where: { campaignId, status: 'PENDING' },
    })).toBe(2);
  });

  it('respects the batch size, so one campaign cannot monopolise the sender', async () => {
    for (let i = 0; i < 5; i += 1) await makeCustomer(TENANT_A, `1555730000${i}`);
    const { campaignId } = await makeCampaign(ownerA);
    await request(app).post(`/api/campaigns/${campaignId}/start`).set(auth(ownerA)).expect(200);

    const first = await sendCampaignBatch(campaignId, 2);
    expect(first.sent).toBe(2);
    expect(first.remaining).toBe(3);
    // Still SENDING — a partial batch must not look finished.
    expect((await prisma.campaign.findUniqueOrThrow({ where: { id: campaignId } })).status).toBe('SENDING');

    await sendCampaignBatch(campaignId, 2);
    const last = await sendCampaignBatch(campaignId, 2);
    expect(last.remaining).toBe(0);
    expect((await prisma.campaign.findUniqueOrThrow({ where: { id: campaignId } })).status).toBe('SENT');
  });

  it('never sends the same person twice across repeated batches', async () => {
    await makeCustomer(TENANT_A, '15557400001');
    const { campaignId } = await makeCampaign(ownerA);
    await request(app).post(`/api/campaigns/${campaignId}/start`).set(auth(ownerA)).expect(200);

    await sendCampaignBatch(campaignId, 25);
    await sendCampaignBatch(campaignId, 25);
    await sendCampaignBatch(campaignId, 25);

    const conversation = await prisma.conversation.findFirstOrThrow({ where: { tenantId: TENANT_A } });
    expect(await prisma.message.count({
      where: { conversationId: conversation.id, direction: 'OUTBOUND' },
    })).toBe(1);
  });
});

describe('the consent summary', () => {
  it('reports opted in and opted out separately', async () => {
    await makeCustomer(TENANT_A, '15557500001');
    await makeCustomer(TENANT_A, '15557500002', { optedOutAt: new Date() });
    await makeCustomer(TENANT_A, '15557500003', { marketingOptIn: false });

    const summary = await request(app).get('/api/campaigns/consent').set(auth(ownerA)).expect(200);
    expect(summary.body.data).toMatchObject({ total: 3, optedIn: 1, optedOut: 1 });
  });
});
