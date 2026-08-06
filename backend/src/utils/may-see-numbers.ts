import { prisma } from '../config/prisma.js';
import { holds, tenantIdOf } from '../middleware/auth.js';

// May this request see real customer phone numbers?
//
// Its own module rather than a helper inside one controller, because **eight endpoints**
// across five files need the same answer, and the one thing that must not happen is two of
// them computing it differently. The shape deliberately mirrors `maySeeLeads` in
// `customer.controller.ts`: read the permission off the request, read the workspace's switch
// from the database, combine.
//
// **Order matters for cost.** The permission check is free and settles the common case — an
// owner, or any workspace that has never turned masking on. The tenant read only happens
// for someone who lacks the permission.

/**
 * True when this caller may see full numbers.
 *
 * Two ways to be true:
 *
 *   • **The permission.** `customers:view_full_number` is on the OWNER role, and `isOwner`
 *     roles resolve to every permission — so owners always qualify without a query.
 *   • **The switch is off.** With `maskCustomerNumbers` false nobody is masked, which is
 *     every existing workspace until someone turns it on.
 *
 * A missing tenant returns `false`, the safe direction: if we cannot establish that masking
 * is off, do not reveal.
 */
export const maySeeFullNumbers = async (
  req: Parameters<typeof tenantIdOf>[0],
): Promise<boolean> => {
  if (holds(req, 'customers:view_full_number')) return true;

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantIdOf(req) },
    select: { maskCustomerNumbers: true },
  });
  if (!tenant) return false;

  return !tenant.maskCustomerNumbers;
};

/**
 * The shortest number of digits a masked caller may search on.
 *
 * Search stays available deliberately — an agent typing a number a customer has just read
 * out is confirming, not discovering, and taking it away makes the Inbox painful. But an
 * unbounded `contains` is an oracle: try `1`, then `12`, and reconstruct a number a digit at
 * a time from which results come back.
 *
 * Six digits means a query already carries most of a number, so it can confirm one and
 * cannot find one. Callers who may see full numbers are not limited.
 */
export const MIN_MASKED_SEARCH_DIGITS = 6;

/**
 * Should this search be refused as too short to be a confirmation?
 *
 * Returns true only for a *numeric* query below the threshold — searching a name is
 * unaffected, and so is a query that merely contains a few digits alongside letters.
 */
export const isTooShortToSearch = (search: string, seeFull: boolean): boolean => {
  if (seeFull) return false;
  const digits = search.replace(/\D/g, '');
  // No digits at all: a name search, which masking has no opinion about.
  if (!digits) return false;
  // Digits present but the query is mostly letters — treat it as a name, not a number probe.
  const looksNumeric = digits.length >= search.trim().length - 2;
  return looksNumeric && digits.length < MIN_MASKED_SEARCH_DIGITS;
};
