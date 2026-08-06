import type { ModuleKey } from '@prisma/client';
import { prisma } from '../../config/prisma.js';

// Which optional modules a workspace has.
//
// Marketing, Leads and Customer Support are sold and rolled out per workspace
// rather than shipped to everyone on deploy, so each one is a switch an operator
// throws in the super admin console.
//
// **One function is the authority.** Every gate — the middleware, the session
// payload, the nav — reads `moduleStateFor`. A second place that decides whether
// Leads is on is a second place that can disagree with the first, and the
// disagreement always surfaces as "the menu is there but the page 404s".

export const MODULE_KEYS = ['MARKETING', 'LEADS', 'SUPPORT', 'AI_AGENT', 'ECOMMERCE'] as const;

export type ModuleState = Record<ModuleKey, boolean>;

/**
 * The default before any operator has said anything.
 *
 * **Off for the add-ons.** A workspace opts in; it never opts out. That direction is
 * deliberate. A bug that fails to enable a module leaves a customer without something they
 * were promised, and they tell us within the hour. A bug that fails to *disable* one silently
 * hands every workspace on the platform a module nobody sold them, and nothing surfaces it.
 *
 * **On for `AI_AGENT` and `ECOMMERCE`, which invert that reasoning rather than ignoring it.**
 * Neither is an add-on nobody has yet: the agent is already answering customers in every
 * workspace, and every workspace can already see Orders and Menu. Off-by-default would mute or
 * strip all of them the moment this deploys, which is exactly the "silently hands/takes away"
 * failure the rule above exists to prevent, pointing the other way. These are capabilities that
 * get revoked, not ones that get granted.
 *
 * Expressed here rather than as backfilled rows in the migration on purpose: rows would only
 * cover the workspaces that existed when it ran, and every future signup would arrive with no
 * agent and no obvious reason why.
 *
 * This is also the seam for plan-driven defaults. If these ever become a paid
 * tier, the plan's entitlement is read here and the tenant's own row keeps
 * overriding it — exactly how `seatLimitOverride` already layers over the plan.
 * No call site changes.
 */
const defaultState = (): ModuleState => ({
  MARKETING: false,
  LEADS: false,
  SUPPORT: false,
  AI_AGENT: true,
  ECOMMERCE: true,
});

/** Every module's state for one workspace. */
export const moduleStateFor = async (tenantId: string): Promise<ModuleState> => {
  const rows = await prisma.tenantModule.findMany({
    where: { tenantId },
    select: { module: true, enabled: true },
  });

  const state = defaultState();
  for (const row of rows) state[row.module] = row.enabled;
  return state;
};

/** Whether one module is on. */
export const moduleEnabled = async (tenantId: string, module: ModuleKey): Promise<boolean> => {
  const row = await prisma.tenantModule.findUnique({
    where: { tenantId_module: { tenantId, module } },
    select: { enabled: true },
  });
  return row?.enabled ?? defaultState()[module];
};

/** The enabled ones, for the session payload the client filters its nav on. */
export const enabledModulesFor = async (tenantId: string): Promise<ModuleKey[]> => {
  const state = await moduleStateFor(tenantId);
  return MODULE_KEYS.filter((key) => state[key]);
};

/** Why the AI agent is off, when it is. */
export type AiAgentDenial = 'DISABLED_BY_OPERATOR' | 'DISABLED_BY_OWNER';

export type AiAgentGate =
  | { allowed: true }
  | { allowed: false; reason: AiAgentDenial };

/**
 * Whether this workspace may make an LLM call at all.
 *
 * **Both halves must agree.** The `AI_AGENT` module is the operator's ceiling — only the super
 * admin console writes it — and `Tenant.aiAgentEnabled` is the workspace's own preference. Off
 * at either level means no model is reached.
 *
 * The operator is checked first, so `DISABLED_BY_OPERATOR` wins when both are off. That
 * ordering is the point rather than an accident: the owner's Settings page uses this reason to
 * decide whether to say "your plan does not include this" or "you turned this off", and telling
 * someone they turned off a thing they were never allowed to have is a confusing way to answer
 * a support ticket.
 *
 * Two queries, not one join, because `moduleEnabled` is the single authority on module state
 * (see the note at the top of this file) and going around it is how the menu ends up disagreeing
 * with the page. Both are indexed point lookups; the caching seam, if this ever needs one, is
 * the same one the rest of the hot path wants.
 */
export const aiAgentGate = async (tenantId: string): Promise<AiAgentGate> => {
  if (!await moduleEnabled(tenantId, 'AI_AGENT')) {
    return { allowed: false, reason: 'DISABLED_BY_OPERATOR' };
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { aiAgentEnabled: true },
  });
  // A tenant that no longer exists gets no model call. Reached only in a race between deletion
  // and an in-flight message, and refusing is the cheaper mistake.
  if (!tenant?.aiAgentEnabled) return { allowed: false, reason: 'DISABLED_BY_OWNER' };

  return { allowed: true };
};

export interface ModuleSetting {
  module: ModuleKey;
  enabled: boolean;
  note: string | null;
  updatedByAdminId: string | null;
  updatedAt: Date | null;
}

/**
 * Every module with its current setting, including the ones never configured.
 *
 * For the operator console, which has to render a switch for each module rather
 * than only for the rows that happen to exist.
 */
export const moduleSettingsFor = async (tenantId: string): Promise<ModuleSetting[]> => {
  const rows = await prisma.tenantModule.findMany({ where: { tenantId } });
  const byKey = new Map(rows.map((row) => [row.module, row]));

  return MODULE_KEYS.map((module) => {
    const row = byKey.get(module);
    return {
      module,
      enabled: row?.enabled ?? defaultState()[module],
      note: row?.note ?? null,
      updatedByAdminId: row?.updatedByAdminId ?? null,
      updatedAt: row?.updatedAt ?? null,
    };
  });
};

/**
 * Turn a module on or off.
 *
 * An upsert on the compound unique, so flipping the same switch twice cannot
 * leave two rows disagreeing about one module. Only the super admin surface
 * calls this — there is deliberately no customer-facing route that grants a
 * workspace a module.
 */
export const setModuleEnabled = async ({ tenantId, module, enabled, note, superAdminId }: {
  tenantId: string;
  module: ModuleKey;
  enabled: boolean;
  note?: string | null;
  superAdminId: string;
}): Promise<ModuleSetting> => {
  const row = await prisma.tenantModule.upsert({
    where: { tenantId_module: { tenantId, module } },
    update: { enabled, note: note ?? null, updatedByAdminId: superAdminId },
    create: { tenantId, module, enabled, note: note ?? null, updatedByAdminId: superAdminId },
  });

  return {
    module: row.module,
    enabled: row.enabled,
    note: row.note,
    updatedByAdminId: row.updatedByAdminId,
    updatedAt: row.updatedAt,
  };
};
