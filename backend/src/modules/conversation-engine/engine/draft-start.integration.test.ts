import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import { prisma } from '../../../config/prisma.js';
import type { WorkflowDefinition } from '../domain/definition.js';
import {
  VersionNotFoundError, WorkflowNotPublishedError,
  startInstance, startInstanceOnVersion,
} from './instance-manager.js';

// Running a version on purpose, published or not.
//
// **Why this exists.** `startInstance` refuses anything unpublished, with a comment
// saying why: "a draft must never answer a customer". That is right for routing and
// wrong for the builder's Test Flow, whose conversation is a synthetic +1 555
// contact — and Test Flow called it anyway. Pressing Test Flow on a generated draft
// failed with "has no published version", on the one screen whose entire job is
// trying a graph *before* publishing it.
//
// The second bug was quieter and worse: `testWorkflow` resolved a version, handed
// the *workflow* to `startInstance` (which pinned `publishedVersion` on the
// instance), then walked the version it resolved. Whenever those two differed, the
// run's recorded version was not the version that ran — so an execution log pointed
// at a graph that had never executed. `pins the version it was asked for` below is
// that bug.
//
// Against a real Postgres, because the guarantees are database guarantees: the
// tenant scoping is part of a query, not an `if`.

const TENANT = '77777777-7777-7777-7777-777777777771';
const OTHER = '77777777-7777-7777-7777-777777777772';

/** Two graphs that differ only in a way a test can see, to prove which one loaded. */
const graph = (entry: string): WorkflowDefinition => ({
  schemaVersion: '1.0',
  entryNodeId: entry,
  nodes: [
    { id: entry, type: 'ASSISTANT_ROUTE_ENTRY', position: { x: 0, y: 0 }, config: { acceptedIntents: [] } },
    { id: 'done', type: 'END_WORKFLOW', position: { x: 0, y: 1 }, config: { outcome: 'COMPLETED' } },
  ],
  edges: [{ id: 'e1', source: entry, target: 'done' }],
});

let draftWorkflowId: string;
let draftVersionId: string;
/** Published at v1, but carrying a newer unpublished v2. */
let mixedWorkflowId: string;
let publishedVersionId: string;
let newerVersionId: string;
let otherTenantVersionId: string;
let conversationId: string;

const version = (workflowId: string, n: number, entry: string, published: boolean) =>
  prisma.workflowVersion.create({
    data: {
      workflowId,
      version: n,
      definition: graph(entry) as unknown as Prisma.InputJsonValue,
      publishedAt: published ? new Date() : null,
    },
  });

const seed = async () => {
  for (const id of [TENANT, OTHER]) {
    await prisma.tenant.create({
      data: { id, businessName: `Draft start ${id.slice(-1)}`, category: 'RESTAURANT' },
    });
  }

  // Never published, no publishedVersionId — exactly what `generateWorkflow` leaves.
  const draft = await prisma.workflow.create({
    data: {
      tenantId: TENANT, name: 'Generated draft', slug: `draft_${Date.now()}`,
      category: 'CONVERSATION', status: 'DRAFT',
    },
  });
  draftWorkflowId = draft.id;
  draftVersionId = (await version(draft.id, 1, 'draft_entry', false)).id;

  const mixed = await prisma.workflow.create({
    data: {
      tenantId: TENANT, name: 'Published with a newer draft', slug: `mixed_${Date.now()}`,
      category: 'CONVERSATION', status: 'PUBLISHED',
    },
  });
  mixedWorkflowId = mixed.id;
  publishedVersionId = (await version(mixed.id, 1, 'published_entry', true)).id;
  newerVersionId = (await version(mixed.id, 2, 'newer_entry', false)).id;
  await prisma.workflow.update({
    where: { id: mixed.id }, data: { publishedVersionId },
  });

  const foreign = await prisma.workflow.create({
    data: {
      tenantId: OTHER, name: 'Someone else', slug: `foreign_${Date.now()}`,
      category: 'CONVERSATION', status: 'DRAFT',
    },
  });
  otherTenantVersionId = (await version(foreign.id, 1, 'foreign_entry', false)).id;

  const contact = await prisma.customer.create({
    data: { tenantId: TENANT, waId: '15550009921', name: 'Simulator' },
  });
  conversationId = (await prisma.conversation.create({
    data: { tenantId: TENANT, customerId: contact.id, status: 'OPEN' },
  })).id;
};

const wipe = async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [TENANT, OTHER] } } });
};

beforeEach(async () => {
  await wipe();
  await seed();
});

afterAll(async () => {
  await wipe();
  await prisma.$disconnect();
});

describe('running an unpublished draft', () => {
  it('**starts, where startInstance refuses** — the whole point of Test Flow', async () => {
    const { instance, definition } = await startInstanceOnVersion({
      tenantId: TENANT, workflowId: draftWorkflowId, conversationId, versionId: draftVersionId,
    });

    expect(instance.status).toBe('RUNNING');
    expect(instance.workflowVersionId).toBe(draftVersionId);
    expect(instance.currentNodeId).toBe('draft_entry');
    expect(definition.entryNodeId).toBe('draft_entry');
  });

  it('**and startInstance still refuses it** — the gate is intact, not relaxed', async () => {
    // The paired assertion. If someone ever "simplifies" these two into one
    // function with a flag, this is the test that should fail.
    await expect(startInstance({ tenantId: TENANT, workflowId: draftWorkflowId, conversationId }))
      .rejects.toBeInstanceOf(WorkflowNotPublishedError);
  });

  it('seeds extracted inputs and claims the conversation like any other run', async () => {
    const { instance } = await startInstanceOnVersion({
      tenantId: TENANT, workflowId: draftWorkflowId, conversationId, versionId: draftVersionId,
      extractedInputs: { student: 'Aarav' },
    });

    expect(instance.variables).toEqual({ student: 'Aarav' });
    const conversation = await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } });
    expect(conversation.activeWorkflowInstanceId).toBe(instance.id);
  });

  it('leaves the conversation pointer alone on a dry run', async () => {
    const { instance } = await startInstanceOnVersion({
      tenantId: TENANT, workflowId: draftWorkflowId, conversationId, versionId: draftVersionId,
      dryRun: true,
    });

    const conversation = await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } });
    expect(conversation.activeWorkflowInstanceId).toBeNull();
    expect(instance.status).toBe('RUNNING');
  });
});

describe('which version actually runs', () => {
  it('**pins the version it was asked for, not the published one**', async () => {
    // The silent bug. `startInstance` pinned `publishedVersion` while the caller
    // walked a different definition, so the execution log named a graph that never
    // ran. Asking for v2 of a workflow published at v1 must record v2 *and* return
    // v2's definition — one resolved version, used for both.
    const { instance, definition } = await startInstanceOnVersion({
      tenantId: TENANT, workflowId: mixedWorkflowId, conversationId, versionId: newerVersionId,
    });

    expect(instance.workflowVersionId).toBe(newerVersionId);
    expect(instance.workflowVersionId).not.toBe(publishedVersionId);
    expect(definition.entryNodeId).toBe('newer_entry');
    expect(instance.currentNodeId).toBe('newer_entry');
  });

  it('can still be pointed at the published version explicitly', async () => {
    const { definition } = await startInstanceOnVersion({
      tenantId: TENANT, workflowId: mixedWorkflowId, conversationId, versionId: publishedVersionId,
    });
    expect(definition.entryNodeId).toBe('published_entry');
  });
});

describe('what it refuses', () => {
  it("**will not run another tenant's version**", async () => {
    // The scoping is in the `where`, joined through the workflow, so it cannot be
    // the check someone forgets to write. A leaked version id is not enough.
    await expect(startInstanceOnVersion({
      tenantId: TENANT, workflowId: draftWorkflowId, conversationId,
      versionId: otherTenantVersionId,
    })).rejects.toBeInstanceOf(VersionNotFoundError);
  });

  it('will not run a version belonging to a different workflow of the same tenant', async () => {
    // Same tenant, wrong workflow. Without the `workflowId` in the lookup this
    // would happily run one workflow's graph while recording it against another.
    await expect(startInstanceOnVersion({
      tenantId: TENANT, workflowId: draftWorkflowId, conversationId,
      versionId: publishedVersionId,
    })).rejects.toBeInstanceOf(VersionNotFoundError);
  });

  it('refuses a version id that does not exist', async () => {
    await expect(startInstanceOnVersion({
      tenantId: TENANT, workflowId: draftWorkflowId, conversationId,
      versionId: '00000000-0000-0000-0000-0000000000ff',
    })).rejects.toBeInstanceOf(VersionNotFoundError);
  });
});
