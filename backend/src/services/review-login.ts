import { logger } from '../config/logger.js';

// The one account that can sign in without receiving an SMS.
//
// **Why this exists.** Sign-in is phone + OTP over a real SMS gateway. An Apple or Google
// reviewer has neither the handset nor the number, so they are given credentials in the
// store's review notes and expect them to work. Without this, submission fails on "unable
// to sign in", which is among the most common review rejections there is.
//
// **This is an authentication bypass, and the whole file is about its blast radius.** Its
// own module rather than a branch inside `otp.service.ts` for one reason: "what can log in
// without a code being sent" should be a question `grep` answers with a filename.
//
// Three properties do the work:
//
//   1. **Off unless fully configured.** A half-set pair is the dangerous state — an empty
//      `PRODOTPFORTEST` must never mean "an empty code is accepted".
//   2. **Exactly one number.** No wildcards, no prefixes, no "starts with".
//   3. **Nothing else is relaxed.** The caller still writes an ordinary challenge with the
//      code hashed, so the attempt cap, single-use consumption, expiry and the hourly
//      limiter all apply unchanged. `verifyOtp` is not involved and does not know this
//      exists.

/**
 * The same rule the API applies to a submitted code (`auth.controller.ts`).
 *
 * Checked here too, because a configured code the endpoint would reject is a bypass that
 * silently does not work — discovered during review, which is the worst possible time.
 */
const CODE_SHAPE = /^\d{4,8}$/;

/** India's calling code. The configured number may omit it; see `expectedPhones`. */
const IN = '91';

interface ReviewAccount {
  /** Every form of the number that should match, as `normalisePhone` would produce it. */
  phones: string[];
  code: string;
}

/**
 * Read and validate the pair, or `null` when the feature is off.
 *
 * Read from `process.env` at the point of use rather than from the `config/env.ts`
 * snapshot, for the reason that has bitten this codebase five times: the snapshot is taken
 * at import, so a value changed afterwards keeps reading as the old one.
 *
 * Misconfiguration logs and returns `null` rather than throwing. A bad pair must not stop
 * the server booting or break login for everybody else — but it must not half-work either.
 */
const account = (): ReviewAccount | null => {
  const number = process.env.PRODOTPTESTNUMBER?.trim();
  const code = process.env.PRODOTPFORTEST?.trim();

  // Neither set is the normal case — the feature is simply not in use here. Silent.
  if (!number && !code) return null;

  // One set without the other is a mistake worth saying out loud.
  if (!number || !code) {
    logger.error(
      'The app-review login is half-configured and is therefore DISABLED. '
      + 'Set both PRODOTPTESTNUMBER and PRODOTPFORTEST, or neither.',
      { hasNumber: Boolean(number), hasCode: Boolean(code) },
    );
    return null;
  }

  if (!CODE_SHAPE.test(code)) {
    // Never log the code itself, even when rejecting it — only its shape.
    logger.error(
      'PRODOTPFORTEST is not 4 to 8 digits, so the app-review login is DISABLED. '
      + 'The verify endpoint would reject it anyway.',
      { length: code.length },
    );
    return null;
  }

  const digits = number.replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 15) {
    logger.error(
      'PRODOTPTESTNUMBER is not a usable number, so the app-review login is DISABLED.',
      { length: digits.length },
    );
    return null;
  }

  return { phones: expectedPhones(digits), code };
};

/**
 * Which stored forms of the configured number should match.
 *
 * **Why more than one.** `normalisePhone` strips non-digits and adds nothing, so what
 * arrives depends on what was typed: the app's country picker supplies `+91` and produces
 * `91` + ten digits, while a bare ten-digit entry stays ten digits. The configured value
 * is ten digits — the national part — so both have to resolve or the reviewer's login
 * depends on which field they happened to use.
 *
 * A value that already carries a country code is used as-is and nothing is prepended.
 */
const expectedPhones = (digits: string): string[] =>
  (digits.length === 10 ? [digits, `${IN}${digits}`] : [digits]);

/**
 * The fixed code for this number, or `null` for every other number.
 *
 * An exact match against a small list — never a prefix or substring test, so a number that
 * merely *contains* the configured digits (`919912345678` inside `1919912345678`) does not
 * match.
 */
export const reviewCodeFor = (phone: string): string | null => {
  const configured = account();
  if (!configured) return null;
  return configured.phones.includes(phone) ? configured.code : null;
};

/** Whether the review login is configured at all. For a boot-time log line. */
export const reviewLoginConfigured = (): boolean => account() !== null;

/**
 * The numbers the review login answers to, for a boot-time log line.
 *
 * Exposed so the resolved E.164 can be confirmed *before* submitting to a store, rather
 * than finding out from a rejection that the reviewer was typing a form we never matched.
 * Never exposes the code.
 */
export const reviewLoginPhones = (): string[] => account()?.phones ?? [];
