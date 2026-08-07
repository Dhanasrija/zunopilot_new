import { prisma } from '../../config/prisma.js';

/*
 * What the assistant knows about the business.
 *
 * Every active entry goes into the prompt, whole. That is the right shape while the corpus is a
 * few pages — the model sees everything, so it cannot retrieve the wrong passage, because it
 * never retrieves. It is also the shape that stops working at some size, which is what this
 * file is really about.
 */

/**
 * How much prose the assistant is given, in words.
 *
 * **A budget rather than "whatever is in the table" is the whole point.** Without one, the
 * fifteenth entry somebody pastes silently doubles the cost of every single inbound message,
 * and the twentieth pushes the conversation history out of the context window — at which point
 * the assistant starts forgetting what the customer said two messages ago, and nothing on any
 * screen connects that to the paragraph that was added last Tuesday.
 *
 * 8,000 words is roughly 11k tokens: comfortable beside a 300-token answer and eight messages
 * of history in any current model, and far more than a small business has to say about itself.
 * The number is here, once, so raising it is a decision rather than an accident.
 */
export const KNOWLEDGE_WORD_BUDGET = 8_000;

/** A single entry may not eat the whole budget on its own. */
export const ENTRY_WORD_LIMIT = 2_000;

export const wordsIn = (text: string): number =>
  text.trim() ? text.trim().split(/\s+/).length : 0;

export interface KnowledgeUsage {
  /** Words across every active entry, whether or not they all fit. */
  used: number;
  budget: number;
  /** Entries dropped for being past the budget. Zero is the normal, healthy answer. */
  droppedEntries: number;
}

export interface SelectedKnowledge {
  entries: Array<{ id: string; title: string; body: string }>;
  usage: KnowledgeUsage;
}

/**
 * The entries the model will actually be shown, in order, up to the budget.
 *
 * **Whole entries only.** Cutting an entry in half to use the last two hundred words of budget
 * would hand the model a sentence that stops mid-clause, and a model given half a refund policy
 * does not decline to answer — it finishes the thought itself, confidently and wrongly. Better
 * to drop the entry and be able to say so.
 *
 * `sortOrder` decides what survives, which is why the page presents it as "what matters most"
 * rather than as decoration.
 */
export const knowledgeFor = async (tenantId: string): Promise<SelectedKnowledge> => {
  const rows = await prisma.knowledgeEntry.findMany({
    where: { tenantId, isActive: true },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    select: { id: true, title: true, body: true },
  });

  const entries: SelectedKnowledge['entries'] = [];
  let used = 0;
  let dropped = 0;

  for (const row of rows) {
    const cost = wordsIn(row.title) + wordsIn(row.body);
    if (used + cost > KNOWLEDGE_WORD_BUDGET) {
      dropped += 1;
      continue;
    }
    entries.push(row);
    used += cost;
  }

  return {
    entries,
    // `used` counts what was *selected*, so the page's "3,100 of 8,000" describes what the
    // assistant can see rather than what is stored. `droppedEntries` carries the rest of the
    // truth, and the page says so out loud.
    usage: { used, budget: KNOWLEDGE_WORD_BUDGET, droppedEntries: dropped },
  };
};

/**
 * The knowledge as the model reads it.
 *
 * Headed, so the model can attribute an answer to a section rather than to an undifferentiated
 * wall — which is also what makes a useful title worth asking for on the page.
 */
export const knowledgeAsPrompt = (
  entries: Array<{ title: string; body: string }>,
): string => entries
  .map((entry) => `## ${entry.title.trim()}\n${entry.body.trim()}`)
  .join('\n\n');
