import type { Conversation, Customer, Tenant } from '@prisma/client';
import type { TemplateScope } from './types.js';
import { localNumberOf } from './local-number.js';
import { customerFacingName } from '../../../utils/customer-name.js';

// Template interpolation for the conversation engine.
//
// Carried over deliberately from the Module 11 engine, because the property
// that matters is the same: whoever can edit a workflow controls every template
// string a node evaluates, and inbound WhatsApp text — fully attacker-controlled
// — flows into `message.text`. So this is a whitelisted dotted-path lookup, not
// `eval`, not `new Function`, and not a template engine that can reach globals.
//
// Two properties worth stating because they are easy to lose in a refactor:
//   • Substitution happens exactly once. A customer who types "{{tenant.name}}"
//     gets that string back verbatim, not the tenant's name.
//   • An unresolvable path yields '', never the literal token, so a typo in a
//     workflow cannot leak `{{vars.secret}}` into a customer's chat.

const MAX_DEPTH = 4;

const BLOCKED_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);

export const buildScope = ({
  tenant, contact, conversation, message, variables, timezone,
}: {
  tenant: Tenant;
  contact: Customer;
  conversation: Conversation;
  message: { body: string | null; type: string } | null;
  variables: Record<string, unknown>;
  timezone: string;
}): TemplateScope => {
  const now = new Date();
  return {
    tenant: {
      name: tenant.businessName,
      category: tenant.category,
    },
    customer: {
      // The customer's own name, not an agent's label for them. Every string a workflow builds
      // from this scope is on its way to the customer, so `{{customer.name}}` must never carry
      // an internal note — see `customerFacingName`.
      name: customerFacingName(contact) ?? '',
      waId: contact.waId,
      phone: contact.phone ?? '',
      // Derived, not stored: `phone` is set to the same full international number on the
      // inbound path (`phone: message.from`), so it is not the local form either.
      localNumber: localNumberOf(contact.waId),
    },
    conversation: {
      id: conversation.id,
      status: conversation.status,
    },
    message: {
      text: message?.body ?? '',
      type: message?.type ?? '',
    },
    vars: variables,
    // The router and any date-collecting node need "today" in the workspace's
    // timezone, not the server's — "tomorrow" is otherwise wrong for half the day.
    now: {
      iso: now.toISOString(),
      date: now.toLocaleDateString('en-CA', { timeZone: timezone }),
      time: now.toLocaleTimeString('en-GB', { timeZone: timezone, hour12: false }),
      timezone,
    },
  };
};

/** Resolve a dotted path against the scope. Returns '' for anything missing. */
export const readPath = (scope: unknown, path: string): string => {
  const parts = path.split('.').filter(Boolean);
  if (!parts.length || parts.length > MAX_DEPTH) return '';

  let current: unknown = scope;
  for (const part of parts) {
    if (BLOCKED_SEGMENTS.has(part)) return '';
    if (current == null || typeof current !== 'object') return '';
    if (!Object.prototype.hasOwnProperty.call(current, part)) return '';
    current = (current as Record<string, unknown>)[part];
  }

  if (current == null) return '';
  return typeof current === 'object' ? JSON.stringify(current) : String(current);
};

const TOKEN = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

/** Replace `{{path}}` tokens in a string. Non-strings pass through untouched. */
export const interpolate = <T>(value: T, scope: TemplateScope): T => {
  if (typeof value !== 'string') return value;
  return value.replace(TOKEN, (_match, path: string) => readPath(scope, path)) as T;
};

/** Interpolate every string in a config document, at any depth. */
export const interpolateDeep = (value: unknown, scope: TemplateScope): unknown => {
  if (typeof value === 'string') return interpolate(value, scope);
  if (Array.isArray(value)) return value.map((v) => interpolateDeep(v, scope));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) out[key] = interpolateDeep(nested, scope);
    return out;
  }
  return value;
};
