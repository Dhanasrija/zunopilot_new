import { logger } from '../config/logger.js';

// Sending an OTP by SMS, through TextSpeed (mTouch Labs).
//
// **The message text is not ours to edit.** India's DLT regime registers the exact
// body against `templateid`, and the operator rejects anything that does not match the
// registered wording — so `OTP_TEMPLATE` below is a fixed string with one substitution,
// not a message someone should improve. Changing a comma here means every login SMS
// silently stops being delivered, with a success-looking response from the gateway.
//
// That is also why the ten minutes is written twice: once in the SMS the customer
// reads, and once in `TTL_MINUTES` in `otp.service.ts`. `assertTemplateMatchesTtl`
// exists so those two can never drift, because the failure mode is a code that expires
// while the message the customer is reading says it has not.
//
// **India only.** TextSpeed is a domestic gateway with a domestic sender id, so a
// non-Indian number cannot be delivered to. `canSendTo` is checked before spending a
// request, and the caller is told plainly rather than being handed a gateway error it
// cannot interpret.

const ENDPOINT = 'https://sms.textspeed.in/vb/apikey.php';

/**
 * Registered against the DLT template id. Do not reword — see the note above.
 *
 * **The trailing " From mTouch Labs" is part of the registered content**, not a
 * signature this code adds for politeness. Indian DLT templates commonly end with the
 * registered entity's name, and it counts toward the byte-exact match the operator
 * performs.
 *
 * It was omitted on the first attempt and the symptom is worth recording, because it is
 * indistinguishable from success at every layer we can see: TextSpeed returned
 * `{"status":"Success","code":"011"}` with a message id, charged a credit, and the
 * handset received nothing. Two sends were billed before the cause was found. If a code
 * ever stops arriving again, diff this string against the DLT portal first.
 */
const OTP_TEMPLATE = 'Your ZunoPilot verification code is <OTP>. This code is valid for '
  + '10 minutes. Do not share this code with anyone. From mTouch Labs';

/** The DLT template id this body is registered under. */
const TEMPLATE_ID = '1277178558983059679';

/** The approved sender id. Six characters, assigned by the operator. */
const SENDER_ID = 'ZUNOPI';

/** What the template promises. Kept beside the text it comes from. */
export const OTP_TEMPLATE_VALIDITY_MINUTES = 10;

/**
 * The gateway's timeout.
 *
 * A person is watching a spinner on the login screen, so this is short. A slow SMS is
 * still worth having, but a request that hangs for thirty seconds is a login that looks
 * broken — better to fail and let them press resend.
 */
const TIMEOUT_MS = Number(process.env.SMS_TIMEOUT_MS ?? 8_000);

/**
 * The API key, read from `process.env` at the point of use.
 *
 * **No fallback to the `config/env.ts` snapshot, deliberately.** That snapshot is taken
 * at import, so a rotated key would keep reading as the old one — the trap this codebase
 * has hit five times. And no fallback to any *other* secret: a key that silently became
 * something else would fail every login with an authentication error nobody would trace
 * back to here.
 */
const apiKey = (): string | null => process.env.TEXTSPEEDAPIKEY?.trim() || null;

/** Is a real SMS gateway configured? */
export const smsConfigured = (): boolean => apiKey() !== null;

/**
 * Can this number be reached by this gateway?
 *
 * `phone` is E.164 digits without the plus, as `normalisePhone` produces. Indian
 * numbers are `91` + ten digits; anything else — including the reserved `+1 555` range
 * the seeds and the webhook helper use — is not deliverable here.
 */
export const canSendTo = (phone: string): boolean => /^91\d{10}$/.test(phone);

export class SmsSendError extends Error {
  constructor(message: string, readonly detail?: string) {
    super(message);
    this.name = 'SmsSendError';
  }
}

/**
 * Guard against the SMS and the expiry disagreeing.
 *
 * Called once when a send is attempted rather than at import, so a misconfigured
 * `OTP_TTL_MINUTES` surfaces as a clear refusal instead of thousands of customers being
 * told ten minutes when they have five.
 */
export const assertTemplateMatchesTtl = (ttlMinutes: number): void => {
  if (ttlMinutes !== OTP_TEMPLATE_VALIDITY_MINUTES) {
    throw new SmsSendError(
      `OTP_TTL_MINUTES is ${ttlMinutes} but the registered DLT template says `
      + `${OTP_TEMPLATE_VALIDITY_MINUTES} minutes. The template text cannot be changed `
      + 'without re-registering it, so change the TTL back or register a new template.',
    );
  }
};

/** The body for one code, with the single permitted substitution applied. */
export const renderOtpMessage = (code: string): string =>
  OTP_TEMPLATE.replace('<OTP>', code);

/**
 * Send one OTP.
 *
 * Throws `SmsSendError` on anything that is not a confirmed accept, so the caller can
 * delete the challenge rather than leaving a customer waiting for a code that was never
 * dispatched.
 */
export const sendOtpSms = async (phone: string, code: string): Promise<void> => {
  const key = apiKey();
  if (!key) throw new SmsSendError('No SMS API key is configured');
  if (!canSendTo(phone)) {
    throw new SmsSendError(`TextSpeed can only deliver to Indian numbers, not +${phone}`);
  }

  // **`%20` for spaces, not `+`.**
  //
  // `URLSearchParams` encodes a space as `+`, which PHP's `$_GET` does decode back to a
  // space — so in principle either works. In practice the only request shape *known* to
  // reach a handset is the one with `%20`, and when the operator is performing a
  // byte-exact match on content there is no reason to differ from it by even one
  // character. `encodeURIComponent` produces `%20`.
  //
  // Built by encoding each value rather than concatenating raw text: the body contains
  // spaces and full stops, and a hand-built query string is how a template silently
  // stops matching.
  const query = [
    ['apikey', key],
    ['senderid', SENDER_ID],
    ['templateid', TEMPLATE_ID],
    ['number', phone],
    ['message', renderOtpMessage(code)],
  ].map(([name, value]) => `${name}=${encodeURIComponent(value)}`).join('&');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let response: Response;
  let body: string;
  try {
    response = await fetch(`${ENDPOINT}?${query}`, {
      method: 'GET',
      signal: controller.signal,
    });
    body = (await response.text()).trim();
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError';
    // **Never the URL.** It carries the API key, the customer's number and the live
    // code, and logs are the one place none of those may end up.
    logger.error('SMS gateway unreachable', {
      aborted,
      error: err instanceof Error ? err.message : String(err),
    });
    throw new SmsSendError(
      aborted ? 'The SMS gateway did not respond in time' : 'The SMS gateway could not be reached',
    );
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    logger.error('SMS gateway refused the request', { status: response.status, body: body.slice(0, 200) });
    throw new SmsSendError('The SMS gateway refused the request', body.slice(0, 200));
  }

  // **A 200 is not an accept.** This gateway answers failures with HTTP 200 and an
  // error in the body, so trusting the status alone means silently dropping login codes
  // while telling the customer one is on the way.
  //
  // Two checks, in order of confidence. A live send returns JSON:
  //
  //   {"status":"Success","code":"011","description":"Message submitted successfully"}
  //
  // so when the body parses, `status` is read directly — that is an exact answer rather
  // than a guess. When it does not parse, the word-based check below is the fallback.
  // Deliberately a denylist of failure words and not an allowlist of success ones: the
  // response format is undocumented, and one wording change at the gateway must not
  // lock every customer out of logging in.
  const parsed = ((): { status?: unknown } | null => {
    try {
      const value: unknown = JSON.parse(body);
      return value && typeof value === 'object' ? (value as { status?: unknown }) : null;
    } catch {
      return null;
    }
  })();

  if (parsed && typeof parsed.status === 'string') {
    if (parsed.status.toLowerCase() !== 'success') {
      logger.error('SMS gateway reported a failure', { body: body.slice(0, 300) });
      throw new SmsSendError('The SMS gateway reported a failure', body.slice(0, 300));
    }
  } else if (/error|invalid|fail|denied|unauthor|insufficient|balance/i.test(body)) {
    logger.error('SMS gateway reported a failure in a 200 response', { body: body.slice(0, 300) });
    throw new SmsSendError('The SMS gateway reported a failure', body.slice(0, 300));
  }

  // Logged without the code, and with the number partly masked: an OTP send is a
  // security event worth recording, and neither of those belongs in a log line.
  logger.info('OTP SMS accepted by the gateway', {
    to: `${phone.slice(0, 4)}****${phone.slice(-2)}`,
    // Long enough for the whole JSON accept, which was truncated mid-object at 80.
    response: body.slice(0, 200),
  });
};
