// Shared vocabulary for the Support screens.

export const TICKET_STATUSES = [
  'OPEN', 'IN_PROGRESS', 'WAITING_ON_CUSTOMER', 'RESOLVED', 'CLOSED',
] as const;

export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const TICKET_PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];

/** Statuses where the promise is discharged — these need `tickets:close`. */
export const CLOSED_STATUSES: TicketStatus[] = ['RESOLVED', 'CLOSED'];

export const STATUS_LABEL: Record<TicketStatus, string> = {
  OPEN: 'Open',
  IN_PROGRESS: 'In progress',
  WAITING_ON_CUSTOMER: 'Waiting on customer',
  RESOLVED: 'Resolved',
  CLOSED: 'Closed',
};

export const STATUS_TONE: Record<TicketStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  OPEN: 'destructive',
  IN_PROGRESS: 'default',
  WAITING_ON_CUSTOMER: 'secondary',
  RESOLVED: 'secondary',
  CLOSED: 'outline',
};

export const PRIORITY_LABEL: Record<TicketPriority, string> = {
  LOW: 'Low', NORMAL: 'Normal', HIGH: 'High', URGENT: 'Urgent',
};

export interface Ticket {
  id: string;
  number: string;
  sequence: number;
  subject: string;
  body: string;
  status: TicketStatus;
  priority: TicketPriority;
  customerId: string | null;
  customer: { id: string; waId: string; name: string | null; phone: string | null } | null;
  conversationId: string | null;
  assigneeId: string | null;
  assignee: { id: string; fullName: string } | null;
  openedBy: { id: string; fullName: string } | null;
  openedAt: string;
  firstRespondedAt: string | null;
  resolvedAt: string | null;
  closedAt: string | null;
  updatedAt: string;
}

export interface TicketEvent {
  id: string;
  type: string;
  fromStatus: TicketStatus | null;
  toStatus: TicketStatus | null;
  body: string | null;
  /** Whether the customer saw this line. Drives how it is rendered. */
  visibleToCustomer: boolean;
  messageId: string | null;
  createdAt: string;
  actor: { id: string; fullName: string } | null;
}

/**
 * Whether a free-form WhatsApp reply may be sent right now.
 *
 * Served with the ticket so the reply box can say the window has closed
 * *before* the agent types, rather than after they press send.
 */
export interface WindowState {
  open: boolean;
  lastInboundAt: string | null;
  expiresAt: string | null;
  reason: 'open' | 'expired' | 'never_messaged' | 'no_conversation';
}

/** How long is left in the 24-hour window, in words. */
export const windowLabel = (window: WindowState): string => {
  if (window.reason === 'no_conversation') return 'Not linked to a WhatsApp conversation';
  if (window.reason === 'never_messaged') return 'This customer has never messaged on WhatsApp';
  if (!window.open) return 'Reply window closed — over 24 hours since their last message';

  const msLeft = new Date(window.expiresAt!).getTime() - Date.now();
  const hours = Math.floor(msLeft / 3_600_000);
  const minutes = Math.round((msLeft % 3_600_000) / 60_000);
  return hours >= 1
    ? `${hours}h ${minutes}m left to reply freely`
    : `${minutes}m left to reply freely`;
};
