import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { Prisma } from '@prisma/client';
import { buildApp } from '../app.js';
import { prisma } from '../config/prisma.js';
import { signToken } from '../utils/jwt.js';
import { seedDefaultRoles } from '../services/role.service.js';
import { matchDeterministicRule } from '../modules/conversation-engine/routing/deterministic.js';

// Customer tags.
//
// Two jobs. The obvious one is the TAGS column on the customers screen. The one worth
// having a test for is the last describe block: **`CUSTOMER_TAG` routing rules have never
// been able to fire.** `tagsOf` in routing/deterministic.ts reads `contact.tags` and the
// column did not exist, so every such rule quietly matched nothing. That is the assertion
// that proves this migration bought something.
//
// Normalisation is tested hard because it is where a silent failure lives: a rule written
// against "vip" simply stops matching the day somebody saves "VIP", with no error anywhere.

const TENANT = '99999999-9999-9999-9999-99999999c001';
const app = buildApp();

let token: string;
let customerId: string;

const wipe = async () => {
  await prisma.order.deleteMany({ where: { tenantId: TENANT } });
  await prisma.tenant.deleteMany({ where: { id: TENANT } });
};

beforeEach(async () => {
  await wipe();
  await prisma.tenant.create({
    data: { id: TENANT, businessName: 'Tags Test', category: 'RESTAURANT' },
  });
  await seedDefaultRoles(prisma, TENANT);
  const ownerRole = await prisma.role.findFirst({
    where: { tenantId: TENANT, isOwner: true }, select: { id: true },
  });
  const user = await prisma.user.create({
    data: {
      tenantId: TENANT, phone: '15559990001', fullName: 'Owner', role: 'OWNER',
      roleId: ownerRole?.id,
    },
  });
  token = signToken({ userId: user.id, tenantId: TENANT });

  const customer = await prisma.customer.create({
    data: { tenantId: TENANT, waId: '15559991000', name: 'Tagged Person' },
  });
  customerId = customer.id;
});

afterAll(async () => {
  await wipe();
  await prisma.$disconnect();
});

const auth = { Authorization: '' };
const setTags = (tags: unknown) => request(app)
  .patch(`/api/customers/${customerId}`)
  .set('Authorization', auth.Authorization)
  .send({ tags });

beforeEach(() => { auth.Authorization = `Bearer ${token}`; });

const tagsOf = async () => (await prisma.customer.findUniqueOrThrow({
  where: { id: customerId }, select: { tags: true },
})).tags;

describe('storing tags', () => {
  it('defaults to an empty array rather than null', async () => {
    // An additive column with no default would leave every existing row null, and
    // `tagsOf` would have to guess. It does not have to.
    expect(await tagsOf()).toEqual([]);
  });

  it('lowercases them', async () => {
    await setTags(['VIP', 'Wholesale']).expect(200);
    expect(await tagsOf()).toEqual(['vip', 'wholesale']);
  });

  it('**collapses case-variant duplicates into one**', async () => {
    // The failure this prevents: "VIP" and "vip" as two tags means a routing rule
    // matching one silently ignores the other.
    await setTags(['VIP', 'vip', ' Vip ']).expect(200);
    expect(await tagsOf()).toEqual(['vip']);
  });

  it('trims and drops blanks', async () => {
    await setTags(['  pricing  ', '', '   ']).expect(200);
    expect(await tagsOf()).toEqual(['pricing']);
  });

  it('replaces the set, so removing a tag is sending a shorter list', async () => {
    await setTags(['vip', 'demo']).expect(200);
    await setTags(['vip']).expect(200);
    expect(await tagsOf()).toEqual(['vip']);

    await setTags([]).expect(200);
    expect(await tagsOf()).toEqual([]);
  });

  it('refuses more than 20, and an over-long tag, with a readable message', async () => {
    const tooMany = await setTags(Array.from({ length: 21 }, (_, i) => `tag${i}`)).expect(400);
    expect(String(tooMany.body.message ?? tooMany.body.errors?.[0]?.msg)).toMatch(/20/);

    const tooLong = await setTags(['x'.repeat(31)]).expect(400);
    expect(tooLong.body.message).toContain('30 characters');
  });

  it('leaves tags alone when the field is absent', async () => {
    await setTags(['vip']).expect(200);
    await request(app).patch(`/api/customers/${customerId}`)
      .set('Authorization', auth.Authorization).send({ name: 'Renamed' }).expect(200);
    expect(await tagsOf()).toEqual(['vip']);
  });

  it("will not tag another workspace's customer", async () => {
    const other = await prisma.tenant.create({
      data: {
        id: '99999999-9999-9999-9999-99999999c002',
        businessName: 'Other', category: 'RESTAURANT',
      },
    });
    const theirs = await prisma.customer.create({
      data: { tenantId: other.id, waId: '15559992000' },
    });
    await request(app).patch(`/api/customers/${theirs.id}`)
      .set('Authorization', auth.Authorization).send({ tags: ['vip'] }).expect(404);
    await prisma.tenant.delete({ where: { id: other.id } });
  });
});

describe('reading by tag', () => {
  beforeEach(async () => {
    await setTags(['vip', 'pricing']).expect(200);
    await prisma.customer.create({
      data: { tenantId: TENANT, waId: '15559991001', name: 'Plain Person', tags: ['demo'] },
    });
  });

  it('filters with ?tag=', async () => {
    const response = await request(app).get('/api/customers?tag=vip&take=10')
      .set('Authorization', auth.Authorization).expect(200);
    expect(response.body.meta.total).toBe(1);
    expect(response.body.data[0].name).toBe('Tagged Person');
  });

  it('matches a tag regardless of the case typed', async () => {
    const response = await request(app).get('/api/customers?tag=VIP&take=10')
      .set('Authorization', auth.Authorization).expect(200);
    expect(response.body.meta.total).toBe(1);
  });

  it('finds a tag through the search box too', async () => {
    // The field is labelled "Search name, phone, tag", so it has to.
    const response = await request(app).get('/api/customers?search=pricing&take=10')
      .set('Authorization', auth.Authorization).expect(200);
    expect(response.body.meta.total).toBe(1);
  });

  it('lists the workspace\'s tags with counts, commonest first', async () => {
    await prisma.customer.create({
      data: { tenantId: TENANT, waId: '15559991002', tags: ['demo'] },
    });
    const response = await request(app).get('/api/customers/tags')
      .set('Authorization', auth.Authorization).expect(200);

    expect(response.body.data).toEqual([
      { tag: 'demo', count: 2 },
      { tag: 'pricing', count: 1 },
      { tag: 'vip', count: 1 },
    ]);
  });

  it('returns tags on the list rows, for the column to render', async () => {
    const response = await request(app).get('/api/customers?take=10')
      .set('Authorization', auth.Authorization).expect(200);
    const tagged = response.body.data.find((c: { name: string }) => c.name === 'Tagged Person');
    expect(tagged.tags).toEqual(['vip', 'pricing']);
  });
});

describe('the last-message column', () => {
  it('surfaces the newest conversation time, or null', async () => {
    // `lastMessageAt` is on Conversation, not Customer, so the list has to reach for it.
    const when = new Date('2026-08-01T10:00:00.000Z');
    await prisma.conversation.create({
      data: { tenantId: TENANT, customerId, lastMessageAt: when },
    });
    await prisma.conversation.create({
      data: { tenantId: TENANT, customerId, lastMessageAt: new Date('2026-07-01T10:00:00.000Z') },
    });

    const response = await request(app).get('/api/customers?take=10')
      .set('Authorization', auth.Authorization).expect(200);
    const row = response.body.data.find((c: { id: string }) => c.id === customerId);
    // The newest of the two, not the first one created.
    expect(row.lastMessageAt).toBe(when.toISOString());
  });

  it('is null for somebody who has never messaged', async () => {
    const response = await request(app).get('/api/customers?take=10')
      .set('Authorization', auth.Authorization).expect(200);
    expect(response.body.data[0].lastMessageAt).toBeNull();
  });
});

describe('filtering by consent state', () => {
  beforeEach(async () => {
    await prisma.customer.create({
      data: { tenantId: TENANT, waId: '15559993001', marketingOptIn: true },
    });
    await prisma.customer.create({
      data: {
        tenantId: TENANT, waId: '15559993002', marketingOptIn: true, optedOutAt: new Date(),
      },
    });
  });

  const total = async (status: string) => (await request(app)
    .get(`/api/customers?status=${status}&take=10`)
    .set('Authorization', auth.Authorization).expect(200)).body.meta.total;

  it('separates subscribed, pending and unsubscribed', async () => {
    expect(await total('subscribed')).toBe(1);
    // The seeded customer, who never opted in.
    expect(await total('pending')).toBe(1);
    expect(await total('unsubscribed')).toBe(1);
  });

  it('ignores an unknown status rather than returning nothing', async () => {
    expect(await total('nonsense')).toBe(3);
  });
});

/** An assistant needs a channel to be bound to, so both are built together. */
const makeAssistant = async (name: string) => {
  const channel = await prisma.whatsappAccount.create({
    data: {
      tenantId: TENANT,
      wabaId: `waba-${name}`,
      phoneNumberId: `channel-${name}`,
      accessToken: 'test-token',
    },
  });
  return prisma.assistant.create({
    data: { tenantId: TENANT, name, whatsappChannelId: channel.id },
  });
};

describe('**CUSTOMER_TAG routing, which could not fire before this column existed**', () => {
  it('matches a rule against a tag the contact has', async () => {
    const workflow = await prisma.workflow.create({
      data: { tenantId: TENANT, name: 'VIP handling', slug: 'vip-handling' },
    });
    const assistant = await makeAssistant('Router');
    await prisma.routingRule.create({
      data: {
        assistantId: assistant.id,
        workflowId: workflow.id,
        name: 'VIP tag',
        type: 'CUSTOMER_TAG',
        priority: 1,
        enabled: true,
        configuration: { tags: ['vip'], mode: 'any' } as Prisma.InputJsonValue,
      },
    });

    const contact = await prisma.customer.findUniqueOrThrow({ where: { id: customerId } });

    // Before the column: `tagsOf` returned [] and this was always null.
    const withoutTag = await matchDeterministicRule({
      assistantId: assistant.id, text: 'hello', interactiveReplyId: null, contact,
    });
    expect(withoutTag).toBeNull();

    await setTags(['vip']).expect(200);
    const tagged = await prisma.customer.findUniqueOrThrow({ where: { id: customerId } });
    const match = await matchDeterministicRule({
      assistantId: assistant.id, text: 'hello', interactiveReplyId: null, contact: tagged,
    });

    expect(match?.reasonCode).toBe('CUSTOMER_TAG_MATCH');
    expect(match?.workflowId).toBe(workflow.id);
  });

  it('honours mode "all", so every tag must be present', async () => {
    const workflow = await prisma.workflow.create({
      data: { tenantId: TENANT, name: 'Both', slug: 'both' },
    });
    const assistant = await makeAssistant('Router2');
    await prisma.routingRule.create({
      data: {
        assistantId: assistant.id,
        workflowId: workflow.id,
        name: 'Both tags',
        type: 'CUSTOMER_TAG',
        priority: 1,
        enabled: true,
        configuration: { tags: ['vip', 'wholesale'], mode: 'all' } as Prisma.InputJsonValue,
      },
    });

    await setTags(['vip']).expect(200);
    const partial = await prisma.customer.findUniqueOrThrow({ where: { id: customerId } });
    expect(await matchDeterministicRule({
      assistantId: assistant.id, text: 'hi', interactiveReplyId: null, contact: partial,
    })).toBeNull();

    await setTags(['vip', 'wholesale']).expect(200);
    const both = await prisma.customer.findUniqueOrThrow({ where: { id: customerId } });
    expect((await matchDeterministicRule({
      assistantId: assistant.id, text: 'hi', interactiveReplyId: null, contact: both,
    }))?.reasonCode).toBe('CUSTOMER_TAG_MATCH');
  });
});
