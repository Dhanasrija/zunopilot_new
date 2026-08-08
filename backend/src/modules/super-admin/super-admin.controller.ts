import type { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import type { LlmVendor } from '@prisma/client';
import type { BillingInterval as PrismaInterval, PlanCode as PrismaPlan } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../../config/prisma.js';
import { logger } from '../../config/logger.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ApiError } from '../../utils/ApiError.js';
import { adminOf, audit, signSuperAdminToken } from './auth.js';
import { syncMembership } from '../../services/membership.service.js';
import { dailyMessageCounts, tenantActivity } from './activity.js';
import { entitlementsFor, usageFor } from '../billing/billing.service.js';
import { OVERAGE, PLANS, planByCode } from '../billing/catalogue.js';
import { GST_RATE_PERCENT, grossPaise, sellerTaxIdentity } from '../billing/gst.js';
import {
  REQUEST_TTL_HOURS, grantUsable, grantView, mintImpersonationToken,
} from './impersonation.js';
import { MODULE_KEYS, moduleSettingsFor, setModuleEnabled } from '../modules/module.service.js';
import { COPY_LIMITS as ASSISTANT_COPY } from '../conversation-engine/routing/assistant-copy.js';
import { LLM_VENDORS, env } from '../../config/env.js';
import {
  enquiryById, listEnquiries, newEnquiryCount, updateEnquiry,
} from '../enquiries/enquiry.service.js';
import { queryString } from '../../utils/query.js';
import { assertUrlAllowed, EgressBlockedError } from '../conversation-engine/providers/egress.js';
import {
  CONNECTOR_AUTH_TYPES, CONNECTOR_KINDS, HTTP_METHODS, connectorKeySchema,
  operationCreateSchema, operationInputSchema, responseMappingSchema,
} from '../conversation-engine/connectors/schemas.js';

// The super admin API.
//
// Read broadly, write narrowly. Everything here can see every workspace, so the
// writes are deliberately few and each one is audited: assign or override a plan,
// suspend a workspace, deactivate or reactivate a user, reset a password. There
// is no endpoint that reads a customer's message bodies, and none that returns a
// credential — a support tool that can read conversations is a privacy incident
// waiting for a curious afternoon.

const idParam = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const requireId = (value: string | undefined, what: string): string => {
  if (!value || !idParam.test(value)) throw ApiError.badRequest(`Not a ${what} id`);
  return value;
};

// ── Auth ──────────────────────────────────────────────────────────────────────

const loginSchema = z.object({
  email: z.string().trim().email().max(200),
  password: z.string().min(1).max(200),
});

export const login = asyncHandler(async (req: Request, res: Response) => {
  const body = loginSchema.parse(req.body);

  const admin = await prisma.superAdmin.findUnique({
    where: { email: body.email.toLowerCase() },
  });

  // One message for "no such account" and "wrong password", and the hash is
  // compared even when there is no account, so the response does not reveal
  // which super admin emails exist.
  const hash = admin?.passwordHash ?? '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv';
  const ok = await bcrypt.compare(body.password, hash);

  if (!admin || !admin.isActive || !ok) {
    logger.warn('Super admin login rejected', { email: body.email, ip: req.ip });
    throw ApiError.unauthorized('Invalid email or password');
  }

  await prisma.superAdmin.update({
    where: { id: admin.id },
    data: { lastLoginAt: new Date() },
  });

  await prisma.auditEvent.create({
    data: {
      superAdminId: admin.id,
      action: 'superadmin.login',
      summary: `${admin.fullName} signed in`,
      ip: req.ip ?? null,
    },
  });

  res.json({
    success: true,
    data: {
      token: signSuperAdminToken(admin.id),
      admin: { id: admin.id, email: admin.email, fullName: admin.fullName },
    },
  });
});

export const me = asyncHandler(async (req: Request, res: Response) => {
  const admin = adminOf(req);
  res.json({
    success: true,
    data: {
      id: admin.id, email: admin.email, fullName: admin.fullName, lastLoginAt: admin.lastLoginAt,
    },
  });
});

// ── Platform overview ─────────────────────────────────────────────────────────

/**
 * The numbers an operator wants on opening the console.
 *
 * Revenue is read from `Invoice`, not from subscriptions: an invoice is money
 * that actually settled, whereas a subscription row is an intention. Counting
 * the latter as revenue is how a dashboard ends up more optimistic than the bank.
 */
export const overview = asyncHandler(async (_req: Request, res: Response) => {
  const now = new Date();
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  const [
    tenants, activeTenants, users, channels, messages24h, aiDecisions24h,
    subscriptionsByPlan, invoiceTotals, monthInvoices, publishedWorkflows, openHandoffs,
    newEnquiries,
  ] = await Promise.all([
    prisma.tenant.count(),
    prisma.tenant.count({ where: { isActive: true } }),
    prisma.user.count({ where: { isActive: true } }),
    prisma.whatsappAccount.count(),
    prisma.message.count({ where: { createdAt: { gte: dayAgo } } }),
    prisma.routingDecision.count({ where: { createdAt: { gte: dayAgo }, source: 'AI_ROUTER' } }),
    prisma.subscription.groupBy({ by: ['plan', 'status'], _count: { _all: true } }),
    prisma.invoice.aggregate({ _sum: { totalPaise: true }, _count: { _all: true } }),
    prisma.invoice.aggregate({
      where: { issuedAt: { gte: monthStart } },
      _sum: { totalPaise: true },
      _count: { _all: true },
    }),
    prisma.workflow.count({ where: { status: 'PUBLISHED' } }),
    prisma.humanHandoff.count({ where: { status: 'PENDING' } }),
    // Drives the Enquiries nav badge. An inbox nobody is told about is one nobody
    // checks — and until this shipped, every contact-form submission was discarded.
    newEnquiryCount(),
  ]);

  res.json({
    success: true,
    data: {
      tenants: { total: tenants, active: activeTenants, suspended: tenants - activeTenants },
      users,
      newEnquiries,
      whatsappNumbers: channels,
      last24h: { messages: messages24h, aiRoutedMessages: aiDecisions24h },
      publishedWorkflows,
      openHandoffs,
      plans: subscriptionsByPlan.map((row) => ({
        plan: row.plan, status: row.status, count: row._count._all,
      })),
      revenue: {
        // Lifetime and this calendar month, both from settled invoices.
        allTimePaise: invoiceTotals._sum.totalPaise ?? 0,
        invoiceCount: invoiceTotals._count._all,
        thisMonthPaise: monthInvoices._sum.totalPaise ?? 0,
        thisMonthInvoices: monthInvoices._count._all,
      },
    },
  });
});

// ── Tenants ───────────────────────────────────────────────────────────────────

const listQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  plan: z.enum(['STARTER', 'GROWTH', 'BUSINESS', 'ENTERPRISE', 'NONE']).optional(),
  status: z.enum(['active', 'suspended']).optional(),
  take: z.coerce.number().int().min(1).max(200).default(50),
  skip: z.coerce.number().int().min(0).default(0),
});

export const listTenants = asyncHandler(async (req: Request, res: Response) => {
  const query = listQuerySchema.parse(req.query);

  const where = {
    ...(query.status ? { isActive: query.status === 'active' } : {}),
    ...(query.search
      ? {
        OR: [
          { businessName: { contains: query.search, mode: 'insensitive' as const } },
          { users: { some: { email: { contains: query.search, mode: 'insensitive' as const } } } },
          { whatsappAccounts: { some: { displayPhone: { contains: query.search } } } },
        ],
      }
      : {}),
    ...(query.plan
      ? query.plan === 'NONE'
        ? { subscription: { is: null } }
        : { subscription: { plan: query.plan as PrismaPlan } }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.tenant.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: query.take,
      skip: query.skip,
      select: {
        id: true,
        businessName: true,
        /*
         * Both, because neither alone is the answer.
         *
         * `category` is the pre-rows `BusinessCategoryLegacy` enum and reads `RESTAURANT` for every
         * workspace on the platform — it was the column that existed before categories became rows,
         * and nothing has written it since. The console was showing it, so every workspace appeared
         * to be a restaurant, including the IT consultancies.
         */
        category: true,
        businessCategory: { select: { label: true } },
        onboardingCompletedAt: true,
        isActive: true,
        createdAt: true,
        gstin: true,
        subscription: {
          select: { plan: true, interval: true, status: true, currentPeriodEnd: true },
        },
        whatsappAccounts: { select: { displayPhone: true } },
        _count: { select: { users: true, customers: true, orders: true } },
      },
    }),
    prisma.tenant.count({ where }),
  ]);

  res.json({
    success: true,
    data: rows.map((row) => ({
      id: row.id,
      businessName: row.businessName,
      /*
       * The label the workspace actually picked, and null when it has not picked one.
       *
       * Null rather than falling back to the enum: a workspace with no category row has not chosen,
       * and "restaurant" is a worse answer than "not set" — it is how eleven workspaces came to look
       * like eleven restaurants. The legacy enum stays in the payload under its own name for anything
       * that still reads it.
       */
      category: row.businessCategory?.label ?? null,
      /** @deprecated The pre-rows enum. `RESTAURANT` for everybody; do not display it. */
      legacyCategory: row.category,
      /** Null means they verified a code and never finished the profile form. */
      onboardingCompletedAt: row.onboardingCompletedAt,
      isActive: row.isActive,
      createdAt: row.createdAt,
      gstin: row.gstin,
      plan: row.subscription?.plan ?? null,
      interval: row.subscription?.interval ?? null,
      subscriptionStatus: row.subscription?.status ?? null,
      periodEnd: row.subscription?.currentPeriodEnd ?? null,
      numbers: row.whatsappAccounts.map((c) => c.displayPhone).filter(Boolean),
      users: row._count.users,
      customers: row._count.customers,
      orders: row._count.orders,
    })),
    meta: { total, take: query.take, skip: query.skip },
  });
});

/**
 * Everything about one workspace on one screen.
 *
 * Note what is *not* here: no message bodies, no access tokens, no connector
 * credentials. `WhatsappAccount.accessToken` is selected around rather than
 * fetched-and-stripped, because a field that never leaves the database cannot be
 * leaked by a later careless spread.
 */
export const getTenant = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = requireId(req.params.tenantId, 'workspace');

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: {
      id: true, businessName: true, contactNumber: true, address: true,
      website: true, isActive: true, createdAt: true, updatedAt: true,
      gstin: true, gstStateCode: true,
      /*
       * The category the workspace chose, and the enum that predates the table.
       *
       * `category` alone reads `RESTAURANT` for every workspace on the platform — nothing has written
       * it since categories became rows — so a detail page showing it told every operator that every
       * customer runs a restaurant. The label is the answer; the enum stays under its own name.
       */
      category: true,
      businessCategory: { select: { id: true, key: true, label: true } },
      onboardingCompletedAt: true,
      // Which model answers this workspace's customers. Null is the platform default.
      llmVendor: true,
      users: {
        select: {
          id: true, email: true, fullName: true, role: true, isActive: true,
          emailVerified: true, createdAt: true,
        },
        orderBy: { createdAt: 'asc' },
      },
      whatsappAccounts: {
        // `accessToken` is selected around rather than fetched and stripped: a
        // field that never leaves the database cannot be leaked by a later
        // careless spread. Its expiry is useful, the token itself never is.
        select: {
          id: true, displayPhone: true, phoneNumberId: true, wabaId: true,
          businessName: true, tokenExpiresAt: true, connectedAt: true, updatedAt: true,
        },
      },
      subscription: true,
      _count: {
        select: {
          customers: true, orders: true, conversations: true, workflows: true,
          assistants: true, messages: true,
        },
      },
    },
  });
  if (!tenant) throw ApiError.notFound('Workspace not found');

  const [entitlements, usage, invoices, payments, connectors] = await Promise.all([
    entitlementsFor(tenantId),
    usageFor(tenantId),
    prisma.invoice.findMany({
      where: { tenantId },
      orderBy: { issuedAt: 'desc' },
      take: 50,
      select: {
        id: true, number: true, planName: true, intervalLabel: true, periodStart: true,
        periodEnd: true, subtotalPaise: true, overagePaise: true, taxPaise: true,
        totalPaise: true, currency: true, issuedAt: true, billedToGstin: true,
        placeOfSupply: true,
      },
    }),
    prisma.payment.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: 25,
      select: {
        id: true, plan: true, interval: true, amountPaise: true, status: true,
        createdAt: true, paidAt: true, failureReason: true, razorpayPaymentId: true,
      },
    }),
    prisma.connector.findMany({
      where: { tenantId },
      select: { id: true, key: true, name: true, kind: true, status: true },
    }),
  ]);

  res.json({
    success: true,
    data: {
      tenant,
      entitlements,
      usage,
      invoices,
      payments,
      connectors,
      /*
       * What this workspace's model choice actually resolves to, and what else this box could serve.
       *
       * The console needs three things the `llmVendor` column alone cannot say: which vendors have a
       * key here (so it can disable the rest rather than offering a model the server cannot reach),
       * which model each one means, and what "platform default" resolves to today. Read from the
       * environment at request time, because that is where the answer lives.
       */
      llm: llmChoices(tenant.llmVendor),
      // What the workspace would be charged today, so an operator answering
      // "what do I owe" does not have to do the GST arithmetic themselves.
      pricing: {
        gstRatePercent: sellerTaxIdentity().registered ? GST_RATE_PERCENT : 0,
        payableTodayPaise: tenant.subscription
          ? grossPaise(
            planByCode(tenant.subscription.plan)?.prices[tenant.subscription.interval] ?? 0,
            tenant.gstStateCode,
          )
          : null,
      },
    },
  });
});

export const getTenantActivity = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = requireId(req.params.tenantId, 'workspace');
  const [entries, daily] = await Promise.all([
    tenantActivity(tenantId),
    dailyMessageCounts(tenantId),
  ]);
  res.json({ success: true, data: { entries, dailyMessages: daily } });
});

// ── Tenant writes ─────────────────────────────────────────────────────────────

const suspendSchema = z.object({
  isActive: z.boolean(),
  reason: z.string().trim().max(500).optional(),
});

/**
 * Suspend or restore a workspace.
 *
 * Suspension is a flag, never a delete. Deleting a tenant cascades through every
 * customer, conversation, order and invoice it has — an irreversible action no
 * support console should offer next to a search box.
 */
export const setTenantActive = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = requireId(req.params.tenantId, 'workspace');
  const body = suspendSchema.parse(req.body);

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { businessName: true, isActive: true },
  });
  if (!tenant) throw ApiError.notFound('Workspace not found');

  await prisma.tenant.update({ where: { id: tenantId }, data: { isActive: body.isActive } });

  await audit(req, {
    action: body.isActive ? 'tenant.restored' : 'tenant.suspended',
    tenantId,
    targetType: 'Tenant',
    targetId: tenantId,
    summary: `${body.isActive ? 'Restored' : 'Suspended'} ${tenant.businessName}`,
    metadata: { reason: body.reason ?? null, previous: tenant.isActive },
  });

  res.json({ success: true, data: { isActive: body.isActive } });
});

const assignPlanSchema = z.object({
  plan: z.enum(['STARTER', 'GROWTH', 'BUSINESS', 'ENTERPRISE']),
  interval: z.enum(['MONTHLY', 'QUARTERLY', 'YEARLY']).default('YEARLY'),
  months: z.number().int().min(1).max(120).default(12),
  note: z.string().trim().max(500).optional(),
  seatLimit: z.number().int().min(1).max(10_000).nullish(),
  numberLimit: z.number().int().min(1).max(1_000).nullish(),
  automationLimit: z.number().int().min(1).max(100_000).nullish(),
  aiQuota: z.number().int().min(0).max(100_000_000).nullish(),
  overageCapPaise: z.number().int().min(0).max(1_000_000_000).nullish(),
});

/**
 * Assign a plan by hand, with optional limit overrides.
 *
 * This is how Enterprise is actually delivered, and how a goodwill extension or
 * a trial is granted. `status: MANUAL` means open-ended: `entitlementsFor` does
 * not apply a period check to it, so a negotiated account does not silently lapse
 * because nobody renewed a row.
 *
 * It deliberately does **not** touch Razorpay. A manually assigned plan is not a
 * mandate, and creating a subscription here would start charging a card that
 * never agreed to it.
 */
export const assignTenantPlan = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = requireId(req.params.tenantId, 'workspace');
  const body = assignPlanSchema.parse(req.body);
  const admin = adminOf(req);

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { businessName: true },
  });
  if (!tenant) throw ApiError.notFound('Workspace not found');

  const start = new Date();
  const end = new Date(start);
  end.setMonth(end.getMonth() + body.months);

  const overrides = {
    seatLimitOverride: body.seatLimit ?? null,
    numberLimitOverride: body.numberLimit ?? null,
    automationLimitOverride: body.automationLimit ?? null,
    aiQuotaOverride: body.aiQuota ?? null,
    ...(body.overageCapPaise === undefined ? {} : { overageCapPaise: body.overageCapPaise }),
  };

  const subscription = await prisma.subscription.upsert({
    where: { tenantId },
    create: {
      tenantId,
      plan: body.plan as PrismaPlan,
      interval: body.interval as PrismaInterval,
      status: 'MANUAL',
      currentPeriodStart: start,
      currentPeriodEnd: end,
      assignedNote: body.note ?? null,
      ...overrides,
    },
    update: {
      plan: body.plan as PrismaPlan,
      interval: body.interval as PrismaInterval,
      status: 'MANUAL',
      currentPeriodStart: start,
      currentPeriodEnd: end,
      assignedNote: body.note ?? null,
      // A hand-assigned plan clears any change that was scheduled against the
      // old one, or an hourly job would later apply a downgrade nobody wants.
      pendingPlan: null,
      pendingInterval: null,
      pendingPriceId: null,
      pendingEffectiveAt: null,
      ...overrides,
    },
  });

  await audit(req, {
    action: 'tenant.plan_assigned',
    tenantId,
    targetType: 'Subscription',
    targetId: subscription.id,
    summary: `Assigned ${body.plan} ${body.interval.toLowerCase()} to ${tenant.businessName} for ${body.months} months`,
    metadata: { ...body, assignedBy: admin.email },
  });

  res.json({ success: true, data: subscription });
});

// ── Optional modules ──────────────────────────────────────────────────────────

const modulePatchSchema = z.object({
  module: z.enum(MODULE_KEYS),
  enabled: z.boolean(),
  note: z.string().trim().max(500).optional(),
});

/** Every module and its current setting, including ones never configured. */
export const getTenantModules = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = requireId(req.params.tenantId, 'workspace');

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true },
  });
  if (!tenant) throw ApiError.notFound('Workspace not found');

  res.json({ success: true, data: await moduleSettingsFor(tenantId) });
});

/**
 * Give a workspace an optional module, or take it away.
 *
 * The only way a module is ever switched on. There is deliberately no
 * customer-facing route — a workspace cannot grant itself Marketing — which is
 * what makes this a rollout control rather than a setting.
 *
 * One module per request rather than a whole map, so the audit trail records
 * "Marketing enabled" instead of a diff a reader has to reconstruct, and so two
 * operators toggling different modules cannot overwrite each other.
 *
 * Turning a module **off** does not delete anything behind it. The data stays and
 * the routes stop answering, so switching it back on restores the workspace as it
 * was — a rollout switch that destroyed a customer's leads would be unusable.
 */
export const setTenantModule = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = requireId(req.params.tenantId, 'workspace');
  const body = modulePatchSchema.parse(req.body);
  const admin = adminOf(req);

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { businessName: true },
  });
  if (!tenant) throw ApiError.notFound('Workspace not found');

  const setting = await setModuleEnabled({
    tenantId,
    module: body.module,
    enabled: body.enabled,
    note: body.note ?? null,
    superAdminId: admin.id,
  });

  await audit(req, {
    action: body.enabled ? 'tenant.module_enabled' : 'tenant.module_disabled',
    tenantId,
    targetType: 'TenantModule',
    targetId: body.module,
    summary: `${body.enabled ? 'Enabled' : 'Disabled'} ${body.module} for ${tenant.businessName}`,
    metadata: { module: body.module, enabled: body.enabled, note: body.note ?? null, by: admin.email },
  });

  logger.info('Tenant module changed', {
    tenantId, module: body.module, enabled: body.enabled, superAdminId: admin.id,
  });

  res.json({ success: true, data: setting });
});

// ── Which model answers a workspace ───────────────────────────────────────────

/**
 * The model options for a workspace, and what its current choice means.
 *
 * `available: false` is the important field: it means this box has no key for that vendor, so the
 * console disables it. An operator pinning a workspace to a vendor the server cannot reach would
 * produce a workspace whose every message falls back with a warning nobody reads.
 */
const llmChoices = (pinned: LlmVendor | null) => ({
  /** What this workspace is pinned to, or null for the platform default. */
  pinned,
  /** What null means today, so "Platform default" can name a model rather than being a mystery. */
  platform: {
    vendor: (env.llm.vendor || null) as string | null,
    model: env.llm.apiKey ? env.llm.model : null,
  },
  vendors: LLM_VENDORS.map((vendor) => {
    const settings = env.llm.byVendor[vendor];
    return {
      vendor,
      available: settings !== null,
      model: settings?.model ?? null,
      baseUrl: settings?.baseUrl || null,
      /** Groq is `json_object`; the router's schema is only *enforced* under `json_schema`. */
      structuredMode: settings?.structuredMode ?? null,
    };
  }),
  /**
   * Writing workflows is pinned to OpenAI whatever is chosen here, so the console can say so rather
   * than leaving an operator to wonder why a Groq workspace's generated drafts name a GPT model.
   */
  authoringVendor: 'OPENAI' as const,
});

const llmVendorPatchSchema = z.object({
  /**
   * `null` means the platform default, and is a real choice rather than an omission — it is how an
   * operator un-pins a workspace.
   */
  vendor: z.enum(LLM_VENDORS).nullable(),
  note: z.string().trim().max(300).nullish(),
});

/**
 * Choose which vendor answers a workspace's customers.
 *
 * An operator's decision, beside the module toggles, for the same reason those are: it is our cost
 * per message and our latency budget, not the workspace's preference. It takes effect on the next
 * message — there is no cache to clear, because the provider is chosen per call from this column.
 */
export const setTenantLlmVendor = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = requireId(req.params.tenantId, 'workspace');
  const body = llmVendorPatchSchema.parse(req.body);
  const admin = adminOf(req);

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { businessName: true, llmVendor: true },
  });
  if (!tenant) throw ApiError.notFound('Workspace not found');

  /*
   * Refused rather than accepted-with-a-warning.
   *
   * A vendor with no key on this box cannot answer anything: every message would fall back to the
   * platform default and log a line. Storing that choice would make the console show a model the
   * workspace is not actually using, which is worse than not offering it.
   */
  if (body.vendor && env.llm.byVendor[body.vendor] === null) {
    throw ApiError.badRequest(
      `${body.vendor} has no API key on this server, so a workspace cannot be pinned to it. `
      + `Set ${body.vendor}_LLM_API_KEY and restart.`,
    );
  }

  const updated = await prisma.tenant.update({
    where: { id: tenantId },
    data: { llmVendor: body.vendor },
    select: { llmVendor: true },
  });

  await audit(req, {
    action: 'tenant.llm_vendor_changed',
    tenantId,
    targetType: 'Tenant',
    targetId: tenantId,
    summary: body.vendor
      ? `Set ${tenant.businessName}'s model to ${body.vendor} (${env.llm.byVendor[body.vendor]?.model})`
      : `Put ${tenant.businessName} back on the platform default model`,
    metadata: {
      from: tenant.llmVendor, to: body.vendor, note: body.note ?? null, by: admin.email,
    },
  });

  logger.info('Tenant LLM vendor changed', {
    tenantId, from: tenant.llmVendor, to: body.vendor, superAdminId: admin.id,
  });

  res.json({ success: true, data: llmChoices(updated.llmVendor) });
});

// ── Contact enquiries ─────────────────────────────────────────────────────────

const enquiryQuerySchema = z.object({
  status: z.enum(['NEW', 'CONTACTED', 'CLOSED', 'SPAM']).optional(),
  take: z.coerce.number().int().min(1).max(200).default(50),
  skip: z.coerce.number().int().min(0).default(0),
});

/**
 * Enquiries from the marketing site.
 *
 * **This returns the message body, and that is deliberate.** §2 of
 * `docs/super-admin.md` says no endpoint returns message bodies — that rule keeps an
 * operator out of *tenants' customers'* conversations, which are none of our
 * business. An enquiry is a message written *to* ZunoPilot by its own author, and
 * reading it is the entire purpose of the screen. Please do not "fix" this.
 */
export const listEnquiriesHandler = asyncHandler(async (req: Request, res: Response) => {
  const query = enquiryQuerySchema.parse({
    status: queryString(req.query.status),
    take: queryString(req.query.take),
    skip: queryString(req.query.skip),
  });

  res.json({ success: true, data: await listEnquiries(query) });
});

const enquiryPatchSchema = z.object({
  status: z.enum(['NEW', 'CONTACTED', 'CLOSED', 'SPAM']).optional(),
  internalNote: z.string().trim().max(2_000).nullish(),
});

export const updateEnquiryHandler = asyncHandler(async (req: Request, res: Response) => {
  const enquiryId = requireId(req.params.enquiryId, 'enquiry');
  const body = enquiryPatchSchema.parse(req.body);
  if (body.status === undefined && body.internalNote === undefined) {
    throw ApiError.badRequest('Nothing to change');
  }
  const admin = adminOf(req);

  const before = await enquiryById(enquiryId);
  const updated = await updateEnquiry(enquiryId, admin.id, {
    status: body.status,
    internalNote: body.internalNote ?? undefined,
  });

  // Audited like every other operator write. `tenantId` stays null — this is a
  // platform-level record with no workspace to attribute it to, which is exactly why
  // `AuditEvent.tenantId` was left nullable.
  if (body.status && body.status !== before.status) {
    await audit(req, {
      action: 'enquiry.status_changed',
      targetType: 'Enquiry',
      targetId: enquiryId,
      summary: `Enquiry from ${before.fullName} moved to ${body.status}`,
      metadata: { from: before.status, to: body.status, by: admin.email },
    });
  }

  res.json({ success: true, data: updated });
});

// ── Users ─────────────────────────────────────────────────────────────────────

const userPatchSchema = z.object({
  isActive: z.boolean().optional(),
  role: z.enum(['OWNER', 'MANAGER', 'AGENT']).optional(),
});

export const updateUser = asyncHandler(async (req: Request, res: Response) => {
  const userId = requireId(req.params.userId, 'user');
  const body = userPatchSchema.parse(req.body);
  if (body.isActive === undefined && body.role === undefined) {
    throw ApiError.badRequest('Nothing to change');
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true, email: true, fullName: true, role: true, isActive: true, tenantId: true,
      tenant: { select: { businessName: true } },
    },
  });
  if (!user) throw ApiError.notFound('User not found');

  // Removing the last active owner leaves a workspace nobody can administer —
  // including the customer, who then has to call support to get back in.
  const removingOwnerPowers = (body.isActive === false || (body.role && body.role !== 'OWNER'))
    && user.role === 'OWNER' && user.isActive;
  if (removingOwnerPowers) {
    const otherOwners = await prisma.user.count({
      where: { tenantId: user.tenantId, role: 'OWNER', isActive: true, id: { not: user.id } },
    });
    if (otherOwners === 0) {
      throw ApiError.badRequest(
        'This is the only active owner of the workspace. Promote another user first.',
      );
    }
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data: {
      ...(body.isActive === undefined ? {} : { isActive: body.isActive }),
      ...(body.role === undefined ? {} : { role: body.role }),
    },
    select: { id: true, email: true, role: true, isActive: true },
  });

  /*
   * Mirror it onto the membership.
   *
   * This endpoint writes the *login* — `isActive` and the legacy `role` — with no notion of which
   * workspace it means, which is coherent today because a user has exactly one. It stops being
   * coherent under memberships, and splitting it is deliberately deferred to its own commit
   * because it touches the operator console. Until then this keeps the two in step, so the split
   * is a change of shape rather than a repair of drifted data.
   */
  await syncMembership(userId);

  await audit(req, {
    action: 'user.updated',
    tenantId: user.tenantId,
    targetType: 'User',
    targetId: user.id,
    summary: `Updated ${user.email} in ${user.tenant.businessName}`,
    metadata: {
      from: { role: user.role, isActive: user.isActive },
      to: { role: updated.role, isActive: updated.isActive },
    },
  });

  res.json({ success: true, data: updated });
});

/**
 * There is deliberately no password-reset endpoint.
 *
 * Customers sign in with a phone number and a one-time code — there is no password
 * to reset, and setting one would create a credential that no login path accepts.
 * A customer who cannot get in needs their number checked or their SMS delivery
 * looked at, not a new secret.
 */

// ── Plans ─────────────────────────────────────────────────────────────────────

/**
 * The plan catalogue, and why it is read-only here.
 *
 * `PLANS` in `billing/catalogue.ts` is the source, and `syncPriceCatalogue()`
 * writes it into `Price` rows. An edit made only in the database would be
 * **silently reverted** the next time `sync-prices` or `razorpay-plans` runs —
 * it archives the admin's row and re-inserts the code value. So this screen
 * reports the live rows and how they compare to the code, rather than offering a
 * form whose effect expires at the next deploy.
 *
 * It also matches the rule the money code already follows: a price is an approved
 * value. Approving it means a deliberate commit, not a text box.
 */
export const listPlans = asyncHandler(async (_req: Request, res: Response) => {
  const [prices, counts] = await Promise.all([
    prisma.price.findMany({
      orderBy: [{ plan: 'asc' }, { interval: 'asc' }, { createdAt: 'desc' }],
      select: {
        id: true, plan: true, interval: true, amountPaise: true, currency: true,
        razorpayPlanId: true, archivedAt: true, createdAt: true,
      },
    }),
    prisma.subscription.groupBy({ by: ['plan'], _count: { _all: true } }),
  ]);

  const subscribers = new Map(counts.map((row) => [row.plan, row._count._all]));
  const registered = sellerTaxIdentity().registered;

  res.json({
    success: true,
    data: {
      editable: false,
      source: 'backend/src/modules/billing/catalogue.ts',
      howToChange: [
        'Edit PLANS in backend/src/modules/billing/catalogue.ts, and the literal amounts in its test.',
        'Run: npx tsx scripts/sync-prices.ts   (archives the old Price row, inserts a new one)',
        'Run: npx tsx scripts/razorpay-plans.ts --dry-run, then without the flag, to create the plans.',
      ],
      gst: registered ? { ratePercent: GST_RATE_PERCENT } : null,
      plans: PLANS.map((plan) => ({
        code: plan.code,
        name: plan.name,
        tagline: plan.tagline,
        includes: plan.includes,
        entitlements: plan.entitlements,
        selfServe: plan.selfServe,
        badges: plan.badges,
        subscribers: subscribers.get(plan.code) ?? 0,
        overage: OVERAGE[plan.code],
        prices: Object.entries(plan.prices).map(([interval, amountPaise]) => {
          const live = prices.find(
            (p) => p.plan === plan.code && p.interval === interval && !p.archivedAt,
          );
          return {
            interval,
            catalogueAmountPaise: amountPaise,
            livePriceId: live?.id ?? null,
            liveAmountPaise: live?.amountPaise ?? null,
            payablePaise: grossPaise(amountPaise, null),
            razorpayPlanId: live?.razorpayPlanId ?? null,
            // The one thing worth alarming on: the database and the code
            // disagreeing means checkout is charging something the page is not
            // showing.
            outOfSync: live != null && live.amountPaise !== amountPaise,
            notSynced: live == null,
          };
        }),
      })),
      archivedPrices: prices.filter((p) => p.archivedAt),
    },
  });
});

// ── Audit log ─────────────────────────────────────────────────────────────────

const auditQuerySchema = z.object({
  tenantId: z.string().regex(idParam).optional(),
  action: z.string().trim().max(80).optional(),
  take: z.coerce.number().int().min(1).max(200).default(100),
  skip: z.coerce.number().int().min(0).default(0),
});

export const listAudit = asyncHandler(async (req: Request, res: Response) => {
  const query = auditQuerySchema.parse(req.query);

  const where = {
    ...(query.tenantId ? { tenantId: query.tenantId } : {}),
    ...(query.action ? { action: { contains: query.action } } : {}),
  };

  const [events, total] = await Promise.all([
    prisma.auditEvent.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: query.take,
      skip: query.skip,
      include: { superAdmin: { select: { fullName: true, email: true } } },
    }),
    prisma.auditEvent.count({ where }),
  ]);

  // Resolve workspace names in one query rather than per row.
  const tenantIds = [...new Set(events.flatMap((e) => (e.tenantId ? [e.tenantId] : [])))];
  const names = new Map(
    (await prisma.tenant.findMany({
      where: { id: { in: tenantIds } },
      select: { id: true, businessName: true },
    })).map((t) => [t.id, t.businessName]),
  );

  res.json({
    success: true,
    data: events.map((event) => ({
      ...event,
      tenantName: event.tenantId ? names.get(event.tenantId) ?? null : null,
    })),
    meta: { total, take: query.take, skip: query.skip },
  });
});

// ── Support access ────────────────────────────────────────────────────────────
//
// The operator can only *ask*. There is no endpoint below that grants access,
// which is deliberate and is the difference between a consent model and a
// courtesy.

const requestAccessSchema = z.object({
  /**
   * Shown verbatim to the workspace owner who decides. Required and given a real
   * minimum length, because "debugging" is not something a person can meaningfully
   * consent to.
   */
  reason: z.string().trim().min(15).max(500),
});

export const requestImpersonation = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = requireId(req.params.tenantId, 'workspace');
  const body = requestAccessSchema.parse(req.body);
  const admin = adminOf(req);

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { businessName: true, users: { where: { role: 'OWNER', isActive: true }, take: 1 } },
  });
  if (!tenant) throw ApiError.notFound('Workspace not found');

  // Nobody to ask means no access. Not a fallback to "approve it ourselves".
  if (tenant.users.length === 0) {
    throw ApiError.unprocessable(
      'This workspace has no active owner who could approve support access.',
    );
  }

  const existing = await prisma.impersonationGrant.findFirst({
    where: {
      tenantId,
      OR: [
        { status: 'PENDING', requestExpiresAt: { gt: new Date() } },
        { status: 'APPROVED', revokedAt: null, approvedUntil: { gt: new Date() } },
      ],
    },
  });
  if (existing) {
    throw ApiError.conflict(
      existing.status === 'PENDING'
        ? 'A request is already waiting for this workspace to answer.'
        : 'Support access is already active for this workspace.',
    );
  }

  const grant = await prisma.impersonationGrant.create({
    data: {
      tenantId,
      requestedById: admin.id,
      reason: body.reason,
      requestExpiresAt: new Date(Date.now() + REQUEST_TTL_HOURS * 3_600_000),
    },
  });

  await audit(req, {
    action: 'impersonation.requested',
    tenantId,
    targetType: 'ImpersonationGrant',
    targetId: grant.id,
    summary: `Requested support access to ${tenant.businessName}`,
    metadata: { reason: body.reason },
  });

  logger.warn('Support access requested', {
    tenantId, grantId: grant.id, by: admin.email,
  });

  res.status(201).json({ success: true, data: grantView(grant) });
});

/** Where a request stands, from the operator's side. */
export const listImpersonation = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = requireId(req.params.tenantId, 'workspace');

  const grants = await prisma.impersonationGrant.findMany({
    where: { tenantId },
    orderBy: { createdAt: 'desc' },
    take: 25,
    include: {
      requestedBy: { select: { fullName: true, email: true } },
      respondedBy: { select: { fullName: true } },
      viewAsUser: { select: { fullName: true, email: true, phone: true } },
    },
  });

  res.json({ success: true, data: grants.map(grantView) });
});

/**
 * Exchange an approved grant for a short-lived read-only token.
 *
 * Mints rather than stores: the token lives for minutes inside a window measured
 * in hours, so the console asks again as it works and a leaked token is useful
 * briefly. The first exchange stamps `startedAt`, which is what the customer's
 * screen shows as "session began".
 */
export const startImpersonation = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = requireId(req.params.tenantId, 'workspace');
  const grantId = requireId(req.params.grantId, 'support request');
  const admin = adminOf(req);

  const grant = await prisma.impersonationGrant.findFirst({ where: { id: grantId, tenantId } });
  if (!grant) throw ApiError.notFound('Support request not found');

  // Only the operator who asked may use it. The workspace consented to a named
  // person, not to the company.
  if (grant.requestedById !== admin.id) {
    throw ApiError.forbidden('This access was granted to the engineer who requested it');
  }
  if (!grantUsable(grant)) {
    throw ApiError.forbidden(
      grant.revokedAt
        ? 'The workspace ended this session'
        : `This access is ${grant.status.toLowerCase()}`,
    );
  }

  const { token, expiresAt } = mintImpersonationToken(grant);

  const first = grant.startedAt === null;
  if (first) {
    await prisma.impersonationGrant.update({
      where: { id: grant.id },
      data: { startedAt: new Date() },
    });
    await audit(req, {
      action: 'impersonation.started',
      tenantId,
      targetType: 'ImpersonationGrant',
      targetId: grant.id,
      summary: `Started a read-only support session on ${tenantId}`,
      metadata: { approvedUntil: grant.approvedUntil?.toISOString() ?? null },
    });
    logger.warn('Support session started', { tenantId, grantId: grant.id, by: admin.email });
  }

  res.json({
    success: true,
    data: {
      token,
      tokenExpiresAt: expiresAt,
      approvedUntil: grant.approvedUntil,
      readOnly: true,
      viewAsUserId: grant.viewAsUserId,
    },
  });
});

/** End the session from this side — the courteous half of the contract. */
export const endImpersonation = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = requireId(req.params.tenantId, 'workspace');
  const grantId = requireId(req.params.grantId, 'support request');

  const grant = await prisma.impersonationGrant.findFirst({ where: { id: grantId, tenantId } });
  if (!grant) throw ApiError.notFound('Support request not found');
  if (grant.status !== 'APPROVED' || grant.revokedAt) {
    throw ApiError.badRequest('There is no active session to end');
  }

  await prisma.impersonationGrant.update({
    where: { id: grant.id },
    data: {
      status: 'REVOKED', revokedAt: new Date(), revokedBySelf: true,
    },
  });

  await audit(req, {
    action: 'impersonation.ended',
    tenantId,
    targetType: 'ImpersonationGrant',
    targetId: grant.id,
    summary: `Ended their support session after ${grant.requestCount} requests`,
    metadata: { requestCount: grant.requestCount, endedBy: 'engineer' },
  });

  res.json({ success: true });
});

// ── Business categories ───────────────────────────────────────────────────────
//
// The list of business kinds a workspace can pick, moved out of a Prisma enum so
// adding "Pharmacy" is an operator action rather than a migration and a deploy.
//
// `key` is what code matches on — workflow templates declare `suitedTo:
// ['RESTAURANT']` and the router prompt is given the category — so it is
// immutable after creation. The label is free to change.

/*
 * The topic list's ceiling, from the one place the limits live.
 *
 * Lines times characters plus the newlines between them — expressed rather than typed as a round
 * number, so raising the per-line cap cannot leave this silently inconsistent with the per-line
 * check the tenant API applies.
 */
const TOPICS_MAX_CHARS = ASSISTANT_COPY.topicLines * (ASSISTANT_COPY.topicLineChars + 1);

const categoryCreateSchema = z.object({
  key: z.string().trim().regex(/^[A-Z][A-Z0-9_]*$/, 'SCREAMING_SNAKE_CASE, starting with a letter').max(48),
  label: z.string().trim().min(2).max(80),
  description: z.string().trim().max(300).optional(),
  sortOrder: z.number().int().min(0).max(9999).default(100),
  /*
   * What this kind of business calls the things it sells, and one of them.
   *
   * Optional, and unset is a real answer: the app falls back to "Catalogue"/"Item", which is
   * generic rather than another category's word. Short caps because these render in a sidebar
   * entry and a tab, where a long word wraps and looks broken.
   */
  catalogueNoun: z.string().trim().min(2).max(24).nullish(),
  catalogueItemNoun: z.string().trim().min(2).max(24).nullish(),

  /*
   * Where a kind of business starts, before it has opinions.
   *
   * The assistant's persona and the topics it declines are the two pieces of copy that are
   * genuinely category-shaped, and every workspace on this category inherits them until it writes
   * its own — so improving one here improves every workspace that never did. Editing this changes
   * live behaviour for those workspaces, which is why it is audited like the rest of this screen.
   *
   * Unset is a real answer: the assistant falls back to house text that is bland but never wrong,
   * the same way an unset `catalogueNoun` reads "Catalogue" rather than "Menu".
   */
  defaultPersona: z.string().trim().max(ASSISTANT_COPY.personaChars).nullish(),
  defaultOutOfScopeTopics: z.string().trim().max(TOPICS_MAX_CHARS).nullish(),
});

const categoryUpdateSchema = z.object({
  label: z.string().trim().min(2).max(80).optional(),
  description: z.string().trim().max(300).nullish(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
  /*
   * What this kind of business calls the things it sells, and one of them.
   *
   * Optional, and unset is a real answer: the app falls back to "Catalogue"/"Item", which is
   * generic rather than another category's word. Short caps because these render in a sidebar
   * entry and a tab, where a long word wraps and looks broken.
   */
  catalogueNoun: z.string().trim().min(2).max(24).nullish(),
  catalogueItemNoun: z.string().trim().min(2).max(24).nullish(),

  /*
   * Where a kind of business starts, before it has opinions.
   *
   * The assistant's persona and the topics it declines are the two pieces of copy that are
   * genuinely category-shaped, and every workspace on this category inherits them until it writes
   * its own — so improving one here improves every workspace that never did. Editing this changes
   * live behaviour for those workspaces, which is why it is audited like the rest of this screen.
   *
   * Unset is a real answer: the assistant falls back to house text that is bland but never wrong,
   * the same way an unset `catalogueNoun` reads "Catalogue" rather than "Menu".
   */
  defaultPersona: z.string().trim().max(ASSISTANT_COPY.personaChars).nullish(),
  defaultOutOfScopeTopics: z.string().trim().max(TOPICS_MAX_CHARS).nullish(),

  isActive: z.boolean().optional(),
});

export const listBusinessCategories = asyncHandler(async (_req: Request, res: Response) => {
  const categories = await prisma.businessCategory.findMany({
    orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
    include: { _count: { select: { tenants: true } } },
  });

  res.json({
    success: true,
    data: categories.map((category) => ({
      id: category.id,
      key: category.key,
      label: category.label,
      description: category.description,
      sortOrder: category.sortOrder,
      catalogueNoun: category.catalogueNoun,
      catalogueItemNoun: category.catalogueItemNoun,
      defaultPersona: category.defaultPersona,
      defaultOutOfScopeTopics: category.defaultOutOfScopeTopics,
      isActive: category.isActive,
      workspaces: category._count.tenants,
      createdAt: category.createdAt,
    })),
  });
});

export const createBusinessCategory = asyncHandler(async (req: Request, res: Response) => {
  const body = categoryCreateSchema.parse(req.body);

  const clash = await prisma.businessCategory.findUnique({ where: { key: body.key } });
  if (clash) throw ApiError.conflict(`A category already uses the key "${body.key}"`);

  const category = await prisma.businessCategory.create({
    data: {
      key: body.key,
      label: body.label,
      description: body.description ?? null,
      sortOrder: body.sortOrder,
      catalogueNoun: body.catalogueNoun ?? null,
      catalogueItemNoun: body.catalogueItemNoun ?? null,
      defaultPersona: body.defaultPersona ?? null,
      defaultOutOfScopeTopics: body.defaultOutOfScopeTopics ?? null,
    },
  });

  await audit(req, {
    action: 'category.created',
    targetType: 'BusinessCategory',
    targetId: category.id,
    summary: `Added the business category "${category.label}" (${category.key})`,
    metadata: { ...body },
  });

  res.status(201).json({ success: true, data: category });
});

/**
 * Edit a category.
 *
 * `key` is deliberately not editable. Workflow templates match on it, so renaming
 * one silently stops every template being offered to the workspaces it was written
 * for — a failure with no error message anywhere.
 */
export const updateBusinessCategory = asyncHandler(async (req: Request, res: Response) => {
  const id = requireId(req.params.categoryId, 'category');
  const body = categoryUpdateSchema.parse(req.body);

  const existing = await prisma.businessCategory.findUnique({
    where: { id },
    include: { _count: { select: { tenants: true } } },
  });
  if (!existing) throw ApiError.notFound('Category not found');

  const category = await prisma.businessCategory.update({
    where: { id },
    data: {
      ...(body.label === undefined ? {} : { label: body.label }),
      ...(body.description === undefined ? {} : { description: body.description ?? null }),
      ...(body.sortOrder === undefined ? {} : { sortOrder: body.sortOrder }),
      ...(body.catalogueNoun === undefined ? {} : { catalogueNoun: body.catalogueNoun ?? null }),
      ...(body.catalogueItemNoun === undefined
        ? {} : { catalogueItemNoun: body.catalogueItemNoun ?? null }),
      ...(body.defaultPersona === undefined
        ? {} : { defaultPersona: body.defaultPersona ?? null }),
      ...(body.defaultOutOfScopeTopics === undefined
        ? {} : { defaultOutOfScopeTopics: body.defaultOutOfScopeTopics ?? null }),
      ...(body.isActive === undefined ? {} : { isActive: body.isActive }),
    },
  });

  await audit(req, {
    action: 'category.updated',
    targetType: 'BusinessCategory',
    targetId: category.id,
    summary: body.isActive === false
      ? `Hid the business category "${category.label}" from new signups`
      : `Updated the business category "${category.label}"`,
    metadata: { changes: body, workspaces: existing._count.tenants },
  });

  res.json({ success: true, data: category });
});

/**
 * Remove a category, but only one nothing is using.
 *
 * A category with workspaces on it is deactivated instead — deleting it would
 * null their `businessCategoryId` and quietly change which workflow templates
 * they are offered. Hiding it from new signups achieves the actual intent without
 * touching anyone already set up.
 */
export const deleteBusinessCategory = asyncHandler(async (req: Request, res: Response) => {
  const id = requireId(req.params.categoryId, 'category');

  const category = await prisma.businessCategory.findUnique({
    where: { id },
    include: { _count: { select: { tenants: true } } },
  });
  if (!category) throw ApiError.notFound('Category not found');

  if (category._count.tenants > 0) {
    throw ApiError.conflict(
      `${category._count.tenants} workspace${category._count.tenants === 1 ? ' is' : 's are'} on `
      + `"${category.label}". Hide it from new signups instead of deleting it.`,
    );
  }

  await prisma.businessCategory.delete({ where: { id } });

  await audit(req, {
    action: 'category.deleted',
    targetType: 'BusinessCategory',
    targetId: id,
    summary: `Deleted the unused business category "${category.label}"`,
  });

  res.json({ success: true });
});

// ── Connector types ───────────────────────────────────────────────────────────
//
// The catalog of outside systems ZunoPilot can reach, moved out of a `z.enum` so
// adding "Razorpay" is an operator action rather than a migration and a deploy.
// Same shape as business categories above, for the same reasons — including the
// two that matter most: `key` is immutable because a tenant's connector records
// which type it came from, and a type in use is deactivated rather than deleted.
//
// **Nothing here is a credential.** A type says how to authenticate, never with
// what; the tenant supplies the secret when they create the connector. That is
// what makes the whole row safe to serve to a tenant-facing endpoint.

const OPERATION_TEMPLATE_LIMIT = 40;

const connectorTypeCreateSchema = z.object({
  key: connectorKeySchema,
  label: z.string().trim().min(2).max(80),
  description: z.string().trim().max(500).optional(),
  kind: z.enum(CONNECTOR_KINDS).default('HTTP'),
  /// Empty means "offer them all", which is what a generic HTTP type wants.
  allowedAuthTypes: z.array(z.enum(CONNECTOR_AUTH_TYPES)).max(CONNECTOR_AUTH_TYPES.length).default([]),
  defaultBaseUrl: z.string().trim().max(500).optional(),
  secretLabel: z.string().trim().max(80).optional(),
  usernameLabel: z.string().trim().max(80).optional(),
  defaultHeader: z.string().trim().max(120).optional(),
  docsUrl: z.string().trim().max(500).optional(),
  sortOrder: z.number().int().min(0).max(9999).default(100),
});

/**
 * A partial update, restated with **no defaults** rather than derived with `.partial()`.
 *
 * `.partial()` does not suppress `.default()` — an absent key still parses to its creation
 * default, so every `!== undefined` guard below would be true and a request that only set
 * `isActive: false` would also write `kind: 'HTTP'`, `allowedAuthTypes: []` and
 * `sortOrder: 100`. Hiding a Google Sheets type would quietly turn it into an HTTP type
 * that accepts any credential. See the same note on `connectorUpdateSchema`.
 */
const connectorTypeUpdateSchema = z.object({
  label: z.string().trim().min(2).max(80).optional(),
  description: z.string().trim().max(500).nullish(),
  kind: z.enum(CONNECTOR_KINDS).optional(),
  allowedAuthTypes: z.array(z.enum(CONNECTOR_AUTH_TYPES)).max(CONNECTOR_AUTH_TYPES.length).optional(),
  defaultBaseUrl: z.string().trim().max(500).nullish(),
  secretLabel: z.string().trim().max(80).nullish(),
  usernameLabel: z.string().trim().max(80).nullish(),
  defaultHeader: z.string().trim().max(120).nullish(),
  docsUrl: z.string().trim().max(500).nullish(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
  isActive: z.boolean().optional(),
});

/** The template shape is the runtime shape, so a clone is a copy and not a translation. */
const templateCreateSchema = operationCreateSchema.extend({
  sortOrder: z.number().int().min(0).max(9999).default(100),
});

/** No defaults, for the reason given on `connectorTypeUpdateSchema`. */
const templateUpdateSchema = z.object({
  key: connectorKeySchema.optional(),
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(500).nullish(),
  method: z.enum(HTTP_METHODS).optional(),
  path: z.string().min(1).max(500).optional(),
  inputs: z.array(operationInputSchema).max(25).optional(),
  responseMapping: responseMappingSchema.optional(),
  sideEffecting: z.boolean().optional(),
  timeoutMs: z.number().int().min(100).max(30_000).nullish(),
  sampleResponse: z.unknown().nullish(),
  bodyTemplate: z.unknown().nullish(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
});

/**
 * A default base URL is checked here, not when a tenant uses it.
 *
 * The operator's suggestion is inherited by every tenant who picks the type, so a
 * type pointing at the metadata service would hand the same SSRF to all of them.
 * One review point, at the moment somebody is looking at the form.
 */
const checkDefaultBaseUrl = (url: string | null | undefined) => {
  if (!url) return;
  try {
    assertUrlAllowed(url);
  } catch (err) {
    if (err instanceof EgressBlockedError) throw ApiError.badRequest(err.message);
    throw err;
  }
};

const templateSelect = {
  id: true,
  key: true,
  name: true,
  description: true,
  method: true,
  path: true,
  inputs: true,
  responseMapping: true,
  sideEffecting: true,
  timeoutMs: true,
  sampleResponse: true,
  bodyTemplate: true,
  sortOrder: true,
} as const;

const connectorTypeOf = async (typeId: string) => {
  const type = await prisma.connectorType.findUnique({
    where: { id: typeId },
    include: { _count: { select: { connectors: true } } },
  });
  if (!type) throw ApiError.notFound('Connector type not found');
  return type;
};

export const listConnectorTypes = asyncHandler(async (_req: Request, res: Response) => {
  const types = await prisma.connectorType.findMany({
    orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
    include: {
      _count: { select: { connectors: true } },
      operationTemplates: {
        select: templateSelect,
        orderBy: [{ sortOrder: 'asc' }, { key: 'asc' }],
      },
    },
  });

  res.json({
    success: true,
    data: types.map(({ _count, ...type }) => ({
      ...type,
      // How many tenant connectors are on this type. The operator needs it before
      // touching a row — deactivating one nobody uses is housekeeping, and
      // deactivating one forty workspaces use is a decision.
      connectors: _count.connectors,
    })),
  });
});

export const createConnectorType = asyncHandler(async (req: Request, res: Response) => {
  const body = connectorTypeCreateSchema.parse(req.body);
  checkDefaultBaseUrl(body.defaultBaseUrl);

  const clash = await prisma.connectorType.findUnique({ where: { key: body.key } });
  if (clash) throw ApiError.conflict(`A connector type already uses the key "${body.key}"`);

  const type = await prisma.connectorType.create({
    data: {
      key: body.key,
      label: body.label,
      description: body.description ?? null,
      kind: body.kind,
      allowedAuthTypes: body.allowedAuthTypes,
      defaultBaseUrl: body.defaultBaseUrl ?? null,
      secretLabel: body.secretLabel ?? null,
      usernameLabel: body.usernameLabel ?? null,
      defaultHeader: body.defaultHeader ?? null,
      docsUrl: body.docsUrl ?? null,
      sortOrder: body.sortOrder,
    },
  });

  await audit(req, {
    action: 'connector_type.created',
    targetType: 'ConnectorType',
    targetId: type.id,
    summary: `Added the connector type "${type.label}" (${type.key})`,
    metadata: { ...body },
  });

  res.status(201).json({ success: true, data: type });
});

/**
 * Edit a type.
 *
 * `key` is deliberately absent from the update schema. A tenant's connector stores
 * `connectorTypeId`, and the seed and any future template library match on the key —
 * renaming one would break that link with no error message anywhere, which is the
 * same argument the business categories make.
 */
export const updateConnectorType = asyncHandler(async (req: Request, res: Response) => {
  const id = requireId(req.params.typeId, 'connector type');
  const body = connectorTypeUpdateSchema.parse(req.body);
  const existing = await connectorTypeOf(id);
  checkDefaultBaseUrl(body.defaultBaseUrl);

  const type = await prisma.connectorType.update({
    where: { id },
    data: {
      ...(body.label !== undefined ? { label: body.label } : {}),
      ...(body.description !== undefined ? { description: body.description ?? null } : {}),
      ...(body.kind !== undefined ? { kind: body.kind } : {}),
      ...(body.allowedAuthTypes !== undefined ? { allowedAuthTypes: body.allowedAuthTypes } : {}),
      ...(body.defaultBaseUrl !== undefined ? { defaultBaseUrl: body.defaultBaseUrl ?? null } : {}),
      ...(body.secretLabel !== undefined ? { secretLabel: body.secretLabel ?? null } : {}),
      ...(body.usernameLabel !== undefined ? { usernameLabel: body.usernameLabel ?? null } : {}),
      ...(body.defaultHeader !== undefined ? { defaultHeader: body.defaultHeader ?? null } : {}),
      ...(body.docsUrl !== undefined ? { docsUrl: body.docsUrl ?? null } : {}),
      ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
      ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
    },
  });

  await audit(req, {
    action: 'connector_type.updated',
    targetType: 'ConnectorType',
    targetId: type.id,
    summary: body.isActive === false
      ? `Hid the connector type "${type.label}" from new connections`
      : `Updated the connector type "${type.label}"`,
    metadata: { changes: body, connectors: existing._count.connectors },
  });

  res.json({ success: true, data: type });
});

/**
 * Remove a type, but only one nothing is using.
 *
 * The foreign key is `SET NULL`, so a forced delete would not break the connectors on
 * it — but it would erase which type they came from and make this very list lie about
 * how many are in use. Hiding it from new connections achieves the actual intent.
 */
export const deleteConnectorType = asyncHandler(async (req: Request, res: Response) => {
  const id = requireId(req.params.typeId, 'connector type');
  const type = await connectorTypeOf(id);

  if (type._count.connectors > 0) {
    throw ApiError.conflict(
      `${type._count.connectors} connector${type._count.connectors === 1 ? ' is' : 's are'} on `
      + `"${type.label}". Hide it from new connections instead of deleting it.`,
    );
  }

  await prisma.connectorType.delete({ where: { id } });

  await audit(req, {
    action: 'connector_type.deleted',
    targetType: 'ConnectorType',
    targetId: id,
    summary: `Deleted the unused connector type "${type.label}"`,
  });

  res.json({ success: true });
});

// ── Operation templates ───────────────────────────────────────────────────────

export const createConnectorTypeOperation = asyncHandler(async (req: Request, res: Response) => {
  const typeId = requireId(req.params.typeId, 'connector type');
  const body = templateCreateSchema.parse(req.body);
  const type = await connectorTypeOf(typeId);

  const count = await prisma.connectorTypeOperation.count({ where: { connectorTypeId: typeId } });
  if (count >= OPERATION_TEMPLATE_LIMIT) {
    throw ApiError.badRequest(
      `A connector type holds at most ${OPERATION_TEMPLATE_LIMIT} operations. `
      + 'Every one is copied into each tenant who connects.',
    );
  }

  try {
    const template = await prisma.connectorTypeOperation.create({
      data: {
        connectorTypeId: typeId,
        key: body.key,
        name: body.name,
        description: body.description ?? null,
        method: body.method,
        path: body.path,
        inputs: body.inputs as Prisma.InputJsonValue,
        responseMapping: body.responseMapping as Prisma.InputJsonValue,
        sideEffecting: body.sideEffecting,
        timeoutMs: body.timeoutMs ?? null,
        sampleResponse: (body.sampleResponse ?? null) as Prisma.InputJsonValue,
        bodyTemplate: (body.bodyTemplate ?? null) as Prisma.InputJsonValue,
        sortOrder: body.sortOrder,
      },
      select: templateSelect,
    });

    await audit(req, {
      action: 'connector_type.operation_added',
      targetType: 'ConnectorType',
      targetId: typeId,
      summary: `Added the operation "${body.key}" to the connector type "${type.label}"`,
      metadata: { operationKey: body.key, method: body.method, sideEffecting: body.sideEffecting },
    });

    res.status(201).json({ success: true, data: template });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw ApiError.conflict(`"${type.label}" already has an operation keyed "${body.key}"`);
    }
    throw err;
  }
});

/** Scoped through the type, so an operation id from another type cannot be edited. */
const templateOf = async (typeId: string, operationId: string) => {
  const template = await prisma.connectorTypeOperation.findFirst({
    where: { id: operationId, connectorTypeId: typeId },
  });
  if (!template) throw ApiError.notFound('Operation not found');
  return template;
};

export const updateConnectorTypeOperation = asyncHandler(async (req: Request, res: Response) => {
  const typeId = requireId(req.params.typeId, 'connector type');
  const operationId = requireId(req.params.operationId, 'operation');
  const body = templateUpdateSchema.parse(req.body);
  const type = await connectorTypeOf(typeId);
  const existing = await templateOf(typeId, operationId);

  const template = await prisma.connectorTypeOperation.update({
    where: { id: existing.id },
    data: {
      ...(body.key !== undefined ? { key: body.key } : {}),
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.description !== undefined ? { description: body.description ?? null } : {}),
      ...(body.method !== undefined ? { method: body.method } : {}),
      ...(body.path !== undefined ? { path: body.path } : {}),
      ...(body.inputs !== undefined ? { inputs: body.inputs as Prisma.InputJsonValue } : {}),
      ...(body.responseMapping !== undefined
        ? { responseMapping: body.responseMapping as Prisma.InputJsonValue }
        : {}),
      ...(body.sideEffecting !== undefined ? { sideEffecting: body.sideEffecting } : {}),
      ...(body.timeoutMs !== undefined ? { timeoutMs: body.timeoutMs ?? null } : {}),
      ...(body.sampleResponse !== undefined
        ? { sampleResponse: (body.sampleResponse ?? null) as Prisma.InputJsonValue }
        : {}),
      ...(body.bodyTemplate !== undefined
        ? { bodyTemplate: (body.bodyTemplate ?? null) as Prisma.InputJsonValue }
        : {}),
      ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
    },
    select: templateSelect,
  });

  await audit(req, {
    action: 'connector_type.operation_updated',
    targetType: 'ConnectorType',
    targetId: typeId,
    // Says plainly that this does not reach anyone already connected — the clone is a
    // one-time snapshot, so an edit here only changes what future tenants receive.
    summary: `Updated the operation "${template.key}" on "${type.label}" `
      + '(applies to new connections only)',
    metadata: { operationId, changes: body, connectors: type._count.connectors },
  });

  res.json({ success: true, data: template });
});

export const deleteConnectorTypeOperation = asyncHandler(async (req: Request, res: Response) => {
  const typeId = requireId(req.params.typeId, 'connector type');
  const operationId = requireId(req.params.operationId, 'operation');
  const type = await connectorTypeOf(typeId);
  const template = await templateOf(typeId, operationId);

  await prisma.connectorTypeOperation.delete({ where: { id: template.id } });

  await audit(req, {
    action: 'connector_type.operation_deleted',
    targetType: 'ConnectorType',
    targetId: typeId,
    summary: `Removed the operation "${template.key}" from "${type.label}" `
      + '(tenants already connected keep their copy)',
    metadata: { operationKey: template.key, connectors: type._count.connectors },
  });

  res.json({ success: true });
});
