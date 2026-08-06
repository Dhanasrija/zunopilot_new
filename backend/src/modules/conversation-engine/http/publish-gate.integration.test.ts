import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { Prisma } from '@prisma/client';
import { prisma } from '../../../config/prisma.js';
import { buildApp } from '../../../app.js';
import { signToken } from '../../../utils/jwt.js';
import { ROLE_PERMISSIONS } from '../../../config/permissions.js';
import type { WorkflowDefinition } from '../domain/definition.js';
import type { ValidationIssue } from '../validation/definition-validator.js';

// Publishing a draft the repair loop gave up on.
//
// **The gap this closes.** `publishWorkflow` refuses when validation reports an
// *error*, and the largest generation fault is a warning: eight of twelve nodes
// unreachable. A draft like that satisfied `valid === true`, published, and answered
// a real parent with its whole second half dead. So the surviving generation
// blockers are recorded on the version and consulted separately.
//
// The two claims worth pinning, in order:
//
//   • A version carrying unresolved issues is refused *even though it validates*.
//     If that ever stops being true the column is decoration.
//   • Editing lifts the refusal without anything having to reset a flag. Versions
//     are append-only, so a fix is a new row with a null column — and this suite is
//     what would catch a future change to that assumption.

const app = buildApp();

const TENANT = 'cccccccc-c000-0000-0000-00000000c051';

let ownerToken: string;
let ownerId: string;
let workflowId: string;

/** Valid and warning-free: entry → message → end. */
const definition: WorkflowDefinition = {
  schemaVersion: '1.0',
  entryNodeId: 'entry',
  nodes: [
    { id: 'entry', type: 'ASSISTANT_ROUTE_ENTRY', position: { x: 0, y: 0 }, config: { acceptedIntents: [] } },
    {
      id: 'reply', type: 'SEND_WHATSAPP_MESSAGE', position: { x: 0, y: 1 },
      config: { body: 'We are open 11am to 11pm.' },
    },
    { id: 'done', type: 'END_WORKFLOW', position: { x: 0, y: 2 }, config: { outcome: 'COMPLETED' } },
  ],
  edges: [
    { id: 'e1', source: 'entry', target: 'reply' },
    { id: 'e2', source: 'reply', target: 'done' },
  ],
};

/** Shaped exactly as `blockingIssues` returns them. */
const unresolved: ValidationIssue[] = [
  {
    level: 'warning',
    code: 'UNREACHABLE_NODE',
    message: '"Cancel the class" cannot be reached from the entry node — it will never run',
    nodeId: 'step7',
  },
];

const wipe = async () => {
  await prisma.tenant.deleteMany({ where: { id: TENANT } });
};

const seed = async () => {
  const tenant = await prisma.tenant.create({
    data: {
      id: TENANT,
      businessName: 'Publish Gate Kitchen',
      category: 'RESTAURANT',
      roles: {
        create: [{
          name: 'Owner', permissions: [...ROLE_PERMISSIONS.OWNER], isOwner: true, isSystem: true,
        }],
      },
      users: { create: [{ phone: '15550009931', fullName: 'Owner', role: 'OWNER' }] },
    },
    include: { users: true, roles: true },
  });
  ownerId = tenant.users[0].id;
  await prisma.user.update({
    where: { id: ownerId }, data: { roleId: tenant.roles[0].id },
  });
  ownerToken = signToken({ userId: ownerId });

  const workflow = await prisma.workflow.create({
    data: {
      tenantId: TENANT,
      name: 'Opening hours',
      slug: `hours_${Date.now()}`,
      category: 'CONVERSATION',
      status: 'DRAFT',
      capability: {
        create: {
          purpose: 'Tell the customer our opening hours',
          useWhen: ['asks about timings'],
          doNotUseWhen: ['wants to order'],
          positiveExamples: ['what time do you open', 'are you open', 'timings'],
          negativeExamples: ['two biryanis please', 'cancel my order'],
          requiredInputs: [] as unknown as Prisma.InputJsonValue,
          optionalInputs: [] as unknown as Prisma.InputJsonValue,
          preconditions: [],
          sideEffects: [],
          requiresConfirmation: false,
        },
      },
    },
  });
  workflowId = workflow.id;
};

const addVersion = (n: number, issues: ValidationIssue[] | null) =>
  prisma.workflowVersion.create({
    data: {
      workflowId,
      version: n,
      definition: definition as unknown as Prisma.InputJsonValue,
      createdBy: ownerId,
      unresolvedIssues: issues === null
        ? Prisma.DbNull
        : (issues as unknown as Prisma.InputJsonValue),
    },
  });

const publish = (versionId?: string) => request(app)
  .post(`/api/workflows/${workflowId}/publish`)
  .set('Authorization', `Bearer ${ownerToken}`)
  .send(versionId ? { versionId } : {});

beforeEach(async () => {
  await wipe();
  await seed();
});

afterAll(async () => {
  await wipe();
  await prisma.$disconnect();
});

describe('a hand-authored version', () => {
  it('publishes exactly as it always did', async () => {
    // The backward-compatibility claim. `unresolvedIssues` is null for every version
    // that existed before this feature, and null must mean "not my business".
    await addVersion(1, null);

    const res = await publish();
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('PUBLISHED');
  });
});

describe('a generated version', () => {
  it('publishes when the generator came out clean', async () => {
    // An empty array is not the same as null, and it must not be treated as a
    // problem — this is the ordinary successful generation.
    await addVersion(1, []);

    const res = await publish();
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('PUBLISHED');
  });

  it('**is refused while a blocker survives, even though it validates**', async () => {
    // The whole point. This definition has no errors and no warnings at all — the
    // refusal comes from what the *generator* could not fix, not from the graph.
    await addVersion(1, unresolved);

    const res = await publish();
    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/could not be fixed automatically/);

    const workflow = await prisma.workflow.findUniqueOrThrow({ where: { id: workflowId } });
    expect(workflow.status).toBe('DRAFT');
    expect(workflow.publishedVersionId).toBeNull();
  });

  it('**says which nodes**, so the refusal is actionable', async () => {
    await addVersion(1, unresolved);

    const res = await publish();
    expect(res.body.errors ?? res.body.details ?? res.body.data).toBeDefined();
    // Whichever envelope key carries them, the node id has to reach the client.
    expect(JSON.stringify(res.body)).toContain('step7');
    expect(JSON.stringify(res.body)).toContain('UNREACHABLE_NODE');
  });
});

describe('after the draft is fixed by hand', () => {
  it('**publishes without anything having to clear the column**', async () => {
    // Versions are append-only: editing in the builder writes a new row, and a new
    // row's `unresolvedIssues` is null. Publishing defaults to the newest version,
    // so the refusal lifts on its own. If versions ever become mutable, this is the
    // test that should start failing.
    await addVersion(1, unresolved);
    const fixed = await addVersion(2, null);

    const res = await publish();
    expect(res.status).toBe(200);
    expect(res.body.data.publishedVersion.id).toBe(fixed.id);

    // And the record of what was wrong stays attached to the version it was wrong
    // about, rather than being erased.
    const v1 = await prisma.workflowVersion.findFirstOrThrow({
      where: { workflowId, version: 1 },
    });
    expect(v1.unresolvedIssues).not.toBeNull();
  });

  it('still refuses if the older broken version is named explicitly', async () => {
    const broken = await addVersion(1, unresolved);
    await addVersion(2, null);

    const res = await publish(broken.id);
    expect(res.status).toBe(422);
  });
});
