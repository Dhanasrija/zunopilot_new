import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import { prisma } from '../../../config/prisma.js';
import { asyncHandler } from '../../../utils/asyncHandler.js';
import { ApiError } from '../../../utils/ApiError.js';
import { logger } from '../../../config/logger.js';
import { tenantIdOf, userOf } from '../../../middleware/auth.js';
import { capabilityContractSchema, type CapabilityContract } from '../domain/capability.js';
import { validateWorkflowDefinition } from '../validation/definition-validator.js';
import { templateById, templateReadiness, templateSummaries } from '../domain/templates.js';
import { generateWorkflow, GenerationFailedError } from '../generation/generate.js';
import { assertCanPublishAutomation, assertFeatureAvailable } from '../../billing/limits.js';

// Workflow authoring: definitions, versions, capability contracts, publishing.

const requireWorkflow = async (req: Request, include: Prisma.WorkflowInclude = {}) => {
  const workflow = await prisma.workflow.findFirst({
    where: { id: req.params.workflowId ?? req.params.id, tenantId: tenantIdOf(req) },
    include,
  });
  if (!workflow) throw ApiError.notFound('Workflow not found');
  return workflow;
};

const requireAssistant = async (req: Request) => {
  const assistant = await prisma.assistant.findFirst({
    where: { id: req.params.assistantId, tenantId: tenantIdOf(req) },
  });
  if (!assistant) throw ApiError.notFound('Assistant not found');
  return assistant;
};

/**
 * The stored capability row as the contract the validator expects.
 *
 * A row that exists but will not parse is a different problem from no row at
 * all, and reporting both as "missing capability" sends the author looking for
 * a contract that is right there. Log the reason so it is diagnosable.
 */
const contractOf = (row: unknown): CapabilityContract | null => {
  if (!row) return null;
  const parsed = capabilityContractSchema.safeParse(row);
  if (!parsed.success) {
    logger.error('Stored capability failed to parse', {
      issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    });
    return null;
  }
  return parsed.data;
};

// ── Templates ─────────────────────────────────────────────────────────────────

/**
 * The template gallery. Ordered so the ones suited to this workspace's business
 * category come first — a restaurant should see "Place an Order" before
 * "Collect Feedback", without the others being hidden.
 */
export const listTemplates = asyncHandler(async (req: Request, res: Response) => {
  const tenant = await prisma.tenant.findUniqueOrThrow({
    where: { id: tenantIdOf(req) },
    select: { category: true },
  });

  const summaries = templateSummaries();
  const relevance = (suitedTo: string[]) => {
    if (suitedTo.includes(tenant.category)) return 0;
    if (suitedTo.length === 0) return 1;
    return 2;
  };

  res.json({
    success: true,
    data: [...summaries].sort((a, b) => relevance(a.suitedTo) - relevance(b.suitedTo)),
  });
});

/**
 * Instantiate a template as a new DRAFT workflow.
 *
 * A copy, not a reference: the graph and contract are written into the tenant's
 * own rows and nothing links back to the template. A later change to the
 * template must never reach into a workflow someone has already customised and
 * published.
 *
 * Always DRAFT, whatever the template says — the author reviews and publishes.
 */
export const createFromTemplate = asyncHandler(async (req: Request, res: Response) => {
  const assistant = await requireAssistant(req);
  const template = templateById(req.body.templateId);
  if (!template) throw ApiError.notFound('Template not found');

  const readiness = templateReadiness(template);
  if (!readiness.available) {
    throw ApiError.unprocessable(
      `This template needs node types that have no runtime yet: ${readiness.missingRuntimes.join(', ')}.`,
    );
  }

  // The suggested slug may already be taken — a workspace can reasonably want
  // two order flows. Suffix rather than fail.
  const base = req.body.slug?.trim() || template.suggestedSlug;
  const taken = new Set(
    (await prisma.workflow.findMany({
      where: { tenantId: assistant.tenantId, slug: { not: null } },
      select: { slug: true },
    })).flatMap((w) => (w.slug ? [w.slug] : [])),
  );
  let slug = base;
  for (let n = 2; taken.has(slug) && n < 50; n += 1) slug = `${base}_${n}`;

  const name = req.body.name?.trim() || template.name;

  const workflow = await prisma.$transaction(async (tx) => {
    const created = await tx.workflow.create({
      data: {
        tenantId: assistant.tenantId,
        assistantId: assistant.id,
        name,
        slug,
        description: template.capability.purpose,
        category: 'CONVERSATION',
        status: 'DRAFT',
        priority: template.priority,
        capability: {
          create: template.capability as unknown as Prisma.WorkflowCapabilityCreateWithoutWorkflowInput,
        },
      },
    });

    const version = await tx.workflowVersion.create({
      data: {
        workflowId: created.id,
        version: 1,
        definition: template.definition as unknown as Prisma.InputJsonValue,
        createdBy: userOf(req).id,
      },
    });

    return { created, version };
  });

  logger.info('Workflow created from template', {
    tenantId: assistant.tenantId,
    templateId: template.id,
    workflowId: workflow.created.id,
    slug,
  });

  res.status(201).json({
    success: true,
    data: { ...workflow.created, versionId: workflow.version.id },
  });
});

// ── List / create ─────────────────────────────────────────────────────────────

export const listWorkflows = asyncHandler(async (req: Request, res: Response) => {
  const assistant = await requireAssistant(req);
  const { status, category, search } = req.query as Record<string, string | undefined>;

  const where: Prisma.WorkflowWhereInput = { assistantId: assistant.id };
  if (status) where.status = status as Prisma.WorkflowWhereInput['status'];
  else where.status = { not: 'ARCHIVED' };
  if (category) where.category = category as Prisma.WorkflowWhereInput['category'];
  if (search) where.name = { contains: search, mode: 'insensitive' };

  const workflows = await prisma.workflow.findMany({
    where,
    include: {
      capability: { select: { purpose: true, sideEffects: true, requiresConfirmation: true } },
      publishedVersion: { select: { id: true, version: true, publishedAt: true } },
      _count: { select: { versions: true, instances: true } },
    },
    orderBy: [{ priority: 'desc' }, { updatedAt: 'desc' }],
  });

  // Success rate is computed from terminal runs only — counting in-flight runs
  // as failures would make a healthy workflow look broken under load.
  const stats = await prisma.workflowInstance.groupBy({
    by: ['workflowId', 'status'],
    where: { workflowId: { in: workflows.map((w) => w.id) } },
    _count: true,
  });

  const statsFor = (workflowId: string) => {
    const rows = stats.filter((s) => s.workflowId === workflowId);
    const count = (status: string) => rows.find((r) => r.status === status)?._count ?? 0;
    const completed = count('COMPLETED');
    const failed = count('FAILED');
    const terminal = completed + failed + count('CANCELLED');
    return {
      completed,
      failed,
      active: count('RUNNING') + count('WAITING_FOR_USER') + count('PAUSED') + count('PENDING'),
      successRate: terminal ? Math.round((completed / terminal) * 100) : null,
    };
  };

  res.json({
    success: true,
    data: workflows.map((w) => ({
      id: w.id,
      name: w.name,
      slug: w.slug,
      description: w.description,
      category: w.category,
      status: w.status,
      priority: w.priority,
      purpose: w.capability?.purpose ?? null,
      hasCapability: Boolean(w.capability),
      publishedVersion: w.publishedVersion,
      versionCount: w._count.versions,
      totalRuns: w._count.instances,
      updatedAt: w.updatedAt,
      ...statsFor(w.id),
    })),
  });
});

export const createWorkflow = asyncHandler(async (req: Request, res: Response) => {
  const assistant = await requireAssistant(req);
  const { capability, definition, ...fields } = req.body;

  // A conversation workflow with no contract can never be routed to, so
  // requiring it at creation is kinder than letting someone build a whole graph
  // and discover it at publish time.
  if (fields.category === 'CONVERSATION' && !capability) {
    throw ApiError.badRequest(
      'A conversation workflow needs a routing capability contract — purpose, use-when, '
      + 'and at least 3 positive and 2 negative examples.',
    );
  }

  try {
    const workflow = await prisma.$transaction(async (tx) => {
      const created = await tx.workflow.create({
        data: {
          ...fields,
          tenantId: assistant.tenantId,
          assistantId: assistant.id,
          status: 'DRAFT',
          ...(capability ? { capability: { create: capability as Prisma.WorkflowCapabilityCreateWithoutWorkflowInput } } : {}),
        },
      });

      if (definition) {
        await tx.workflowVersion.create({
          data: {
            workflowId: created.id,
            version: 1,
            definition: definition as Prisma.InputJsonValue,
            createdBy: userOf(req).id,
          },
        });
      }

      return created;
    });

    res.status(201).json({ success: true, data: workflow });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw ApiError.conflict('Another workflow in this workspace already uses that slug');
    }
    throw err;
  }
});

export const getWorkflow = asyncHandler(async (req: Request, res: Response) => {
  const workflow = await requireWorkflow(req, {
    capability: true,
    publishedVersion: true,
    versions: { orderBy: { version: 'desc' }, take: 20 },
  });
  res.json({ success: true, data: workflow });
});

export const updateWorkflow = asyncHandler(async (req: Request, res: Response) => {
  const workflow = await requireWorkflow(req);
  try {
    const updated = await prisma.workflow.update({ where: { id: workflow.id }, data: req.body });
    res.json({ success: true, data: updated });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw ApiError.conflict('Another workflow in this workspace already uses that slug');
    }
    throw err;
  }
});

export const deleteWorkflow = asyncHandler(async (req: Request, res: Response) => {
  const workflow = await requireWorkflow(req);

  // Deleting a workflow with a live run would orphan a customer mid-conversation.
  const live = await prisma.workflowInstance.count({
    where: {
      workflowId: workflow.id,
      status: { in: ['PENDING', 'RUNNING', 'WAITING_FOR_USER', 'WAITING_FOR_APPROVAL', 'PAUSED'] },
    },
  });
  if (live) {
    throw ApiError.conflict(
      `${live} conversation${live === 1 ? ' is' : 's are'} still running this workflow. `
      + 'Archive it instead — archiving stops new runs and lets the current ones finish.',
    );
  }

  await prisma.workflow.delete({ where: { id: workflow.id } });
  res.json({ success: true });
});

// ── Capability ────────────────────────────────────────────────────────────────

export const getCapability = asyncHandler(async (req: Request, res: Response) => {
  const workflow = await requireWorkflow(req, { capability: true });
  res.json({ success: true, data: workflow.capability ?? null });
});

export const putCapability = asyncHandler(async (req: Request, res: Response) => {
  const workflow = await requireWorkflow(req);
  const contract = req.body as CapabilityContract;

  const capability = await prisma.workflowCapability.upsert({
    where: { workflowId: workflow.id },
    create: { workflowId: workflow.id, ...contract } as Prisma.WorkflowCapabilityUncheckedCreateInput,
    update: contract as Prisma.WorkflowCapabilityUncheckedUpdateInput,
  });

  res.json({ success: true, data: capability });
});

// ── Versions ──────────────────────────────────────────────────────────────────

export const listVersions = asyncHandler(async (req: Request, res: Response) => {
  const workflow = await requireWorkflow(req);
  const versions = await prisma.workflowVersion.findMany({
    where: { workflowId: workflow.id },
    orderBy: { version: 'desc' },
    select: { id: true, version: true, createdBy: true, createdAt: true, publishedAt: true },
  });
  res.json({ success: true, data: versions });
});

export const createVersion = asyncHandler(async (req: Request, res: Response) => {
  const workflow = await requireWorkflow(req);

  const latest = await prisma.workflowVersion.findFirst({
    where: { workflowId: workflow.id },
    orderBy: { version: 'desc' },
    select: { version: true },
  });

  const version = await prisma.workflowVersion.create({
    data: {
      workflowId: workflow.id,
      version: (latest?.version ?? 0) + 1,
      definition: req.body.definition as Prisma.InputJsonValue,
      createdBy: userOf(req).id,
    },
  });

  res.status(201).json({ success: true, data: version });
});

// ── Validate / publish ────────────────────────────────────────────────────────

const validateFor = async (
  workflow: Awaited<ReturnType<typeof requireWorkflow>>,
  definition: unknown,
) => {
  const capabilityRow = await prisma.workflowCapability.findUnique({
    where: { workflowId: workflow.id },
  });
  const siblings = await prisma.workflow.findMany({
    where: { tenantId: workflow.tenantId, slug: { not: null }, id: { not: workflow.id } },
    select: { slug: true },
  });

  return validateWorkflowDefinition({
    definition,
    category: workflow.category,
    capability: contractOf(capabilityRow),
    slug: workflow.slug,
    siblingSlugs: siblings.flatMap((s) => (s.slug ? [s.slug] : [])),
  });
};

export const validateWorkflow = asyncHandler(async (req: Request, res: Response) => {
  const workflow = await requireWorkflow(req);

  let definition = req.body.definition;
  if (!definition) {
    const latest = await prisma.workflowVersion.findFirst({
      where: { workflowId: workflow.id },
      orderBy: { version: 'desc' },
    });
    if (!latest) throw ApiError.badRequest('This workflow has no versions to validate');
    definition = latest.definition;
  }

  res.json({ success: true, data: await validateFor(workflow, definition) });
});

/**
 * Publish a version.
 *
 * Validation runs here rather than only in the editor, because the editor is
 * not the only way in — and publishing is the moment a graph starts answering
 * real customers.
 */
export const publishWorkflow = asyncHandler(async (req: Request, res: Response) => {
  const workflow = await requireWorkflow(req);

  // An active automation is a published one. Checked here rather than at save,
  // so a plan limit never stops someone *designing* — only shipping.
  await assertCanPublishAutomation(workflow.tenantId, workflow.id);

  const version = req.body.versionId
    ? await prisma.workflowVersion.findFirst({
      where: { id: req.body.versionId, workflowId: workflow.id },
    })
    : await prisma.workflowVersion.findFirst({
      where: { workflowId: workflow.id },
      orderBy: { version: 'desc' },
    });

  if (!version) throw ApiError.badRequest('This workflow has no version to publish');

  const validation = await validateFor(workflow, version.definition);
  if (!validation.valid) {
    throw ApiError.unprocessable(
      'This workflow cannot be published yet',
      validation.issues.filter((i) => i.level === 'error'),
    );
  }

  const published = await prisma.$transaction(async (tx) => {
    await tx.workflowVersion.update({
      where: { id: version.id },
      data: { publishedAt: version.publishedAt ?? new Date() },
    });
    return tx.workflow.update({
      where: { id: workflow.id },
      data: { status: 'PUBLISHED', publishedVersionId: version.id, publishedAt: new Date() },
      include: { publishedVersion: { select: { id: true, version: true } } },
    });
  });

  res.json({
    success: true,
    data: published,
    warnings: validation.issues.filter((i) => i.level === 'warning'),
  });
});

export const unpublishWorkflow = asyncHandler(async (req: Request, res: Response) => {
  const workflow = await requireWorkflow(req);

  // Runs already in flight keep their pinned version and finish normally;
  // unpublishing only stops *new* runs from starting.
  const updated = await prisma.workflow.update({
    where: { id: workflow.id },
    data: { status: 'DRAFT' },
  });

  const stillRunning = await prisma.workflowInstance.count({
    where: {
      workflowId: workflow.id,
      status: { in: ['RUNNING', 'WAITING_FOR_USER', 'PAUSED'] },
    },
  });

  res.json({
    success: true,
    data: updated,
    message: stillRunning
      ? `${stillRunning} conversation${stillRunning === 1 ? '' : 's'} already running will finish on the published version.`
      : undefined,
  });
});

/**
 * Generate a workflow from a description.
 *
 * Always a DRAFT, and always returned with its gaps. Generation is a starting
 * point for someone to review — the point of the feature is to save the typing,
 * not to put an unread graph in front of customers.
 *
 * `gaps` and `issues` are two different things and both matter: a gap is
 * something the model could not resolve (an operation that does not exist, a
 * missing branch), an issue is what the publish validator says about the graph
 * that resulted. The author fixes the first and the second stops them shipping
 * anything they did not.
 */
export const generateWorkflowFromPrompt = asyncHandler(async (req: Request, res: Response) => {
  const assistant = await requireAssistant(req);
  await assertFeatureAvailable(assistant.tenantId, 'aiWorkflowGeneration', 'AI workflow generation');
  const description = String(req.body?.description ?? '').trim();

  if (description.length < 20) {
    throw ApiError.badRequest(
      'Describe the workflow in a sentence or two — what should happen, and in what order.',
    );
  }

  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: assistant.tenantId } });

  let generated;
  try {
    generated = await generateWorkflow({ tenant, description: description.slice(0, 4000) });
  } catch (err) {
    if (err instanceof GenerationFailedError) throw ApiError.unprocessable(err.message);
    throw err;
  }

  const base = generated.plan.slug?.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_') || 'generated_workflow';
  const taken = new Set(
    (await prisma.workflow.findMany({
      where: { tenantId: assistant.tenantId, slug: { not: null } },
      select: { slug: true },
    })).flatMap((w) => (w.slug ? [w.slug] : [])),
  );
  let slug = base;
  for (let n = 2; taken.has(slug) && n < 50; n += 1) slug = `${base}_${n}`;

  const { definition, capability } = generated.compiled;

  const workflow = await prisma.$transaction(async (tx) => {
    const created = await tx.workflow.create({
      data: {
        tenantId: assistant.tenantId,
        assistantId: assistant.id,
        name: generated.plan.name?.trim() || 'Generated workflow',
        slug,
        description: capability.purpose,
        category: 'CONVERSATION',
        status: 'DRAFT',
        capability: {
          create: {
            purpose: capability.purpose,
            description: capability.description ?? null,
            useWhen: capability.useWhen,
            doNotUseWhen: capability.doNotUseWhen,
            positiveExamples: capability.positiveExamples,
            negativeExamples: capability.negativeExamples,
            requiredInputs: capability.requiredInputs as unknown as Prisma.InputJsonValue,
            optionalInputs: capability.optionalInputs as unknown as Prisma.InputJsonValue,
            preconditions: capability.preconditions,
            sideEffects: capability.sideEffects,
            requiresConfirmation: capability.requiresConfirmation,
            minimumConfidence: capability.minimumConfidence,
            allowsInterruption: capability.allowsInterruption,
          },
        },
      },
    });

    await tx.workflowVersion.create({
      data: {
        workflowId: created.id,
        version: 1,
        definition: definition as unknown as Prisma.InputJsonValue,
        createdBy: userOf(req).id,
      },
    });

    return created;
  });

  res.status(201).json({
    success: true,
    data: {
      workflow,
      gaps: generated.compiled.gaps,
      issues: generated.issues,
      model: generated.model,
      promptVersion: generated.promptVersion,
      latencyMs: generated.latencyMs,
      stepCount: generated.plan.steps.length,
    },
  });
});
