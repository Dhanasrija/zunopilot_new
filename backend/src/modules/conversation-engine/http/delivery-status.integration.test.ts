import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import crypto from 'node:crypto';
import { prisma } from '../../../config/prisma.js';
import { buildApp } from '../../../app.js';

/*
 * Delivery status: what Meta says about an outbound message, and what we do with it.
 *
 * **`applyStatusUpdates` had no tests at all**, and it turned out to hold four defects — each of
 * which this file reproduces before asserting the fix:
 *
 *   1. No monotonic guard. Meta delivers status webhooks out of order and retries them, so a
 *      late `sent` overwrote a `READ` and the tick walked backwards.
 *   2. No tenant scoping — `where: { waMessageId }`, half of `@@unique([tenantId, waMessageId])`.
 *      One workspace's webhook rewrote another workspace's message.
 *   3. `status as never`. An unmodelled word threw Prisma validation, and because the whole
 *      entry loop is one try/catch the throw abandoned `recordInboundEvents` for the rest of the
 *      batch — real customer messages lost, silently, behind an already-sent 200.
 *   4. `CampaignRecipient.DELIVERED` / `READ` were never written by anything, so a broadcast
 *      report could only ever show sent and failed.
 *
 * Written as HTTP tests rather than direct calls to `applyStatusUpdates` because defect 3 is
 * only visible through the controller: the interesting assertion is about a *different* change
 * in the same request surviving.
 */

const app = buildApp();

const TENANT_A = '77777777-7777-7777-7777-77777777a001';
const TENANT_B = '77777777-7777-7777-7777-77777777a002';
const PHONE_A = 'pn-status-a';
const PHONE_B = 'pn-status-b';

/** Meta's clock, not ours. Fixed so the assertions can name the exact instant. */
const DELIVERED_AT = 1785000000;
const READ_AT = 1785000060;

const wipe = async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [TENANT_A, TENANT_B] } } });
  await prisma.webhookEvent.deleteMany({ where: { externalEventId: { startsWith: 'wamid.status' } } });
};

/** A workspace with a channel, a customer, a conversation and one outbound message. */
const makeWorkspace = async (tenantId: string, phoneNumberId: string, waMessageId: string) => {
  await prisma.tenant.create({
    data: { id: tenantId, businessName: `Status ${tenantId.slice(-4)}`, category: 'RESTAURANT' },
  });
  await prisma.whatsappAccount.create({
    data: {
      tenantId,
      wabaId: `waba-${tenantId.slice(-4)}`,
      phoneNumberId,
      accessToken: `mock-token-${tenantId.slice(-4)}`,
    },
  });
  const customer = await prisma.customer.create({
    data: { tenantId, waId: `1555700${tenantId.slice(-4)}` },
  });
  const conversation = await prisma.conversation.create({
    data: { tenantId, customerId: customer.id, status: 'OPEN' },
  });
  const message = await prisma.message.create({
    data: {
      tenantId,
      conversationId: conversation.id,
      customerId: customer.id,
      direction: 'OUTBOUND',
      type: 'TEXT',
      status: 'SENT',
      body: 'On its way.',
      waMessageId,
    },
  });
  return { customer, conversation, message };
};

/** POST it the way Meta does: raw body, HMAC over those exact bytes. */
const deliver = async (body: unknown) => {
  const secret = process.env.META_APP_SECRET ?? '';
  // Guarded rather than skipped. A skipped test is indistinguishable from a passing one in a
  // summary, and an unsigned webhook is refused — so without the secret every assertion below
  // would fail obscurely rather than saying why.
  expect(
    secret,
    'META_APP_SECRET must be set for this suite — an unsigned webhook is refused.',
  ).not.toBe('');

  const raw = JSON.stringify(body);
  return request(app)
    .post('/api/webhook')
    .set('Content-Type', 'application/json')
    .set('x-hub-signature-256', `sha256=${crypto.createHmac('sha256', secret).update(raw).digest('hex')}`)
    .send(raw);
};

/** One status event for one message. */
const statusWebhook = (input: {
  phoneNumberId: string;
  waMessageId: string;
  status: string;
  timestamp?: number;
  errors?: unknown[];
}) => ({
  // `object` is not decoration: `receiveWebhook` returns early on anything else, so a payload
  // without it is silently ignored and every assertion below would pass vacuously.
  object: 'whatsapp_business_account',
  entry: [{
    changes: [{
      value: {
        metadata: { phone_number_id: input.phoneNumberId },
        statuses: [{
          id: input.waMessageId,
          status: input.status,
          recipient_id: '15557000001',
          timestamp: String(input.timestamp ?? DELIVERED_AT),
          ...(input.errors ? { errors: input.errors } : {}),
        }],
      },
    }],
  }],
});

/**
 * Wait for the controller's post-response work.
 *
 * `receiveWebhook` sends 200 and *then* writes, so supertest resolving proves nothing. Polling
 * rather than a fixed sleep: a sleep is either flaky on a slow machine or wasted on a fast one.
 */
const waitFor = async <T>(what: string, read: () => Promise<T | null>, timeoutMs = 5_000): Promise<T> => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const found = await read();
    if (found) return found;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((resolve) => { setTimeout(resolve, 50); });
  }
};

const statusOf = async (id: string) => {
  const row = await prisma.message.findUnique({ where: { id } });
  return row!;
};

/** Poll until the message reaches `want`, so the assertion is not a race. */
const settlesAt = (id: string, want: string) => waitFor(
  `message ${id} to reach ${want}`,
  async () => {
    const row = await prisma.message.findUnique({ where: { id } });
    return row?.status === want ? row : null;
  },
);

let A: Awaited<ReturnType<typeof makeWorkspace>>;

beforeEach(async () => {
  await wipe();
  A = await makeWorkspace(TENANT_A, PHONE_A, 'wamid.status.shared');
});

afterAll(async () => {
  await wipe();
  await prisma.$disconnect();
});

describe('climbing the ladder', () => {
  it('**sent, delivered, read — with Meta’s timestamps, not ours**', async () => {
    await deliver(statusWebhook({ phoneNumberId: PHONE_A, waMessageId: 'wamid.status.shared', status: 'delivered' }));
    await settlesAt(A.message.id, 'DELIVERED');

    await deliver(statusWebhook({
      phoneNumberId: PHONE_A, waMessageId: 'wamid.status.shared', status: 'read', timestamp: READ_AT,
    }));
    const row = await settlesAt(A.message.id, 'READ');

    expect(row.deliveredAt).toEqual(new Date(DELIVERED_AT * 1000));
    expect(row.readAt).toEqual(new Date(READ_AT * 1000));
    expect(row.failedAt).toBeNull();
    expect(row.statusError).toBeNull();
  });

  it('records the failure reason alongside FAILED', async () => {
    await deliver(statusWebhook({
      phoneNumberId: PHONE_A,
      waMessageId: 'wamid.status.shared',
      status: 'failed',
      errors: [{
        code: 131030,
        title: 'Recipient is not in allowed list',
        error_data: { details: 'Add recipient phone number to recipient list' },
      }],
    }));

    const row = await settlesAt(A.message.id, 'FAILED');
    expect(row.statusError).toBe('131030: Add recipient phone number to recipient list');
    expect(row.failedAt).toEqual(new Date(DELIVERED_AT * 1000));
  });
});

describe('a status that arrives out of order', () => {
  it('**cannot walk a READ backwards to SENT**', async () => {
    /*
     * The tick that flickered. Meta retries status webhooks and delivers them out of order, so a
     * `sent` after a `read` is ordinary traffic — and before the monotonic guard it overwrote the
     * READ, so an agent watched the blue ticks turn back into one grey one.
     */
    await deliver(statusWebhook({
      phoneNumberId: PHONE_A, waMessageId: 'wamid.status.shared', status: 'read', timestamp: READ_AT,
    }));
    await settlesAt(A.message.id, 'READ');

    await deliver(statusWebhook({
      phoneNumberId: PHONE_A, waMessageId: 'wamid.status.shared', status: 'sent', timestamp: DELIVERED_AT,
    }));

    // Give the write a chance to land before asserting it did not happen.
    await new Promise((resolve) => { setTimeout(resolve, 300); });
    const row = await statusOf(A.message.id);
    expect(row.status).toBe('READ');
    expect(row.readAt).toEqual(new Date(READ_AT * 1000));
  });

  it('**cannot revive a FAILED message with a late delivered**', async () => {
    await deliver(statusWebhook({
      phoneNumberId: PHONE_A,
      waMessageId: 'wamid.status.shared',
      status: 'failed',
      errors: [{ code: 131047, error_data: { details: 'Re-engagement message' } }],
    }));
    await settlesAt(A.message.id, 'FAILED');

    await deliver(statusWebhook({
      phoneNumberId: PHONE_A, waMessageId: 'wamid.status.shared', status: 'delivered',
    }));
    await new Promise((resolve) => { setTimeout(resolve, 300); });

    const row = await statusOf(A.message.id);
    expect(row.status).toBe('FAILED');
    expect(row.statusError).toContain('131047');
    // Not merely unchanged — the delivered timestamp must not be recorded either, or a report
    // would show a delivery time for a message that never arrived.
    expect(row.deliveredAt).toBeNull();
  });

  it('leaves a null deliveredAt when read overtook delivered, rather than inventing one', async () => {
    // The documented consequence of the guard. Anything reading these takes the *state* from
    // `status` and uses the timestamps only for a label.
    await deliver(statusWebhook({
      phoneNumberId: PHONE_A, waMessageId: 'wamid.status.shared', status: 'read', timestamp: READ_AT,
    }));
    const row = await settlesAt(A.message.id, 'READ');

    expect(row.readAt).not.toBeNull();
    expect(row.deliveredAt).toBeNull();
  });

  it('settles at READ whichever of two concurrent webhooks wins', async () => {
    /*
     * The atomicity claim. One `updateMany` per status means Postgres re-evaluates the WHERE
     * against the newly committed row when the second UPDATE unblocks, so the loser writes
     * nothing. Run a few times, because a single pass can pass by luck.
     */
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await prisma.message.update({
        where: { id: A.message.id },
        data: { status: 'SENT', deliveredAt: null, readAt: null },
      });

      await Promise.all([
        deliver(statusWebhook({ phoneNumberId: PHONE_A, waMessageId: 'wamid.status.shared', status: 'delivered' })),
        deliver(statusWebhook({
          phoneNumberId: PHONE_A, waMessageId: 'wamid.status.shared', status: 'read', timestamp: READ_AT,
        })),
      ]);

      const row = await settlesAt(A.message.id, 'READ');
      expect(row.status, `attempt ${attempt}`).toBe('READ');
    }
  });
});

describe('tenant isolation', () => {
  it('**a status for one workspace never touches another’s message**', async () => {
    /*
     * Both workspaces hold a message with the *same* `waMessageId` — legal, because the unique
     * constraint is `(tenantId, waMessageId)`. The old `where: { waMessageId }` used half that
     * key, so one workspace's webhook advanced both rows. This is the assertion that fails
     * hardest against the previous code.
     */
    const B = await makeWorkspace(TENANT_B, PHONE_B, 'wamid.status.shared');

    await deliver(statusWebhook({ phoneNumberId: PHONE_A, waMessageId: 'wamid.status.shared', status: 'read' }));
    await settlesAt(A.message.id, 'READ');

    const theirs = await statusOf(B.message.id);
    expect(theirs.status).toBe('SENT');
    expect(theirs.readAt).toBeNull();
    expect(theirs.deliveredAt).toBeNull();
  });
});

describe('an inbound message', () => {
  it('**is never relabelled by a delivery status**', async () => {
    // RECEIVED is deliberately absent from the ladder, so there is no rung to climb from.
    const inbound = await prisma.message.create({
      data: {
        tenantId: TENANT_A,
        conversationId: A.conversation.id,
        customerId: A.customer.id,
        direction: 'INBOUND',
        type: 'TEXT',
        status: 'RECEIVED',
        body: 'hello',
        waMessageId: 'wamid.status.inbound',
      },
    });

    await deliver(statusWebhook({
      phoneNumberId: PHONE_A, waMessageId: 'wamid.status.inbound', status: 'delivered',
    }));
    await new Promise((resolve) => { setTimeout(resolve, 300); });

    const row = await statusOf(inbound.id);
    expect(row.status).toBe('RECEIVED');
    expect(row.deliveredAt).toBeNull();
  });
});

describe('a status we cannot use', () => {
  it('**does not cost us an inbound message in the same request**', async () => {
    /*
     * The silent-loss bug, reproduced faithfully. One entry, two changes: an unmodelled status
     * first, an ordinary customer message second. `applyStatusUpdates` used to run before
     * `recordInboundEvents` and threw on the unknown word; the throw reached the entry-loop catch
     * and abandoned the second change entirely. Meta had already been sent a 200, so it never
     * retried and the customer's message was gone with nothing to show it had arrived.
     */
    const response = await deliver({
      object: 'whatsapp_business_account',
      entry: [{
        changes: [
          {
            value: {
              metadata: { phone_number_id: PHONE_A },
              statuses: [{
                id: 'wamid.status.shared', status: 'deleted', recipient_id: '1', timestamp: String(DELIVERED_AT),
              }],
            },
          },
          {
            value: {
              metadata: { phone_number_id: PHONE_A },
              contacts: [{ wa_id: A.customer.waId, profile: { name: 'Asha' } }],
              messages: [{
                id: 'wamid.status.survivor',
                from: A.customer.waId,
                type: 'text',
                text: { body: 'did you get this?' },
                timestamp: String(DELIVERED_AT),
              }],
            },
          },
        ],
      }],
    });

    expect(response.status).toBe(200);

    // The message that must survive.
    await waitFor('the inbound message to be recorded', () => prisma.webhookEvent.findFirst({
      where: { externalEventId: 'wamid.status.survivor' },
    }));

    // And the unknown status changed nothing.
    const row = await statusOf(A.message.id);
    expect(row.status).toBe('SENT');
  });

  it('shrugs off a status for a wamid we have never seen', async () => {
    const response = await deliver(statusWebhook({
      phoneNumberId: PHONE_A, waMessageId: 'wamid.status.nobody', status: 'read',
    }));
    expect(response.status).toBe(200);

    await new Promise((resolve) => { setTimeout(resolve, 300); });
    expect((await statusOf(A.message.id)).status).toBe('SENT');
  });
});

describe('campaign recipients', () => {
  /** A campaign whose one recipient shares the message's wamid, as the sender writes it. */
  const makeCampaign = async (status: 'PENDING' | 'SENT' | 'SKIPPED_OPTED_OUT') => {
    const template = await prisma.campaignTemplate.create({
      data: {
        tenantId: TENANT_A,
        name: `status-${status}`,
        metaTemplate: 'promo_v1',
        bodyPreview: 'Hello',
        status: 'APPROVED',
        category: 'MARKETING',
        headerFormat: 'NONE',
      },
    });
    const campaign = await prisma.campaign.create({
      data: { tenantId: TENANT_A, name: 'Promo', templateId: template.id },
    });
    const sentAt = status === 'SENT' ? new Date(DELIVERED_AT * 1000) : null;
    const recipient = await prisma.campaignRecipient.create({
      data: {
        campaignId: campaign.id,
        customerId: A.customer.id,
        status,
        waMessageId: 'wamid.status.shared',
        messageId: status === 'SENT' ? A.message.id : null,
        sentAt,
      },
    });
    return recipient;
  };

  it('**advance with the message, which nothing has ever made them do**', async () => {
    // DELIVERED, READ, deliveredAt and readAt were dead columns: `CampaignDetail.tsx` has
    // rendered labels for them all along and the report could only ever show sent and failed.
    const recipient = await makeCampaign('SENT');

    await deliver(statusWebhook({ phoneNumberId: PHONE_A, waMessageId: 'wamid.status.shared', status: 'delivered' }));
    await settlesAt(A.message.id, 'DELIVERED');
    await deliver(statusWebhook({
      phoneNumberId: PHONE_A, waMessageId: 'wamid.status.shared', status: 'read', timestamp: READ_AT,
    }));
    await settlesAt(A.message.id, 'READ');

    const after = await waitFor('the recipient to reach READ', async () => {
      const row = await prisma.campaignRecipient.findUnique({ where: { id: recipient.id } });
      return row?.status === 'READ' ? row : null;
    });

    expect(after.deliveredAt).toEqual(new Date(DELIVERED_AT * 1000));
    expect(after.readAt).toEqual(new Date(READ_AT * 1000));
    // The sender's own writes survive.
    expect(after.sentAt).toEqual(new Date(DELIVERED_AT * 1000));
    expect(after.messageId).toBe(A.message.id);
  });

  it('**will not turn an honoured opt-out into a delivery**', async () => {
    // SKIPPED_OPTED_OUT is off the ladder. Nothing Meta says may turn "we chose not to message
    // this person" into "we messaged this person".
    const recipient = await makeCampaign('SKIPPED_OPTED_OUT');

    await deliver(statusWebhook({ phoneNumberId: PHONE_A, waMessageId: 'wamid.status.shared', status: 'delivered' }));
    await settlesAt(A.message.id, 'DELIVERED');

    const after = await prisma.campaignRecipient.findUnique({ where: { id: recipient.id } });
    expect(after!.status).toBe('SKIPPED_OPTED_OUT');
    expect(after!.deliveredAt).toBeNull();
  });

  it('leaves a still-PENDING recipient alone', async () => {
    // A status against a PENDING row means the sender's write has not landed. Advancing it would
    // leave a recipient that is "delivered" with no sentAt and no linked Message.
    const recipient = await makeCampaign('PENDING');

    await deliver(statusWebhook({ phoneNumberId: PHONE_A, waMessageId: 'wamid.status.shared', status: 'delivered' }));
    await settlesAt(A.message.id, 'DELIVERED');

    const after = await prisma.campaignRecipient.findUnique({ where: { id: recipient.id } });
    expect(after!.status).toBe('PENDING');
    expect(after!.deliveredAt).toBeNull();
  });
});
