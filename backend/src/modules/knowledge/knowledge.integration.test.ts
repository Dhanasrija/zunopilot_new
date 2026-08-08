import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { seedMemberships } from '../../test-support/members.js';
import request from 'supertest';
import { prisma } from '../../config/prisma.js';
import { buildApp } from '../../app.js';
import { signToken } from '../../utils/jwt.js';
import { ROLE_PERMISSIONS } from '../../config/permissions.js';
import { buildSystemPrompt } from '../conversation-engine/routing/general-response.js';
import {
  ENTRY_WORD_LIMIT, KNOWLEDGE_WORD_BUDGET, knowledgeAsPrompt, knowledgeFor, wordsIn,
} from './knowledge.service.js';

/*
 * What the assistant knows about the business.
 *
 * The gap this closes: the agent's only knowledge was `KeywordRule`, which is
 * keyword-to-canned-reply. A workspace with none produced a prompt whose knowledge section read
 * "(none configured)" directly above an instruction never to guess — so the model, however
 * good, could only ever offer to check with the team. mTouch Labs in production was exactly
 * that: zero rules, zero workflows, one fallback line.
 *
 * The interesting behaviour here is the **budget**. Everything active is sent with every single
 * inbound message, so an unbounded table is a bill and a context window that quietly stops
 * fitting the conversation history.
 */

const app = buildApp();

const TENANT = 'ffffffff-f000-0000-0000-00000000f001';
const OTHER = 'ffffffff-f000-0000-0000-00000000f002';

let owner: string;
let otherOwner: string;

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

const wipe = () => prisma.tenant.deleteMany({ where: { id: { in: [TENANT, OTHER] } } });

const makeTenant = async (id: string, name: string, phone: string) => {
  const tenant = await prisma.tenant.create({
    data: {
      id,
      businessName: name,
      roles: {
        create: { name: 'Owner', permissions: [...ROLE_PERMISSIONS.OWNER], isOwner: true, isSystem: true },
      },
      users: { create: { phone, fullName: `${name} Owner`, role: 'OWNER' } },
    },
    include: { users: true, roles: true },
  });
  await prisma.user.update({
    where: { id: tenant.users[0].id },
    data: { roleId: tenant.roles[0].id },
  });
  return signToken({ userId: tenant.users[0].id });
};

/** `n` words of filler, for pushing the budget around. */
const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');

const addEntry = (tenantId: string, title: string, body: string, sortOrder = 0) =>
  prisma.knowledgeEntry.create({ data: { tenantId, title, body, sortOrder } });

beforeEach(async () => {
  await wipe();
  owner = await makeTenant(TENANT, 'mTouch Labs', '15551110001');
  otherOwner = await makeTenant(OTHER, 'Someone Else', '15551110002');
});

afterAll(async () => {
  await wipe();
  await prisma.$disconnect();
});

describe('writing knowledge down', () => {
  it('**adds a section and hands it back with its word count**', async () => {
    const res = await request(app).post('/api/knowledge').set(auth(owner)).send({
      title: 'What we do',
      body: 'We build web applications, mobile apps and WhatsApp automation.',
    }).expect(201);

    expect(res.body.data.title).toBe('What we do');

    const list = await request(app).get('/api/knowledge').set(auth(owner)).expect(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].words).toBe(wordsIn('What we do') + wordsIn(res.body.data.body));
    expect(list.body.data[0].inPrompt).toBe(true);
  });

  it('edits and removes one', async () => {
    const entry = await addEntry(TENANT, 'Hours', 'Nine to six.');

    await request(app).patch(`/api/knowledge/${entry.id}`).set(auth(owner))
      .send({ body: 'Nine to seven, Monday to Friday.' }).expect(200);
    expect((await prisma.knowledgeEntry.findUniqueOrThrow({ where: { id: entry.id } })).body)
      .toBe('Nine to seven, Monday to Friday.');

    await request(app).delete(`/api/knowledge/${entry.id}`).set(auth(owner)).expect(200);
    expect(await prisma.knowledgeEntry.findUnique({ where: { id: entry.id } })).toBeNull();
  });

  it('refuses an empty PATCH rather than reporting a save that did not happen', async () => {
    const entry = await addEntry(TENANT, 'Hours', 'Nine to six.');
    await request(app).patch(`/api/knowledge/${entry.id}`).set(auth(owner)).send({}).expect(400);
  });

  it('**refuses one enormous entry, and says how to fix it**', async () => {
    // A single wall of text is both a budget hazard and worse to answer from than several
    // titled sections, so the refusal explains that rather than just saying no.
    const res = await request(app).post('/api/knowledge').set(auth(owner)).send({
      title: 'Everything', body: words(ENTRY_WORD_LIMIT + 1),
    }).expect(400);

    expect(res.body.message).toMatch(/split it into a few shorter ones/i);
  });

  it('**is invisible to another workspace**', async () => {
    const mine = await addEntry(TENANT, 'Mine', 'Private.');

    expect((await request(app).get('/api/knowledge').set(auth(otherOwner)).expect(200)).body.data)
      .toHaveLength(0);
    await request(app).patch(`/api/knowledge/${mine.id}`).set(auth(otherOwner))
      .send({ title: 'Theirs now' }).expect(404);
    await request(app).delete(`/api/knowledge/${mine.id}`).set(auth(otherOwner)).expect(404);

    expect((await prisma.knowledgeEntry.findUniqueOrThrow({ where: { id: mine.id } })).title)
      .toBe('Mine');
  });

  it('is behind automation:write', async () => {
    const role = await prisma.role.create({
      data: { tenantId: TENANT, name: 'Agent', permissions: ['inbox:read'] },
    });
    const agent = await prisma.user.create({
      data: {
        tenantId: TENANT, phone: '15551110009', fullName: 'Agent', role: 'AGENT', roleId: role.id,
      },
    });
    // This person is created inside the test body, so no hook can cover them.
    await seedMemberships();
    const token = signToken({ userId: agent.id });

    await request(app).get('/api/knowledge').set(auth(token)).expect(403);
    await request(app).post('/api/knowledge').set(auth(token))
      .send({ title: 'x', body: 'y' }).expect(403);
  });
});

describe('the budget', () => {
  it('**drops whole entries rather than cutting one in half**', async () => {
    // Half a refund policy is worse than none: a model given a sentence that stops mid-clause
    // finishes the thought itself, confidently and wrongly.
    await addEntry(TENANT, 'First', words(KNOWLEDGE_WORD_BUDGET - 200), 1);
    await addEntry(TENANT, 'Second', words(500), 2);

    const selected = await knowledgeFor(TENANT);

    expect(selected.entries.map((e) => e.title)).toEqual(['First']);
    expect(selected.usage.droppedEntries).toBe(1);
    // Nothing truncated: what survived is the entry, whole.
    expect(selected.entries[0].body.split(/\s+/)).toHaveLength(KNOWLEDGE_WORD_BUDGET - 200);
  });

  it('**sortOrder decides what survives**, which is why the page calls it priority', async () => {
    await addEntry(TENANT, 'Least important', words(KNOWLEDGE_WORD_BUDGET - 100), 99);
    await addEntry(TENANT, 'Most important', words(100), 1);

    const selected = await knowledgeFor(TENANT);

    expect(selected.entries.map((e) => e.title)).toEqual(['Most important']);
  });

  it('**tells the page which entries the assistant cannot see**', async () => {
    // A total alone would leave the operator to work out which paragraph stopped counting.
    await addEntry(TENANT, 'Fits', words(100), 1);
    await addEntry(TENANT, 'Does not', words(KNOWLEDGE_WORD_BUDGET), 2);

    const res = await request(app).get('/api/knowledge').set(auth(owner)).expect(200);

    const byTitle = Object.fromEntries(
      res.body.data.map((e: { title: string; inPrompt: boolean }) => [e.title, e.inPrompt]));
    expect(byTitle).toEqual({ Fits: true, 'Does not': false });
    expect(res.body.meta.droppedEntries).toBe(1);
  });

  it('leaves an inactive entry out without deleting it', async () => {
    const entry = await addEntry(TENANT, 'Retired', 'Last year’s pricing.');
    await prisma.knowledgeEntry.update({ where: { id: entry.id }, data: { isActive: false } });

    expect((await knowledgeFor(TENANT)).entries).toHaveLength(0);
    // The text is still there — switching off is how you retire an answer, not lose it.
    expect(await prisma.knowledgeEntry.findUnique({ where: { id: entry.id } })).not.toBeNull();
  });
});

describe('what reaches the model', () => {
  const promptFor = (knowledge: string, faqs: Array<{ keywords: string[]; response: string }> = []) =>
    buildSystemPrompt({
      tenant: { businessName: 'mTouch Labs', category: null } as never,
      // Null, not a stub: a workspace with no WhatsApp channel has no assistant, and null is what
      // the copy resolver reads as "nothing set, inherit".
      assistant: null,
      category: null,
      faqs,
      knowledge,
      hasMenu: false,
    });

  it('**puts the prose in the prompt, under its heading**', async () => {
    await addEntry(TENANT, 'What we do', 'We build mobile apps.');
    const selected = await knowledgeFor(TENANT);

    const prompt = promptFor(knowledgeAsPrompt(selected.entries));

    expect(prompt).toContain('ABOUT THE BUSINESS');
    expect(prompt).toContain('## What we do');
    expect(prompt).toContain('We build mobile apps.');
  });

  it('**no longer tells the assistant the answer must be in a list**', async () => {
    // The old wording was "If the answer is not in the list above, say you'll check" — with
    // prose there is no list, and the instruction read as a refusal to use the paragraph it had
    // just been given.
    const prompt = promptFor('## What we do\nWe build mobile apps.');

    expect(prompt).not.toContain('not in the list above');
    expect(prompt).toContain('Answer only from the material above');
    expect(prompt).toContain('never add a fact that is not there');
  });

  it('keeps the prepared answers alongside, because exact wording still matters', async () => {
    const prompt = promptFor('## What we do\nWe build mobile apps.', [
      { keywords: ['refund'], response: 'Refunds within 14 days.' },
    ]);

    expect(prompt).toContain('PREPARED ANSWERS');
    expect(prompt).toContain('Refunds within 14 days.');
    expect(prompt).toContain('## What we do');
  });

  it('omits the section entirely when nothing is written', () => {
    // An empty "ABOUT THE BUSINESS" heading is noise the model has to interpret.
    const prompt = promptFor('');
    expect(prompt).not.toContain('ABOUT THE BUSINESS');
  });
});

/*
 * Memberships for the users this fixture inserts directly.
 *
 * In the product every path that creates a user writes a `Membership` too. Fixtures bypass those
 * paths, so without this they produce a login belonging to no workspace — which works while
 * `requireAuth` reads `User.tenantId` and 401s the moment it reads memberships.
 *
 * Registered last in the file so it runs after every fixture hook above, whichever of them created
 * the users. Idempotent. See `test-support/members.ts` for why this is an explicit call rather than
 * a global hook.
 */
beforeEach(async () => { await seedMemberships(); });
