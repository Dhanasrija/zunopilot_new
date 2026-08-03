import { PrismaClient, Prisma, UserRole } from '@prisma/client';
import { templateById } from '../src/modules/conversation-engine/domain/templates.js';
import { validateWorkflowDefinition } from '../src/modules/conversation-engine/validation/definition-validator.js';

// Zuno Kitchen — the ordering demo for the conversation engine.
//
// A THIRD tenant, alongside Demo Biryani House (legacy cart FSM) and Acme
// Hospital (engine demo). It exists because the "Place an Order" template can
// only be driven end to end against a channel whose sends are mocked: a real
// Meta channel rejects any recipient that is not allowlisted, so the very first
// list message would fail and the run would die before proving anything.
//
// The workflow is published from the shipped template *verbatim* — no local
// copy — so driving this proves the template itself, not a variant of it.
//
// Idempotent and scoped: it deletes and rebuilds only this tenant.

const prisma = new PrismaClient();

const TENANT_ID = '44444444-4444-4444-4444-444444444444';
const CHANNEL_PHONE_ID = 'zuno-kitchen-mock-channel';
/** Owner's sign-in number. Reserved US 555 range — see the `phone` comment below. */
const OWNER_PHONE = '15550001001';

const MENU: Array<{ category: string; items: Array<[string, number, string?]> }> = [
  {
    category: 'Biryani',
    items: [
      ['Chicken Biryani', 280, 'Slow-cooked, serves one'],
      ['Mutton Biryani', 420, 'Slow-cooked, serves one'],
      ['Veg Dum Biryani', 220],
    ],
  },
  {
    category: 'Starters',
    items: [
      ['Chicken 65', 240],
      ['Paneer Tikka', 260],
    ],
  },
  {
    category: 'Breads',
    items: [
      ['Butter Naan', 60],
      ['Tandoori Roti', 40],
    ],
  },
  {
    category: 'Drinks',
    items: [
      ['Sweet Lassi', 80],
      ['Masala Chai', 40],
    ],
  },
];

const FAQS: Array<{ keywords: string[]; response: string }> = [
  {
    keywords: ['hours', 'open', 'timing', 'close'],
    response: 'We are open every day from 11am to 11pm.',
  },
  {
    keywords: ['delivery', 'deliver', 'area'],
    response: 'We deliver within 6km of Jubilee Hills. Delivery usually takes 35-45 minutes.',
  },
  {
    keywords: ['address', 'location', 'where'],
    response: 'We are at 12 Road No. 36, Jubilee Hills, Hyderabad.',
  },
  {
    keywords: ['parking'],
    response: 'Yes, there is free parking behind the building.',
  },
];

const main = async () => {
  const template = templateById('order_place');
  if (!template) throw new Error('The order_place template is missing');

  const result = validateWorkflowDefinition({
    definition: template.definition,
    category: 'CONVERSATION',
    capability: template.capability,
    slug: template.suggestedSlug,
    siblingSlugs: [],
  });
  const errors = result.issues.filter((i) => i.level === 'error');
  if (errors.length) {
    throw new Error(
      'The order_place template would fail validation:\n'
      + errors.map((e) => `  • [${e.code}] ${e.message}`).join('\n'),
    );
  }
  for (const warning of result.issues.filter((i) => i.level === 'warning')) {
    console.warn(`  ⚠ ${warning.message}`);
  }

  // Orders first: OrderItem references MenuItem without a cascade, so a
  // previous demo order would block the tenant delete.
  await prisma.order.deleteMany({ where: { tenantId: TENANT_ID } });
  await prisma.tenant.deleteMany({ where: { id: TENANT_ID } });

  const tenant = await prisma.tenant.create({
    data: {
      id: TENANT_ID,
      businessName: 'Zuno Kitchen',
      businessCategory: { connect: { key: 'RESTAURANT' } },
      // Onboarding is not part of a demo; these workspaces are set up by definition.
      onboardingCompletedAt: new Date(),
      contactNumber: '+914040001234',
      address: '12 Road No. 36, Jubilee Hills, Hyderabad',
      users: {
        create: {
          // The login identifier. Drawn from the reserved US 555 range, which is
          // set aside for fiction and routes to no handset — so a seed that runs
          // on every reset can never send a real person a code, and can never
          // collide with a real customer's number on the global unique index.
          phone: OWNER_PHONE,
          email: 'owner@zunokitchen.test',
          // No passwordHash: customers sign in with a phone and a one-time code,
          // and no login path accepts a password. Seeding one would only suggest
          // a credential that does not work.
          fullName: 'Zuno Kitchen Owner',
          role: UserRole.OWNER,
          emailVerified: true,
        },
      },
    },
  });

  const channel = await prisma.whatsappAccount.create({
    data: {
      tenantId: tenant.id,
      wabaId: 'zuno-kitchen-mock-waba',
      phoneNumberId: CHANNEL_PHONE_ID,
      displayPhone: '+1 555 010 4040',
      businessName: 'Zuno Kitchen',
      // Not a real credential. The `mock-token-` prefix is what makes this
      // channel always use the mock sender, whatever WHATSAPP_PROVIDER says —
      // per-channel, so a live tenant on the same server is unaffected.
      accessToken: 'mock-token-not-a-credential',
    },
  });

  let items = 0;
  for (const [index, group] of MENU.entries()) {
    const category = await prisma.menuCategory.create({
      data: { tenantId: tenant.id, name: group.category, sortOrder: index + 1 },
    });
    for (const [order, [name, price, description]] of group.items.entries()) {
      await prisma.menuItem.create({
        data: {
          tenantId: tenant.id,
          categoryId: category.id,
          name,
          basePrice: new Prisma.Decimal(price),
          sortOrder: order + 1,
          ...(description ? { description } : {}),
        },
      });
      items += 1;
    }
  }

  // The assistant's FAQ knowledge base is the tenant's own keyword rules, so
  // seeding these is what lets GENERAL_RESPONSE answer anything at all.
  await prisma.keywordRule.createMany({
    data: FAQS.map((faq, i) => ({
      tenantId: tenant.id,
      keywords: faq.keywords,
      response: faq.response,
      priority: 100 - i,
    })),
  });

  await prisma.fallbackRule.create({
    data: {
      tenantId: tenant.id,
      response: "Sorry, I didn't quite catch that. Reply MENU to start an order, or ask me anything.",
    },
  });

  const assistant = await prisma.assistant.create({
    data: {
      tenantId: tenant.id,
      whatsappChannelId: channel.id,
      name: 'Zuno Kitchen WhatsApp Assistant',
      description: 'Takes orders on WhatsApp and answers questions about the restaurant.',
      generalSystemPrompt:
        'You are the WhatsApp assistant for Zuno Kitchen, a biryani restaurant in Hyderabad. '
        + 'Be brief, warm and factual.',
      generalResponseEnabled: true,
      highConfidenceThreshold: 0.8,
      mediumConfidenceThreshold: 0.55,
      maxRecentMessages: 8,
      status: 'ACTIVE',
    },
  });

  const workflow = await prisma.workflow.create({
    data: {
      tenantId: tenant.id,
      assistantId: assistant.id,
      name: template.name,
      slug: template.suggestedSlug,
      description: template.capability.purpose,
      category: 'CONVERSATION',
      status: 'PUBLISHED',
      priority: template.priority,
      publishedAt: new Date(),
      capability: {
        create: {
          purpose: template.capability.purpose,
          description: template.capability.description ?? null,
          useWhen: template.capability.useWhen,
          doNotUseWhen: template.capability.doNotUseWhen,
          positiveExamples: template.capability.positiveExamples,
          negativeExamples: template.capability.negativeExamples,
          requiredInputs: template.capability.requiredInputs as unknown as Prisma.InputJsonValue,
          optionalInputs: template.capability.optionalInputs as unknown as Prisma.InputJsonValue,
          preconditions: template.capability.preconditions,
          sideEffects: template.capability.sideEffects,
          requiresConfirmation: template.capability.requiresConfirmation,
          minimumConfidence: template.capability.minimumConfidence,
          allowsInterruption: template.capability.allowsInterruption,
        },
      },
    },
  });

  const version = await prisma.workflowVersion.create({
    data: {
      workflowId: workflow.id,
      version: 1,
      definition: template.definition as unknown as Prisma.InputJsonValue,
      createdBy: 'seed',
      publishedAt: new Date(),
    },
  });
  await prisma.workflow.update({
    where: { id: workflow.id },
    data: { publishedVersionId: version.id },
  });

  // A keyword rule so the demo can be driven without spending a router call —
  // and so "menu" behaves the way a customer expects even if the model is down.
  await prisma.routingRule.create({
    data: {
      assistantId: assistant.id,
      name: 'Explicit ordering keyword',
      type: 'KEYWORD',
      configuration: { keywords: ['menu', 'order', 'i want to order'], match: 'word' },
      workflowId: workflow.id,
      priority: 90,
    },
  });

  console.log(`
Zuno Kitchen seeded.
  tenant     ${tenant.id}
  sign in    phone ${OWNER_PHONE} — needs OTP_ECHO=true, which returns the code:
             curl -s -XPOST localhost:4000/api/auth/otp \\
               -H 'Content-Type: application/json' -d '{"phone":"${OWNER_PHONE}"}'
  channel    ${CHANNEL_PHONE_ID} (mock provider — nothing is ever sent)
  menu       ${MENU.length} categories, ${items} items
  workflow   ${template.name} (${template.definition.nodes.length} nodes) PUBLISHED

Drive it:
  npx tsx scripts/send-webhook.ts --phone-id ${CHANNEL_PHONE_ID} "I want to order"
  npx tsx scripts/send-webhook.ts --phone-id ${CHANNEL_PHONE_ID} --list "cat:<id>"
`);
};

main()
  .catch((err: Error) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
