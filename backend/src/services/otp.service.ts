import bcrypt from 'bcryptjs';
import { randomInt } from 'node:crypto';
import { prisma } from '../config/prisma.js';
import { logger } from '../config/logger.js';
import { ApiError } from '../utils/ApiError.js';

// One-time login codes.
//
// The code is the credential, so it is treated like one:
//
//   • **Hashed at rest.** A database dump must not be a list of live login codes.
//   • **Attempt-limited.** A 6-digit code is 10^6, which is nothing if it can be
//     guessed at leisure — so a challenge burns after a few wrong tries rather
//     than only on expiry.
//   • **Single-use and short-lived.** Consumed on success, and expired either way.
//   • **Never revealed by the request path.** Asking for a code tells you nothing
//     about whether that number has an account, because the answer is identical
//     either way.

/** Long enough to type from a notification, short enough to be worth nothing later. */
const CODE_LENGTH = 6;
const TTL_MINUTES = Number(process.env.OTP_TTL_MINUTES ?? 10);
const MAX_ATTEMPTS = Number(process.env.OTP_MAX_ATTEMPTS ?? 5);

/**
 * How many codes one number may be sent in an hour.
 *
 * Per *phone*, not per IP, and enforced in the database rather than in an
 * in-memory limiter: the abuse this stops is using our SMS balance to spam
 * somebody else's handset, and that attacker rotates IPs freely.
 */
const MAX_PER_HOUR = Number(process.env.OTP_MAX_PER_HOUR ?? 5);

/** A fresh code is refused while a recent one is still usable. */
const RESEND_COOLDOWN_SECONDS = Number(process.env.OTP_RESEND_COOLDOWN_SECONDS ?? 45);

export interface OtpDelivery {
  channel: 'sms' | 'echo';
  /**
   * The code, returned to the caller.
   *
   * **Only ever set outside production.** See `echoAllowed()` — putting the code
   * in the API response is a complete authentication bypass, because anyone could
   * request a code for any number and read it straight back.
   */
  code?: string;
}

/**
 * Whether the code may be handed back in the response.
 *
 * Two conditions, both required, and the environment one is not overridable:
 * `OTP_ECHO=true` asks for it, and `NODE_ENV !== 'production'` permits it. Set in
 * production it is refused and logged as an error rather than honoured, because a
 * misconfiguration that silently disables login entirely is better than one that
 * silently disables it for everybody's account.
 */
export const echoAllowed = (): boolean => {
  const asked = (process.env.OTP_ECHO ?? '').toLowerCase() === 'true';
  if (!asked) return false;

  if (process.env.NODE_ENV === 'production') {
    logger.error(
      'OTP_ECHO is set in production and is being IGNORED. Returning login codes in '
      + 'an API response lets anyone sign in as anyone. Remove it and configure an SMS provider.',
    );
    return false;
  }
  return true;
};

/**
 * Normalise a phone number to E.164 digits without the plus.
 *
 * Deliberately strict rather than clever: no region guessing, no defaulting to
 * India. A number stored two ways is two accounts for one person, and a "helpful"
 * default is how someone ends up signing in as a stranger who happens to share
 * their local number.
 */
export const normalisePhone = (input: string): string => {
  const digits = input.replace(/[^\d]/g, '');
  if (digits.length < 8 || digits.length > 15) {
    throw ApiError.badRequest('Enter your number with its country code, for example +91 77020 00350');
  }
  return digits;
};

/**
 * The country a number belongs to, from its calling code.
 *
 * Chosen over an IP lookup: the phone is already the identifier, so this needs no
 * external service, no egress call and no request-level geolocation — and it is
 * right even when someone signs up over a VPN or while travelling, which is
 * exactly when an IP is wrong.
 *
 * Longest prefix wins, because `1` (US/Canada) and `1242` (Bahamas) both start
 * with 1. Unknown returns null rather than a guess.
 */
const CALLING_CODES: Record<string, string> = {
  1: 'US', 7: 'RU', 20: 'EG', 27: 'ZA', 30: 'GR', 31: 'NL', 32: 'BE', 33: 'FR',
  34: 'ES', 36: 'HU', 39: 'IT', 40: 'RO', 41: 'CH', 43: 'AT', 44: 'GB', 45: 'DK',
  46: 'SE', 47: 'NO', 48: 'PL', 49: 'DE', 51: 'PE', 52: 'MX', 54: 'AR', 55: 'BR',
  56: 'CL', 57: 'CO', 58: 'VE', 60: 'MY', 61: 'AU', 62: 'ID', 63: 'PH', 64: 'NZ',
  65: 'SG', 66: 'TH', 81: 'JP', 82: 'KR', 84: 'VN', 86: 'CN', 90: 'TR', 91: 'IN',
  92: 'PK', 93: 'AF', 94: 'LK', 95: 'MM', 98: 'IR',
  212: 'MA', 213: 'DZ', 216: 'TN', 218: 'LY', 220: 'GM', 233: 'GH', 234: 'NG',
  254: 'KE', 255: 'TZ', 256: 'UG', 260: 'ZM', 263: 'ZW', 264: 'NA',
  351: 'PT', 352: 'LU', 353: 'IE', 354: 'IS', 356: 'MT', 358: 'FI', 359: 'BG',
  370: 'LT', 371: 'LV', 372: 'EE', 380: 'UA', 381: 'RS', 385: 'HR', 386: 'SI',
  420: 'CZ', 421: 'SK', 501: 'BZ', 502: 'GT', 503: 'SV', 504: 'HN', 506: 'CR',
  507: 'PA', 591: 'BO', 593: 'EC', 595: 'PY', 598: 'UY',
  673: 'BN', 674: 'NR', 679: 'FJ',
  852: 'HK', 853: 'MO', 855: 'KH', 856: 'LA', 880: 'BD', 886: 'TW',
  960: 'MV', 961: 'LB', 962: 'JO', 963: 'SY', 964: 'IQ', 965: 'KW', 966: 'SA',
  967: 'YE', 968: 'OM', 970: 'PS', 971: 'AE', 972: 'IL', 973: 'BH', 974: 'QA',
  975: 'BT', 976: 'MN', 977: 'NP', 992: 'TJ', 993: 'TM', 994: 'AZ', 995: 'GE',
  996: 'KG', 998: 'UZ',
};

export const countryFromPhone = (phone: string): string | null => {
  for (const length of [4, 3, 2, 1]) {
    const prefix = phone.slice(0, length);
    if (CALLING_CODES[prefix]) return CALLING_CODES[prefix];
  }
  return null;
};

/** Zero-padded, and from a CSPRNG — `Math.random()` is predictable enough to matter here. */
const generateCode = (): string => String(randomInt(0, 10 ** CODE_LENGTH)).padStart(CODE_LENGTH, '0');

/**
 * Deliver a code. Swap the `sms` branch for a real provider.
 *
 * Kept behind one function so plugging MSG91 or Twilio in later is a single edit
 * with nothing else to find, and so the echo path cannot leak into the real one.
 */
const deliver = async (phone: string, code: string): Promise<OtpDelivery> => {
  if (echoAllowed()) {
    // Logged as a warning, not info: a running server handing out login codes is
    // something that should be noticeable in a log tail.
    logger.warn('OTP echoed instead of sent — development only', { phone, code });
    return { channel: 'echo', code };
  }

  // No provider is configured yet. Failing loudly beats pretending to have sent
  // something: a customer waiting for a code that was never dispatched has no way
  // to tell the difference.
  logger.error('No SMS provider is configured, so the login code could not be sent', { phone });
  throw ApiError.unprocessable(
    'Login codes cannot be sent yet because no SMS provider is configured.',
  );
};

export interface RequestOtpResult extends OtpDelivery {
  expiresAt: Date;
  /** Seconds until another code may be requested. */
  resendAfterSeconds: number;
}

export const requestOtp = async (
  rawPhone: string,
  ip: string | null,
): Promise<RequestOtpResult> => {
  const phone = normalisePhone(rawPhone);
  const now = new Date();

  const recent = await prisma.otpChallenge.findMany({
    where: { phone, createdAt: { gte: new Date(now.getTime() - 3_600_000) } },
    orderBy: { createdAt: 'desc' },
  });

  if (recent.length >= MAX_PER_HOUR) {
    throw ApiError.tooManyRequests(
      'Too many codes requested for this number. Try again in an hour.',
    );
  }

  const last = recent[0];
  if (last && !last.consumedAt && last.expiresAt > now) {
    const elapsed = (now.getTime() - last.createdAt.getTime()) / 1000;
    if (elapsed < RESEND_COOLDOWN_SECONDS) {
      throw ApiError.tooManyRequests(
        `A code was just sent. Ask for another in ${Math.ceil(RESEND_COOLDOWN_SECONDS - elapsed)} seconds.`,
      );
    }
  }

  // Any earlier live challenge is retired, so exactly one code works at a time.
  // Two valid codes doubles the guessing surface for no benefit.
  await prisma.otpChallenge.updateMany({
    where: { phone, consumedAt: null, expiresAt: { gt: now } },
    data: { expiresAt: now },
  });

  const code = generateCode();
  const expiresAt = new Date(now.getTime() + TTL_MINUTES * 60_000);

  const challenge = await prisma.otpChallenge.create({
    data: { phone, codeHash: await bcrypt.hash(code, 10), expiresAt, ip },
  });

  let delivery: OtpDelivery;
  try {
    delivery = await deliver(phone, code);
  } catch (err) {
    // Delete the challenge that was never delivered.
    //
    // The row is written before sending so a live code can never exist unrecorded.
    // But a code that was not sent is not a login attempt, and leaving the row
    // would spend both the resend cooldown and the hourly quota — answering a
    // provider outage by locking the customer out of retrying for another minute,
    // for something that was never their doing. Removed rather than expired,
    // because the hourly cap counts rows regardless of their state.
    await prisma.otpChallenge.delete({ where: { id: challenge.id } }).catch(() => {});
    throw err;
  }

  return { ...delivery, expiresAt, resendAfterSeconds: RESEND_COOLDOWN_SECONDS };
};

/**
 * Check a code and burn the challenge.
 *
 * One message for every failure — wrong code, expired, none outstanding — so the
 * response never distinguishes "that is not the code" from "that number has no
 * code waiting", and therefore never confirms whether a number has an account.
 */
export const verifyOtp = async (rawPhone: string, code: string): Promise<string> => {
  const phone = normalisePhone(rawPhone);
  const wrong = () => ApiError.unauthorized('That code is not valid. Ask for a new one.');

  const challenge = await prisma.otpChallenge.findFirst({
    where: { phone, consumedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  });

  // Still spend the time hashing when there is no challenge, so a missing account
  // is not detectable from how quickly the request comes back.
  if (!challenge) {
    await bcrypt.compare(code, '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv');
    throw wrong();
  }

  if (challenge.attempts >= MAX_ATTEMPTS) {
    await prisma.otpChallenge.update({
      where: { id: challenge.id },
      data: { expiresAt: new Date() },
    });
    throw wrong();
  }

  if (!await bcrypt.compare(code, challenge.codeHash)) {
    await prisma.otpChallenge.update({
      where: { id: challenge.id },
      data: { attempts: { increment: 1 } },
    });
    throw wrong();
  }

  await prisma.otpChallenge.update({
    where: { id: challenge.id },
    data: { consumedAt: new Date() },
  });

  return phone;
};

/** Drop spent challenges. Nothing needs them after the login they belong to. */
export const sweepOtpChallenges = async (): Promise<number> => {
  const { count } = await prisma.otpChallenge.deleteMany({
    where: { expiresAt: { lt: new Date(Date.now() - 24 * 3_600_000) } },
  });
  if (count) logger.info('Swept expired OTP challenges', { count });
  return count;
};
