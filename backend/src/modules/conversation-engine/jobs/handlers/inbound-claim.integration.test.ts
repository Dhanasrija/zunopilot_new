import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../../../config/prisma.js';
import { handleProcessInboundMessage } from './process-inbound.js';

// How a customer's backlog gets claimed.
//
// The ordering guarantee here is load-bearing: two messages from one customer become two jobs,
// the worker pool gives no ordering promise, and processing "2 large" before "I want pizza"
// corrupts a workflow's state. That used to be enforced by holding an advisory lock — a database
// transaction — around the whole drain, including two LLM calls and an HTTP POST per message. The
// lock is now held only long enough to *claim* the batch, and the work happens outside it.
//
// **These tests are about the claim, not the reply.** No channel is registered for the
// `phone_number_id`s below, so each event resolves to `IGNORED` immediately — which is the point:
// it exercises the claim, the ordering and the cap without dragging the router, an LLM or Meta
// into a unit test. `processedAt` ordering is the observable that matters.

const CHANNEL = 'claim-test-channel-1';
const OTHER_CHANNEL = 'claim-test-channel-2';
const CUSTOMER = '15550007001';

const event = async (args: {
  channel?: string;
  from?: string;
  text: string;
  createdAt: Date;
  status?: 'PENDING' | 'FAILED' | 'PROCESSING' | 'PROCESSED';
}) => prisma.webhookEvent.create({
  data: {
    source: 'whatsapp',
    eventType: 'messages',
    externalEventId: `claim-test-${args.text}-${args.createdAt.getTime()}-${args.channel ?? CHANNEL}`,
    processingStatus: args.status ?? 'PENDING',
    createdAt: args.createdAt,
    payload: {
      phoneNumberId: args.channel ?? CHANNEL,
      message: {
        externalId: `wamid.claim.${args.text}.${args.createdAt.getTime()}`,
        from: args.from ?? CUSTOMER,
        profileName: 'Claim Test',
        type: 'text',
        text: args.text,
        interactive: null,
        location: null,
        raw: {},
      },
    } as unknown as Prisma.InputJsonValue,
  },
});

const at = (secondsAgo: number) => new Date(Date.now() - secondsAgo * 1000);

const wipe = () => prisma.webhookEvent.deleteMany({
  where: { externalEventId: { startsWith: 'claim-test-' } },
});

beforeEach(wipe);
afterAll(async () => {
  await wipe();
  await prisma.$disconnect();
});

/** Which events are no longer waiting, oldest-handled first. */
const settledOrder = async () => {
  const rows = await prisma.webhookEvent.findMany({
    where: { externalEventId: { startsWith: 'claim-test-' }, processedAt: { not: null } },
    orderBy: { processedAt: 'asc' },
    select: { payload: true },
  });
  return rows.map((r) => (r.payload as { message?: { text?: string } }).message?.text);
};

describe('claiming a customer’s backlog', () => {
  it('**processes oldest first, whichever job happens to run**', async () => {
    // The job is handed the *newest* event, which is what really happens: each message enqueues
    // its own job and the last one can win the race. It must still drain in arrival order.
    await event({ text: 'first', createdAt: at(30) });
    await event({ text: 'second', createdAt: at(20) });
    const newest = await event({ text: 'third', createdAt: at(10) });

    await handleProcessInboundMessage({ webhookEventId: newest.id });

    expect(await settledOrder()).toEqual(['first', 'second', 'third']);
  });

  it('**caps the drain, so one conversation cannot own a worker for minutes**', async () => {
    // Was 50 events × ~2.65 s each ≈ two minutes holding a slot while other tenants queued.
    for (let i = 0; i < 12; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await event({ text: `m${i}`, createdAt: at(100 - i) });
    }
    const trigger = await prisma.webhookEvent.findFirstOrThrow({
      where: { externalEventId: { startsWith: 'claim-test-' } },
    });

    await handleProcessInboundMessage({ webhookEventId: trigger.id });

    const done = await settledOrder();
    expect(done.length).toBe(8);
    // The remainder is still queued, not lost — the next job for this customer takes it.
    expect(await prisma.webhookEvent.count({
      where: { externalEventId: { startsWith: 'claim-test-' }, processingStatus: 'PENDING' },
    })).toBe(4);
  });

  it('**a second job for the same customer takes nothing, rather than double-processing**', async () => {
    // This is what the lock buys. Both jobs run; only one may claim.
    const a = await event({ text: 'only-once', createdAt: at(30) });
    const b = await event({ text: 'also-once', createdAt: at(20) });

    await Promise.all([
      handleProcessInboundMessage({ webhookEventId: a.id }),
      handleProcessInboundMessage({ webhookEventId: b.id }),
    ]);

    const done = await settledOrder();
    // Each event appears exactly once, in order.
    expect(done).toEqual(['only-once', 'also-once']);
  });

  it('**reclaims work a crashed process abandoned**', async () => {
    // A row left PROCESSING by a worker that died. Without the reclaim it is stranded forever and
    // that customer can never be answered again.
    const abandoned = await event({
      text: 'abandoned', createdAt: at(3600), status: 'PROCESSING',
    });
    const fresh = await event({ text: 'fresh', createdAt: at(5) });

    await handleProcessInboundMessage({ webhookEventId: fresh.id });

    expect(await settledOrder()).toEqual(['abandoned', 'fresh']);
    expect((await prisma.webhookEvent.findUniqueOrThrow({ where: { id: abandoned.id } })).processedAt)
      .not.toBeNull();
  });

  it('does not reclaim a PROCESSING row that is plausibly still running', async () => {
    const inFlight = await event({ text: 'in-flight', createdAt: at(5), status: 'PROCESSING' });
    const fresh = await event({ text: 'other', createdAt: at(2) });

    await handleProcessInboundMessage({ webhookEventId: fresh.id });

    expect((await prisma.webhookEvent.findUniqueOrThrow({ where: { id: inFlight.id } })).processedAt)
      .toBeNull();
  });

  it('**never steals another channel’s events for the same phone number**', async () => {
    // One person can message two businesses on this platform. The old query filtered on
    // `message.from` alone, so either tenant's job could pull the other's events into its drain.
    const mine = await event({ text: 'mine', createdAt: at(30) });
    const theirs = await event({ text: 'theirs', createdAt: at(29), channel: OTHER_CHANNEL });

    await handleProcessInboundMessage({ webhookEventId: mine.id });

    expect(await settledOrder()).toEqual(['mine']);
    expect((await prisma.webhookEvent.findUniqueOrThrow({ where: { id: theirs.id } })).processingStatus)
      .toBe('PENDING');
  });
});

describe('how long the lock is held', () => {
  it('**the claim fits inside a 10s transaction, which the old drain could not**', async () => {
    /*
     * The structural proof, and worth explaining because the obvious test is a bad one.
     *
     * Asserting "no connection is idle in transaction" *after* the handler returns proves
     * nothing — the transaction commits when the callback ends either way, so the old code
     * passed that too. The real property is how much work sits inside the transaction, and the
     * evidence for it is the timeout the code now runs under.
     *
     * `withAdvisoryLock` defaults to a 10-second transaction timeout. The old drain needed
     * `{ timeoutMs: 60_000 }` because it held the lock across up to 50 messages, each making two
     * LLM calls and an HTTP POST. This asserts the override is gone: the claim now completes
     * under the default, which a drain spanning network I/O could not do. If someone moves
     * processing back inside the lock, this fails — either on the timeout, or on the grep below.
     */
    const source = await (await import('node:fs/promises'))
      .readFile(new URL('./process-inbound.ts', import.meta.url), 'utf-8');

    expect(source).not.toContain('timeoutMs: 60_000');
    // The lock callback must hand back ids to process, not do the processing itself.
    expect(source).toMatch(/const claimed = await withAdvisoryLock\(/);
    expect(source).toMatch(/for \(const id of claimed\)/);

    // And it genuinely runs under the default timeout.
    await event({ text: 'x', createdAt: at(10) });
    const trigger = await prisma.webhookEvent.findFirstOrThrow({
      where: { externalEventId: { startsWith: 'claim-test-' } },
    });
    await expect(handleProcessInboundMessage({ webhookEventId: trigger.id })).resolves.toBeUndefined();
  });
});
