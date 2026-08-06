import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import { prisma } from '../../../config/prisma.js';
import { mockServices, type MockWhatsAppProvider } from '../providers/mock.js';
import type { WorkflowDefinition } from '../domain/definition.js';
import {
  ActiveInstanceExistsError, WorkflowNotPublishedError,
  findActiveInstance, startInstance,
} from './instance-manager.js';
import { walk, type WalkDeps } from './walker.js';
import { resumeWithUserInput } from './resume.js';

// End-to-end against a real Postgres, because the properties that matter here
// are database properties: the partial unique index that prevents two live
// instances, and the transaction boundaries around parking and resuming.
// Mocking Prisma would test the mock.

const TEST_TENANT = '11111111-1111-1111-1111-111111111111';

const definition: WorkflowDefinition = {
  schemaVersion: '1.0',
  entryNodeId: 'entry',
  nodes: [
    { id: 'entry', type: 'ASSISTANT_ROUTE_ENTRY', position: { x: 0, y: 0 }, config: { acceptedIntents: [] } },
    {
      id: 'ask_speciality',
      type: 'ASK_USER_INPUT',
      position: { x: 0, y: 1 },
      config: {
        prompt: 'Which speciality would you like to consult?',
        variableName: 'speciality',
        inputType: 'string',
        required: true,
        validation: { minLength: 3 },
        retryMessage: 'Please give a speciality, e.g. Cardiology.',
        maxRetries: 3,
      },
    },
    {
      id: 'check_slots',
      type: 'HTTP_REQUEST',
      position: { x: 0, y: 2 },
      config: {
        method: 'GET',
        url: 'https://api.acme-hospital.test/availability',
        query: { speciality: '{{vars.speciality}}' },
        mockService: 'doctorAvailability',
        outputVariable: 'availability',
      },
    },
    {
      id: 'offer',
      type: 'SEND_WHATSAPP_MESSAGE',
      position: { x: 0, y: 3 },
      config: { body: 'Earliest with {{vars.availability.doctor}}: {{vars.availability.slots}}' },
    },
    { id: 'done', type: 'END_WORKFLOW', position: { x: 0, y: 4 }, config: { outcome: 'COMPLETED' } },
  ],
  edges: [
    { id: 'e1', source: 'entry', target: 'ask_speciality' },
    { id: 'e2', source: 'ask_speciality', target: 'check_slots' },
    { id: 'e3', source: 'check_slots', target: 'offer', sourceHandle: 'success' },
    { id: 'e4', source: 'offer', target: 'done' },
  ],
};

let workflowId: string;
let conversationId: string;
let deps: WalkDeps;
let whatsapp: MockWhatsAppProvider;

const seed = async () => {
  await prisma.tenant.upsert({
    where: { id: TEST_TENANT },
    update: {},
    create: { id: TEST_TENANT, businessName: 'Engine Test Hospital', category: 'RESTAURANT' },
  });

  const channel = await prisma.whatsappAccount.upsert({
    where: { tenantId_phoneNumberId: { tenantId: TEST_TENANT, phoneNumberId: 'pn-test' } },
    update: {},
    create: {
      tenantId: TEST_TENANT, wabaId: 'waba-test', phoneNumberId: 'pn-test',
      accessToken: 'token-test', displayPhone: '+1 555 000 0000',
    },
  });

  const workflow = await prisma.workflow.create({
    data: {
      tenantId: TEST_TENANT,
      name: 'Appointment Booking (test)',
      slug: `booking_${Date.now()}`,
      category: 'CONVERSATION',
      status: 'PUBLISHED',
    },
  });

  const version = await prisma.workflowVersion.create({
    data: {
      workflowId: workflow.id,
      version: 1,
      definition: definition as unknown as Prisma.InputJsonValue,
      publishedAt: new Date(),
    },
  });

  await prisma.workflow.update({
    where: { id: workflow.id },
    data: { publishedVersionId: version.id },
  });

  const contact = await prisma.customer.upsert({
    where: { tenantId_waId: { tenantId: TEST_TENANT, waId: '15550009911' } },
    update: {},
    create: { tenantId: TEST_TENANT, waId: '15550009911', name: 'Test Patient' },
  });

  const conversation = await prisma.conversation.create({
    data: { tenantId: TEST_TENANT, customerId: contact.id, status: 'OPEN' },
  });

  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: TEST_TENANT } });
  const services = mockServices();
  whatsapp = services.whatsapp;

  workflowId = workflow.id;
  conversationId = conversation.id;
  deps = {
    tenant, contact, conversation, channel,
    assistantId: null,
    services,
    latestMessage: { id: 'msg-1', body: 'I want to book an appointment', type: 'TEXT', payload: null },
  };
};

const wipe = async () => {
  await prisma.tenant.deleteMany({ where: { id: TEST_TENANT } });
};

beforeEach(async () => {
  await wipe();
  await seed();
});

afterAll(async () => {
  await wipe();
  await prisma.$disconnect();
});

describe('starting a workflow', () => {
  it('pins the published version and claims the conversation', async () => {
    const { instance } = await startInstance({
      tenantId: TEST_TENANT, workflowId, conversationId,
      extractedInputs: { patient_name: 'Asha' },
    });

    expect(instance.status).toBe('RUNNING');
    expect(instance.currentNodeId).toBe('entry');
    expect(instance.variables).toEqual({ patient_name: 'Asha' });

    const conversation = await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } });
    expect(conversation.activeWorkflowInstanceId).toBe(instance.id);
  });

  it('refuses to start a draft workflow', async () => {
    await prisma.workflow.update({ where: { id: workflowId }, data: { status: 'DRAFT' } });
    await expect(startInstance({ tenantId: TEST_TENANT, workflowId, conversationId }))
      .rejects.toBeInstanceOf(WorkflowNotPublishedError);
  });

  it('never lets two workflows become active for one conversation', async () => {
    // The core guarantee. Two inbound messages racing must not both start a
    // workflow — the partial unique index makes the second one lose.
    await startInstance({ tenantId: TEST_TENANT, workflowId, conversationId });
    await expect(startInstance({ tenantId: TEST_TENANT, workflowId, conversationId }))
      .rejects.toBeInstanceOf(ActiveInstanceExistsError);

    const live = await prisma.workflowInstance.count({
      where: { conversationId, status: { in: ['PENDING', 'RUNNING', 'WAITING_FOR_USER', 'PAUSED'] } },
    });
    expect(live).toBe(1);
  });

  it('holds even when both starts are issued concurrently', async () => {
    const results = await Promise.allSettled([
      startInstance({ tenantId: TEST_TENANT, workflowId, conversationId }),
      startInstance({ tenantId: TEST_TENANT, workflowId, conversationId }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
  });
});

describe('walking and waiting', () => {
  it('runs to the first question and parks', async () => {
    const { instance, definition: def } = await startInstance({
      tenantId: TEST_TENANT, workflowId, conversationId,
    });
    const outcome = await walk({ instance, definition: def, deps });

    expect(outcome.status).toBe('WAITING_FOR_USER');
    expect(whatsapp.bodies()).toEqual(['Which speciality would you like to consult?']);

    const parked = await prisma.workflowInstance.findUniqueOrThrow({ where: { id: instance.id } });
    expect(parked.status).toBe('WAITING_FOR_USER');
    expect(parked.waitingNodeId).toBe('ask_speciality');
    expect(parked.waitingVariableName).toBe('speciality');

    // The entry node ran, the question node is open awaiting an answer, and
    // nothing past it has run.
    const executions = await prisma.nodeExecution.findMany({
      where: { workflowInstanceId: instance.id }, orderBy: { startedAt: 'asc' },
    });
    expect(executions.map((e) => [e.nodeId, e.status])).toEqual([
      ['entry', 'SUCCESS'],
      ['ask_speciality', 'WAITING'],
    ]);
  });
});

describe('resuming on the next message', () => {
  const startAndPark = async () => {
    const { instance, definition: def } = await startInstance({
      tenantId: TEST_TENANT, workflowId, conversationId,
    });
    await walk({ instance, definition: def, deps });
    whatsapp.reset();
    return prisma.workflowInstance.findUniqueOrThrow({ where: { id: instance.id } });
  };

  it('continues the SAME workflow and completes it', async () => {
    const parked = await startAndPark();

    const result = await resumeWithUserInput({ instance: parked, deps, answer: 'Cardiology' });

    expect(result.outcome).toBe('CONTINUED');
    expect(result.walk?.status).toBe('COMPLETED');

    // The mock availability service is keyed off the speciality, so this also
    // proves the answer reached the HTTP node through variables.
    expect(whatsapp.bodies()).toEqual([
      'Earliest with Dr Rao: ["10:00","11:30","16:00"]',
    ]);

    const finished = await prisma.workflowInstance.findUniqueOrThrow({ where: { id: parked.id } });
    expect(finished.status).toBe('COMPLETED');
    expect(finished.variables).toMatchObject({ speciality: 'Cardiology' });

    // The conversation is released, so the next message routes afresh.
    const conversation = await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } });
    expect(conversation.activeWorkflowInstanceId).toBeNull();
  });

  it('closes out the waiting node rather than leaving it open', async () => {
    const parked = await startAndPark();
    await resumeWithUserInput({ instance: parked, deps, answer: 'Cardiology' });

    const ask = await prisma.nodeExecution.findFirstOrThrow({
      where: { workflowInstanceId: parked.id, nodeId: 'ask_speciality' },
    });
    expect(ask.status).toBe('SUCCESS');
    expect(ask.output).toMatchObject({ answered: true, value: 'Cardiology' });
  });

  it('re-prompts an invalid answer without advancing', async () => {
    const parked = await startAndPark();

    const result = await resumeWithUserInput({ instance: parked, deps, answer: 'x' });

    expect(result.outcome).toBe('REPROMPTED');
    expect(whatsapp.bodies()).toEqual(['Please give a speciality, e.g. Cardiology.']);

    const still = await prisma.workflowInstance.findUniqueOrThrow({ where: { id: parked.id } });
    expect(still.status).toBe('WAITING_FOR_USER');
    expect(still.retryCount).toBe(1);
    expect((still.variables as Record<string, unknown>).speciality).toBeUndefined();
  });

  it('hands off rather than looping forever on repeated bad answers', async () => {
    let current = await startAndPark();

    for (let i = 0; i < 3; i += 1) {
      await resumeWithUserInput({ instance: current, deps, answer: 'x' });
      current = await prisma.workflowInstance.findUniqueOrThrow({ where: { id: current.id } });
    }

    expect(current.status).toBe('PAUSED');

    const conversation = await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } });
    expect(conversation.status).toBe('HUMAN_TAKEOVER');
    expect(conversation.automationPaused).toBe(true);

    const handoff = await prisma.humanHandoff.findFirst({ where: { conversationId } });
    expect(handoff).not.toBeNull();
  });

  it('keeps running against the pinned version after the workflow is edited', async () => {
    const parked = await startAndPark();

    // Publish a completely different graph mid-conversation.
    const v2 = await prisma.workflowVersion.create({
      data: {
        workflowId,
        version: 2,
        definition: {
          schemaVersion: '1.0',
          entryNodeId: 'entry',
          nodes: [{ id: 'entry', type: 'ASSISTANT_ROUTE_ENTRY', position: { x: 0, y: 0 }, config: {} }],
          edges: [],
        } as unknown as Prisma.InputJsonValue,
        publishedAt: new Date(),
      },
    });
    await prisma.workflow.update({ where: { id: workflowId }, data: { publishedVersionId: v2.id } });

    const result = await resumeWithUserInput({ instance: parked, deps, answer: 'Cardiology' });

    // Still finishes the v1 flow it started on, including the v1 offer message.
    expect(result.walk?.status).toBe('COMPLETED');
    expect(whatsapp.bodies()).toEqual(['Earliest with Dr Rao: ["10:00","11:30","16:00"]']);
  });
});

describe('loop protection', () => {
  it('fails a run that cycles instead of walking forever', async () => {
    const looping = await prisma.workflowVersion.create({
      data: {
        workflowId,
        version: 3,
        definition: {
          schemaVersion: '1.0',
          entryNodeId: 'entry',
          nodes: [
            { id: 'entry', type: 'ASSISTANT_ROUTE_ENTRY', position: { x: 0, y: 0 }, config: {} },
            { id: 'a', type: 'SET_VARIABLE', position: { x: 0, y: 1 }, config: { variableName: 'n', value: '1' } },
            { id: 'b', type: 'SET_VARIABLE', position: { x: 0, y: 2 }, config: { variableName: 'm', value: '2' } },
          ],
          edges: [
            { id: 'e1', source: 'entry', target: 'a' },
            { id: 'e2', source: 'a', target: 'b' },
            { id: 'e3', source: 'b', target: 'a' },
          ],
        } as unknown as Prisma.InputJsonValue,
        publishedAt: new Date(),
      },
    });
    await prisma.workflow.update({ where: { id: workflowId }, data: { publishedVersionId: looping.id } });

    const { instance, definition: def } = await startInstance({
      tenantId: TEST_TENANT, workflowId, conversationId,
    });
    const outcome = await walk({ instance, definition: def, deps });

    expect(outcome.status).toBe('FAILED');
    expect(outcome.error).toMatch(/loop/i);

    // And the conversation is released, so a loop bug cannot wedge a customer.
    const conversation = await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } });
    expect(conversation.activeWorkflowInstanceId).toBeNull();
  });
});

describe('active instance lookup', () => {
  it('finds the live instance and stops finding it once finished', async () => {
    const { instance, definition: def } = await startInstance({
      tenantId: TEST_TENANT, workflowId, conversationId,
    });
    await walk({ instance, definition: def, deps });

    expect(await findActiveInstance(conversationId)).not.toBeNull();

    const parked = await prisma.workflowInstance.findUniqueOrThrow({ where: { id: instance.id } });
    await resumeWithUserInput({ instance: parked, deps, answer: 'Cardiology' });

    expect(await findActiveInstance(conversationId)).toBeNull();
  });
});
