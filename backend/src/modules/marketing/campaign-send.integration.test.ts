import { AxiosError, AxiosHeaders } from 'axios';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

/*
 * The send path, from "start" to what the recipient row says afterwards.
 *
 * Written after a production campaign failed all of its recipients and was recorded as a
 * success. The template's body opened `Hi {{1}},`; `variableValues` was `{}` because the
 * composer had no input for it; Meta answered 132000 for every message; the campaign row
 * ended up `status SENT, error null`.
 *
 * Four separate things had to be wrong for that to happen, and each has a test here:
 * nothing filled the placeholder, nothing checked before sending, the failure reason was
 * discarded, and the outcome was reported as SENT.
 *
 * The provider is mocked rather than using `MockWhatsAppProvider`, because the recording
 * mock always succeeds and a failure is exactly what most of this file is about.
 */

const hooks = vi.hoisted(() => ({
  sends: [] as Array<{ to: string; params: string[]; templateName: string }>,
  failWith: null as unknown,
}));

vi.mock('../conversation-engine/providers/whatsapp.js', () => ({
  whatsappProviderFor: () => ({
    sendTemplate: async ({ to, params, templateName }: {
      to: string; params: string[]; templateName: string;
    }) => {
      if (hooks.failWith) throw hooks.failWith;
      hooks.sends.push({ to, params, templateName });
      return { messageId: `wamid.test.${hooks.sends.length}` };
    },
  }),
}));

const { prisma } = await import('../../config/prisma.js');
const { buildApp } = await import('../../app.js');
const { signToken } = await import('../../utils/jwt.js');
const { ROLE_PERMISSIONS } = await import('../../config/permissions.js');
const { sendCampaignBatch } = await import('./campaign.service.js');

const app = buildApp();
const TENANT = 'aaaaaaaa-c500-0000-0000-000000000001';
let owner: string;

/** Meta's actual answer to the campaign that prompted all of this. */
const NOT_FILLED = (() => {
  const err = new AxiosError('Request failed with status code 400');
  err.response = {
    status: 400,
    statusText: '',
    data: {
      error: {
        code: 132000,
        message: '(#132000) Number of parameters does not match the expected number',
        error_data: {
          details: 'body: number of localizable_params (0) does not match the expected number of params (1)',
        },
      },
    },
    headers: new AxiosHeaders(),
    config: { headers: new AxiosHeaders() },
  };
  return err;
})();

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

const wipe = () => prisma.tenant.deleteMany({ where: { id: TENANT } });

beforeEach(async () => {
  hooks.sends.length = 0;
  hooks.failWith = null;
  await wipe();

  const tenant = await prisma.tenant.create({
    data: {
      id: TENANT,
      businessName: 'Alpha',
      onboardingCompletedAt: new Date(),
      roles: {
        create: { name: 'Owner', permissions: [...ROLE_PERMISSIONS.OWNER], isOwner: true, isSystem: true },
      },
      users: { create: { phone: '15559000001', fullName: 'Alpha Owner', role: 'OWNER' } },
      modules: { create: { module: 'MARKETING', enabled: true } },
      whatsappAccounts: {
        create: { wabaId: 'waba-x', phoneNumberId: 'pn-x', accessToken: 'mock-token-not-a-credential' },
      },
    },
    include: { users: true, roles: true },
  });
  await prisma.user.update({
    where: { id: tenant.users[0].id },
    data: { roleId: tenant.roles[0].id },
  });
  owner = signToken({ userId: tenant.users[0].id });
});

afterAll(async () => {
  await wipe();
  await prisma.$disconnect();
});

/** The production template, placeholder and all. */
const makeTemplate = async (variables: string[] = ['1']) => {
  const res = await request(app).post('/api/campaigns/templates').set(auth(owner)).send({
    name: 'Welcome',
    metaTemplate: 'zunopilot_welcome_v1',
    bodyPreview: 'Hi {{1}}, welcome to ZunoPilot!',
    status: 'APPROVED',
    variables,
  }).expect(201);
  return res.body.data.id as string;
};

const makeCampaign = async (templateId: string, variableValues: unknown = {}) => {
  const res = await request(app).post('/api/campaigns').set(auth(owner)).send({
    name: 'New', templateId, variableValues,
  }).expect(201);
  return res.body.data.id as string;
};

const makeCustomer = (waId: string, name: string | null, consent = true) =>
  prisma.customer.create({
    data: { tenantId: TENANT, waId, phone: waId, name, marketingOptIn: consent },
  });

describe('starting a campaign', () => {
  it('**refuses to start when a placeholder has no value**', async () => {
    // The whole production incident, prevented at the one point where it costs one error
    // instead of one per recipient.
    await makeCustomer('15558000001', 'Naveen');
    const campaignId = await makeCampaign(await makeTemplate());

    const res = await request(app).post(`/api/campaigns/${campaignId}/start`)
      .set(auth(owner)).expect(400);

    expect(res.body.message).toContain('{{1}}');
    expect(res.body.message).toMatch(/placeholder/i);
    // Nothing was frozen, so nothing can be sent by a later sweep.
    expect(await prisma.campaignRecipient.count({ where: { campaignId } })).toBe(0);
  });

  it('starts once the placeholder is filled', async () => {
    await makeCustomer('15558000001', 'Naveen');
    const campaignId = await makeCampaign(await makeTemplate(), {
      1: { kind: 'CUSTOMER', field: 'name', fallback: 'there' },
    });

    await request(app).post(`/api/campaigns/${campaignId}/start`).set(auth(owner)).expect(200);
    expect(await prisma.campaignRecipient.count({ where: { campaignId } })).toBe(1);
  });

  it('leaves a template with no placeholders alone', async () => {
    // The guard must not block the common case it was never about.
    await makeCustomer('15558000001', 'Naveen');
    const campaignId = await makeCampaign(await makeTemplate([]));
    await request(app).post(`/api/campaigns/${campaignId}/start`).set(auth(owner)).expect(200);
  });
});

describe('sending', () => {
  const startedCampaign = async (values: unknown) => {
    const campaignId = await makeCampaign(await makeTemplate(), values);
    await request(app).post(`/api/campaigns/${campaignId}/start`).set(auth(owner)).expect(200);
    return campaignId;
  };

  it('**gives each recipient their own name**', async () => {
    await makeCustomer('15558000001', 'Naveen');
    await makeCustomer('15558000002', 'Priya');
    const campaignId = await startedCampaign({
      1: { kind: 'CUSTOMER', field: 'name', fallback: 'there' },
    });

    await sendCampaignBatch(campaignId, 10);

    expect(hooks.sends.map((s) => s.params[0]).sort()).toEqual(['Naveen', 'Priya']);
  });

  it('falls back for the recipient who has no name', async () => {
    await makeCustomer('15558000001', 'Naveen');
    await makeCustomer('15558000002', null);
    const campaignId = await startedCampaign({
      1: { kind: 'CUSTOMER', field: 'name', fallback: 'there' },
    });

    await sendCampaignBatch(campaignId, 10);

    expect(hooks.sends.map((s) => s.params[0]).sort()).toEqual(['Naveen', 'there']);
  });

  it('**mirrors the rendered body, not the raw template**', async () => {
    // The Inbox used to show "Hi {{1}}, welcome to ZunoPilot!" — a message no customer
    // received — to the agent who picked up the reply.
    await makeCustomer('15558000001', 'Naveen');
    const campaignId = await startedCampaign({
      1: { kind: 'CUSTOMER', field: 'name', fallback: 'there' },
    });

    await sendCampaignBatch(campaignId, 10);

    const message = await prisma.message.findFirst({
      where: { tenantId: TENANT, direction: 'OUTBOUND' },
    });
    expect(message?.body).toBe('Hi Naveen, welcome to ZunoPilot!');
  });

  it('**records Meta\'s reason on the recipient, not "status code 400"**', async () => {
    await makeCustomer('15558000001', 'Naveen');
    const campaignId = await startedCampaign({ 1: 'there' });
    hooks.failWith = NOT_FILLED;

    await sendCampaignBatch(campaignId, 10);

    const recipient = await prisma.campaignRecipient.findFirst({ where: { campaignId } });
    expect(recipient?.status).toBe('FAILED');
    expect(recipient?.error).toContain('localizable_params');
    expect(recipient?.error).not.toContain('status code');
  });

  it('**marks a campaign FAILED when nothing was sent**', async () => {
    // It used to say SENT. `status SENT, sent 0, failed 2` is what production recorded,
    // and the campaigns list showed a success.
    await makeCustomer('15558000001', 'Naveen');
    await makeCustomer('15558000002', 'Priya');
    const campaignId = await startedCampaign({ 1: 'there' });
    hooks.failWith = NOT_FILLED;

    await sendCampaignBatch(campaignId, 10);

    const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
    expect(campaign?.status).toBe('FAILED');
    // And the reason is on the campaign itself, so the list can say why.
    expect(campaign?.error).toContain('localizable_params');
  });

  it('still marks it SENT when the messages went out', async () => {
    await makeCustomer('15558000001', 'Naveen');
    const campaignId = await startedCampaign({ 1: 'there' });

    await sendCampaignBatch(campaignId, 10);

    const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
    expect(campaign?.status).toBe('SENT');
    expect(campaign?.error).toBeNull();
  });

  it('a partly-failed campaign is not called a failure', async () => {
    // One recipient out of two failing is not the same event as nothing being delivered,
    // and the per-recipient rows carry the detail either way.
    const naveen = await makeCustomer('15558000001', 'Naveen');
    await makeCustomer('15558000002', 'Priya');
    const campaignId = await startedCampaign({ 1: 'there' });

    await prisma.campaignRecipient.updateMany({
      where: { campaignId, customerId: naveen.id },
      data: { status: 'FAILED', error: 'Refused', failedAt: new Date() },
    });
    await sendCampaignBatch(campaignId, 10);

    const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
    expect(campaign?.status).toBe('SENT');
  });
});

describe('the test send', () => {
  it('**sends one message without creating a campaign**', async () => {
    const templateId = await makeTemplate();

    const res = await request(app).post('/api/campaigns/test').set(auth(owner)).send({
      templateId,
      to: '+91 77020 00350',
      variableValues: { 1: { kind: 'CUSTOMER', field: 'name', fallback: 'there' } },
    }).expect(200);

    expect(hooks.sends).toHaveLength(1);
    expect(hooks.sends[0].to).toBe('917702000350');
    expect(res.body.data.body).toBe('Hi there, welcome to ZunoPilot!');
    // The point of "test": nothing is recorded against the workspace.
    expect(await prisma.campaign.count({ where: { tenantId: TENANT } })).toBe(0);
    expect(await prisma.message.count({ where: { tenantId: TENANT } })).toBe(0);
  });

  it('uses the real customer when the number is one, so the test is truthful', async () => {
    await makeCustomer('917702000350', 'Naveen');
    const templateId = await makeTemplate();

    await request(app).post('/api/campaigns/test').set(auth(owner)).send({
      templateId,
      to: '917702000350',
      variableValues: { 1: { kind: 'CUSTOMER', field: 'name', fallback: 'there' } },
    }).expect(200);

    expect(hooks.sends[0].params).toEqual(['Naveen']);
  });

  it('**will not test against a customer who opted out**', async () => {
    // Calling it a test does not make it a different message. Without this, "send a test"
    // would be the one path in the module that reaches somebody who replied STOP.
    await prisma.customer.create({
      data: {
        tenantId: TENANT, waId: '917702000350', name: 'Naveen',
        marketingOptIn: true, optedOutAt: new Date(),
      },
    });
    const templateId = await makeTemplate();

    const res = await request(app).post('/api/campaigns/test').set(auth(owner)).send({
      templateId, to: '917702000350', variableValues: { 1: 'there' },
    }).expect(400);

    expect(res.body.message).toMatch(/opted in|STOP/i);
    expect(hooks.sends).toHaveLength(0);
  });

  it('refuses an unfilled placeholder here too', async () => {
    const res = await request(app).post('/api/campaigns/test').set(auth(owner)).send({
      templateId: await makeTemplate(), to: '917702000350', variableValues: {},
    }).expect(400);

    expect(res.body.message).toContain('{{1}}');
    expect(hooks.sends).toHaveLength(0);
  });

  it('refuses a template that Meta has not approved', async () => {
    const template = await request(app).post('/api/campaigns/templates').set(auth(owner)).send({
      name: 'Draft one', metaTemplate: 'draft_v1', bodyPreview: 'Hello', status: 'DRAFT',
    }).expect(201);

    await request(app).post('/api/campaigns/test').set(auth(owner)).send({
      templateId: template.body.data.id, to: '917702000350', variableValues: {},
    }).expect(400);
    expect(hooks.sends).toHaveLength(0);
  });

  it('**shows Meta\'s objection instead of an internal server error**', async () => {
    // This is the whole reason a test send is worth having: the operator reads the
    // rejection here, once, rather than after it has happened to everybody.
    const templateId = await makeTemplate();
    hooks.failWith = NOT_FILLED;

    const res = await request(app).post('/api/campaigns/test').set(auth(owner)).send({
      templateId, to: '917702000350', variableValues: { 1: 'there' },
    }).expect(422);

    expect(res.body.message).toContain('localizable_params');
  });

  it('is behind campaigns:send — it is a real message to a real phone', async () => {
    const agentRole = await prisma.role.create({
      data: {
        tenantId: TENANT,
        name: 'Composer',
        // Everything a marketer needs except the authority to reach a customer.
        permissions: ['campaigns:read', 'campaigns:write'],
      },
    });
    const composer = await prisma.user.create({
      data: {
        tenantId: TENANT, phone: '15559000009', fullName: 'Composer', role: 'AGENT',
        roleId: agentRole.id,
      },
    });

    await request(app).post('/api/campaigns/test')
      .set(auth(signToken({ userId: composer.id })))
      .send({ templateId: await makeTemplate(), to: '917702000350', variableValues: { 1: 'x' } })
      .expect(403);
    expect(hooks.sends).toHaveLength(0);
  });
});
