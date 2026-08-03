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

export const MODULE_KEYS = ['MARKETING', 'LEADS', 'SUPPORT'] as const;

export type ModuleState = Record<ModuleKey, boolean>;

/**
 * The default before any operator has said anything: **everything off**.
 *
 * A workspace opts in; it never opts out. That direction is deliberate. A bug
 * that fails to enable a module leaves a customer without something they were
 * promised, and they tell us within the hour. A bug that fails to *disable* one
 * silently hands every workspace on the platform a module nobody sold them, and
 * nothing surfaces it.
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
