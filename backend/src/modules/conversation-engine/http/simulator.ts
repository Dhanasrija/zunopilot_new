import { prisma } from '../../../config/prisma.js';
import { ApiError } from '../../../utils/ApiError.js';
import type { WalkDeps } from '../engine/walker.js';
import {
  MOCK_INTEGRATIONS, MockHttpCaller, MockLlmProvider, MockWhatsAppProvider,
} from '../providers/mock.js';

// The synthetic conversation a workflow is tried against.
//
// Extracted from `instances.controller.ts`, where both of these were private to
// `testWorkflow`. Generation's dry-run driver needs the same throwaway identity and
// the same mocked services, and the alternative was a second scratch conversation
// with its own subtly different rules about which provider it talks to. One is
// enough — and it means a generated draft leaves its trace on exactly the
// conversation an operator can already open from the builder.

/**
 * Build a throwaway conversation for a test run.
 *
 * A dedicated contact per key keeps simulator traffic out of the real inbox and stops
 * a test conversation colliding with a live one for the same person. The `waId` is in
 * the +1 555 range, which is reserved for fiction and never routable — so even a
 * misconfigured provider cannot reach anyone.
 */
export const simulatorConversation = async (
  tenantId: string,
  assistantId: string | null,
  key: string,
) => {
  const waId = `1555${key.replace(/\D/g, '').slice(0, 7).padStart(7, '0')}`;

  const contact = await prisma.customer.upsert({
    where: { tenantId_waId: { tenantId, waId } },
    update: { lastSeenAt: new Date() },
    create: { tenantId, waId, name: 'Simulator', lastSeenAt: new Date() },
  });

  const existing = await prisma.conversation.findFirst({
    where: { tenantId, customerId: contact.id, status: { in: ['OPEN', 'HUMAN_TAKEOVER'] } },
    orderBy: { lastMessageAt: 'desc' },
  });

  const conversation = existing ?? await prisma.conversation.create({
    data: {
      tenantId,
      customerId: contact.id,
      assistantId,
      status: 'OPEN',
      externalConversationKey: `simulator:${key}`,
      lastMessageAt: new Date(),
    },
  });

  return { contact, conversation };
};

export const simulatorDeps = async (
  tenantId: string,
  conversation: { id: string },
  contact: { id: string },
  dryRun: boolean,
): Promise<{ deps: WalkDeps; whatsapp: MockWhatsAppProvider }> => {
  const [tenant, channel, fullContact, fullConversation] = await Promise.all([
    prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } }),
    prisma.whatsappAccount.findFirst({ where: { tenantId } }),
    prisma.customer.findUniqueOrThrow({ where: { id: contact.id } }),
    prisma.conversation.findUniqueOrThrow({ where: { id: conversation.id } }),
  ]);
  if (!channel) throw ApiError.badRequest('This workspace has no WhatsApp channel connected');

  // Always the mock, never the tenant's real provider — a Test Flow button that
  // messages a customer is the worst possible surprise.
  const whatsapp = new MockWhatsAppProvider();

  return {
    whatsapp,
    deps: {
      tenant,
      contact: fullContact,
      conversation: fullConversation,
      channel,
      assistantId: fullConversation.assistantId,
      services: {
        whatsapp,
        llm: new MockLlmProvider(),
        http: new MockHttpCaller(),
        integrations: MOCK_INTEGRATIONS,
      },
      latestMessage: null,
      dryRun,
    },
  };
};

/**
 * Clear any run already parked on this conversation.
 *
 * Repeated Test Flow presses would otherwise trip
 * `WorkflowInstance_one_active_per_conversation`, which is a confusing error for what
 * is really "start again".
 */
export const clearPreviousRuns = async (conversationId: string) => {
  await prisma.workflowInstance.updateMany({
    where: {
      conversationId,
      status: { in: ['PENDING', 'RUNNING', 'WAITING_FOR_USER', 'WAITING_FOR_APPROVAL', 'PAUSED'] },
    },
    data: { status: 'CANCELLED', error: 'Superseded by a new test run', completedAt: new Date() },
  });
  await prisma.conversation.update({
    where: { id: conversationId },
    data: { activeWorkflowInstanceId: null },
  });
};
