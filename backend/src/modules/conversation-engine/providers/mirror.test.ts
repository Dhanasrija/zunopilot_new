import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../../config/prisma.js';
import { MockWhatsAppProvider } from './mock.js';
import { mirrorOutbound, type MirrorContext } from './mirror.js';

// Against real Postgres, because the interesting behaviour is what the unique
// index on (tenantId, waMessageId) does — that constraint exists to make
// inbound webhook retries idempotent, and outbound mirroring has to live with
// it without ever losing a line from the operator's view of the conversation.

const TEST_TENANT = '55555555-5555-5555-5555-555555555555';

let ctx: MirrorContext;
let inner: MockWhatsAppProvider;

const wipe = () => prisma.tenant.deleteMany({ where: { id: TEST_TENANT } });

beforeEach(async () => {
  await wipe();
  await prisma.tenant.create({
    data: { id: TEST_TENANT, businessName: 'Mirror Test', category: 'RESTAURANT' },
  });
  const contact = await prisma.customer.create({
    data: { tenantId: TEST_TENANT, waId: '15550009933', name: 'Mirror Tester' },
  });
  const conversation = await prisma.conversation.create({
    data: { tenantId: TEST_TENANT, customerId: contact.id, status: 'OPEN' },
  });

  ctx = { tenantId: TEST_TENANT, conversationId: conversation.id, customerId: contact.id };
  inner = new MockWhatsAppProvider();
});

afterAll(async () => {
  await wipe();
  await prisma.$disconnect();
});

const messages = () => prisma.message.findMany({
  where: { conversationId: ctx.conversationId },
  orderBy: { createdAt: 'asc' },
});

describe('mirroring engine replies into the inbox', () => {
  it('records a text reply as an outbound message', async () => {
    const sender = mirrorOutbound(inner, ctx);
    await sender.sendText({ to: '15550009933', body: 'What name should we put on the order?' });

    const [row] = await messages();
    expect(row).toMatchObject({
      direction: 'OUTBOUND',
      type: 'TEXT',
      status: 'SENT',
      body: 'What name should we put on the order?',
    });
    expect(row!.waMessageId).toBe('wamid.mock.1');
  });

  it('records a list with the rows the customer was offered', async () => {
    const sender = mirrorOutbound(inner, ctx);
    await sender.sendList({
      to: '15550009933',
      body: 'What are you in the mood for?',
      button: 'Browse menu',
      sections: [{ title: 'Our menu', rows: [{ id: 'cat:1', title: 'Biryani' }, { id: 'cat:2', title: 'Drinks' }] }],
    });

    const [row] = await messages();
    expect(row).toMatchObject({ type: 'INTERACTIVE', body: 'What are you in the mood for?' });
    expect(row!.payload).toEqual({
      outbound: {
        kind: 'list',
        button: 'Browse menu',
        options: [{ id: 'cat:1', title: 'Biryani' }, { id: 'cat:2', title: 'Drinks' }],
      },
    });
  });

  it('records buttons with their ids, so a tap can be traced back', async () => {
    const sender = mirrorOutbound(inner, ctx);
    await sender.sendButtons({
      to: '15550009933',
      body: 'Anything else?',
      buttons: [{ id: 'add_more', title: 'Add more items' }, { id: 'checkout', title: 'Checkout' }],
    });

    const [row] = await messages();
    expect(row!.payload).toMatchObject({ outbound: { kind: 'buttons' } });
    expect((row!.payload as { outbound: { options: unknown } }).outbound.options)
      .toEqual([{ id: 'add_more', title: 'Add more items' }, { id: 'checkout', title: 'Checkout' }]);
  });

  it('does not record anything when the send itself fails', async () => {
    // A message Meta rejected was never seen by the customer, so showing it in
    // the operator's transcript would be a lie.
    const failing = {
      ...inner,
      sendText: async () => { throw new Error('Recipient not in allowed list'); },
    } as unknown as MockWhatsAppProvider;

    const sender = mirrorOutbound(failing, ctx);
    await expect(sender.sendText({ to: '15550009933', body: 'nope' })).rejects.toThrow();
    expect(await messages()).toHaveLength(0);
  });

  it('keeps the message when a provider reuses a message id', async () => {
    // The console adapter restarts its counter per instance, so duplicate ids
    // are real. Losing the transcript line over one would defeat the point.
    const repeating = {
      sendText: async () => ({ messageId: 'duplicate-id' }),
    } as unknown as MockWhatsAppProvider;

    const sender = mirrorOutbound(repeating, ctx);
    await sender.sendText({ to: '15550009933', body: 'first' });
    await sender.sendText({ to: '15550009933', body: 'second' });

    const rows = await messages();
    expect(rows.map((r) => r.body)).toEqual(['first', 'second']);
    // The second keeps the line but drops the colliding id.
    expect(rows[0]!.waMessageId).toBe('duplicate-id');
    expect(rows[1]!.waMessageId).toBeNull();
  });

  it('never fails the send because the mirror could not write', async () => {
    // The customer already has the message. Throwing here would fail the node
    // and break the conversation over a bookkeeping problem.
    const sender = mirrorOutbound(inner, { ...ctx, conversationId: 'does-not-exist' });
    await expect(sender.sendText({ to: '15550009933', body: 'still delivered' })).resolves.toBeTruthy();
    expect(inner.bodies()).toEqual(['still delivered']);
  });
});
