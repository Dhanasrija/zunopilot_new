import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../../../config/prisma.js';
import { validateWorkflowDefinition, type ValidationIssue } from '../validation/definition-validator.js';
import { blockingIssues } from './blockers.js';

// The real generator output, as a fixture.
//
// `cancel_child_class` was generated from one paragraph of prose and then took three
// rounds and roughly a dozen hand corrections to make it run. Every version of it is
// still in `WorkflowVersion`, which makes this the best fixture available: a graph
// with *known* faults that a model actually produced, rather than one written to fail
// the checks being tested.
//
// **This suite is a canary, not a unit test.** It reads whatever is in the database,
// so it is skipped when the workflow is absent — a fresh machine or CI without the
// dev data must not fail here. When the data *is* present, the counts are exact,
// because they were measured before the checks were written and any drift in them is
// a real change in what the validator sees.
//
// The negative at the bottom matters most: v6 is the version that finally worked and
// it must stay clean. Blockers that fire on a working graph would make generation
// unusable.

const SLUG = 'cancel_child_class';

/** How many versions of the story each check should be seen in. Measured, not assumed. */
const EXPECTED: Record<number, Record<string, number>> = {
  // As generated, plus two rounds that changed messages without fixing the wiring.
  1: {
    UNREACHABLE_NODE: 8,
    LIST_ITEMS_VARIABLE_UNWRITTEN: 2,
    CONFIRMATION_NOT_BRANCHED: 1,
    CONDITION_COMPARES_WHOLE_BODY: 1,
  },
  // The edges were rewired by hand, so nothing is unreachable — and the four
  // data-flow faults that survived are exactly what Layer 2 was written for.
  4: {
    LIST_ITEMS_VARIABLE_UNWRITTEN: 2,
    CONFIRMATION_NOT_BRANCHED: 1,
    CONDITION_COMPARES_WHOLE_BODY: 1,
  },
  5: {
    CONFIRMATION_NOT_BRANCHED: 1,
    CONDITION_COMPARES_WHOLE_BODY: 1,
  },
  6: {},
};

const load = async () => {
  const workflow = await prisma.workflow.findFirst({
    where: { slug: SLUG },
    select: {
      capability: true,
      versions: { select: { version: true, definition: true }, orderBy: { version: 'asc' } },
    },
  });
  return workflow;
};

const countsFor = (issues: ValidationIssue[]): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const i of issues) counts[i.code] = (counts[i.code] ?? 0) + 1;
  return counts;
};

afterAll(async () => {
  await prisma.$disconnect();
});

describe('the generated workflow that needed twelve corrections', () => {
  it('is either present with every version, or absent and skipped', async () => {
    const workflow = await load();
    if (!workflow) return; // Documented above: no dev data, nothing to say.
    expect(workflow.versions.length).toBeGreaterThanOrEqual(6);
  });

  for (const [version, expected] of Object.entries(EXPECTED)) {
    const n = Number(version);
    const clean = Object.keys(expected).length === 0;

    it(`v${n} — ${clean ? '**is clean, and must stay clean**' : `${Object.keys(expected).length} distinct faults`}`, async () => {
      const workflow = await load();
      if (!workflow) return;
      const stored = workflow.versions.find((v) => v.version === n);
      if (!stored) return;

      const { issues } = validateWorkflowDefinition({
        definition: stored.definition,
        category: 'CONVERSATION',
        capability: workflow.capability as never,
        slug: SLUG,
        siblingSlugs: [],
      });

      // Only the codes this fixture is about. Asserting the *whole* issue list would
      // make the suite fail on any unrelated future check, which is noise rather
      // than signal — the claim here is about these specific faults.
      const counts = countsFor(issues);
      const relevant = Object.fromEntries(
        Object.keys(EXPECTED[1]).map((code) => [code, counts[code] ?? 0]),
      );
      const wanted = Object.fromEntries(
        Object.keys(EXPECTED[1]).map((code) => [code, expected[code] ?? 0]),
      );
      expect(relevant).toEqual(wanted);
    });
  }

  it('**would have refused v1 as a generated draft, where publishing let it through**', async () => {
    // The whole point of Layer 1, stated against real data. v1's eight unreachable
    // nodes are warnings, so `valid` is true for them — publishing was refused only
    // once Layer 2 added errors. A generator must be held to the stricter bar.
    const workflow = await load();
    if (!workflow) return;
    const v1 = workflow.versions.find((v) => v.version === 1);
    if (!v1) return;

    const { issues } = validateWorkflowDefinition({
      definition: v1.definition,
      category: 'CONVERSATION',
      capability: workflow.capability as never,
      slug: SLUG,
      siblingSlugs: [],
    });

    const blocking = blockingIssues(issues);
    // 8 unreachable + 2 unwritten list variables + 1 unbranched confirmation
    // + 1 whole-body comparison.
    expect(blocking).toHaveLength(12);
    expect(blocking.filter((i) => i.code === 'UNREACHABLE_NODE')).toHaveLength(8);
  });

  it('**would have accepted v6**, so the loop terminates on a graph that works', async () => {
    const workflow = await load();
    if (!workflow) return;
    const v6 = workflow.versions.find((v) => v.version === 6);
    if (!v6) return;

    const { issues } = validateWorkflowDefinition({
      definition: v6.definition,
      category: 'CONVERSATION',
      capability: workflow.capability as never,
      slug: SLUG,
      siblingSlugs: [],
    });

    expect(blockingIssues(issues)).toEqual([]);
  });
});
