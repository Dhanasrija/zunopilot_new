// Shared vocabulary for the Leads screens.
//
// Kept in one place because the list and the detail page must agree about what a
// status is called and how a value is formatted — two copies of a status list is
// how one screen ends up showing "Proposal" and the other "PROPOSAL".

export const LEAD_STATUSES = [
  'NEW', 'CONTACTED', 'QUALIFIED', 'PROPOSAL', 'WON', 'LOST',
] as const;

export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const CALL_OUTCOMES = [
  { value: 'CONNECTED', label: 'Connected' },
  { value: 'NO_ANSWER', label: 'No answer' },
  { value: 'BUSY', label: 'Busy' },
  { value: 'WRONG_NUMBER', label: 'Wrong number' },
  { value: 'CALLBACK_REQUESTED', label: 'Asked to be called back' },
] as const;

export type CallOutcome = (typeof CALL_OUTCOMES)[number]['value'];

/** Badge tone per status, within the four the design system actually has. */
export const STATUS_TONE: Record<LeadStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  NEW: 'secondary',
  CONTACTED: 'secondary',
  QUALIFIED: 'default',
  PROPOSAL: 'default',
  WON: 'default',
  LOST: 'destructive',
};

export interface LeadOwner { id: string; fullName: string }

export interface Lead {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  company: string | null;
  source: string | null;
  status: LeadStatus;
  ownerId: string | null;
  owner: LeadOwner | null;
  /** Integer paise. Never a float — see `rupeesFromPaise`. */
  valuePaise: number | null;
  notes: string | null;
  customerId: string | null;
  customer: {
    id: string;
    waId: string;
    name: string | null;
    /** The newest thread, or empty for a linked customer who has no conversation yet. */
    conversations: Array<{ id: string }>;
  } | null;
  nextActionAt: string | null;
  lastContactedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LeadEvent {
  id: string;
  type: string;
  fromStatus: LeadStatus | null;
  toStatus: LeadStatus | null;
  body: string | null;
  createdAt: string;
  actor: { id: string; fullName: string } | null;
}

export interface CallLog {
  id: string;
  phone: string;
  outcome: CallOutcome;
  notes: string | null;
  durationSeconds: number | null;
  createdAt: string;
  actor: { id: string; fullName: string } | null;
}

export interface Reminder {
  id: string;
  dueAt: string;
  note: string;
  completedAt: string | null;
  assignee: { id: string; fullName: string } | null;
  lead?: { id: string; name: string; phone: string; status: LeadStatus } | null;
}

/**
 * Paise to rupees, for display only.
 *
 * The division happens here and nowhere else. Amounts stay integer paise
 * everywhere they are stored, compared or sent.
 */
export const rupeesFromPaise = (paise: number): string =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency', currency: 'INR', maximumFractionDigits: 0,
  }).format(paise / 100);

/**
 * "in 3 days" / "2 hours ago", for a due date.
 *
 * Relative rather than absolute because the only question anyone asks of a
 * reminder is whether it has come round yet.
 */
export const dueLabel = (iso: string): string => {
  const diffMs = new Date(iso).getTime() - Date.now();
  const abs = Math.abs(diffMs);
  const minutes = Math.round(abs / 60_000);
  const hours = Math.round(abs / 3_600_000);
  const days = Math.round(abs / 86_400_000);

  const amount = minutes < 60 ? `${minutes} min` : hours < 48 ? `${hours} hr` : `${days} days`;
  if (minutes < 1) return 'now';
  return diffMs > 0 ? `in ${amount}` : `${amount} overdue`;
};

/** A `datetime-local` value some hours from now, for the reminder form default. */
export const inHours = (hours: number): string => {
  const when = new Date(Date.now() + hours * 3_600_000);
  // Trim the timezone and seconds: `datetime-local` wants `YYYY-MM-DDTHH:mm`.
  const offset = when.getTimezoneOffset() * 60_000;
  return new Date(when.getTime() - offset).toISOString().slice(0, 16);
};
