import { prisma } from '../../config/prisma.js';
import { ApiError } from '../../utils/ApiError.js';
import { entitlementsFor, type ResolvedEntitlements } from './billing.service.js';
import type { Entitlements } from './catalogue.js';
import { countSeats } from '../../services/membership.service.js';

// Enforcing what a plan allows.
//
// Checked at the point of use rather than as middleware, because the question
// is always "would this *particular* action exceed the limit", and only the
// handler knows what is about to be created.
//
// Two deliberate choices about how limits behave:
//
//   • **A limit blocks the next one, it never removes what exists.** A
//     workspace that downgrades from 20 seats to 5 keeps its 20 people; it just
//     cannot add a 21st. Silently deactivating fifteen colleagues because a
//     card was downgraded would be indefensible.
//   • **The error says the number and the plan.** "Limit reached" makes someone
//     open a support ticket; "Your Starter plan includes 2 team members" tells
//     them what to do next.

export class PlanLimitError extends ApiError {
  constructor(message: string) {
    super(402, message);
    this.name = 'PlanLimitError';
  }
}

const LIMIT_COPY: Record<keyof Omit<Entitlements, 'features' | 'support'>, {
  noun: string;
  verb: string;
}> = {
  teamMembers: { noun: 'team members', verb: 'add another team member' },
  whatsappNumbers: { noun: 'WhatsApp numbers', verb: 'connect another WhatsApp number' },
  activeAutomations: { noun: 'active automations', verb: 'publish another automation' },
  aiInteractionsPerMonth: { noun: 'AI interactions per month', verb: 'use more AI' },
};

/**
 * Refuse an action that would take a workspace past its limit.
 *
 * `current` is what exists now; the check is whether `current + 1` fits, so it
 * is called *before* creating the thing.
 */
export const assertWithinLimit = (
  entitlements: ResolvedEntitlements,
  key: keyof typeof LIMIT_COPY,
  current: number,
): void => {
  const limit = entitlements[key];
  if (limit === null) return; // unlimited
  if (current < limit) return;

  const copy = LIMIT_COPY[key];
  throw new PlanLimitError(
    `Your ${entitlements.planName} plan includes ${limit} ${copy.noun}. `
    + `Upgrade to ${copy.verb}.`,
  );
};

/** A feature the plan does not include. */
export const assertFeature = (
  entitlements: ResolvedEntitlements,
  feature: keyof Entitlements['features'],
  label: string,
): void => {
  if (entitlements.features[feature]) return;
  throw new PlanLimitError(
    `${label} is not included in your ${entitlements.planName} plan. Upgrade to use it.`,
  );
};

// ── The four counted resources ───────────────────────────────────────────────

export const assertCanAddTeamMember = async (tenantId: string): Promise<void> => {
  const [entitlements, current] = await Promise.all([
    entitlementsFor(tenantId),
    // The same call the billing page makes to *display* this number. Written twice, the meter
    // and the gate eventually disagree — a workspace told it has room and then refused.
    countSeats(tenantId),
  ]);
  assertWithinLimit(entitlements, 'teamMembers', current);
};

export const assertCanAddWhatsappNumber = async (tenantId: string): Promise<void> => {
  const [entitlements, current] = await Promise.all([
    entitlementsFor(tenantId),
    prisma.whatsappAccount.count({ where: { tenantId } }),
  ]);
  assertWithinLimit(entitlements, 'whatsappNumbers', current);
};

/**
 * An "active automation" is a published workflow.
 *
 * A draft costs nothing and is not counted — otherwise a plan limit would stop
 * someone *designing*, which is the opposite of what a trial should do.
 */
export const assertCanPublishAutomation = async (
  tenantId: string,
  workflowId?: string,
): Promise<void> => {
  const entitlements = await entitlementsFor(tenantId);
  if (entitlements.activeAutomations === null) return;

  const current = await prisma.workflow.count({
    where: {
      tenantId,
      status: 'PUBLISHED',
      // Re-publishing something already published is not a new automation.
      ...(workflowId ? { id: { not: workflowId } } : {}),
    },
  });
  assertWithinLimit(entitlements, 'activeAutomations', current);
};

export const assertFeatureAvailable = async (
  tenantId: string,
  feature: keyof Entitlements['features'],
  label: string,
): Promise<void> => {
  assertFeature(await entitlementsFor(tenantId), feature, label);
};
