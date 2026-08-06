// The shapes the inbox reads, shared by the page and the four regions it is built from.
//
// These live here rather than in the page because all four components need them and a
// component importing a type from the page it renders inside is a cycle waiting to happen.

export type Scope = 'all' | 'mine' | 'unassigned';

export interface Conversation {
  id: string;
  status: string;
  automationPaused: boolean;
  unreadCount: number;
  lastMessageAt: string | null;
  customer: { id: string; name?: string; waId: string };
  assignedAgent?: { id: string; fullName: string; email: string } | null;
  /**
   * The workflow occupying this conversation, if one is.
   *
   * A conversation holds one active instance at a time, and while it does the router refuses
   * every inbound message with `ACTIVE_WORKFLOW_BUSY`. `PAUSED` is the state a handoff node
   * leaves behind — the flow has given up control and is waiting for a human, so it will sit
   * there forever and the bot can never answer again until somebody clears it.
   */
  activeWorkflowInstance?: {
    id: string;
    status: string;
    currentNodeId: string | null;
    workflow: { name: string };
  } | null;
}

export interface TeamMember { id: string; fullName: string; role: string; isActive: boolean }

export interface Message {
  id: string;
  direction: 'INBOUND' | 'OUTBOUND';
  type: string;
  body?: string | null;
  payload?: unknown;
  createdAt: string;
  /**
   * Who sent it. Null on an OUTBOUND message means the bot — the workflow engine or the
   * assistant — which is exactly what a shared inbox has to make visible: a colleague's
   * reply, your own, and an automated one all look identical without it.
   */
  sentByUser?: { id: string; fullName: string; role: string } | null;
}

export interface OfferedOption { id: string; title: string }

/**
 * The rows or buttons an outbound interactive message offered.
 *
 * Written by the engine's inbox mirror under `payload.outbound`. Read defensively —
 * `payload` also carries Meta's own inbound shapes, which this must never try to interpret.
 */
export const outboundOptions = (message: Message): OfferedOption[] => {
  const outbound = (message.payload as { outbound?: { options?: unknown } } | null)?.outbound;
  if (!outbound || !Array.isArray(outbound.options)) return [];
  return outbound.options.filter(
    (o): o is OfferedOption => !!o && typeof (o as OfferedOption).title === 'string',
  );
};

/** What to call this customer. Falls back to the number, which is already masked if masking is on. */
export const displayName = (c: Conversation['customer']) => c.name || c.waId;
