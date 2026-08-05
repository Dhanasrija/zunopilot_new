import { describe, expect, it } from 'vitest';
import { GENERATION_BLOCKERS, blockingIssues, repairInstruction } from './blockers.js';
import type { ValidationIssue } from '../validation/definition-validator.js';

// The author-dependent half of validation.
//
// The load-bearing claim is the pair at the bottom of the first block: the same
// `UNREACHABLE_NODE` is advisory for a person and disqualifying for a generator.
// If that distinction ever collapses in either direction the feature is wrong —
// collapse it one way and a human can no longer park a node, the other way and a
// generator ships eight dead nodes again.

const issue = (
  code: string,
  level: ValidationIssue['level'] = 'warning',
  nodeId?: string,
): ValidationIssue => ({ code, level, message: `${code} happened`, ...(nodeId ? { nodeId } : {}) });

describe('what disqualifies a generated draft', () => {
  it('**blocks on an unreachable node, which validation only warns about**', () => {
    // The fault that motivated all of this: eight of these named the whole journey
    // after the parent lookup, and the draft published anyway.
    const issues = [issue('UNREACHABLE_NODE', 'warning', 'step3')];
    expect(blockingIssues(issues)).toHaveLength(1);
  });

  it('blocks on every error, without needing to name them', () => {
    // Errors are graphs the engine cannot run at all. The set only lists warnings
    // precisely so that a new error code is covered the day it is added.
    const issues = [issue('SOME_BRAND_NEW_ERROR_CODE', 'error')];
    expect(blockingIssues(issues)).toHaveLength(1);
    expect(GENERATION_BLOCKERS.has('SOME_BRAND_NEW_ERROR_CODE')).toBe(false);
  });

  it('**leaves a warning it does not name alone**', () => {
    // The negative case that keeps this from becoming "all warnings are errors".
    const issues = [issue('LOW_CONFIDENCE_FOR_SIDE_EFFECT'), issue('UNBOUNDED_CYCLE')];
    expect(blockingIssues(issues)).toEqual([]);
  });

  it('blocks a condition comparing a whole response body', () => {
    // A warning for a person, who may be testing for emptiness on purpose. From a
    // generator it can never match — it told every parent "too late to cancel"
    // moments after cancelling their class.
    expect(blockingIssues([issue('CONDITION_COMPARES_WHOLE_BODY')])).toHaveLength(1);
  });

  it('names exactly the five warnings, and no errors', () => {
    expect([...GENERATION_BLOCKERS].sort()).toEqual([
      'BRANCH_WITHOUT_FALLBACK',
      'CONDITION_COMPARES_WHOLE_BODY',
      'DEAD_END',
      'UNKNOWN_VARIABLE',
      'UNREACHABLE_NODE',
    ]);
  });

  it('is empty for a clean plan', () => {
    expect(blockingIssues([])).toEqual([]);
  });
});

describe('the repair instruction', () => {
  it('**groups one repeated mistake into one complaint**', () => {
    // Eight unreachable nodes are one wiring error. Eight separately-worded
    // complaints invite eight local patches instead of rethinking the edges.
    const issues = ['step3', 'step4', 'step5'].map((id) => issue('UNREACHABLE_NODE', 'warning', id));
    const text = repairInstruction(issues);

    // Counting complaint *lines*, not mentions: the code also appears inside this
    // fixture's own message text, which is a property of the fixture and not of
    // the grouping under test.
    expect(text.match(/^- UNREACHABLE_NODE/gm)).toHaveLength(1);
    expect(text).toContain('steps step3, step4, step5');
  });

  it('says "step" rather than "steps" for a single node', () => {
    expect(repairInstruction([issue('DEAD_END', 'warning', 'step2')])).toContain('step step2');
  });

  it('handles an issue with no node id', () => {
    const text = repairInstruction([issue('MISSING_PURPOSE', 'error')]);
    expect(text).toContain('MISSING_PURPOSE');
    expect(text).not.toContain('undefined');
  });

  it('keeps distinct codes distinct', () => {
    const text = repairInstruction([
      issue('UNREACHABLE_NODE', 'warning', 'step3'),
      issue('LIST_ITEMS_VARIABLE_UNWRITTEN', 'error', 'step4'),
    ]);
    expect(text).toContain('UNREACHABLE_NODE');
    expect(text).toContain('LIST_ITEMS_VARIABLE_UNWRITTEN');
  });

  it('**is fenced, so a plan description cannot be mistaken for feedback**', () => {
    // It is appended to a user prompt that already contains operator-supplied text.
    // Both halves have to be delimited or the model cannot tell them apart.
    const text = repairInstruction([issue('DEAD_END')]);
    expect(text).toContain('--- BEGIN PROBLEMS WITH YOUR PREVIOUS ANSWER ---');
    expect(text).toContain('--- END PROBLEMS WITH YOUR PREVIOUS ANSWER ---');
  });

  it('asks for a whole plan rather than a patch', () => {
    // The schema only accepts a complete plan, so asking for a diff would produce
    // something unparseable.
    expect(repairInstruction([issue('DEAD_END')])).toMatch(/complete new plan/);
  });
});
