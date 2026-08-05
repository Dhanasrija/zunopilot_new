import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The guard that stops a test run texting a real person.
//
// Written as its own file because it asserts a *negative* about the whole app: that no
// route through `requestOtp` can reach a handset while `NODE_ENV=test`. The suite it
// protects (`otp.integration.test.ts`) requests codes for `919811122233` — a plausible
// real Indian mobile — and stays harmless only because it sets `OTP_ECHO=true`. This is
// what makes that a belt rather than the only thing holding the trousers up.

/**
 * A number no other suite touches.
 *
 * Deliberately not `919811122233`, which `otp.integration.test.ts` uses: a challenge
 * left over from that suite trips the 45-second resend cooldown, and the request is then
 * rejected by the *limiter* rather than by the guard — a pass that proves nothing.
 * Cleared before each test for the same reason.
 */
const PHONE = '919999000111';

let fetchMock: ReturnType<typeof vi.fn>;
let savedEcho: string | undefined;

beforeEach(async () => {
  const { prisma } = await import('../config/prisma.js');
  await prisma.otpChallenge.deleteMany({ where: { phone: PHONE } });

  savedEcho = process.env.OTP_ECHO;
  // The dangerous configuration: a real key present, echo off. Exactly what production
  // looks like, and exactly what a test must never behave like.
  process.env.TEXTSPEEDAPIKEY = 'a-real-looking-key';
  delete process.env.OTP_ECHO;

  fetchMock = vi.fn(() => { throw new Error('a test tried to send a real SMS'); });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  if (savedEcho === undefined) delete process.env.OTP_ECHO;
  else process.env.OTP_ECHO = savedEcho;
  delete process.env.TEXTSPEEDAPIKEY;
  vi.unstubAllGlobals();
});

describe('sending a real SMS from a test run', () => {
  it('**is refused, and never reaches the network**', async () => {
    const { requestOtp } = await import('./otp.service.js');

    // If this ever resolves instead of rejecting, a test run is sending real text
    // messages — which is what the whole file exists to prevent.
    await expect(requestOtp(PHONE, null)).rejects.toThrow(/test run/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('confirms NODE_ENV is what the guard relies on', () => {
    // If vitest ever stopped setting this, the guard above would silently stop working
    // and this is the line that would fail.
    expect(process.env.NODE_ENV).toBe('test');
  });
});
