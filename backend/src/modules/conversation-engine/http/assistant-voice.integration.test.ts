import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { seedMemberships } from '../../../test-support/members.js';
import request from 'supertest';
import { prisma } from '../../../config/prisma.js';
import { buildApp } from '../../../app.js';
import { signToken } from '../../../utils/jwt.js';
import { ROLE_PERMISSIONS } from '../../../config/permissions.js';
import { COPY_LIMITS, HOUSE } from '../routing/assistant-copy.js';

/*
 * Setting what the assistant says, over HTTP.
 *
 * Three properties, and the second is the one that would rot quietly:
 *
 *   1. **The caps are enforced by the server.** Every one of these fields is spliced into the prompt
 *      above the rules that keep the assistant safe, so a field roomy enough for prose is a field
 *      roomy enough for "ignore the rules below". The browser shows counters; this is what refuses.
 *   2. **`null` survives the round trip as `null`.** It is the value that means *inherit*, and it
 *      arrives as JSON null through a Zod schema and a Prisma update, either of which could turn it
 *      into "no change" — at which point the Reset button in the UI silently does nothing.
 *   3. **The screen is told what the assistant is actually saying**, not only what this workspace has
 *      typed, or an unset field would render as an empty box for an assistant with a whole persona.
 */

const app = buildApp();

const TENANT = 'cccccccc-c000-0000-0000-00000000c081';
const CATEGORY = 'cccccccc-c000-0000-0000-00000000c082';

let token: string;
let assistantId: string;

const wipe = async () => {
  await prisma.tenant.deleteMany({ where: { id: TENANT } });
  await prisma.businessCategory.deleteMany({ where: { id: CATEGORY } });
};

const seed = async () => {
  await prisma.businessCategory.create({
    data: {
      id: CATEGORY,
      key: `VOICE_TEST_${Date.now()}`,
      label: 'Voice Test Trade',
      defaultPersona: 'Warm and quick.',
      defaultOutOfScopeTopics: 'nutrition advice',
    },
  });

  const tenant = await prisma.tenant.create({
    data: {
      id: TENANT,
      businessName: 'Voice Test Co',
      category: 'RESTAURANT',
      businessCategoryId: CATEGORY,
      roles: {
        create: [{
          name: 'Owner', permissions: [...ROLE_PERMISSIONS.OWNER], isOwner: true, isSystem: true,
        }],
      },
      users: { create: [{ phone: '15550009941', fullName: 'Owner', role: 'OWNER' }] },
    },
    include: { users: true, roles: true },
  });
  await prisma.user.update({
    where: { id: tenant.users[0]!.id }, data: { roleId: tenant.roles[0]!.id },
  });
  await seedMemberships();
  token = signToken({ userId: tenant.users[0]!.id, tenantId: TENANT });

  // An assistant belongs to a WhatsApp channel, so there has to be one.
  const channel = await prisma.whatsappAccount.create({
    data: {
      tenantId: TENANT,
      phoneNumberId: `voice-${Date.now()}`,
      wabaId: 'waba-voice',
      displayPhone: '+91 90000 00001',
      accessToken: 'test-token',
    },
  });
  const assistant = await prisma.assistant.create({
    data: { tenantId: TENANT, whatsappChannelId: channel.id, name: 'Voice Test Assistant' },
  });
  assistantId = assistant.id;
};

const patch = (body: Record<string, unknown>) => request(app)
  .patch(`/api/assistants/${assistantId}`)
  .set('Authorization', `Bearer ${token}`)
  .send(body);

const routing = () => request(app)
  .get(`/api/assistants/${assistantId}/routing`)
  .set('Authorization', `Bearer ${token}`);

beforeEach(async () => {
  await wipe();
  await seed();
});

afterAll(async () => {
  await wipe();
  await prisma.$disconnect();
});

describe('the assistant’s voice, over the API', () => {
  it('**saves what the workspace wrote**', async () => {
    await patch({
      generalSystemPrompt: 'Blunt and technical.',
      outOfScopeTopics: 'recruitment enquiries\ninternships',
      unknownAnswerReply: 'Let me confirm with the delivery team.',
      outOfScopeReply: 'I only help with questions about our software.',
      replyWordLimit: 120,
      replyLanguage: 'English',
    }).expect(200);

    const saved = await prisma.assistant.findUniqueOrThrow({ where: { id: assistantId } });
    expect(saved.generalSystemPrompt).toBe('Blunt and technical.');
    expect(saved.replyWordLimit).toBe(120);
    expect(saved.replyLanguage).toBe('English');
  });

  it('**keeps null meaning inherit, all the way to the column**', async () => {
    await patch({ generalSystemPrompt: 'Mine.', replyWordLimit: 90 }).expect(200);

    // What the Reset control sends. If Zod or Prisma read this as "no change", the button would
    // appear to work and change nothing.
    await patch({ generalSystemPrompt: null, replyWordLimit: null }).expect(200);

    const saved = await prisma.assistant.findUniqueOrThrow({ where: { id: assistantId } });
    expect(saved.generalSystemPrompt).toBeNull();
    expect(saved.replyWordLimit).toBeNull();

    // And it is inheriting again, rather than holding an empty string.
    const res = await routing().expect(200);
    expect(res.body.data.assistant.resolvedCopy.persona).toBe('Warm and quick.');
    expect(res.body.data.assistant.resolvedCopy.sources.persona).toBe('category');
  });

  it('**refuses copy long enough to be a second prompt**', async () => {
    // Each of these is spliced in above the rules, so the cap is the boundary, not a courtesy.
    await patch({ unknownAnswerReply: 'x'.repeat(COPY_LIMITS.replyChars + 1) }).expect(400);
    await patch({ generalSystemPrompt: 'x'.repeat(COPY_LIMITS.personaChars + 1) }).expect(400);
    await patch({
      outOfScopeTopics: Array.from({ length: COPY_LIMITS.topicLines + 1 }, (_, i) => `t${i}`).join('\n'),
    }).expect(400);
    await patch({
      outOfScopeTopics: 'x'.repeat(COPY_LIMITS.topicLineChars + 1),
    }).expect(400);
    await patch({ replyWordLimit: COPY_LIMITS.wordLimitMax + 1 }).expect(400);
    await patch({ replyWordLimit: COPY_LIMITS.wordLimitMin - 1 }).expect(400);

    // Nothing was written by any of them.
    const saved = await prisma.assistant.findUniqueOrThrow({ where: { id: assistantId } });
    expect(saved.unknownAnswerReply).toBeNull();
    expect(saved.outOfScopeTopics).toBeNull();
    expect(saved.replyWordLimit).toBeNull();
  });

  it('**tells the screen what the assistant is really saying, and where it came from**', async () => {
    const res = await routing().expect(200);
    const { assistant } = res.body.data;

    // Raw: nothing set here. The form binds to these so a Reset can send null and mean it.
    expect(assistant.generalSystemPrompt).toBeNull();
    expect(assistant.outOfScopeTopics).toBeNull();

    // Resolved: what a customer would actually get, and its provenance.
    expect(assistant.resolvedCopy.persona).toBe('Warm and quick.');
    expect(assistant.resolvedCopy.sources.persona).toBe('category');
    expect(assistant.resolvedCopy.unknownAnswerReply).toBe(HOUSE.unknownAnswerReply);
    expect(assistant.resolvedCopy.sources.unknownAnswerReply).toBe('house');

    // The label, so the screen can say "Inherited from Voice Test Trade" rather than a uuid.
    expect(assistant.categoryLabel).toBe('Voice Test Trade');
    // And the caps, so a counter in the browser cannot promise what a save then refuses.
    expect(assistant.copyLimits.replyChars).toBe(COPY_LIMITS.replyChars);
  });

  it('cannot be read or written from another workspace', async () => {
    // The assistant id is a uuid a caller could guess; the lookup is always scoped by the token.
    const stranger = signToken({ userId: 'nobody', tenantId: 'cccccccc-c000-0000-0000-0000000000ff' });

    await request(app).get(`/api/assistants/${assistantId}/routing`)
      .set('Authorization', `Bearer ${stranger}`).expect(401);
    await request(app).patch(`/api/assistants/${assistantId}`)
      .set('Authorization', `Bearer ${stranger}`).send({ replyWordLimit: 30 }).expect(401);
  });
});
