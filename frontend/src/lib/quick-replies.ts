import { api } from './api';

// Saved questions with tappable answers.
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

/** What WhatsApp allows, mirrored from the server so the form can say so before it saves. */
export const QUICK_REPLY_LIMITS = {
  buttons: 3,
  label: 20,
  /** Not the 4000 a plain text reply allows — an interactive message is capped lower. */
  body: 1024,
  name: 80,
} as const;

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
