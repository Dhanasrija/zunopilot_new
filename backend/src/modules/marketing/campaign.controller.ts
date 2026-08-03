import type { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../config/prisma.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ApiError } from '../../utils/ApiError.js';
import { tenantIdOf, userOf } from '../../middleware/auth.js';
import { queryString } from '../../utils/query.js';
import {
  campaignInclude, campaignOf, campaignProgress, pauseCampaign, previewAudience,
  startCampaign, type AudienceFilter,
} from './campaign.service.js';

const idParam = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const requireId = (value: string | undefined, what: string): string => {
  if (!value || !idParam.test(value)) throw ApiError.badRequest(`Not a ${what} id`);
  return value;
};

const audienceSchema = z.object({
  lastSeenAfter: z.string().datetime().nullish(),
  hasOrdered: z.boolean().optional(),
});

// ── Templates ─────────────────────────────────────────────────────────────────

const templateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  metaTemplate: z.string().trim().min(1).max(200),
  language: z.string().trim().min(2).max(10).default('en'),
  category: z.enum(['MARKETING', 'UTILITY']).default('MARKETING'),
  bodyPreview: z.string().trim().min(1).max(2_000),
  variables: z.array(z.string().trim().max(80)).max(20).default([]),
  status: z.enum(['DRAFT', 'PENDING', 'APPROVED', 'REJECTED']).optional(),
});

export const listTemplates = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = tenantIdOf(req);
  const templates = await prisma.campaignTemplate.findMany({
    where: { tenantId },
    orderBy: { updatedAt: 'desc' },
  });
  res.json({ success: true, data: templates });
});

export const postTemplate = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = tenantIdOf(req);
  const body = templateSchema.parse(req.body);

  const existing = await prisma.campaignTemplate.findUnique({
    where: { tenantId_name: { tenantId, name: body.name } },
    select: { id: true },
  });
  if (existing) throw new ApiError(409, `A template called "${body.name}" already exists.`);

  const template = await prisma.campaignTemplate.create({
    data: { ...body, tenantId, variables: body.variables },
  });
  res.status(201).json({ success: true, data: template });
});

export const patchTemplate = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = tenantIdOf(req);
  const templateId = requireId(req.params.templateId, 'template');
  const body = templateSchema.partial().parse(req.body);

  const existing = await prisma.campaignTemplate.findFirst({
    where: { id: templateId, tenantId },
    select: { id: true },
  });
  if (!existing) throw ApiError.notFound('Template not found');

  const template = await prisma.campaignTemplate.update({
    where: { id: templateId },
    data: body,
  });
  res.json({ success: true, data: template });
});

// ── Audience ──────────────────────────────────────────────────────────────────

/**
 * How many people a filter reaches, and how many it excludes for lack of consent.
 *
 * Its own endpoint so the composer can show both numbers live, before anyone
 * commits to a send.
 */
export const postAudiencePreview = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = tenantIdOf(req);
  const filter = audienceSchema.parse(req.body ?? {});
  res.json({ success: true, data: await previewAudience(tenantId, filter as AudienceFilter) });
});

// ── Campaigns ─────────────────────────────────────────────────────────────────

const campaignSchema = z.object({
  name: z.string().trim().min(1).max(160),
  templateId: z.string().regex(idParam),
  audienceFilter: audienceSchema.default({}),
  variableValues: z.record(z.string(), z.string().max(1_000)).default({}),
  scheduledAt: z.string().datetime().nullish(),
});

export const listCampaigns = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = tenantIdOf(req);
  const status = queryString(req.query.status);

  const campaigns = await prisma.campaign.findMany({
    where: { tenantId, ...(status ? { status: status as never } : {}) },
    include: campaignInclude,
    orderBy: { createdAt: 'desc' },
    take: 100,
  });

  // Progress per campaign, so the list can show a bar rather than just a status.
  const progress = await Promise.all(campaigns.map((c) => campaignProgress(c.id)));

  res.json({
    success: true,
    data: campaigns.map((campaign, index) => ({ ...campaign, progress: progress[index] })),
  });
});

export const getCampaign = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = tenantIdOf(req);
  const campaignId = requireId(req.params.campaignId, 'campaign');

  const campaign = await campaignOf(tenantId, campaignId);
  const [progress, audience] = await Promise.all([
    campaignProgress(campaignId),
    previewAudience(tenantId, (campaign.audienceFilter ?? {}) as AudienceFilter),
  ]);

  res.json({ success: true, data: { campaign, progress, audience } });
});

export const postCampaign = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = tenantIdOf(req);
  const user = userOf(req);
  const body = campaignSchema.parse(req.body);

  const template = await prisma.campaignTemplate.findFirst({
    where: { id: body.templateId, tenantId },
    select: { id: true },
  });
  if (!template) throw ApiError.badRequest('That template is not in this workspace');

  const campaign = await prisma.campaign.create({
    data: {
      tenantId,
      name: body.name,
      templateId: body.templateId,
      audienceFilter: body.audienceFilter,
      variableValues: body.variableValues,
      scheduledAt: body.scheduledAt ? new Date(body.scheduledAt) : null,
      status: body.scheduledAt ? 'SCHEDULED' : 'DRAFT',
      createdById: user.id,
    },
    include: campaignInclude,
  });

  res.status(201).json({ success: true, data: campaign });
});

/**
 * Start sending.
 *
 * Behind `campaigns:send`, which is separate from `campaigns:write` on purpose —
 * drafting a message and putting it in front of every customer the business has
 * are different decisions, and this one spends money and stakes the number's
 * reputation.
 */
export const postCampaignStart = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = tenantIdOf(req);
  const campaignId = requireId(req.params.campaignId, 'campaign');

  const campaign = await startCampaign(tenantId, campaignId);
  res.json({ success: true, data: { ...campaign, progress: await campaignProgress(campaignId) } });
});

export const postCampaignPause = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = tenantIdOf(req);
  const campaignId = requireId(req.params.campaignId, 'campaign');
  res.json({ success: true, data: await pauseCampaign(tenantId, campaignId) });
});

/** Who it went to, and what happened. Capped — this is a summary, not an export. */
export const listCampaignRecipients = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = tenantIdOf(req);
  const campaignId = requireId(req.params.campaignId, 'campaign');
  await campaignOf(tenantId, campaignId);

  const recipients = await prisma.campaignRecipient.findMany({
    where: { campaignId },
    include: { customer: { select: { id: true, name: true, waId: true } } },
    orderBy: { createdAt: 'asc' },
    take: 200,
  });

  res.json({ success: true, data: recipients });
});

// ── Consent ───────────────────────────────────────────────────────────────────

/**
 * The workspace's consent position, in one number each way.
 *
 * On the Marketing screen rather than buried in Customers, because the moment
 * someone plans a campaign is the moment the opted-out count is worth seeing.
 */
export const getConsentSummary = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = tenantIdOf(req);

  const [total, optedIn, optedOut] = await Promise.all([
    prisma.customer.count({ where: { tenantId } }),
    prisma.customer.count({ where: { tenantId, marketingOptIn: true, optedOutAt: null } }),
    prisma.customer.count({ where: { tenantId, optedOutAt: { not: null } } }),
  ]);

  res.json({ success: true, data: { total, optedIn, optedOut } });
});
