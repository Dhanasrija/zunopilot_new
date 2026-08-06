import { parsePhoneNumberFromString } from 'libphonenumber-js/min';

// A WhatsApp id, minus its country code.
//
// **Why this exists.** A `waId` is always the full international number without the plus —
// `917702000350`. Plenty of local APIs key on the national part alone: a school system that
// stores `7702000350` returns nothing for the prefixed form, and does so with a 200, so the
// workflow reads it as "this parent has no children" rather than as a failure. Until now
// there was no way to express the national part in a workflow: `{{path}}` is a whitelisted
// dotted lookup with no filters, so "the last ten digits" was simply unsayable.
//
// **Why not strip a leading "91".** Because dialling codes are one, two or three digits and
// two countries share some of them. `normalisePhone` in `otp.service.ts` refuses to guess a
// region for exactly this reason — "a 'helpful' default is how someone ends up signing in as
// a stranger who happens to share their local number" — and the same argument applies here
// with a different victim: guess wrong and a workflow asks someone else's API about someone
// else's customer. So the split comes from real metadata, not a prefix rule.

/**
 * The national part of a stored WhatsApp id, or `''` when it cannot be determined.
 *
 * Empty rather than a fallback to the full number, deliberately. A required path input that
 * resolves to `''` is treated as absent and the call is refused with `MISSING_INPUT` — a loud
 * failure in the execution log. Falling back to the prefixed number would instead send a
 * request that looks fine and quietly matches nobody, which is the exact bug this solves.
 */
// Fail at boot, not per call.
//
// The `catch` below exists so a malformed stored number cannot stop a workflow — but it
// swallowed a *missing dependency* just as quietly, reporting every number as unparseable and
// costing an afternoon of looking in the wrong place. A resolution problem is not a bad phone
// number, so it is checked once here where the answer is unambiguous.
if (typeof parsePhoneNumberFromString !== 'function') {
  throw new Error('libphonenumber-js/min did not resolve — customer.localNumber cannot be derived');
}

export const localNumberOf = (waId: string | null | undefined): string => {
  const digits = (waId ?? '').replace(/\D/g, '');
  if (!digits) return '';

  try {
    const parsed = parsePhoneNumberFromString(`+${digits}`);
    if (!parsed?.country) return '';
    // **Valid, not merely parseable** — the same trap the country picker hit. A number
    // already stored without its code still parses: ten bare digits beginning 77 come back
    // as Kazakhstan, because `+7` is Russia and Kazakhstan. Returning a "national part" for
    // that misread would hand an API a number with digits missing from the front.
    if (!parsed.isValid()) return '';
    return parsed.nationalNumber;
  } catch {
    // Malformed input is a `''`, never a throw: this runs while building the scope for
    // every node of every conversation, and a bad stored number must not stop a workflow.
    return '';
  }
};
