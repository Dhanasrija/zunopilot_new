import { channelForTenant } from '../services/whatsapp-account.service.js';
import { ConversationStatus } from '@prisma/client';
import { queryBool, queryEnum } from '../utils/query.js';
import { tenantIdOf, userOf } from '../middleware/auth.js';
import { can } from '../config/permissions.js';
import type { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { whatsappProviderFor } from '../modules/conversation-engine/providers/whatsapp.js';
import { recordOutboundMessage } from '../modules/conversation-engine/providers/mirror.js';

// Gets-or-creates an OPEN conversation for the given customer.
// Used by the CRM "Start conversation" button so agents can jump from a
// customer profile straight into the inbox.
export const startConversation = asyncHandler(async (req, res) => {
  const { customerId } = req.body;
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, tenantId: tenantIdOf(req) },
  });
  if (!customer) throw ApiError.notFound('Customer not found');

  let conversation = await prisma.conversation.findFirst({
    where: {
      tenantId: tenantIdOf(req),
      customerId: customer.id,
      status: { in: ['OPEN', 'HUMAN_TAKEOVER'] },
    },
    orderBy: { lastMessageAt: 'desc' },
  });
  if (!conversation) {
    conversation = await prisma.conversation.create({
      data: {
        tenantId: tenantIdOf(req),
        customerId: customer.id,
        status: 'HUMAN_TAKEOVER',
        automationPaused: true,
        assignedAgentId: userOf(req).id,
        lastMessageAt: new Date(),
      },
    });
  }

  res.status(201).json({ success: true, data: conversation });
});

export const listConversations = asyncHandler(async (req, res) => {
  const status = queryEnum(req.query.status, Object.values(ConversationStatus));
  const where: Prisma.ConversationWhereInput = { tenantId: tenantIdOf(req) };
  if (status) where.status = status;
  if (queryBool(req.query.assignedToMe)) where.assignedAgentId = userOf(req).id;
  // The shared pool: what nobody has picked up. This is the queue an agent
  // works from, so it needs to be one filter rather than a visual scan.
  if (queryBool(req.query.unassigned)) where.assignedAgentId = null;

  const conversations = await prisma.conversation.findMany({
    where,
    include: {
      customer: true,
      assignedAgent: { select: { id: true, fullName: true, email: true } },
      messages: { take: 1, orderBy: { createdAt: 'desc' } },
      // **The workflow occupying this conversation, if any.**
      //
      // Needed because a conversation holds one active instance at a time, and while it
      // does the router refuses every inbound message with `ACTIVE_WORKFLOW_BUSY`. That is
      // right for a flow mid-question and wrong for one parked at a handoff — but without
      // this the Inbox could not tell the two apart, so an agent had no way to see that the
      // bot was stuck, let alone hand control back.
      activeWorkflowInstance: {
        select: {
          id: true,
          status: true,
          currentNodeId: true,
          workflow: { select: { name: true } },
        },
      },
    },
    orderBy: { lastMessageAt: 'desc' },
    take: 100,
  });
  res.json({ success: true, data: conversations });
});

export const getConversation = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const conversation = await prisma.conversation.findFirst({
    where: { id, tenantId: tenantIdOf(req) },
    include: {
      customer: true,
      assignedAgent: { select: { id: true, fullName: true, email: true } },
      notes: { include: { author: { select: { id: true, fullName: true } } }, orderBy: { createdAt: 'desc' } },
    },
  });
  if (!conversation) throw ApiError.notFound('Conversation not found');
  res.json({ success: true, data: conversation });
});

export const listMessages = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const conversation = await prisma.conversation.findFirst({ where: { id, tenantId: tenantIdOf(req) } });
  if (!conversation) throw ApiError.notFound('Conversation not found');
  const messages = await prisma.message.findMany({
    where: { conversationId: id },
    orderBy: { createdAt: 'asc' },
    take: 500,
    include: { sentByUser: { select: { id: true, fullName: true, role: true } } },
  });
  res.json({ success: true, data: messages });
});

export const markRead = asyncHandler(async (req, res) => {
  const { id } = req.params;
  await prisma.conversation.updateMany({
    where: { id, tenantId: tenantIdOf(req) },
    data: { unreadCount: 0 },
  });
  res.json({ success: true });
});

/**
 * Assign, claim, or release a conversation.
 *
 * The rule that makes a *shared* inbox work rather than a free-for-all: anyone
 * may claim something unassigned, and anyone may put their own back, but taking
 * a conversation off a colleague mid-thread needs `inbox:assign_others`. Two
 * agents silently swapping a live customer between them is how a customer gets
 * asked the same question twice.
 */
export const assignAgent = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { agentId } = req.body;
  const tenantId = tenantIdOf(req);
  const actor = userOf(req);

  const existing = await prisma.conversation.findFirst({ where: { id, tenantId } });
  if (!existing) throw ApiError.notFound('Conversation not found');

  if (agentId) {
    const agent = await prisma.user.findFirst({
      where: { id: agentId, tenantId, isActive: true },
    });
    if (!agent) throw ApiError.badRequest('Invalid agent');
  }

  const takingFromSomeoneElse = existing.assignedAgentId
    && existing.assignedAgentId !== actor.id;
  const givingToSomeoneElse = agentId && agentId !== actor.id;

  if ((takingFromSomeoneElse || givingToSomeoneElse) && !can(actor.role, 'inbox:assign_others')) {
    throw ApiError.forbidden(
      takingFromSomeoneElse
        ? 'This conversation is assigned to someone else. Ask a manager to reassign it.'
        : 'Your role can only assign conversations to yourself.',
    );
  }

  const conv = await prisma.conversation.update({
    where: { id },
    data: { assignedAgentId: agentId || null },
    include: { assignedAgent: { select: { id: true, fullName: true, email: true } } },
  });
  res.json({ success: true, data: conv });
});

// Module 5: human takeover toggle. When paused, automation engine skips this conversation.
export const setAutomation = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { paused } = req.body;
  const existing = await prisma.conversation.findFirst({ where: { id, tenantId: tenantIdOf(req) } });
  if (!existing) throw ApiError.notFound('Conversation not found');
  const conv = await prisma.conversation.update({
    where: { id },
    data: {
      automationPaused: !!paused,
      status: paused ? 'HUMAN_TAKEOVER' : 'OPEN',
    },
  });
  res.json({ success: true, data: conv });
});

export const sendAgentMessage = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { body } = req.body;
  const conversation = await prisma.conversation.findFirst({
    where: { id, tenantId: tenantIdOf(req) },
    include: { customer: true },
  });
  if (!conversation) throw ApiError.notFound('Conversation not found');
  const wa = await channelForTenant(conversation.tenantId);
  if (!wa) throw ApiError.badRequest('WhatsApp not connected');

  // Through the same adapter the engine uses, not straight at Meta.
  //
  // `whatsappProviderFor` honours the per-channel rule that a `mock-token-`
  // channel is always served by the mock provider. Calling Meta directly here
  // meant an operator could not reply at all on a demo or test workspace — the
  // bot could talk to the customer and the human could not, which is exactly
  // backwards for a shared inbox.
  let sent: { messageId: string | null };
  try {
    sent = await whatsappProviderFor(wa).sendText({ to: conversation.customer.waId, body });
  } catch (err: any) {
    const isTokenError = err.response?.data?.error?.code === 190 || err.response?.status === 401;
    if (isTokenError) {
      throw new ApiError(424, 'WhatsApp/Meta connection error: Token expired or invalid');
    }
    throw err;
  }

  const msg = await recordOutboundMessage(
    {
      tenantId: tenantIdOf(req),
      conversationId: conversation.id,
      customerId: conversation.customerId,
    },
    {
      type: 'TEXT',
      body,
      messageId: sent.messageId,
      // Who typed it. A null here on an OUTBOUND row means the bot, which is
      // the distinction the shared inbox is built on.
      sentByUserId: userOf(req).id,
    },
  );
  await prisma.conversation.update({
    where: { id: conversation.id },
    data: { lastMessageAt: new Date() },
  });
  res.status(201).json({ success: true, data: msg });
});

export const addNote = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { body } = req.body;
  const conversation = await prisma.conversation.findFirst({ where: { id, tenantId: tenantIdOf(req) } });
  if (!conversation) throw ApiError.notFound();
  const note = await prisma.internalNote.create({
    data: { conversationId: id, authorId: userOf(req).id, body },
    include: { author: { select: { id: true, fullName: true } } },
  });
  res.status(201).json({ success: true, data: note });
});
