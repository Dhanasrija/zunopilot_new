import { describe, expect, it } from 'vitest';
import { capabilityContractSchema } from './capability.js';

// The contract is written by the API and read back from Postgres, so it has to
// round-trip through nullable columns. That asymmetry — `undefined` on write,
// `null` on read — is what these tests pin.

const valid = {
  purpose: 'Create a confirmed doctor appointment',
  useWhen: ['The user explicitly wants to book an appointment'],
  doNotUseWhen: [],
  positiveExamples: [
    'I want to book a cardiologist appointment',
    'Schedule a consultation for tomorrow',
    'Can you book Dr Rao for Friday?',
  ],
  negativeExamples: ['Is Dr Rao available tomorrow?', 'How much is my bill?'],
  requiredInputs: [],
  optionalInputs: [],
  preconditions: [],
  sideEffects: [],
  requiresConfirmation: false,
  minimumConfidence: 0.8,
  allowsInterruption: false,
};

describe('round-tripping through nullable columns', () => {
  it('accepts a null description, as Postgres returns it', () => {
    // Regression: `description` was `.optional()`, which accepts `undefined` but
    // not `null`. Every capability saved without a description then failed to
    // parse on read, and the caller reported that as "missing capability" —
    // sending the author looking for a contract that was right there.
    const parsed = capabilityContractSchema.safeParse({ ...valid, description: null });
    expect(parsed.success).toBe(true);
  });

  it('still accepts an absent description', () => {
    expect(capabilityContractSchema.safeParse(valid).success).toBe(true);
  });

  it('accepts a real description', () => {
    const parsed = capabilityContractSchema.safeParse({ ...valid, description: 'Collects and books.' });
    expect(parsed.success).toBe(true);
  });

  it('ignores the columns Prisma adds around the contract', () => {
    const row = {
      ...valid,
      id: 'cap_1',
      workflowId: 'wf_1',
      description: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    expect(capabilityContractSchema.safeParse(row).success).toBe(true);
  });
});

describe('the rules that block a publish', () => {
  it('rejects side effects without confirmation', () => {
    const parsed = capabilityContractSchema.safeParse({
      ...valid,
      sideEffects: ['Creates an appointment record'],
      requiresConfirmation: false,
    });
    expect(parsed.success).toBe(false);
  });

  it('accepts side effects with confirmation', () => {
    const parsed = capabilityContractSchema.safeParse({
      ...valid,
      sideEffects: ['Creates an appointment record'],
      requiresConfirmation: true,
    });
    expect(parsed.success).toBe(true);
  });

  it('enforces the example minimums', () => {
    expect(capabilityContractSchema.safeParse({ ...valid, positiveExamples: ['one', 'two'] }).success).toBe(false);
    expect(capabilityContractSchema.safeParse({ ...valid, negativeExamples: ['only one'] }).success).toBe(false);
  });

  it('rejects duplicate input keys across required and optional', () => {
    const parsed = capabilityContractSchema.safeParse({
      ...valid,
      requiredInputs: [{ key: 'speciality', label: 'Speciality', type: 'string' }],
      optionalInputs: [{ key: 'speciality', label: 'Speciality again', type: 'string' }],
    });
    expect(parsed.success).toBe(false);
  });
});
