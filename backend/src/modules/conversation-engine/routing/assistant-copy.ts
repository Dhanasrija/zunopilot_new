import type { Assistant, BusinessCategory } from '@prisma/client';

/*
 * What the assistant sounds like, and what it declines.
 *
 * ── Why this is a resolver and not five columns with defaults ────────────────
 *
 * Each field can come from three places: the workspace's own setting, its business category, or a
 * house default. Written as column defaults it would be two places, and the category's wording
 * would have to be copied into every assistant row at signup — which freezes it. Improve the
 * restaurant persona in March and only March's signups would ever see it, and nothing in the row
 * would distinguish "they chose this sentence" from "we wrote it for them in January".
 *
 * So the columns are nullable and this function answers the question at read time.
 *
 * ── Three states, one column ─────────────────────────────────────────────────
 *
 *   null          → inherit (category, then house)
 *   ''            → deliberately none; the field is switched off
 *   anything else → theirs
 *
 * The empty string is what lets a workspace remove a piece of copy rather than reset it, without a
 * second `…IsSet` boolean beside every field.
 *
 * ── Why `source` comes back ──────────────────────────────────────────────────
 *
 * The settings screen has to be able to say "inherited from Restaurant" and offer a Reset that
 * writes null. Deriving that in the client means re-implementing the precedence there, and the copy
 * that drifts is the one that tells somebody their bot says something it does not.
 */

/** Where a resolved value came from. */
export type CopySource = 'tenant' | 'category' | 'house';

export interface ResolvedCopy {
  /** Spliced in above the rules. Tone and who the assistant is. */
  persona: string;
  /** Extra topics this workspace declines, one per line. Added to the house floor. */
  outOfScopeTopics: string;
  /** Wording for "that is about us, but the material does not cover it". */
  unknownAnswerReply: string;
  /** Wording for "that is not what I am here for". Carries no escalation. */
  outOfScopeReply: string;
  /** Roughly how many words a reply may run to. */
  replyWordLimit: number;
  /** The language to answer in, or null to mirror the customer. */
  replyLanguage: string | null;
  sources: Record<keyof Omit<ResolvedCopy, 'sources'>, CopySource>;
}

/**
 * The house defaults, used when neither the workspace nor its category has an opinion.
 *
 * Deliberately bland. These are what every workspace that never opens the settings screen sounds
 * like, so they have to be safe rather than characterful — and `HOUSE.persona` is what has in fact
 * been running in production, because the column it belongs to has never had an input.
 */
export const HOUSE = {
  persona: 'Be brief, warm and factual.',
  outOfScopeTopics: '',
  unknownAnswerReply: "I'll check with the team and come back to you.",
  outOfScopeReply: 'That is not something I can help with here.',
  replyWordLimit: 60,
  replyLanguage: null as string | null,
} as const;

/** Bounds the API enforces, exported so the schema and the tests cannot disagree about them. */
export const COPY_LIMITS = {
  /** Long enough for a paragraph of character, short enough not to be a second prompt. */
  personaChars: 4000,
  /** One topic per line, and a topic is a phrase. */
  topicLines: 10,
  topicLineChars: 80,
  /** A sentence in the business's voice. Anything longer is prose competing with the rules. */
  replyChars: 200,
  wordLimitMin: 20,
  wordLimitMax: 150,
} as const;

/** Null means inherit; an empty string is a real answer. */
const pick = <T>(
  tenant: T | null | undefined,
  category: T | null | undefined,
  house: T,
): { value: T; source: CopySource } => {
  if (tenant !== null && tenant !== undefined) return { value: tenant, source: 'tenant' };
  if (category !== null && category !== undefined) return { value: category, source: 'category' };
  return { value: house, source: 'house' };
};

/** What the assistant's copy actually resolves to, and where each piece came from. */
export const resolveAssistantCopy = (
  assistant: Pick<
    Assistant,
    'generalSystemPrompt' | 'outOfScopeTopics' | 'unknownAnswerReply' | 'outOfScopeReply'
    | 'replyWordLimit' | 'replyLanguage'
  > | null,
  category: Pick<BusinessCategory, 'defaultPersona' | 'defaultOutOfScopeTopics'> | null,
): ResolvedCopy => {
  /*
   * A blank-but-present persona reads as "inherit", not as "no persona".
   *
   * The other fields treat `''` as a deliberate none, and this one cannot: an assistant with no
   * persona line at all is not something anybody would choose, and the field has been settable
   * through the API since before it had a UI — so a workspace that saved an empty textarea meant
   * "I have not written one", not "answer with no voice".
   */
  const persona = pick(
    assistant?.generalSystemPrompt?.trim() || null,
    category?.defaultPersona?.trim() || null,
    HOUSE.persona,
  );
  const topics = pick(
    assistant?.outOfScopeTopics,
    category?.defaultOutOfScopeTopics,
    HOUSE.outOfScopeTopics,
  );
  const unknown = pick(assistant?.unknownAnswerReply, null, HOUSE.unknownAnswerReply);
  const outOfScope = pick(assistant?.outOfScopeReply, null, HOUSE.outOfScopeReply);
  const wordLimit = pick(assistant?.replyWordLimit, null, HOUSE.replyWordLimit);
  const language = pick(assistant?.replyLanguage, null, HOUSE.replyLanguage);

  return {
    persona: persona.value,
    outOfScopeTopics: topics.value,
    unknownAnswerReply: unknown.value,
    outOfScopeReply: outOfScope.value,
    replyWordLimit: wordLimit.value,
    replyLanguage: language.value,
    sources: {
      persona: persona.source,
      outOfScopeTopics: topics.source,
      unknownAnswerReply: unknown.source,
      outOfScopeReply: outOfScope.source,
      replyWordLimit: wordLimit.source,
      replyLanguage: language.source,
    },
  };
};

/**
 * The topic list as prompt lines.
 *
 * Trimmed and capped here as well as at the API, because this is the last point before the text
 * reaches a model: a row written before the cap existed, or by a script, must not turn into a
 * hundred-line instruction block sitting above the rules.
 */
export const topicLines = (topics: string): string[] => topics
  .split('\n')
  .map((line) => line.trim().replace(/^[-•*]\s*/, ''))
  .filter(Boolean)
  .slice(0, COPY_LIMITS.topicLines)
  .map((line) => line.slice(0, COPY_LIMITS.topicLineChars));
