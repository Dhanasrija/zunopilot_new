// Execution context and template interpolation for the workflow engine.
//
// Tenant-authored graphs are effectively untrusted input: whoever edits a
// workflow controls every template string a node evaluates. So interpolation
// here is a whitelisted path lookup — never `eval`, `new Function`, or a template
// engine that can reach globals.

import type { Conversation, Customer, Message, Tenant } from '@prisma/client';
import { customerFacingName } from '../../utils/customer-name.js';

export interface WorkflowVariables { [key: string]: unknown }

/** The read-only view a node's templates can address. */
export interface TemplateContext {
  tenant: { name: string; category: string };
  customer: { name: string; waId: string; phone: string; lifetimeSpend: string };
  conversation: { id: string; status: string };
  message: { text: string; type: string };
  vars: WorkflowVariables;
}

export interface ContextInput {
  tenant?: Tenant | null;
  customer?: Customer | null;
  conversation?: Conversation | null;
  message?: Message | null;
  variables?: WorkflowVariables;
}

/**
 * Build the read-only context a node's templates can see.
 * Anything not listed here is unreachable from a workflow.
 */
export const buildContext = (
  { tenant, customer, conversation, message, variables }: ContextInput,
): TemplateContext => ({
  tenant: {
    name: tenant?.businessName ?? '',
    category: tenant?.category ?? '',
  },
  customer: {
    // The customer's own name, never an agent's internal label — this context feeds templates
    // whose output is sent to them. See `customerFacingName`.
    name: (customer ? customerFacingName(customer) : null) ?? '',
    waId: customer?.waId ?? '',
    phone: customer?.phone ?? '',
    lifetimeSpend: customer?.lifetimeSpend != null ? String(customer.lifetimeSpend) : '0',
  },
  conversation: {
    id: conversation?.id ?? '',
    status: conversation?.status ?? '',
  },
  message: {
    text: message?.body ?? '',
    type: message?.type ?? '',
  },
  // Node outputs land here under their configured output variable name.
  vars: variables ?? {},
});

const MAX_DEPTH = 4;

/** Resolve a dotted path against the context. Returns '' for anything missing. */
const readPath = (ctx: unknown, path: string): string => {
  const parts = String(path).split('.').filter(Boolean);
  if (!parts.length || parts.length > MAX_DEPTH) return '';
  let cur: unknown = ctx;
  for (const p of parts) {
    // Block prototype walking outright — these should never resolve, and a
    // silent '' is safer than relying on the caller to sanitize.
    if (p === '__proto__' || p === 'constructor' || p === 'prototype') return '';
    if (cur == null || typeof cur !== 'object' || !Object.prototype.hasOwnProperty.call(cur, p)) return '';
    cur = (cur as Record<string, unknown>)[p];
  }
  if (cur == null) return '';
  return typeof cur === 'object' ? JSON.stringify(cur) : String(cur);
};

const TEMPLATE = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

/** Replace {{path}} tokens in a string. Non-strings pass through untouched. */
export const interpolate = <T>(value: T, ctx: TemplateContext): T => {
  if (typeof value !== 'string') return value;
  return value.replace(TEMPLATE, (_m: string, path: string) => readPath(ctx, path)) as T;
};

/** Interpolate every string in a config object, one level deep into arrays. */
export const interpolateConfig = (config: unknown, ctx: TemplateContext): any => {
  if (config == null || typeof config !== 'object') return interpolate(config, ctx);
  if (Array.isArray(config)) return config.map((v) => interpolateConfig(v, ctx));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(config)) out[k] = interpolateConfig(v, ctx);
  return out;
};

export { readPath };
