import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { seedMemberships } from '../test-support/members.js';
import { prisma } from '../config/prisma.js';
import { buildApp } from '../app.js';
import { signToken } from '../utils/jwt.js';
import { seedDefaultRoles } from '../services/role.service.js';
import { MOCK_CHANNEL_TOKEN_PREFIX, mockProviderFor } from '../modules/conversation-engine/providers/whatsapp.js';
import { AGENT_REPLY_PREFIX, quickReplyButtonId } from '../modules/conversation-engine/agent-reply-id.js';

/*
 * An agent sends a question with tappable answers.
 *
 * ── The join this file exists to hold ────────────────────────────────────────
 *
 * **The ids that go to Meta must be the button rows' own ids, and the ids recorded on the message
 * must be those same ids.** Three things depend on that single fact agreeing with itself:
 *
 *   • the inbound handler resolves a tap by looking the id up as a row
 *   • the thread draws its pills from what was recorded
 *   • the whole collision argument rests on the id being a uuid nobody typed
 *
 * If the send ever minted its own ids, or the mirror recorded different ones, every one of those
 * breaks silently — the pills would still look right and the taps would stop resolving. So the join
 * is asserted directly rather than through either side.
 */

const app = buildApp();
const TENANT = 'eeeeeeee-0000-0000-0000-0000000000b1';

let ownerToken: string;
let strangerToken: string;
let readOnlyToken: string;
let channelId: string;
let conversationId: string;
let setId: string;
let buttonIds: string[];

const wipe = async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [TENANT, 'eeeeeeee-0000-0000-0000-0000000000b2'] } } });
};

/** An hour ago, so the 24-hour window is open unless a test closes it. */
const anHourAgo = () => new Date(Date.now() - 60 * 60 * 1000);

beforeEach(async () => {
  await wipe();
  await prisma.tenant.create({
    data: { id: TENANT, businessName: 'Button Kitchen', category: 'RESTAURANT' },
  });
  await seedDefaultRoles(prisma, TENANT);

  const roles = await prisma.role.findMany({ where: { tenantId: TENANT } });
  const ownerRole = roles.find((r) => r.isOwner)!;
  /*
   * Built rather than found: **every seeded role can reply.** The first version looked for one that
   * could not and got `undefined`, which failed in `beforeEach` and took all eighteen tests with it.
   */
  const viewerRole = await prisma.role.create({
    data: { tenantId: TENANT, name: 'Read only', permissions: ['inbox:read'] },
  });

  const owner = await prisma.user.create({
    data: { tenantId: TENANT, phone: '15558806001', fullName: 'Owner', role: 'OWNER', roleId: ownerRole.id },
  });
  const viewer = await prisma.user.create({
    data: { tenantId: TENANT, phone: '15558806002', fullName: 'Viewer', role: 'AGENT', roleId: viewerRole.id },
  });
  await seedMemberships();
  ownerToken = signToken({ userId: owner.id, tenantId: TENANT });
  readOnlyToken = signToken({ userId: viewer.id, tenantId: TENANT });

  const channel = await prisma.whatsappAccount.create({
    data: {
      tenantId: TENANT,
      wabaId: 'waba-qrsend',
      phoneNumberId: 'chan-qrsend',
      // Simulated, so nothing reaches Meta and the mock records what was asked of it.
      accessToken: `${MOCK_CHANNEL_TOKEN_PREFIX}qrsend`,
    },
  });
  channelId = channel.id;

  const customer = await prisma.customer.create({
    data: { tenantId: TENANT, waId: '15558806099', name: 'Asha' },
  });
  const conversation = await prisma.conversation.create({
    data: { tenantId: TENANT, customerId: customer.id, status: 'OPEN', lastMessageAt: anHourAgo() },
  });
  conversationId = conversation.id;

  // The window is computed from the customer's last inbound message, so there has to be one.
  await prisma.message.create({
    data: {
      tenantId: TENANT,
      conversationId: conversation.id,
      customerId: customer.id,
      direction: 'INBOUND',
      type: 'TEXT',
      status: 'RECEIVED',
      body: 'Are you open?',
      createdAt: anHourAgo(),
    },
  });

  const set = await prisma.quickReply.create({
    data: {
      tenantId: TENANT,
      name: 'Delivery or pickup',
      body: 'Would you like delivery or pickup?',
      buttons: { create: [{ label: 'Delivery', position: 0 }, { label: 'Pickup', position: 1 }] },
    },
    include: { buttons: { orderBy: { position: 'asc' } } },
  });
  setId = set.id;
  buttonIds = set.buttons.map((b) => b.id);

  // A second workspace, for the isolation checks.
  const other = await prisma.tenant.create({
    data: {
      id: 'eeeeeeee-0000-0000-0000-0000000000b2', businessName: 'Not Yours', category: 'RESTAURANT',
    },
  });
  await seedDefaultRoles(prisma, other.id);
  const otherOwnerRole = await prisma.role.findFirstOrThrow({
    where: { tenantId: other.id, isOwner: true },
  });
  const stranger = await prisma.user.create({
    data: {
      tenantId: other.id, phone: '15558806003', fullName: 'Stranger', role: 'OWNER', roleId: otherOwnerRole.id,
    },
  });
  await seedMemberships();
  strangerToken = signToken({ userId: stranger.id, tenantId: other.id });

  mockProviderFor(channelId).reset();
});

afterAll(async () => {
  await wipe();
  await prisma.$disconnect();
});

const send = (token: string, body: object, conversation = conversationId) => request(app)
  .post(`/api/inbox/conversations/${conversation}/quick-reply`)
  .set('Authorization', `Bearer ${token}`)
  .send(body);

const lastSent = () => mockProviderFor(channelId).sent.at(-1);

describe('sending a set', () => {
  it('**puts the buttons on the wire with the rows’ own ids**', async () => {
    await send(ownerToken, { quickReplyId: setId }).expect(201);

    const out = lastSent();
    expect(out?.kind).toBe('buttons');
    expect(out?.body).toBe('Would you like delivery or pickup?');
    expect((out?.meta as { buttons: { id: string; title: string }[] }).buttons).toEqual([
      { id: quickReplyButtonId(buttonIds[0]!), title: 'Delivery' },
      { id: quickReplyButtonId(buttonIds[1]!), title: 'Pickup' },
    ]);
  });

  it('**records the same ids it sent, so a tap and a pill agree**', async () => {
    /*
     * The join. The thread draws its pills from `payload.outbound`, and the inbound handler
     * resolves a tap by looking the id up as a row — so if these two ever diverged, the pills would
     * still look right while the taps stopped resolving.
     */
    const res = await send(ownerToken, { quickReplyId: setId }).expect(201);

    const stored = (res.body.data.payload as { outbound: { options: { id: string }[] } }).outbound;
    const wire = (lastSent()?.meta as { buttons: { id: string }[] }).buttons;
    expect(stored.options.map((o) => o.id)).toEqual(wire.map((b) => b.id));
  });

  it('**never mints an id the ordering flow would answer**', async () => {
    /*
     * Belt and braces over the unit test, run against the real controller. The ordering FSM
     * dispatches on these seven prefixes, and a collision would not error — it would be answered by
     * the cart instead of by us.
     */
    await send(ownerToken, { quickReplyId: setId }).expect(201);

    const ids = (lastSent()?.meta as { buttons: { id: string }[] }).buttons.map((b) => b.id);
    for (const id of ids) {
      expect(id.startsWith(AGENT_REPLY_PREFIX)).toBe(true);
      for (const owned of ['cat:', 'item:', 'qty:', 'cart:', 'edit:', 'setqty:', 'removeitem:']) {
        expect(id.startsWith(owned)).toBe(false);
      }
    }
  });

  it('records one INTERACTIVE message attributed to the agent who sent it', async () => {
    const res = await send(ownerToken, { quickReplyId: setId }).expect(201);

    expect(res.body.data.type).toBe('INTERACTIVE');
    expect(res.body.data.direction).toBe('OUTBOUND');
    expect(res.body.data.sentByUser.fullName).toBe('Owner');
  });

  it('moves the conversation to the top of the queue', async () => {
    const before = await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } });
    await send(ownerToken, { quickReplyId: setId }).expect(201);

    const after = await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } });
    expect(after.lastMessageAt!.getTime()).toBeGreaterThan(before.lastMessageAt!.getTime());
  });

  it('**does not touch the automation state**', async () => {
    /*
     * Sending is not a decision to hand the thread over, in either direction. Only a *tap* on a
     * workflow-bound button ends a takeover, and only then — pausing on send would kill the bot for
     * a thread whose customer never taps anything.
     */
    await prisma.conversation.update({
      where: { id: conversationId }, data: { automationPaused: true, status: 'HUMAN_TAKEOVER' },
    });

    await send(ownerToken, { quickReplyId: setId }).expect(201);

    const conversation = await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } });
    expect(conversation.automationPaused).toBe(true);
    expect(conversation.status).toBe('HUMAN_TAKEOVER');
  });
});

describe('overriding the question', () => {
  it('sends the agent’s wording instead of the saved default', async () => {
    // The saved body is a starting point — an agent may want to name the customer.
    await send(ownerToken, { quickReplyId: setId, body: 'Asha, delivery or pickup?' }).expect(201);

    expect(lastSent()?.body).toBe('Asha, delivery or pickup?');
  });

  it('leaves the saved set alone', async () => {
    await send(ownerToken, { quickReplyId: setId, body: 'Just this once' }).expect(201);

    const set = await prisma.quickReply.findUniqueOrThrow({ where: { id: setId } });
    expect(set.body).toBe('Would you like delivery or pickup?');
  });

  it('**checks the override against Meta’s limit, which the saved one already passed**', async () => {
    // A different request from the one that saved the set, so its length is not known good.
    const res = await send(ownerToken, { quickReplyId: setId, body: 'x'.repeat(1025) }).expect(400);
    expect(res.body.message).toMatch(/1024/);
  });

  it('refuses an override of nothing but whitespace', async () => {
    await send(ownerToken, { quickReplyId: setId, body: '   ' }).expect(400);
  });
});

describe('when it will not send', () => {
  it('**refuses outside the 24-hour window**', async () => {
    // Checked before the send, following the media path: a bounced question costs the whole
    // composition, not a re-read of a sentence still on screen.
    await prisma.message.updateMany({
      where: { conversationId, direction: 'INBOUND' },
      data: { createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000) },
    });

    const res = await send(ownerToken, { quickReplyId: setId }).expect(400);
    expect(res.body.message).toMatch(/24 hours/);
    // And it points at the alternative that actually exists, which the media refusal cannot.
    expect(res.body.message).toMatch(/template/i);
    expect(mockProviderFor(channelId).sent).toHaveLength(0);
  });

  it('**says something different when the customer has never written**', async () => {
    await prisma.message.deleteMany({ where: { conversationId } });

    const res = await send(ownerToken, { quickReplyId: setId }).expect(400);
    expect(res.body.message).toMatch(/never messaged/i);
  });

  it('refuses a set that has been retired', async () => {
    // Otherwise retiring one does nothing for the agents who already had it in a dropdown.
    await prisma.quickReply.update({ where: { id: setId }, data: { isActive: false } });

    const res = await send(ownerToken, { quickReplyId: setId }).expect(400);
    expect(res.body.message).toMatch(/retired/i);
  });

  it('**refuses a plain reply here rather than sending a question with no answers**', async () => {
    /*
     * A set with no answers is a plain-text frequent reply, and this route is the buttons route.
     * Refused rather than quietly downgraded: WhatsApp has no interactive message with zero buttons,
     * so sending it as text would hand the caller a different message type than the one they asked
     * for, from an endpoint whose whole job is buttons.
     */
    await prisma.quickReplyButton.deleteMany({ where: { quickReplyId: setId } });

    const res = await send(ownerToken, { quickReplyId: setId }).expect(400);
    // Names the route that does want it. The client is one endpoint away from what it meant.
    expect(res.body.message).toMatch(/messages/);
    expect(mockProviderFor(channelId).sent).toHaveLength(0);
  });

  it('**names the right problem even outside the 24-hour window**', async () => {
    /*
     * Pins the ordering. With the window checked first, a plain reply posted here outside it was
     * refused with "WhatsApp only allows buttons within 24 hours…" — an error about a problem the
     * caller does not have, which sends whoever wrote the client hunting a timing bug that is not
     * there. What is wrong is the set, and that is knowable without looking at the clock.
     */
    await prisma.quickReplyButton.deleteMany({ where: { quickReplyId: setId } });
    await prisma.message.updateMany({
      where: { conversationId, direction: 'INBOUND' },
      data: { createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000) },
    });

    const res = await send(ownerToken, { quickReplyId: setId }).expect(400);
    expect(res.body.message).toMatch(/no answers/i);
    expect(res.body.message).not.toMatch(/24 hours/);
  });

  it('**refuses another workspace’s set**', async () => {
    /*
     * A set id is a uuid. Without the tenant in the `where`, an agent could send another
     * workspace's question — and its buttons would resolve to that workspace's rows on the way
     * back in.
     */
    const theirs = await prisma.quickReply.create({
      data: {
        tenantId: 'eeeeeeee-0000-0000-0000-0000000000b2',
        name: 'Theirs',
        body: 'Theirs',
        buttons: { create: [{ label: 'Tap', position: 0 }] },
      },
    });

    await send(ownerToken, { quickReplyId: theirs.id }).expect(404);
    expect(mockProviderFor(channelId).sent).toHaveLength(0);
  });

  it('cannot reach another workspace’s conversation', async () => {
    await send(strangerToken, { quickReplyId: setId }).expect(404);
  });

  it('needs inbox:reply', async () => {
    await send(readOnlyToken, { quickReplyId: setId }).expect(403);
  });

  it('names the missing field rather than failing obscurely', async () => {
    await send(ownerToken, {}).expect(400);
  });
});
