import type { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../config/prisma.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ApiError } from '../../utils/ApiError.js';
import { tenantIdOf, userOf } from '../../middleware/auth.js';
import { providerForVendor } from '../conversation-engine/providers/llm.js';
import { buildSystemPrompt } from '../conversation-engine/routing/general-response.js';
import { aiAgentGate } from '../modules/module.service.js';
import { moduleEnabled } from '../modules/module.service.js';
import { checkAiAllowance, recordAiInteraction } from '../billing/billing.service.js';
import {
  ENTRY_WORD_LIMIT, KNOWLEDGE_WORD_BUDGET, knowledgeAsPrompt, knowledgeFor, wordsIn,
} from './knowledge.service.js';

const idParam = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const requireId = (value: string | undefined): string => {
  if (!value || !idParam.test(value)) throw ApiError.badRequest('Not an entry id');
  return value;
};

/**
 * A word limit rather than a character one, because words are what the budget is spent in and
 * a character count is a number nobody can act on. The message says how far over it is.
 */
const withinEntryLimit = (body: string) => {
  const words = wordsIn(body);
  if (words > ENTRY_WORD_LIMIT) {
    throw ApiError.badRequest(
      `That entry is ${words.toLocaleString()} words, and one entry may be at most `
      + `${ENTRY_WORD_LIMIT.toLocaleString()}. Split it into a few shorter ones — the assistant `
      + 'also finds a short, titled section easier to answer from than a long one.',
    );
  }
};

const entrySchema = z.object({
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

const entryPatchSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  body: z.string().trim().min(1).optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
}).refine(
  (value) => Object.values(value).some((field) => field !== undefined),
  { message: 'Nothing to update' },
);

/**
 * Everything the workspace has written, plus what the assistant can actually see.
 *
 * `usage` is the reason this returns more than a list. Without it, the twelfth entry somebody
 * adds silently stops reaching the model and no screen ever says so.
 */
export const listKnowledge = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = tenantIdOf(req);

  const [entries, selected] = await Promise.all([
    prisma.knowledgeEntry.findMany({
      where: { tenantId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    }),
    knowledgeFor(tenantId),
  ]);

  const visible = new Set(selected.entries.map((entry) => entry.id));

  res.json({
    success: true,
    data: entries.map((entry) => ({
      ...entry,
      words: wordsIn(entry.title) + wordsIn(entry.body),
      // Per entry, so the page can mark the ones past the budget rather than reporting a
      // total and leaving the operator to work out which are affected.
      inPrompt: visible.has(entry.id),
    })),
    meta: { ...selected.usage, entryWordLimit: ENTRY_WORD_LIMIT },
  });
});

export const createKnowledge = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = tenantIdOf(req);
  const body = entrySchema.parse(req.body);
  withinEntryLimit(body.body);

  const entry = await prisma.knowledgeEntry.create({
    data: { ...body, tenantId, createdById: userOf(req).id },
  });
  res.status(201).json({ success: true, data: entry });
});

export const updateKnowledge = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = tenantIdOf(req);
  const id = requireId(req.params.id);
  const body = entryPatchSchema.parse(req.body);
  if (body.body !== undefined) withinEntryLimit(body.body);

  // Scoped before the write, so an id from another workspace is a 404 rather than an update.
  const existing = await prisma.knowledgeEntry.findFirst({ where: { id, tenantId }, select: { id: true } });
  if (!existing) throw ApiError.notFound('Entry not found');

  res.json({ success: true, data: await prisma.knowledgeEntry.update({ where: { id }, data: body }) });
});

export const deleteKnowledge = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = tenantIdOf(req);
  const id = requireId(req.params.id);

  const existing = await prisma.knowledgeEntry.findFirst({ where: { id, tenantId }, select: { id: true } });
  if (!existing) throw ApiError.notFound('Entry not found');

  await prisma.knowledgeEntry.delete({ where: { id } });
  res.json({ success: true, data: { id } });
});

const trySchema = z.object({ question: z.string().trim().min(1).max(1_000) });

/**
 * Ask the assistant a question and see the answer, without messaging anybody.
 *
 * **The point of the page.** Knowledge that reads well to the person who wrote it can still
 * leave the assistant saying "I'll check with the team" — because the fact is phrased as a
 * heading, or buried in a paragraph about something else. Without this, the first person to
 * discover that is a customer.
 *
 * It builds the **same** prompt `respondGenerally` builds, from the same function, so the
 * preview cannot drift into being reassuring and wrong. What it deliberately leaves out is
 * conversation history: there is no conversation, and inventing one would make the answer
 * depend on a thread that does not exist.
 *
 * A real model call, so it is gated and metered exactly like an inbound message would be. An
 * operator testing is cheap, but "cheap" is how unmetered LLM spend starts, and this codebase
 * has already had one path calling a model outside every switch that was supposed to govern it.
 */
export const tryKnowledge = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = tenantIdOf(req);
  const { question } = trySchema.parse(req.body);

  const gate = await aiAgentGate(tenantId);
  if (!gate.allowed) {
    throw ApiError.badRequest(
      gate.reason === 'DISABLED_BY_OPERATOR'
        ? 'The AI agent is switched off for this workspace, so there is nothing to try. Contact us to turn it on.'
        : 'The AI agent is switched off in your settings. Turn it on to try a question.',
    );
  }

  const allowance = await checkAiAllowance(tenantId);
  if (!allowance.allowed) {
    throw ApiError.badRequest(
      'This workspace has used its AI allowance for the month, so a test would not run either.',
    );
  }

  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });

  /*
   * The assistant belongs to a WhatsApp channel, and a workspace that has not connected one has
   * no assistant — so the try-it box uses that channel's settings when there is one and the
   * plain defaults when there is not. Refusing to preview until WhatsApp is connected would be
   * backwards: writing the knowledge first is exactly the right order to work in.
   */
  const assistant = await prisma.assistant.findFirst({
    where: { tenantId },
    select: {
      generalSystemPrompt: true,
      outOfScopeTopics: true,
      unknownAnswerReply: true,
      outOfScopeReply: true,
      replyWordLimit: true,
      replyLanguage: true,
    },
  });

  /*
   * The same category the live path resolves from, so the preview inherits exactly what a real
   * message would. Getting this wrong in either direction makes the preview a liar: omit it and the
   * try-it box answers in house voice while customers hear the category's.
   */
  const category = tenant.businessCategoryId
    ? await prisma.businessCategory.findUnique({
      where: { id: tenant.businessCategoryId },
      select: { label: true, defaultPersona: true, defaultOutOfScopeTopics: true },
    })
    : null;

  const [knowledge, faqs, menuCount, supportEnabled] = await Promise.all([
    knowledgeFor(tenantId),
    await moduleEnabled(tenantId, 'KEYWORD_RULES')
      ? prisma.keywordRule.findMany({
        where: { tenantId, isActive: true },
        orderBy: { priority: 'desc' },
        take: 40,
        select: { keywords: true, response: true },
      })
      : [],
    prisma.menuItem.count({ where: { tenantId, inStock: true } }),
    moduleEnabled(tenantId, 'SUPPORT'),
  ]);

  const started = Date.now();
  // The workspace's own vendor, so a preview is answered by the model that will answer its
  // customers. Previewing on a different model is a preview of something else.
  const completion = await providerForVendor(tenant.llmVendor).complete({
    systemPrompt: buildSystemPrompt({
      tenant,
      // Null rather than a stub: a workspace with no channel has no assistant, and `null` is what
      // the resolver reads as "nothing set here, inherit".
      assistant,
      category,
      faqs,
      knowledge: knowledgeAsPrompt(knowledge.entries),
      hasMenu: menuCount > 0,
      hasSupport: supportEnabled,
    }),
    // No history: there is no conversation, and a fabricated one would make the preview depend
    // on messages that were never sent.
    userPrompt: `--- BEGIN UNTRUSTED CUSTOMER MESSAGE ---\n${question}\n`
      + '--- END UNTRUSTED CUSTOMER MESSAGE ---\n\nReply to the message between the markers.',
    maxTokens: 300,
  });

  void recordAiInteraction(tenantId, {
    billableRatePaise: allowance.billable ? allowance.ratePaise : 0,
  });

  res.json({
    success: true,
    data: {
      answer: completion.text?.trim() ?? '',
      latencyMs: Date.now() - started,
      // So the page can say "answered from 4 of your 6 sections" rather than leaving the
      // operator guessing whether the entry they just added was even considered.
      entriesUsed: knowledge.entries.length,
      wordsUsed: knowledge.usage.used,
      budget: KNOWLEDGE_WORD_BUDGET,
    },
  });
});
