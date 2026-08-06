import type {
  Cart, Conversation, Customer, KeywordRule, Message, Tenant, WhatsappAccount,
} from '@prisma/client';

// Shared shapes for the inbound-message path.
//
// The automation and ordering services hand the same four or five rows to each
// other through every function. Naming that set once keeps the signatures short
// and means a schema change surfaces here rather than in twenty places.

export type { Cart, Conversation, Customer, KeywordRule, Message, Tenant, WhatsappAccount };

/** Everything needed to answer one inbound WhatsApp message. */
export interface InboundContext {
  tenant: Tenant;
  customer: Customer;
  conversation: Conversation;
  waAccount: WhatsappAccount;
}

/** The subset needed just to send a reply. */
export interface ReplyTarget {
  waAccount: WhatsappAccount;
  customer: Customer;
}

/**
 * The structured payload the webhook stores alongside a message. `raw` is
 * Meta's original object; the rest are the bits the ordering flow reads without
 * having to re-parse it.
 */
export interface MessagePayload {
  raw?: unknown;
  interactive?: {
    type?: string;
    list_reply?: { id: string; title?: string; description?: string };
    button_reply?: { id: string; title?: string };
  };
  location?: {
    latitude: number | null;
    longitude: number | null;
    name: string | null;
    address: string | null;
  };
}

/** A Message row with its JSON payload narrowed to the shape above. */
export type InboundMessage = Omit<Message, 'payload'> & { payload: MessagePayload | null };
