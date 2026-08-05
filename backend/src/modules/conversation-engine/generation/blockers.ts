import type { ValidationIssue } from '../validation/definition-validator.js';

// What a generator is not allowed to leave behind.
//
// The validator's own framing is "an error is a graph the engine cannot run
// correctly, a warning is one it runs in a way the author may not have intended".
// That rule is about the *graph*. This file is about the **author**: the same
// issue means different things depending on who produced it.
//
// A person who parks a node has a reason and should only be told. A generator that
// leaves eight of twelve nodes unreachable has failed at the thing it was asked to
// do, and shipping that as a draft with eight warnings attached is how a workflow
// reached a real parent with its whole second half dead.

/**
 * Warnings that disqualify a *generated* draft.
 *
 * Only warnings need naming: every error already disqualifies, because an error is
 * a graph that cannot run at all.
 */
export const GENERATION_BLOCKERS: ReadonlySet<string> = new Set([
  // Eight of these named the entire journey after the parent lookup, and it
  // published anyway. The single largest fault class.
  'UNREACHABLE_NODE',
  'DEAD_END',
  'BRANCH_WITHOUT_FALLBACK',
  // A template reading a variable nothing writes.
  'UNKNOWN_VARIABLE',
  // A person comparing a whole response body may be testing for emptiness and know
  // exactly what they are doing. A generator doing it has made a mistake: the
  // comparison can never match, and it told every parent "too late to cancel"
  // moments after cancelling their class.
  'CONDITION_COMPARES_WHOLE_BODY',
]);

/**
 * The issues that must be fixed before a generated draft is worth handing over.
 *
 * Every error, plus the warnings above. Deliberately not `valid === false`: that is
 * the publish gate's question, and it would let all eight unreachable nodes through.
 */
export const blockingIssues = (issues: ValidationIssue[]): ValidationIssue[] =>
  issues.filter((issue) => issue.level === 'error' || GENERATION_BLOCKERS.has(issue.code));

/**
 * The repair turn, appended to the **user** prompt.
 *
 * Appended rather than folded into the system prompt on purpose: `buildGeneratorPrompt`
 * stays byte-identical across attempts, so the prompt cache still hits on what is by
 * far the larger half of the request.
 *
 * Issues are grouped by code with their node ids listed, because the failure mode
 * being repaired is usually one mistake repeated — "eight nodes are unreachable" is
 * a single wiring error, and eight separately-worded complaints invite eight
 * separate local patches instead of a rethink of the edges.
 */
export const repairInstruction = (issues: ValidationIssue[]): string => {
  const byCode = new Map<string, { message: string; nodeIds: string[] }>();
  for (const issue of issues) {
    const found = byCode.get(issue.code);
    if (found) {
      if (issue.nodeId) found.nodeIds.push(issue.nodeId);
    } else {
      byCode.set(issue.code, {
        message: issue.message,
        nodeIds: issue.nodeId ? [issue.nodeId] : [],
      });
    }
  }

  const lines = [...byCode.entries()].map(([code, { message, nodeIds }]) => {
    const where = nodeIds.length
      ? ` (${nodeIds.length === 1 ? 'step' : 'steps'} ${nodeIds.join(', ')})`
      : '';
    return `- ${code}${where}: ${message}`;
  });

  return `

--- BEGIN PROBLEMS WITH YOUR PREVIOUS ANSWER ---
Your last plan was checked and cannot work. Return a complete new plan for the same
description that fixes every problem below. Do not explain the changes; return the plan.

${lines.join('\n')}

Two things that cause most of these:
- Every step must be reachable from the entry step by following links. A step that
  nothing links to never runs, however correct it looks.
- A step that shows a list from a variable needs an earlier step that *stores* rows
  into that same variable name. Reading a connector's whole response is not the same
  as storing its rows.
--- END PROBLEMS WITH YOUR PREVIOUS ANSWER ---`;
};
