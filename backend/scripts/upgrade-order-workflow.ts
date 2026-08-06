import { PrismaClient, Prisma } from '@prisma/client';
import { templateById } from '../src/modules/conversation-engine/domain/templates.js';
import { validateWorkflowDefinition } from '../src/modules/conversation-engine/validation/definition-validator.js';

// One-off: bring an existing workflow up to the current "Place an Order"
// template graph, by adding a new version and publishing it.
//
// Additive. The old version row is left in place, so any instance pinned to it
// finishes on the graph it started with.

const WORKFLOW_ID = process.argv[2] ?? '';

const prisma = new PrismaClient();

const main = async () => {
  if (!WORKFLOW_ID) throw new Error('Pass a workflow id');

  const template = templateById('order_place');
  if (!template) throw new Error('order_place template missing');

  const workflow = await prisma.workflow.findUniqueOrThrow({
    where: { id: WORKFLOW_ID },
    include: { capability: true, versions: { orderBy: { version: 'desc' }, take: 1 } },
  });

  const siblings = await prisma.workflow.findMany({
    where: { tenantId: workflow.tenantId, id: { not: workflow.id } },
    select: { slug: true },
  });

  const result = validateWorkflowDefinition({
    definition: template.definition,
    category: workflow.category,
    capability: workflow.capability
      ? {
        purpose: workflow.capability.purpose,
        description: workflow.capability.description,
        useWhen: workflow.capability.useWhen,
        doNotUseWhen: workflow.capability.doNotUseWhen,
        positiveExamples: workflow.capability.positiveExamples,
        negativeExamples: workflow.capability.negativeExamples,
        requiredInputs: workflow.capability.requiredInputs as never,
        optionalInputs: workflow.capability.optionalInputs as never,
        preconditions: workflow.capability.preconditions,
        sideEffects: workflow.capability.sideEffects,
        requiresConfirmation: workflow.capability.requiresConfirmation,
        minimumConfidence: workflow.capability.minimumConfidence,
        allowsInterruption: workflow.capability.allowsInterruption,
      }
      : null,
    slug: workflow.slug,
    siblingSlugs: siblings.map((s) => s.slug).filter((s): s is string => !!s),
  });

  const errors = result.issues.filter((i) => i.level === 'error');
  if (errors.length) {
    throw new Error(
      'Refusing to publish — the graph would fail validation:\n'
      + errors.map((e) => `  • [${e.code}] ${e.message}`).join('\n'),
    );
  }
  for (const w of result.issues.filter((i) => i.level === 'warning')) {
    console.warn(`  ⚠ ${w.message}`);
  }

  const live = await prisma.workflowInstance.count({
    where: {
      workflowId: workflow.id,
      status: { in: ['PENDING', 'RUNNING', 'WAITING_FOR_USER', 'WAITING_FOR_APPROVAL', 'PAUSED'] },
    },
  });

  const nextVersion = (workflow.versions[0]?.version ?? 0) + 1;

  const version = await prisma.workflowVersion.create({
    data: {
      workflowId: workflow.id,
      version: nextVersion,
      definition: template.definition as unknown as Prisma.InputJsonValue,
      createdBy: 'template-upgrade',
      publishedAt: new Date(),
    },
  });

  await prisma.workflow.update({
    where: { id: workflow.id },
    data: {
      status: 'PUBLISHED',
      publishedVersionId: version.id,
      publishedAt: new Date(),
      description: template.capability.purpose,
    },
  });

  if (workflow.capability) {
    await prisma.workflowCapability.update({
      where: { workflowId: workflow.id },
      data: { description: template.capability.description ?? null },
    });
  }

  console.log(`
"${workflow.name}" upgraded.
  workflow          ${workflow.id}
  tenant            ${workflow.tenantId}
  version           v${workflow.versions[0]?.version ?? 0} (${workflow.versions[0] ? 'kept' : 'none'}) → v${nextVersion} PUBLISHED
  nodes             ${template.definition.nodes.length}, ${template.definition.edges.length} edges
  live instances    ${live} (each stays pinned to the version it started on)
  warnings          ${result.issues.filter((i) => i.level === 'warning').length}
`);
};

main()
  .catch((err: Error) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
