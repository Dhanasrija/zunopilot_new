import { api } from './api';

// Saved replies a team sends often.
//
// **Two kinds, one row.** A set with no answers is a plain-text frequent reply; one with answers is a
// question the customer taps. The presence of `buttons` is the whole distinction — see `isTextReply`,
// which exists so that three files do not each grow their own `buttons.length === 0`.
//
// One place for the shape and the reads, because two screens use them for opposite reasons: the
// Inbox composer picks one to send, and Settings edits them. What the API returns differs by what
// the caller may do — an agent who can only send gets the active sets, somebody with
// `automation:write` gets the retired ones too — so the same call means slightly different things
// on the two screens. That is deliberate and worth knowing when reading either.

export interface QuickReplyButton {
  id: string;
  label: string;
  position: number;
  workflowId: string | null;
  /**
   * What tapping it starts.
   *
   * **Two consequences a person needs to see before sending**: a tap ends any human takeover and
   * hands the conversation to the bot, and it only starts anything while `status` is `PUBLISHED`.
   */
  workflow: { id: string; name: string; status: string } | null;
}

export interface QuickReply {
  id: string;
  name: string;
  body: string;
  isActive: boolean;
  buttons: QuickReplyButton[];
}

export interface QuickReplyInput {
  name: string;
  body: string;
  isActive?: boolean;
  buttons: Array<{ label: string; workflowId?: string | null }>;
}

/**
 * What WhatsApp allows, mirrored from the server so the form can say so before it saves.
 *
 * **The two body limits are a pair, not a number and an aside.** Which one applies depends on
 * whether the set carries answers, so the editor has to pick between them as the operator adds and
 * removes rows — see `bodyLimitFor`.
 */
export const QUICK_REPLY_LIMITS = {
  buttons: 3,
  label: 20,
  /** With answers: an interactive message is capped lower than a text one. */
  body: 1024,
  /** Without: the same 4000 a plain text reply allows, so nothing saveable is unsendable. */
  textBody: 4000,
  name: 80,
} as const;

/**
 * Is this a plain-text frequent reply rather than a question?
 *
 * **The single definition of the distinction.** Inlining `set.buttons.length === 0` at each of the
 * three sites that need it is how the two kinds start disagreeing — the composer treating a set as
 * text while the editor still shows it as a question.
 */
export const isTextReply = (set: QuickReply): boolean => set.buttons.length === 0;

/** Which body limit applies to a set with this many answers. */
export const bodyLimitFor = (buttonCount: number): number =>
  (buttonCount > 0 ? QUICK_REPLY_LIMITS.body : QUICK_REPLY_LIMITS.textBody);

/**
 * Does this set match what the agent has typed?
 *
 * Name first, then body, so `/ref` finds "Refund policy" whether that word is in its title or only
 * in its text. Lives here rather than in the composer for the same reason `countryMatches` lives in
 * `lib/countries.ts`: a search rule is not something a text field should own.
 */
export const quickReplyMatches = (set: QuickReply, query: string): boolean => {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return set.name.toLowerCase().includes(q) || set.body.toLowerCase().includes(q);
};

export const fetchQuickReplies = async (): Promise<QuickReply[]> => {
  const r = await api.get<{ data: QuickReply[] }>('/quick-replies');
  return r.data.data;
};

export const createQuickReply = async (input: QuickReplyInput): Promise<QuickReply> => {
  const r = await api.post<{ data: QuickReply }>('/quick-replies', input);
  return r.data.data;
};

export const updateQuickReply = async (
  id: string, input: Partial<QuickReplyInput>,
): Promise<QuickReply> => {
  const r = await api.patch<{ data: QuickReply }>(`/quick-replies/${id}`, input);
  return r.data.data;
};

export const deleteQuickReply = async (id: string): Promise<void> => {
  await api.delete(`/quick-replies/${id}`);
};

/**
 * The buttons on this set that will hand the conversation back to the bot.
 *
 * Only published ones: a binding to an unpublished workflow survives, and the tap does nothing, so
 * promising otherwise would be a lie the agent finds out about later.
 */
export const handoverButtons = (set: QuickReply): QuickReplyButton[] =>
  set.buttons.filter((b) => b.workflow?.status === 'PUBLISHED');
