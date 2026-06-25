import { prisma } from '../config/prisma.js';
import { sendTextMessage } from './whatsapp.service.js';
import { handleOrderingFlow, startOrderingFlow } from './ordering.service.js';
import { logger } from '../config/logger.js';

const HUMAN_KEYWORDS = ['agent', 'support', 'human'];
const MENU_KEYWORDS = ['menu', 'order'];

// Returns true if msgText (lowercased) matches any keyword in rule.
const matchesKeywords = (msgText, keywords) =>
  keywords.some((k) => msgText.includes(String(k).toLowerCase()));

export const handleInboundMessage = async ({ tenant, conversation, customer, message }) => {
  if (conversation.automationPaused) {
    logger.info('Automation paused for conversation', { conversationId: conversation.id });
    return;
  }

  const waAccount = await prisma.whatsappAccount.findUnique({ where: { tenantId: tenant.id } });
  if (!waAccount) return;

  const text = (message.body || '').toLowerCase().trim();
  const interactivePayload = message.payload?.interactive;

  // 1. Human takeover keywords.
  if (text && matchesKeywords(text, HUMAN_KEYWORDS)) {
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { status: 'HUMAN_TAKEOVER', automationPaused: true },
    });
    await sendTextMessage({
      accessToken: waAccount.accessToken,
      phoneNumberId: waAccount.phoneNumberId,
      to: customer.waId,
      body: 'Connecting you to a team member. They will reply shortly.',
    });
    return;
  }

  // 2. Active ordering flow (cart in progress).
  const cart = await prisma.cart.findUnique({ where: { customerId: customer.id } });
  if (cart && cart.state !== 'IDLE') {
    await handleOrderingFlow({ tenant, waAccount, customer, cart, message });
    return;
  }

  // 3. Menu intent → start ordering flow.
  if (text && matchesKeywords(text, MENU_KEYWORDS)) {
    await startOrderingFlow({ tenant, waAccount, customer });
    return;
  }

  // 4. Keyword rules.
  const rules = await prisma.keywordRule.findMany({
    where: { tenantId: tenant.id, isActive: true },
    orderBy: { priority: 'desc' },
  });
  for (const rule of rules) {
    if (text && matchesKeywords(text, rule.keywords)) {
      await sendTextMessage({
        accessToken: waAccount.accessToken,
        phoneNumberId: waAccount.phoneNumberId,
        to: customer.waId,
        body: rule.response,
      });
      return;
    }
  }

  // 5. Interactive payload for unknown context — ignore.
  if (interactivePayload) return;

  // 6. Fallback.
  const fallback = await prisma.fallbackRule.findUnique({ where: { tenantId: tenant.id } });
  const response = fallback?.response || "Sorry, I didn't catch that. Type 'Menu' to order, or 'Agent' to speak to our team.";
  await sendTextMessage({
    accessToken: waAccount.accessToken,
    phoneNumberId: waAccount.phoneNumberId,
    to: customer.waId,
    body: response,
  });
};
