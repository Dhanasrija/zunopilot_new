import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { prisma } from '../../../config/prisma.js';
import { mockServices, type MockWhatsAppProvider } from '../providers/mock.js';
import type { WalkDeps } from './walker.js';
import { driveJourney } from './journey-driver.js';

// Driving a whole journey without a person.
//
// **The claim being tested is a negative about the old behaviour.** `testWorkflow`
// runs one `walk`, which parks at the first interactive node — for the class
// cancellation flow that is `pick_student`, step 2 of 8. It then reports success. Every
// fault that reached a real parent lived after that park.
//
// So the assertion that matters below is not "it completed" but **which nodes it
// reached**: the confirmation and the cancellation are on the far side of three
// separate waits, and only a driver that answers and re-enters gets there.
//
// Run against the seeded LMS demo, the same fixture `lms-workflow.integration.test.ts`
// uses, because it is a real flow with recorded samples on every operation — which is
// the dry run's hard precondition.

const TENANT_ID = '66666666-6666-6666-6666-666666666666';

let workflowId: string;
let versionId: string;
let conversationId: string;
let deps: WalkDeps;
let whatsapp: MockWhatsAppProvider;

const seeded = () => {
  execFileSync('npx', ['tsx', 'prisma/seed-lms.ts'], { stdio: 'pipe' });
};

const openConversation = async (waId: string) => {
  const channel = await prisma.whatsappAccount.findFirstOrThrow({ where: { tenantId: TENANT_ID } });
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: TENANT_ID } });
  const contact = await prisma.customer.create({
    data: { tenantId: TENANT_ID, waId, name: 'Driven Parent' },
  });
  const conversation = await prisma.conversation.create({
    data: { tenantId: TENANT_ID, customerId: contact.id, status: 'OPEN' },
  });

  const services = mockServices();
  whatsapp = services.whatsapp;
  conversationId = conversation.id;
  deps = {
    tenant,
    contact,
    conversation,
    channel,
    assistantId: null,
    services,
    latestMessage: { id: 'msg-drive', body: 'I want to cancel a class', type: 'TEXT', payload: null },
  };
};

beforeEach(async () => {
  seeded();
  const workflow = await prisma.workflow.findFirstOrThrow({
    where: { tenantId: TENANT_ID, slug: 'cancel_class' },
  });
  workflowId = workflow.id;
  versionId = workflow.publishedVersionId!;
  await openConversation('15550007001'); // Anita Sharma, two students
});

afterAll(async () => {
  // Same reasoning as the LMS suite: this tenant is the connectors demo, and deleting
  // it here would destroy the Bright Minds workspace on every `npm test`.
  await prisma.$disconnect();
});

const drive = () => driveJourney({
  tenantId: TENANT_ID, workflowId, versionId, conversationId, deps, whatsapp,
});

describe('driving the class cancellation flow', () => {
  it('**gets past the first park, where one walk stops**', async () => {
    const report = await drive();

    // `pick_student` is where `testWorkflow` ends and reports success.
    expect(report.reached).toContain('pick_student');
    // These three are the entire point: they are unreachable without answering.
    expect(report.reached).toContain('pick_class');
    expect(report.reached).toContain('confirm_cancel');
    expect(report.reached).toContain('do_cancel');
    expect(report.turns).toBeGreaterThanOrEqual(3);
  });

  it('reaches a terminal state rather than stalling', async () => {
    const report = await drive();
    expect(report.outcome).toBe('COMPLETED');
  });

  it('**reports no failed node**, which is the mechanical check', async () => {
    const report = await drive();
    expect(report.failures).toEqual([]);
  });

  it('finds rows to tap at every list, so the samples are being used', async () => {
    // A dry run returns each operation's recorded `sampleResponse`. An operation
    // without one yields `{dryRun: true}` and no rows, which is the precondition
    // this asserts is met rather than silently working around.
    const report = await drive();
    expect(report.emptyChoices).toEqual([]);
  });

  it('**sends nothing at all**, which is what a dry run has to mean', async () => {
    // Every interactive executor guards its send with `if (!dryRun)`. So the report's
    // `messages` is empty here by design — and it is also why the driver reads the
    // ids it taps out of the `NodeExecution` output rather than out of the outbound
    // message, which is the only source that exists in both modes.
    const report = await drive();
    expect(report.messages).toEqual([]);
    expect(report.reached).toContain('do_cancel');
  });

  it('collects the messages when driven live', async () => {
    const report = await driveJourney({
      tenantId: TENANT_ID, workflowId, versionId, conversationId, deps, whatsapp, dryRun: false,
    });
    expect(report.messages.join(' ')).toContain('Anita Sharma');
  });
});

describe('what a dry run cannot see', () => {
  it('**takes the registered branch for an unregistered number**', async () => {
    // The single most important caveat about this whole layer, and it is not a bug —
    // it is what `dryRun` means. A dry run returns each operation's recorded
    // `sampleResponse` instead of calling anything, so the parent lookup "finds" the
    // sample parent no matter whose number is on the conversation. The
    // not-registered branch is therefore unreachable under a dry run.
    //
    // So the driver checks that a graph is **wired** so every node can run, not that
    // it behaves correctly on real data. Anything that depends on what a connector
    // actually returns needs a live run. Stating it as a passing test rather than a
    // comment, because a future change that made this branch reachable would be a
    // change in what the driver can promise.
    await openConversation('15559990001');

    const report = await drive();

    expect(report.outcome).toBe('COMPLETED');
    expect(report.reached).toContain('do_cancel');
  });

  it('**does reach the handoff when driven live**', async () => {
    // The same journey, actually calling the mock LMS, which has no such parent. This
    // is the contrast that makes the caveat above concrete.
    await openConversation('15559990002');

    const report = await driveJourney({
      tenantId: TENANT_ID, workflowId, versionId, conversationId, deps, whatsapp, dryRun: false,
    });

    expect(report.outcome).not.toBe('COMPLETED');
    // `endedAt`, not `reached`: the run comes to rest *on* the handoff node, and a
    // node that pauses a run is not necessarily recorded as an execution.
    expect(report.endedAt).toBe('not_registered');
    expect(report.reached).not.toContain('do_cancel');
    // The privacy property, restated because the driver is a new caller: no student
    // names went to a stranger.
    expect(report.messages.join(' ')).not.toContain('Sharma');
  });
});
