import { queryEnum, queryString } from '../utils/query.js';
import { WorkflowStatus } from '@prisma/client';
const WORKFLOW_STATUSES = Object.values(WorkflowStatus);
import { tenantIdOf } from '../middleware/auth.js';
import type { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';

// Module 11: Workflows.
//
// This is the definition/CRUD layer only — nothing here executes a graph. The
// runtime that walks nodes on an inbound message is a separate concern, and until
// it exists a PUBLISHED workflow is inert.

const EMPTY_GRAPH = { nodes: [], edges: [] };

// Shape returned to the list view: the graph can be large, and the list only
// needs a node count, so it is deliberately not sent.
const listSelect = {
  id: true,
  name: true,
  description: true,
  status: true,
  trigger: true,
  version: true,
  publishedAt: true,
  createdAt: true,
  updatedAt: true,
};

const nodeCount = (graph: unknown): number => {
  const nodes = (graph as { nodes?: unknown } | null)?.nodes;
  return Array.isArray(nodes) ? nodes.length : 0;
};

export const listWorkflows = asyncHandler(async (req, res) => {
  const status = queryEnum(req.query.status, WORKFLOW_STATUSES);
  const search = queryString(req.query.search);

  const where: Prisma.WorkflowWhereInput = { tenantId: tenantIdOf(req) };
  // Archived rows are hidden unless explicitly asked for, so an archive acts as a
  // soft delete without vanishing the record.
  if (status) where.status = status;
  else where.status = { not: 'ARCHIVED' };

  if (search) where.name = { contains: search, mode: 'insensitive' };

  const rows = await prisma.workflow.findMany({
    where,
    orderBy: { updatedAt: 'desc' },
    take: 200,
    select: { ...listSelect, graph: true },
  });

  res.json({
    success: true,
    data: rows.map(({ graph, ...w }) => ({ ...w, nodeCount: nodeCount(graph) })),
  });
});

export const getWorkflow = asyncHandler(async (req, res) => {
  const workflow = await prisma.workflow.findFirst({
    where: { id: req.params.id, tenantId: tenantIdOf(req) },
  });
  if (!workflow) throw ApiError.notFound('Workflow not found');
  res.json({ success: true, data: { ...workflow, graph: workflow.graph ?? EMPTY_GRAPH } });
});

export const createWorkflow = asyncHandler(async (req, res) => {
  const { name, description, trigger, graph } = req.body;

  const workflow = await prisma.workflow.create({
    data: {
      tenantId: tenantIdOf(req),
      name: name.trim(),
      description: description?.trim() || null,
      trigger: trigger || 'MESSAGE_RECEIVED',
      graph: graph ?? EMPTY_GRAPH,
      // Always starts as a draft — publishing is an explicit, separate action so
      // a half-built flow can never start handling live customer messages.
      status: 'DRAFT',
    },
  });
  res.status(201).json({ success: true, data: workflow });
});

export const updateWorkflow = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { name, description, trigger, graph } = req.body;

  // Tenant-scoped read before the write; never update({ where: { id } }) on a
  // tenant-owned row.
  const existing = await prisma.workflow.findFirst({ where: { id, tenantId: tenantIdOf(req) } });
  if (!existing) throw ApiError.notFound('Workflow not found');
  if (existing.status === 'ARCHIVED') throw ApiError.badRequest('Restore this workflow before editing it');

  const data: Prisma.WorkflowUpdateInput = {};
  if (name !== undefined) data.name = name.trim();
  if (description !== undefined) data.description = description?.trim() || null;
  if (trigger !== undefined) data.trigger = trigger;
  if (graph !== undefined) data.graph = graph;
  if (!Object.keys(data).length) throw ApiError.badRequest('Nothing to update');

  // `status` and `version` are intentionally not settable here — they move only
  // through publish/unpublish/archive, so the lifecycle stays auditable.
  const workflow = await prisma.workflow.update({ where: { id }, data });
  res.json({ success: true, data: workflow });
});

export const setWorkflowStatus = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  const existing = await prisma.workflow.findFirst({ where: { id, tenantId: tenantIdOf(req) } });
  if (!existing) throw ApiError.notFound('Workflow not found');

  if (status === 'PUBLISHED') {
    if (!nodeCount(existing.graph)) {
      throw ApiError.badRequest('Add at least one node before publishing');
    }
    const workflow = await prisma.workflow.update({
      where: { id },
      data: {
        status: 'PUBLISHED',
        publishedAt: new Date(),
        // Bump on publish, not on every save, so the number tracks releases.
        version: existing.status === 'PUBLISHED' ? existing.version + 1 : existing.version,
      },
    });
    return res.json({ success: true, data: workflow });
  }

  const workflow = await prisma.workflow.update({ where: { id }, data: { status } });
  res.json({ success: true, data: workflow });
});

export const duplicateWorkflow = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const source = await prisma.workflow.findFirst({ where: { id, tenantId: tenantIdOf(req) } });
  if (!source) throw ApiError.notFound('Workflow not found');

  const copy = await prisma.workflow.create({
    data: {
      tenantId: tenantIdOf(req),
      name: `${source.name} (copy)`,
      description: source.description,
      trigger: source.trigger,
      graph: source.graph ?? EMPTY_GRAPH,
      status: 'DRAFT', // a copy never inherits PUBLISHED
    },
  });
  res.status(201).json({ success: true, data: copy });
});

export const deleteWorkflow = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const existing = await prisma.workflow.findFirst({ where: { id, tenantId: tenantIdOf(req) } });
  if (!existing) throw ApiError.notFound('Workflow not found');
  await prisma.workflow.delete({ where: { id } });
  res.json({ success: true });
});
