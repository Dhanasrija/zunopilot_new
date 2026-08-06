import type { Request, Response } from 'express';
import { prisma } from '../../../config/prisma.js';
import { asyncHandler } from '../../../utils/asyncHandler.js';
import { ApiError } from '../../../utils/ApiError.js';
import { tenantIdOf } from '../../../middleware/auth.js';
import { candidateWorkflows } from '../routing/ai-router.js';

// Assistant + routing configuration.
//
// Every read and write is scoped by `tenantId` from the token, never from the
// body or the path. An assistant id is a uuid a caller could guess, so the
// lookup below is always `findFirst({ id, tenantId })` — never `findUnique({ id })`,
// which is how one workspace reads another's routing policy.

const requireAssistant = async (req: Request) => {
  const assistant = await prisma.assistant.findFirst({
    where: { id: req.params.assistantId, tenantId: tenantIdOf(req) },
    include: { whatsappChannel: true },
  });
  if (!assistant) throw ApiError.notFound('Assistant not found');
  return assistant;
};

export const listAssistants = asyncHandler(async (req: Request, res: Response) => {
  const assistants = await prisma.assistant.findMany({
    where: { tenantId: tenantIdOf(req) },
    include: {
      whatsappChannel: { select: { displayPhone: true, phoneNumberId: true } },
      _count: { select: { workflows: true, conversations: true } },
    },
    orderBy: { createdAt: 'asc' },
  });
  res.json({ success: true, data: assistants });
});

export const getAssistant = asyncHandler(async (req: Request, res: Response) => {
  const assistant = await requireAssistant(req);
  res.json({ success: true, data: assistant });
});

export const updateAssistant = asyncHandler(async (req: Request, res: Response) => {
  const assistant = await requireAssistant(req);
  const updated = await prisma.assistant.update({
    where: { id: assistant.id },
    data: req.body,
  });
  res.json({ success: true, data: updated });
});

/**
 * The whole routing picture in one call: thresholds, the workflows the router
 * may choose from, the deterministic rules that pre-empt it, and any overlaps
 * worth reviewing. One request rather than five, because the routing page shows
 * them together and a partial view of routing policy is misleading.
 */
export const getRoutingConfig = asyncHandler(async (req: Request, res: Response) => {
  const assistant = await requireAssistant(req);

  const [workflows, rules] = await Promise.all([
    prisma.workflow.findMany({
      where: { assistantId: assistant.id, status: { not: 'ARCHIVED' } },
      include: {
        capability: true,
        _count: { select: { instances: true } },
      },
      orderBy: [{ priority: 'desc' }, { name: 'asc' }],
    }),
    prisma.routingRule.findMany({
      where: { assistantId: assistant.id },
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
    }),
  ]);

  res.json({
    success: true,
    data: {
      assistant: {
        id: assistant.id,
        name: assistant.name,
        status: assistant.status,
        channel: {
          displayPhone: assistant.whatsappChannel.displayPhone,
          phoneNumberId: assistant.whatsappChannel.phoneNumberId,
        },
        generalResponseEnabled: assistant.generalResponseEnabled,
        generalSystemPrompt: assistant.generalSystemPrompt,
        highConfidenceThreshold: assistant.highConfidenceThreshold,
        mediumConfidenceThreshold: assistant.mediumConfidenceThreshold,
        maxRecentMessages: assistant.maxRecentMessages,
        defaultFallbackWorkflowId: assistant.defaultFallbackWorkflowId,
        humanHandoffWorkflowId: assistant.humanHandoffWorkflowId,
      },
      workflows: workflows.map((w) => ({
        id: w.id,
        name: w.name,
        slug: w.slug,
        status: w.status,
        category: w.category,
        priority: w.priority,
        purpose: w.capability?.purpose ?? null,
        requiresConfirmation: w.capability?.requiresConfirmation ?? false,
        minimumConfidence: w.capability?.minimumConfidence ?? null,
        allowsInterruption: w.capability?.allowsInterruption ?? false,
        sideEffects: w.capability?.sideEffects ?? [],
        requiredInputs: w.capability?.requiredInputs ?? [],
        exampleCount: {
          positive: Array.isArray(w.capability?.positiveExamples) ? w.capability.positiveExamples.length : 0,
          negative: Array.isArray(w.capability?.negativeExamples) ? w.capability.negativeExamples.length : 0,
        },
        totalRuns: w._count.instances,
        routable: w.status === 'PUBLISHED' && Boolean(w.slug) && Boolean(w.capability),
      })),
      rules,
    },
  });
});

export const updateRoutingConfig = asyncHandler(async (req: Request, res: Response) => {
  const assistant = await requireAssistant(req);

  // A fallback or handoff workflow must belong to this tenant. Without this
  // check the body could point routing at another workspace's workflow.
  for (const key of ['defaultFallbackWorkflowId', 'humanHandoffWorkflowId'] as const) {
    const workflowId = req.body[key];
    if (workflowId) {
      const owned = await prisma.workflow.findFirst({
        where: { id: workflowId, tenantId: assistant.tenantId },
        select: { id: true },
      });
      if (!owned) throw ApiError.badRequest(`${key} does not name a workflow in this workspace`);
    }
  }

  const updated = await prisma.assistant.update({ where: { id: assistant.id }, data: req.body });
  res.json({ success: true, data: updated });
});

// ── Deterministic routing rules ──────────────────────────────────────────────

export const listRoutingRules = asyncHandler(async (req: Request, res: Response) => {
  const assistant = await requireAssistant(req);
  const rules = await prisma.routingRule.findMany({
    where: { assistantId: assistant.id },
    orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
  });
  res.json({ success: true, data: rules });
});

export const createRoutingRule = asyncHandler(async (req: Request, res: Response) => {
  const assistant = await requireAssistant(req);

  if (req.body.workflowId) {
    const owned = await prisma.workflow.findFirst({
      where: { id: req.body.workflowId, tenantId: assistant.tenantId },
      select: { id: true },
    });
    if (!owned) throw ApiError.badRequest('workflowId does not name a workflow in this workspace');
  }

  const rule = await prisma.routingRule.create({
    data: { ...req.body, assistantId: assistant.id },
  });
  res.status(201).json({ success: true, data: rule });
});

export const updateRoutingRule = asyncHandler(async (req: Request, res: Response) => {
  const assistant = await requireAssistant(req);
  const existing = await prisma.routingRule.findFirst({
    where: { id: req.params.ruleId, assistantId: assistant.id },
  });
  if (!existing) throw ApiError.notFound('Routing rule not found');

  const rule = await prisma.routingRule.update({ where: { id: existing.id }, data: req.body });
  res.json({ success: true, data: rule });
});

export const deleteRoutingRule = asyncHandler(async (req: Request, res: Response) => {
  const assistant = await requireAssistant(req);
  const existing = await prisma.routingRule.findFirst({
    where: { id: req.params.ruleId, assistantId: assistant.id },
  });
  if (!existing) throw ApiError.notFound('Routing rule not found');

  await prisma.routingRule.delete({ where: { id: existing.id } });
  res.json({ success: true });
});

// ── Conflict detection ───────────────────────────────────────────────────────

/**
 * Find capability pairs likely to be confused with each other.
 *
 * Two signals, because lexical overlap alone is too blunt. "I want to book a
 * cardiologist appointment" and "Is Dr Rao available tomorrow?" share almost no
 * words, yet they are the canonical confusable pair.
 *
 *   A. Lexical overlap between the two sets of positive examples.
 *   B. One workflow's *negative* examples resembling the other's *positive*
 *      ones. This is the stronger signal: an author who wrote "Is Dr Rao
 *      available tomorrow?" into booking's negative examples has told us
 *      directly that the pair is confusable — and that they have guarded it.
 *
 * A guarded pair is still reported, at low severity. The operator wants to see
 * that the pair exists and is handled, so that deleting a negative example
 * visibly flips it to high rather than silently removing the only protection.
 */
export const getRoutingConflicts = asyncHandler(async (req: Request, res: Response) => {
  const assistant = await requireAssistant(req);
  const candidates = await candidateWorkflows(assistant.id);

  const tokenise = (text: string) => new Set(
    text.toLowerCase().split(/\W+/).filter((w) => w.length > 3),
  );

  const overlap = (a: Set<string>, b: Set<string>): number => {
    if (!a.size || !b.size) return 0;
    let shared = 0;
    for (const word of a) if (b.has(word)) shared += 1;
    return shared / Math.min(a.size, b.size);
  };

  /** Best similarity between any phrase in `phrases` and any in `against`. */
  const bestPhraseMatch = (phrases: string[], against: string[]): number => {
    let best = 0;
    for (const phrase of phrases) {
      const words = tokenise(phrase);
      for (const other of against) best = Math.max(best, overlap(words, tokenise(other)));
    }
    return best;
  };

  const conflicts: Array<Record<string, unknown>> = [];

  for (let i = 0; i < candidates.length; i += 1) {
    for (let j = i + 1; j < candidates.length; j += 1) {
      const a = candidates[i]!;
      const b = candidates[j]!;

      const aPositive = [...a.positiveExamples, ...a.useWhen];
      const bPositive = [...b.positiveExamples, ...b.useWhen];

      // Signal A — do their positive examples look alike?
      //
      // Examples only, deliberately not `useWhen`. Every useWhen phrase is
      // operator prose of the form "The user explicitly wants to…", so its
      // vocabulary is near-identical across all workflows and including it made
      // every pair look confusable. Positive examples are things a *customer*
      // would type, which is the vocabulary that actually collides.
      const lexical = overlap(
        tokenise(a.positiveExamples.join(' ')),
        tokenise(b.positiveExamples.join(' ')),
      );

      // Signal B — has either author named the other's territory as off-limits?
      const aGuardsB = bestPhraseMatch([...a.negativeExamples, ...a.doNotUseWhen], bPositive);
      const bGuardsA = bestPhraseMatch([...b.negativeExamples, ...b.doNotUseWhen], aPositive);

      const GUARD = 0.6;
      const aDisclaimsB = aGuardsB >= GUARD;
      const bDisclaimsA = bGuardsA >= GUARD;

      const confusable = lexical >= 0.25 || aDisclaimsB || bDisclaimsA;
      if (!confusable) continue;

      const transactional = [a, b].filter((w) => w.sideEffects.length > 0);
      const bothGuarded = aDisclaimsB && bDisclaimsA;

      // The dangerous shape: one of them performs an irreversible action and
      // the pair is not guarded in both directions.
      const severity = bothGuarded
        ? 'low'
        : transactional.length ? 'high' : 'medium';

      const unguarded = !aDisclaimsB ? a : !bDisclaimsA ? b : null;
      const other = unguarded?.workflowId === a.workflowId ? b : a;

      conflicts.push({
        workflows: [
          { workflowId: a.workflowId, name: a.name, hasSideEffects: a.sideEffects.length > 0, guardsTheOther: aDisclaimsB },
          { workflowId: b.workflowId, name: b.name, hasSideEffects: b.sideEffects.length > 0, guardsTheOther: bDisclaimsA },
        ],
        similarity: Math.round(Math.max(lexical, aGuardsB, bGuardsA) * 100) / 100,
        severity,
        detectedBy: lexical >= 0.25 ? 'similar-examples' : 'declared-counter-example',
        suggestion: bothGuarded
          ? 'These overlap, but each already names the other in its negative examples. Keep those examples — they are what keeps the two apart.'
          : unguarded
            ? `Add a negative example to "${unguarded.name}" quoting something a user would say when they mean "${other.name}".`
            : 'Add a negative example to each naming the other.',
        ...(transactional.length && !bothGuarded
          ? { warning: `"${transactional[0]!.name}" performs an action the customer cannot undo.` }
          : {}),
      });
    }
  }

  conflicts.sort((x, y) => (y.similarity as number) - (x.similarity as number));
  res.json({ success: true, data: { conflicts, checked: candidates.length } });
});
