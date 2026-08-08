import axios from 'axios';
import { ApiError } from '../utils/ApiError.js';

/*
 * Turning a Graph API rejection into something the person who caused it can act on.
 *
 * The symptom this exists for: an agent typed a reply in the shared inbox and got
 * **"Internal server error"**. Nothing was broken. Meta had answered
 *
 *   400  {"error":{"code":131030,"error_data":{"details":
 *          "Recipient phone number not in allowed list: Add recipient phone number to
 *           recipient list and try again."}}}
 *
 * — a complete, actionable explanation — and we threw the raw `AxiosError` at the global
 * handler, which correctly refuses to leak the message of an error it does not recognise.
 * So the one sentence that said what to do went only to the log, and the operator was told
 * the server had failed when it had not.
 *
 * Three things have to be true of the replacement:
 *
 *   1. **The status must not be 5xx.** A message the business is not allowed to send is not
 *      our outage. It also matters to callers: the frontend retries and reports 5xx
 *      differently, and "our server broke" sends people to us rather than to their Meta
 *      settings.
 *   2. **Meta's own wording has to reach the client.** Paraphrasing 130-odd error codes is
 *      not maintainable, and every paraphrase is a chance to be wrong about someone else's
 *      API. Meta writes `error_user_msg` for exactly this.
 *   3. **No phone number may pass through.** `maskCustomerNumbers` exists so an agent
 *      cannot harvest contacts, and a passthrough of a third party's error text is a hole
 *      in it the day Meta decides to quote the recipient back. Cheap to close, so closed.
 */

/** The shape Meta actually returns. Every field optional — this is someone else's API. */
interface GraphErrorBody {
  error?: {
    code?: number;
    message?: string;
    error_user_msg?: string;
    error_data?: { details?: string };
  };
}

/**
 * Blank out anything long enough to be a phone number.
 *
 * Seven digits is the shortest national number in use, so that is the threshold; separators
 * inside a run are tolerated because "+91 77020 00350" must not slip past on its spaces.
 * Bystanders like an HTTP status or a message-per-second limit are two or three digits and
 * survive, which is what keeps the remaining text worth reading.
 */
export const withoutNumbers = (text: string): string =>
  text.replace(/\+?[\d][\d\s().-]{5,}\d/g, (run) =>
    run.replace(/\D/g, '').length >= 7 ? '[number]' : run);

/** Meta's most human field, falling back through the less human ones. */
const wording = (body: GraphErrorBody | undefined): string | null => {
  const e = body?.error;
  if (!e) return null;
  const text = e.error_user_msg || e.error_data?.details || e.message;
  return text ? withoutNumbers(text.trim()) : null;
};

/**
 * An `ApiError` describing a failed Graph call, or `null` if this is not one.
 *
 * `null` rather than a generic 500 on purpose: a caller that wraps something broader than a
 * single Graph call still needs its own bugs to reach the error handler as bugs.
 */
export const metaFailure = (err: unknown): ApiError | null => {
  if (!axios.isAxiosError(err)) return null;

  const status = err.response?.status;
  const body = err.response?.data as GraphErrorBody | undefined;
  const code = body?.error?.code;
  const detail = wording(body);

  // The token is the one failure the operator fixes somewhere else entirely — in Settings,
  // by reconnecting WhatsApp — so it keeps its own status and its own sentence. 424 was
  // already the code for this before the rest of the mapping existed.
  if (code === 190 || status === 401) {
    return new ApiError(424, 'WhatsApp/Meta connection error: Token expired or invalid');
  }

  // No response at all: DNS, a refused connection, or our own `timeout`. Meta is
  // unreachable, which is a gateway problem rather than a bad request.
  if (!status) {
    return new ApiError(502, 'WhatsApp is not responding. The message was not sent — try again in a moment.');
  }

  if (status === 429) {
    return new ApiError(429, detail ?? 'WhatsApp is rate limiting this number. Try again shortly.');
  }

  if (status >= 500) {
    return new ApiError(502, 'WhatsApp had an error at their end. The message was not sent — try again in a moment.');
  }

  if (status >= 400) {
    // 422, not 400: the request we were given was well formed, and it is the downstream
    // account state — allow-list, 24-hour window, template approval — that refuses it.
    return new ApiError(422, detail ?? 'WhatsApp refused the message.');
  }

  return null;
};

/**
 * The same thing as a plain sentence, for callers that report a failure in their own
 * response body instead of throwing — the ticket sender, which must not lose the text the
 * agent wrote just because delivery failed.
 */
export const metaFailureMessage = (err: unknown): string =>
  metaFailure(err)?.message
  ?? (err instanceof Error ? withoutNumbers(err.message) : 'Unknown error');
