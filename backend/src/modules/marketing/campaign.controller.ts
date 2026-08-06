import type { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../config/prisma.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ApiError } from '../../utils/ApiError.js';
import { tenantIdOf, userOf } from '../../middleware/auth.js';
import { queryEnum, queryString } from '../../utils/query.js';
import {
  campaignInclude, campaignOf, campaignProgress, pauseCampaign, previewAudience,
  startCampaign, type AudienceFilter,
} from './campaign.service.js';
import { syncTemplatesFromMeta } from './template-sync.service.js';
import { mediaFor } from '../media/media.service.js';

const idParam = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const requireId = (value: string | undefined, what: string): string => {
  if (!value || !idParam.test(value)) throw ApiError.badRequest(`Not a ${what} id`);
  return value;
};

const audienceSchema = z.object({
  lastSeenAfter: z.string().datetime().nullish(),
  hasOrdered: z.boolean().optional(),
  // Curated lists. Bounded because this is stored on the campaign as JSON and read back
  // on every preview; there is no reason to name twenty lists and every reason not to
  // accept an unbounded array from a client.
  listIds: z.array(z.string().uuid()).max(20).nullish(),
});

// ── Templates ─────────────────────────────────────────────────────────────────

const templateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  metaTemplate: z.string().trim().min(1).max(200),
  language: z.string().trim().min(2).max(10).default('en'),
  category: z.enum(['MARKETING', 'UTILITY']).default('MARKETING'),
  bodyPreview: z.string().trim().min(1).max(2_000),
  // Preview copy. `headerText` is deliberately absent: it only means anything for a TEXT
  // header, and `headerFormat` is not settable here either — the sync is the authority on a
  // template's shape, and letting someone type a header in would let the two disagree.
  footerText: z.string().trim().max(200).optional(),
  buttons: z.array(z.object({
    type: z.string().trim().min(1).max(40),
    text: z.string().trim().min(1).max(80),
  })).max(10).default([]),
  variables: z.array(z.string().trim().max(80)).max(20).default([]),
  status: z.enum(['DRAFT', 'PENDING', 'APPROVED', 'REJECTED']).optional(),
});

export const listTemplates = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = tenantIdOf(req);
  // `?category=MARKETING` for the campaign picker. Filtered here rather than in the browser
  // so the page cannot accidentally offer a UTILITY or AUTHENTICATION template as a
  // broadcast — an OTP template sent to a list is the mistake this prevents.
  const category = queryEnum(req.query.category, ['MARKETING', 'UTILITY'] as const);
  const templates = await prisma.campaignTemplate.findMany({
    where: { tenantId, ...(category ? { category } : {}) },
    orderBy: { updatedAt: 'desc' },
  });
  res.json({ success: true, data: templates });
});

/**
 * Reconcile this workspace's templates with Meta.
 *
 * The header format is the reason this exists — see `template-sync.service.ts`.
 */
export const postTemplateSync = asyncHandler(async (req: Request, res: Response) => {
  res.json({ success: true, data: await syncTemplatesFromMeta(tenantIdOf(req)) });
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
  /** The media filling the template's header, when it declares one. */
  headerMediaId: z.string().regex(idParam).nullish(),
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
    select: { id: true, headerFormat: true },
  });
  if (!template) throw ApiError.badRequest('That template is not in this workspace');

  /*
   * The media id comes from the client, so it is resolved against this tenant before it is
   * stored — otherwise a workspace could attach another's file and have Meta serve it from
   * our public media route.
   *
   * `mediaFor` 404s on a miss, which is the right answer for an id that is not yours.
   */
  if (body.headerMediaId) {
    const asset = await mediaFor(tenantId, body.headerMediaId);
    // Caught here as well as in `startCampaign`, so the mismatch is reported while the
    // person is still choosing rather than when they press send.
    if (template.headerFormat !== asset.kind) {
      throw ApiError.badRequest(
        `That template needs a ${template.headerFormat.toLowerCase()}, but the chosen file `
        + `is a ${asset.kind.toLowerCase()}.`,
      );
    }
  }

  const campaign = await prisma.campaign.create({
    data: {
      tenantId,
      name: body.name,
      templateId: body.templateId,
      headerMediaId: body.headerMediaId ?? null,
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
