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
  customer: { id: string; name?: string | null; waProfileName?: string | null; waId: string };
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
  /**
   * Our own path to the file, `/api/media/:id/file`, not Meta's URL — theirs expires.
   * Null when there is no attachment, or when fetching it from Meta failed.
   */
  mediaUrl?: string | null;
  payload?: unknown;

  /**
   * What Meta last told us about getting this to the customer.
   *
   * Outbound only in practice — every outbound row is born `SENT` and `RECEIVED` is the inbound
   * default. Optional because older rows and the campaign test-send path predate it.
   *
   * **Take the tick's state from here, and use the timestamps below only for the label.** Meta
   * delivers status webhooks out of order, and the monotonic guard on the server rejects a
   * `delivered` that arrives after a `read` — so a set `readAt` beside a null `deliveredAt` is
   * the guard working, not missing data. Coalescing one from the other invents a fact.
   */
  /**
   * The message this one quotes, as a snippet. Null when nothing was quoted, and also when the
   * quoted message has since been removed from the inbox — the server drops it in that case, so
   * a removal cannot leak back through a reply to it.
   *
   * One level deep: a reply to a reply shows its own quote, not a chain. WhatsApp does the same.
   */
  replyTo?: {
    id: string;
    direction: 'INBOUND' | 'OUTBOUND';
    type: string;
    body?: string | null;
  } | null;

  status?: 'SENT' | 'DELIVERED' | 'READ' | 'FAILED' | 'RECEIVED';
  deliveredAt?: string | null;
  readAt?: string | null;
  /** Why Meta refused it, in its own words, phone numbers already scrubbed server-side. */
  statusError?: string | null;

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

/*
 * What to call this customer.
 *
 * Re-exported from `lib/customer-name` rather than defined here: the Customers table needs the
 * same answer, and it used to be `c.name || c.waId` in six places. Now that a person has both a
 * WhatsApp profile name and an operator's label, six copies would be six formats.
 */
export { displayName, primaryName } from '@/lib/customer-name';
