import { prisma } from '../config/prisma.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { sendTextMessage } from '../services/whatsapp.service.js';

// Gets-or-creates an OPEN conversation for the given customer.
// Used by the CRM "Start conversation" button so agents can jump from a
// customer profile straight into the inbox.
export const startConversation = asyncHandler(async (req, res) => {
  const { customerId } = req.body;
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, tenantId: req.tenantId },
  });
  if (!customer) throw ApiError.notFound('Customer not found');

  let conversation = await prisma.conversation.findFirst({
    where: {
      tenantId: req.tenantId,
      customerId: customer.id,
      status: { in: ['OPEN', 'HUMAN_TAKEOVER'] },
    },
    orderBy: { lastMessageAt: 'desc' },
  });
  if (!conversation) {
    conversation = await prisma.conversation.create({
      data: {
        tenantId: req.tenantId,
        customerId: customer.id,
        status: 'HUMAN_TAKEOVER',
        automationPaused: true,
        assignedAgentId: req.user.id,
        lastMessageAt: new Date(),
      },
    });
  }

  res.status(201).json({ success: true, data: conversation });
});

export const listConversations = asyncHandler(async (req, res) => {
  const { status, assignedToMe } = req.query;
  const where = { tenantId: req.tenantId };
  if (status) where.status = status;
  if (assignedToMe === 'true') where.assignedAgentId = req.user.id;

  const conversations = await prisma.conversation.findMany({
    where,
    include: {
      customer: true,
      assignedAgent: { select: { id: true, fullName: true, email: true } },
      messages: { take: 1, orderBy: { createdAt: 'desc' } },
    },
    orderBy: { lastMessageAt: 'desc' },
    take: 100,
  });
  res.json({ success: true, data: conversations });
});

export const getConversation = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const conversation = await prisma.conversation.findFirst({
    where: { id, tenantId: req.tenantId },
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
  const conversation = await prisma.conversation.findFirst({ where: { id, tenantId: req.tenantId } });
  if (!conversation) throw ApiError.notFound('Conversation not found');
  const messages = await prisma.message.findMany({
    where: { conversationId: id },
    orderBy: { createdAt: 'asc' },
    take: 500,
  });
  res.json({ success: true, data: messages });
});

export const markRead = asyncHandler(async (req, res) => {
  const { id } = req.params;
  await prisma.conversation.updateMany({
    where: { id, tenantId: req.tenantId },
    data: { unreadCount: 0 },
  });
  res.json({ success: true });
});

export const assignAgent = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { agentId } = req.body;
  if (agentId) {
    const agent = await prisma.user.findFirst({ where: { id: agentId, tenantId: req.tenantId } });
    if (!agent) throw ApiError.badRequest('Invalid agent');
  }
  const conv = await prisma.conversation.update({
    where: { id },
    data: { assignedAgentId: agentId || null },
    include: { assignedAgent: { select: { id: true, fullName: true } } },
  });
  res.json({ success: true, data: conv });
});

// Module 5: human takeover toggle. When paused, automation engine skips this conversation.
export const setAutomation = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { paused } = req.body;
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
    where: { id, tenantId: req.tenantId },
    include: { customer: true, tenant: { include: { whatsappAccount: true } } },
  });
  if (!conversation) throw ApiError.notFound('Conversation not found');
  const wa = conversation.tenant.whatsappAccount;
  if (!wa) throw ApiError.badRequest('WhatsApp not connected');

  let sent;
  try {
    sent = await sendTextMessage({
      accessToken: wa.accessToken,
      phoneNumberId: wa.phoneNumberId,
      to: conversation.customer.waId,
      body,
    });
  } catch (err) {
    const isTokenError = err.response?.data?.error?.code === 190 || err.response?.status === 401;
    if (isTokenError) {
      throw new ApiError(424, 'WhatsApp/Meta connection error: Token expired or invalid');
    }
    throw err;
  }

  const msg = await prisma.message.create({
    data: {
      tenantId: req.tenantId,
      conversationId: conversation.id,
      customerId: conversation.customerId,
      direction: 'OUTBOUND',
      type: 'TEXT',
      status: 'SENT',
      waMessageId: sent?.messages?.[0]?.id,
      body,
    },
  });
  await prisma.conversation.update({
    where: { id: conversation.id },
    data: { lastMessageAt: new Date() },
  });
  res.status(201).json({ success: true, data: msg });
});

export const addNote = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { body } = req.body;
  const conversation = await prisma.conversation.findFirst({ where: { id, tenantId: req.tenantId } });
  if (!conversation) throw ApiError.notFound();
  const note = await prisma.internalNote.create({
    data: { conversationId: id, authorId: req.user.id, body },
    include: { author: { select: { id: true, fullName: true } } },
  });
  res.status(201).json({ success: true, data: note });
});
