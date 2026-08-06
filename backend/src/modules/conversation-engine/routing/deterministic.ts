import { z } from 'zod';
import type { Customer } from '@prisma/client';
import { prisma } from '../../../config/prisma.js';
import { logger } from '../../../config/logger.js';

// Deterministic routing — everything that can be decided without a model.
//
// This runs before the AI router and always wins, for two reasons. A tap on one
// of our own buttons carries an id we chose, so classifying it would be paying
// a model to read an enum. And an operator who writes a keyword rule expects it
// to fire, not to be second-guessed.
//
// Rules are evaluated by descending priority, first match wins.

const buttonPayloadConfig = z.object({
  /** Exact payload ids, e.g. `CONFIRM_BOOKING`. */
  payloads: z.array(z.string().min(1)).min(1),
});

const keywordConfig = z.object({
  keywords: z.array(z.string().min(1)).min(1),
  /**
   * `whole` matches the entire trimmed message; `word` matches on word
   * boundaries. Substring matching is deliberately not offered — it is how
   * "cancel my order" once matched a rule for "order".
   */
  match: z.enum(['whole', 'word']).default('word'),
  caseSensitive: z.boolean().default(false),
});

const commandConfig = z.object({
  /** Leading-slash commands, e.g. `/menu`. */
  commands: z.array(z.string().min(1)).min(1),
});

const customerTagConfig = z.object({
  tags: z.array(z.string().min(1)).min(1),
  mode: z.enum(['any', 'all']).default('any'),
});

const businessHoursConfig = z.object({
  timezone: z.string().default('Asia/Kolkata'),
  /** 0 = Sunday. Days not listed are treated as closed. */
  open: z.array(z.object({
    day: z.number().int().min(0).max(6),
    from: z.string().regex(/^\d{2}:\d{2}$/),
    to: z.string().regex(/^\d{2}:\d{2}$/),
  })).default([]),
  /** Fire the rule when OUTSIDE the hours above (the usual want). */
  whenClosed: z.boolean().default(true),
});

const crmStateConfig = z.object({
  attribute: z.string().min(1),
  equals: z.string(),
});

export const RULE_CONFIG_SCHEMAS = {
  BUTTON_PAYLOAD: buttonPayloadConfig,
  LIST_PAYLOAD: buttonPayloadConfig,
  KEYWORD: keywordConfig,
  COMMAND: commandConfig,
  CUSTOMER_TAG: customerTagConfig,
  BUSINESS_HOURS: businessHoursConfig,
  CRM_STATE: crmStateConfig,
} as const;

export interface DeterministicMatch {
  ruleId: string;
  workflowId: string | null;
  reasonCode: string;
  extractedInputs?: Record<string, unknown>;
}

const tagsOf = (contact: Customer): string[] => {
  // `tags` lives on the spec's Contact model; the existing Customer has no such
  // column yet, so tag rules are inert rather than throwing.
  const raw = (contact as unknown as { tags?: unknown }).tags;
  return Array.isArray(raw) ? raw.filter((t): t is string => typeof t === 'string') : [];
};

const minutesNow = (timezone: string): { day: number; minutes: number } => {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return {
    day: Math.max(0, days.indexOf(get('weekday'))),
    minutes: Number(get('hour')) * 60 + Number(get('minute')),
  };
};

const toMinutes = (hhmm: string): number => {
  const [h = '0', m = '0'] = hhmm.split(':');
  return Number(h) * 60 + Number(m);
};

export const matchDeterministicRule = async ({
  assistantId, text, interactiveReplyId, contact,
}: {
  assistantId: string;
  text: string;
  interactiveReplyId: string | null;
  contact: Customer;
}): Promise<DeterministicMatch | null> => {
  const rules = await prisma.routingRule.findMany({
    where: { assistantId, enabled: true },
    orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
  });

  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();

  for (const rule of rules) {
    try {
      switch (rule.type) {
        case 'BUTTON_PAYLOAD':
        case 'LIST_PAYLOAD': {
          if (!interactiveReplyId) break;
          const config = buttonPayloadConfig.parse(rule.configuration);
          if (config.payloads.includes(interactiveReplyId)) {
            return {
              ruleId: rule.id,
              workflowId: rule.workflowId,
              reasonCode: 'BUTTON_PAYLOAD_MATCH',
              extractedInputs: { button_payload: interactiveReplyId },
            };
          }
          break;
        }

        case 'COMMAND': {
          const config = commandConfig.parse(rule.configuration);
          const normalised = lower.startsWith('/') ? lower : `/${lower}`;
          if (config.commands.some((c) => (c.startsWith('/') ? c : `/${c}`).toLowerCase() === normalised)) {
            return { ruleId: rule.id, workflowId: rule.workflowId, reasonCode: 'COMMAND_MATCH' };
          }
          break;
        }

        case 'KEYWORD': {
          const config = keywordConfig.parse(rule.configuration);
          const haystack = config.caseSensitive ? trimmed : lower;
          const hit = config.keywords.some((keyword) => {
            const needle = config.caseSensitive ? keyword : keyword.toLowerCase();
            if (config.match === 'whole') return haystack === needle;
            // Word-boundary match. Escaped, because the keyword is operator
            // input and an unescaped '.' would match anything.
            const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            return new RegExp(`\\b${escaped}\\b`).test(haystack);
          });
          if (hit) return { ruleId: rule.id, workflowId: rule.workflowId, reasonCode: 'KEYWORD_MATCH' };
          break;
        }

        case 'CUSTOMER_TAG': {
          const config = customerTagConfig.parse(rule.configuration);
          const tags = tagsOf(contact);
          if (!tags.length) break;
          const matched = config.mode === 'all'
            ? config.tags.every((t) => tags.includes(t))
            : config.tags.some((t) => tags.includes(t));
          if (matched) return { ruleId: rule.id, workflowId: rule.workflowId, reasonCode: 'CUSTOMER_TAG_MATCH' };
          break;
        }

        case 'BUSINESS_HOURS': {
          const config = businessHoursConfig.parse(rule.configuration);
          const { day, minutes } = minutesNow(config.timezone);
          const isOpen = config.open.some((window) => window.day === day
            && minutes >= toMinutes(window.from)
            && minutes < toMinutes(window.to));
          if (config.whenClosed ? !isOpen : isOpen) {
            return {
              ruleId: rule.id,
              workflowId: rule.workflowId,
              reasonCode: config.whenClosed ? 'OUTSIDE_BUSINESS_HOURS' : 'INSIDE_BUSINESS_HOURS',
            };
          }
          break;
        }

        case 'CRM_STATE': {
          const config = crmStateConfig.parse(rule.configuration);
          const attributes = (contact as unknown as { attributes?: Record<string, unknown> }).attributes ?? {};
          if (String(attributes[config.attribute] ?? '') === config.equals) {
            return { ruleId: rule.id, workflowId: rule.workflowId, reasonCode: 'CRM_STATE_MATCH' };
          }
          break;
        }

        default:
          break;
      }
    } catch (err) {
      // A malformed rule must not take down routing for every other rule.
      logger.warn('Skipping malformed routing rule', {
        ruleId: rule.id,
        type: rule.type,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return null;
};
