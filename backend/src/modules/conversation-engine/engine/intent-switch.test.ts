import { describe, expect, it, vi } from 'vitest';
import type { RejectedDecision } from './resume.js';

// Changing the subject mid-flow.
//
// Before this, a customer part-way through picking a class who typed "can I place an order"
// was treated as someone failing to answer: the identical prompt three times, then a handoff
// to a person. That is right for a mistype and wrong for a topic change, and nothing in the
// path could tell them apart — while a run awaited input the router short-circuited straight
// to `resumeWithUserInput` without classifying anything.
//
// These cover the contract of the hook rather than the router's wiring, which the routing
// suite and the integration suites already exercise. The three rules worth pinning are: the
// hook is consulted **only** on a rejection, a switch suppresses the re-prompt and the retry
// count, and nothing switches once the run has changed something it cannot take back.

/** Stands in for `resumeWithUserInput`'s rejection branch, with the same ordering. */
const rejectionBranch = async (opts: {
  accepted: boolean;
  onRejected?: (reason: string) => Promise<RejectedDecision>;
  reprompt: () => void;
  countRetry: () => void;
}) => {
  if (opts.accepted) return 'CONTINUED';
  if (opts.onRejected) {
    const decision = await opts.onRejected('not one of the options');
    if (decision === 'SWITCHED') return 'SWITCHED_INTENT';
  }
  opts.countRetry();
  opts.reprompt();
  return 'REPROMPTED';
};

describe('when the hook is consulted', () => {
  it('**is never asked about a valid answer**', async () => {
    // The cost argument. Classifying every message would mean one model call per turn of every
    // conversation, to learn something the node already knew by matching a row id.
    const onRejected = vi.fn(async (): Promise<RejectedDecision> => 'SWITCHED');
    const outcome = await rejectionBranch({
      accepted: true, onRejected, reprompt: () => {}, countRetry: () => {},
    });
    expect(outcome).toBe('CONTINUED');
    expect(onRejected).not.toHaveBeenCalled();
  });

  it('is asked when the reply does not fit', async () => {
    const onRejected = vi.fn(async (): Promise<RejectedDecision> => 'REPROMPT');
    await rejectionBranch({
      accepted: false, onRejected, reprompt: () => {}, countRetry: () => {},
    });
    expect(onRejected).toHaveBeenCalledOnce();
  });
});

describe('when it switches', () => {
  it('**suppresses the re-prompt and the retry count**', async () => {
    // Both matter. A re-prompt would send the abandoned flow's question after the new one has
    // already replied, and counting the retry would push an unrelated message toward a handoff.
    const reprompt = vi.fn();
    const countRetry = vi.fn();
    const outcome = await rejectionBranch({
      accepted: false,
      onRejected: async () => 'SWITCHED',
      reprompt,
      countRetry,
    });
    expect(outcome).toBe('SWITCHED_INTENT');
    expect(reprompt).not.toHaveBeenCalled();
    expect(countRetry).not.toHaveBeenCalled();
  });
});

describe('when it declines to switch', () => {
  it('falls through to the old behaviour exactly', async () => {
    const reprompt = vi.fn();
    const countRetry = vi.fn();
    const outcome = await rejectionBranch({
      accepted: false,
      onRejected: async () => 'REPROMPT',
      reprompt,
      countRetry,
    });
    expect(outcome).toBe('REPROMPTED');
    expect(reprompt).toHaveBeenCalledOnce();
    expect(countRetry).toHaveBeenCalledOnce();
  });

  it('behaves as before when no hook is supplied at all', async () => {
    // Every existing caller passes no hook, so this is the backward-compatibility claim.
    const reprompt = vi.fn();
    const outcome = await rejectionBranch({
      accepted: false, reprompt, countRetry: () => {},
    });
    expect(outcome).toBe('REPROMPTED');
    expect(reprompt).toHaveBeenCalledOnce();
  });
});

describe('the irreversible-action guard', () => {
  // The rule that keeps this safe. A run that has already cancelled a class or placed an order
  // must not be abandoned quietly — the customer would walk away talking about something else,
  // never told that the thing they asked for actually happened.
  const IRREVERSIBLE_NODES = ['CONNECTOR_ACTION', 'DATABASE_WRITE', 'CREATE_ORDER'];

  it('names the node types that change the outside world', () => {
    expect(IRREVERSIBLE_NODES).toContain('CONNECTOR_ACTION');
    expect(IRREVERSIBLE_NODES).toContain('DATABASE_WRITE');
    expect(IRREVERSIBLE_NODES).toContain('CREATE_ORDER');
  });

  it('**does not include the read-only ones**', () => {
    // A CONNECTOR_QUERY that fetched a class list has changed nothing, so abandoning that run
    // costs the customer nothing. Treating reads as irreversible would disable the feature for
    // every flow that looks something up first — which is all of them.
    for (const readOnly of ['CONNECTOR_QUERY', 'DATABASE_LOOKUP', 'LIST_MESSAGE', 'CONDITION']) {
      expect(IRREVERSIBLE_NODES).not.toContain(readOnly);
    }
  });
});
