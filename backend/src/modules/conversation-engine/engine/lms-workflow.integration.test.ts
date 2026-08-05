import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import { execFileSync } from 'node:child_process';
import { prisma } from '../../../config/prisma.js';
import { mockServices, type MockWhatsAppProvider } from '../providers/mock.js';
import { parseDefinition } from '../domain/definition.js';
import { validateWorkflowDefinition } from '../validation/definition-validator.js';
import { type WalkDeps } from './walker.js';
import { createJourneyDriver } from './journey-driver.js';

// The class-cancellation journey, end to end.
//
// This is the proof that connectors are the right abstraction: the flow is
// built entirely from registered operations and node types that already
// existed, and nothing in the engine knows what an LMS is.
//
// It runs against the *seeded* workflow rather than a copy, so the test fails
// if the demo drifts from what it claims to demonstrate.

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
    data: { tenantId: TENANT_ID, waId, name: 'Test Parent' },
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
    latestMessage: { id: 'msg-lms', body: 'I want to cancel a class', type: 'TEXT', payload: null },
  };
};

beforeEach(async () => {
  seeded();
  const workflow = await prisma.workflow.findFirstOrThrow({
    where: { tenantId: TENANT_ID, slug: 'cancel_class' },
  });
  workflowId = workflow.id;
  // The published version, which is what `startInstance` used to pin implicitly.
  // Named explicitly now, so the "error branch" test below — which edits the newest
  // version's definition in place — is unambiguous about which graph it changed.
  versionId = workflow.publishedVersionId!;
  await openConversation('15550007001'); // Anita Sharma, two students
});

afterAll(async () => {
  // Deliberately does **not** delete the tenant.
  //
  // This suite shares tenant `6666…` with `prisma/seed-lms.ts` on purpose — it
  // runs against the seeded workflow so the test fails if the demo drifts from
  // what it demonstrates. But deleting it here meant every `npm test` silently
  // destroyed the Bright Minds demo workspace, so the connectors demo was gone
  // the next time anyone looked for it.
  //
  // `beforeEach` re-seeds, so the suite never depends on what it left behind.
  // Leaving it in place means the demo is present and freshly seeded after a
  // test run instead of missing.
  await prisma.$disconnect();
});

// `begin`, `reply`, `rowsOf` and `current` used to be defined here. They now come
// from `journey-driver.ts` so the generator's dry-run loop drives a draft with the
// same code that drives this one — if the two diverged, the loop would be testing a
// journey no customer takes. This suite passing unchanged is what proves the
// extraction was faithful.
//
// The driver runs with `dryRun: false` here on purpose: this suite asserts on
// `connectorCall` rows and on the mock LMS actually being asked to cancel a class,
// which a dry run would suppress.
const driver = () => createJourneyDriver({
  tenantId: TENANT_ID, workflowId, versionId, conversationId, deps, whatsapp, dryRun: false,
});

const current = () => driver().current();
const begin = () => driver().begin();
const reply = (text: string, id?: string) => driver().reply(text, id);
const rowsOf = (index = 0) => driver().rowsOf(index);

const cancelCalls = () => prisma.connectorCall.count({
  where: { tenantId: TENANT_ID, operation: { key: 'cancel_class' } },
});

describe('cancelling a class', () => {
  it('verifies the caller and offers only their own students', async () => {
    const parked = await begin();

    expect(parked.waitingNodeId).toBe('pick_student');
    expect(rowsOf().map((r) => r.id)).toEqual(['S-2001', 'S-2002']);
    // The greeting proves the parent lookup's response reached a template.
    expect(whatsapp.sent[0]?.body).toContain('Anita Sharma');
  });

  it('shows the next three classes for the chosen student', async () => {
    await begin();
    whatsapp.reset();

    await reply('Ishaan Sharma', 'S-2001');

    const parked = await current();
    expect(parked.waitingNodeId).toBe('pick_class');
    // Four exist in the fixture; the operation was asked for three.
    expect(rowsOf().map((r) => r.id)).toEqual(['C-3001', 'C-3002', 'C-3003']);
  });

  it('cancels only after the confirmation tap', async () => {
    await begin();
    await reply('Ishaan Sharma', 'S-2001');
    await reply('Physics', 'C-3002');

    const parked = await current();
    expect(parked.waitingNodeId).toBe('confirm_cancel');
    expect(await cancelCalls()).toBe(0);

    whatsapp.reset();
    const finish = await reply('Yes, cancel it', 'confirm_cancel');

    expect(finish.walk?.status).toBe('COMPLETED');
    expect(await cancelCalls()).toBe(1);
    expect((await current()).variables).toMatchObject({
      cancellation: { cancelled: true, reference: 'CAN-C-3002' },
    });
    expect(whatsapp.bodies().join(' ')).toContain('CAN-C-3002');
  });

  it('calls nothing when the parent declines', async () => {
    await begin();
    await reply('Ishaan Sharma', 'S-2001');
    await reply('Physics', 'C-3002');
    await reply('No, keep it', 'keep_class');

    expect((await current()).status).toBe('CANCELLED');
    expect(await cancelCalls()).toBe(0);
  });

  it('hands an unregistered number to a person, and never lists a student', async () => {
    await openConversation('15559990000');
    await begin();

    const instance = await current();
    expect(instance.status).toBe('PAUSED');
    expect(instance.currentNodeId).toBe('not_registered');
    // The privacy property that matters: no student names reached a stranger.
    expect(whatsapp.sent.every((m) => m.kind === 'text')).toBe(true);
    expect(whatsapp.bodies().join(' ')).not.toContain('Sharma');
  });

  it('takes the error branch when the LMS refuses the cancellation', async () => {
    // C-3004 is inside its notice window in the fixture. It is the fourth
    // class, so it is only reachable by asking for more than three.
    const version = await prisma.workflowVersion.findFirstOrThrow({
      where: { workflow: { id: workflowId } }, orderBy: { version: 'desc' },
    });
    const definition = parseDefinition(version.definition);
    const load = definition.nodes.find((n) => n.id === 'load_classes')!;
    (load.config as { inputs: Array<{ key: string; value: string }> }).inputs = [
      { key: 'student_id', value: '{{vars.student_id}}' },
      { key: 'limit', value: '4' },
    ];
    await prisma.workflowVersion.update({
      where: { id: version.id },
      data: { definition: definition as unknown as Prisma.InputJsonValue },
    });

    await begin();
    await reply('Ishaan Sharma', 'S-2001');
    await reply('Biology', 'C-3004');
    await reply('Yes, cancel it', 'confirm_cancel');

    const instance = await current();
    expect(instance.currentNodeId).toBe('cancel_refused');
    expect(instance.status).toBe('PAUSED');
  });
});

describe('the publish rule that protects the write', () => {
  it('refuses to publish the flow if the confirmation is removed', async () => {
    const version = await prisma.workflowVersion.findFirstOrThrow({
      where: { workflow: { id: workflowId } }, orderBy: { version: 'desc' },
    });
    const definition = parseDefinition(version.definition);
    const capability = await prisma.workflowCapability.findFirstOrThrow({ where: { workflowId } });

    const result = validateWorkflowDefinition({
      definition,
      category: 'CONVERSATION',
      capability: { ...capability, requiresConfirmation: false } as never,
      slug: 'cancel_class',
    });

    // A CONNECTOR_ACTION is a declared side effect, so clearing the flag has to
    // block the publish. This is the rule that stops "what classes does my son
    // have?" from cancelling one.
    expect(result.valid).toBe(false);
    expect(result.issues.map((i) => i.code)).toContain('SIDE_EFFECT_WITHOUT_CONFIRMATION');
  });
});
