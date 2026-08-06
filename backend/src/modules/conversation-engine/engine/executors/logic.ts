import { z } from 'zod';
import { NODE_CONFIG_SCHEMAS } from '../../domain/node-types.js';
import { NodeConfigError, type WorkflowNodeExecutor } from '../types.js';

// Branching, state and timing. None of these touch the outside world, so they
// are pure enough to unit-test without any services wired up.

type ConditionConfig = z.infer<typeof NODE_CONFIG_SCHEMAS.CONDITION>;
type SetVariableConfig = z.infer<typeof NODE_CONFIG_SCHEMAS.SET_VARIABLE>;
type DelayConfig = z.infer<typeof NODE_CONFIG_SCHEMAS.DELAY>;
type EndWorkflowConfig = z.infer<typeof NODE_CONFIG_SCHEMAS.END_WORKFLOW>;

const asNumber = (value: unknown): number | null => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

/**
 * Comparison used by CONDITION.
 *
 * String comparisons are case-insensitive because the left side is usually
 * customer-typed free text ("Cardiology" vs "cardiology"), while the numeric
 * operators refuse rather than coerce — `'abc' > 5` returning false is a
 * silently wrong branch, so a non-numeric operand fails the comparison outright.
 */
export const compare = (left: unknown, op: ConditionConfig['op'], right: unknown): boolean => {
  const l = String(left ?? '').toLowerCase();
  const r = String(right ?? '').toLowerCase();

  switch (op) {
    case 'equals': return l === r;
    case 'not_equals': return l !== r;
    case 'contains': return l.includes(r);
    case 'not_contains': return !l.includes(r);
    case 'starts_with': return l.startsWith(r);
    case 'ends_with': return l.endsWith(r);
    case 'is_empty': return l.trim() === '';
    case 'is_not_empty': return l.trim() !== '';
    case 'gt': case 'gte': case 'lt': case 'lte': {
      const a = asNumber(left);
      const b = asNumber(right);
      if (a === null || b === null) return false;
      if (op === 'gt') return a > b;
      if (op === 'gte') return a >= b;
      if (op === 'lt') return a < b;
      return a <= b;
    }
    default: {
      // Exhaustiveness guard: a new operator added to the enum without a case
      // here becomes a compile error rather than a silent `false` branch.
      const exhaustive: never = op;
      throw new NodeConfigError(`Unknown condition operator "${String(exhaustive)}"`);
    }
  }
};

export const conditionExecutor: WorkflowNodeExecutor<ConditionConfig, { result: boolean }> = {
  type: 'CONDITION',
  validateConfig: (config) => NODE_CONFIG_SCHEMAS.CONDITION.parse(config),
  execute: async ({ config }) => {
    const result = compare(config.left, config.op, config.right);
    return {
      status: 'SUCCESS',
      output: { result },
      nextHandle: result ? 'yes' : 'no',
    };
  },
};

export const setVariableExecutor: WorkflowNodeExecutor<SetVariableConfig, { value: string }> = {
  type: 'SET_VARIABLE',
  validateConfig: (config) => NODE_CONFIG_SCHEMAS.SET_VARIABLE.parse(config),
  execute: async ({ config }) => ({
    status: 'SUCCESS',
    output: { value: config.value },
    variablesPatch: { [config.variableName]: config.value },
  }),
};

export const delayExecutor: WorkflowNodeExecutor<DelayConfig, { seconds: number; until: string }> = {
  type: 'DELAY',
  validateConfig: (config) => NODE_CONFIG_SCHEMAS.DELAY.parse(config),
  execute: async ({ config }) => {
    // Zod already caps this at 30 days. Beyond that the WhatsApp 24-hour window
    // is long gone and the run is almost certainly abandoned, so an unbounded
    // park would just leak rows.
    const until = new Date(Date.now() + config.seconds * 1000);
    return {
      status: 'WAITING',
      output: { seconds: config.seconds, until: until.toISOString() },
      waitUntil: until,
    };
  },
};

export const endWorkflowExecutor: WorkflowNodeExecutor<EndWorkflowConfig, { outcome: string }> = {
  type: 'END_WORKFLOW',
  validateConfig: (config) => NODE_CONFIG_SCHEMAS.END_WORKFLOW.parse(config),
  execute: async ({ config, contact, services, dryRun }) => {
    if (!dryRun && config.message) {
      await services.whatsapp.sendText({ to: contact.waId, body: config.message });
    }
    return {
      status: 'SUCCESS',
      output: { outcome: config.outcome },
      terminal: config.outcome,
    };
  },
};
