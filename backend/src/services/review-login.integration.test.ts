import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { prisma } from '../config/prisma.js';
import { buildApp } from '../app.js';

// The app-review login, end to end over HTTP.
//
// **What this proves that the unit tests cannot:** that the bypass rides on the ordinary
// challenge machinery rather than beside it. The reviewer's code is verified by the same
// `bcrypt.compare` as a customer's, burns after the same number of wrong guesses, and is
// single-use — because `verifyOtp` was never touched, and this asserts that rather than
// assuming it.
//
// The other claim here is a negative: **no SMS is attempted.** `fetch` is stubbed to throw,
// so a send would fail the test rather than quietly cost a credit — the same shape of guard
// as `sms-guard.test.ts`.
//
// Run with the real gateway configured and echo off, which is what production looks like.
// If the bypass leaked, this is the configuration where it would leak.

const app = buildApp();

const NUMBER = '9955000111';
const E164 = `91${NUMBER}`;
const CODE = '741253';

let fetchMock: ReturnType<typeof vi.fn>;
let saved: Record<string, string | undefined> = {};

const wipe = async () => {
  await prisma.otpChallenge.deleteMany({ where: { phone: { in: [E164, NUMBER] } } });
  // Sign-in doubles as sign-up, so a successful verify creates a user and a tenant.
  const users = await prisma.user.findMany({
    where: { phone: { in: [E164, NUMBER] } }, select: { tenantId: true },
  });
  await prisma.tenant.deleteMany({ where: { id: { in: users.map((u) => u.tenantId) } } });
};

beforeEach(async () => {
  saved = {
    number: process.env.PRODOTPTESTNUMBER,
    code: process.env.PRODOTPFORTEST,
    echo: process.env.OTP_ECHO,
    key: process.env.TEXTSPEEDAPIKEY,
    env: process.env.NODE_ENV,
  };

  process.env.PRODOTPTESTNUMBER = NUMBER;
  process.env.PRODOTPFORTEST = CODE;
  // Production's shape: a real gateway configured, echo off. `NODE_ENV` is left at `test`,
  // which is fine — the review branch returns before `deliver()` is ever reached, and that
  // ordering is itself one of the things worth pinning.
  delete process.env.OTP_ECHO;
  process.env.TEXTSPEEDAPIKEY = 'a-real-looking-key';

  fetchMock = vi.fn(() => { throw new Error('the review login tried to send an SMS'); });
  vi.stubGlobal('fetch', fetchMock);

  await wipe();
});

afterEach(async () => {
  for (const [key, name] of [
    ['number', 'PRODOTPTESTNUMBER'], ['code', 'PRODOTPFORTEST'],
    ['echo', 'OTP_ECHO'], ['key', 'TEXTSPEEDAPIKEY'], ['env', 'NODE_ENV'],
  ] as const) {
    if (saved[key] === undefined) delete process.env[name];
    else process.env[name] = saved[key]!;
  }
  vi.unstubAllGlobals();
  await wipe();
});

afterAll(async () => {
  await prisma.$disconnect();
});

const askForCode = (phone: string) =>
  request(app).post('/api/auth/otp').send({ phone });

const verify = (phone: string, code: string) =>
  request(app).post('/api/auth/otp/verify').send({ phone, code });

describe('the reviewer’s journey', () => {
  it('**issues a code without sending an SMS, and without returning it**', async () => {
    const res = await askForCode(E164);

    expect(res.status).toBe(200);
    expect(res.body.data.channel).toBe('sms');
    // The credential must never come back in the response. `devCode` is reserved for
    // `OTP_ECHO`; returning a permanent code would publish it to anyone who can call the
    // endpoint.
    expect(res.body.data.devCode).toBeUndefined();
    expect(res.body.data).not.toHaveProperty('code');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('writes exactly one ordinary challenge', async () => {
    await askForCode(E164);
    const challenges = await prisma.otpChallenge.findMany({ where: { phone: E164 } });

    expect(challenges).toHaveLength(1);
    // Hashed, like any other. A plaintext column here would be a stored credential.
    expect(challenges[0].codeHash).not.toBe(CODE);
    expect(challenges[0].codeHash.startsWith('$2')).toBe(true);
    expect(challenges[0].consumedAt).toBeNull();
  });

  it('**signs in with the fixed code**', async () => {
    await askForCode(E164);
    const res = await verify(E164, CODE);

    expect(res.status).toBe(201);
    expect(res.body.data.token).toBeTruthy();
    expect(res.body.data.user.phone).toBe(E164);
  });

  it('works from the bare ten-digit form too', async () => {
    // Whichever field the reviewer types into.
    await askForCode(NUMBER);
    const res = await verify(NUMBER, CODE);
    expect(res.status).toBe(201);
  });
});

describe('nothing else is relaxed', () => {
  it('**is single-use — the same code twice does not sign in twice**', async () => {
    await askForCode(E164);
    await verify(E164, CODE).expect(201);

    // No new challenge, so the consumed one is all there is.
    const res = await verify(E164, CODE);
    expect(res.status).toBe(401);
  });

  it('**still burns after the attempt cap**', async () => {
    await askForCode(E164);

    for (let i = 0; i < 5; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await verify(E164, '0000').expect(401);
    }
    // Burned: the right code no longer works on that challenge.
    const res = await verify(E164, CODE);
    expect(res.status).toBe(401);
  });

  it('**still obeys the resend cooldown**', async () => {
    // Decided rather than overlooked: the review account is rate-limited like everyone.
    await askForCode(E164).expect(200);
    const res = await askForCode(E164);
    expect(res.status).toBe(429);
  });

  it('refuses a wrong code', async () => {
    await askForCode(E164);
    await verify(E164, '999999').expect(401);
  });
});

describe('the blast radius', () => {
  it('**the fixed code does not work for any other number**', async () => {
    // The claim that matters most. A real number still gets a random code, so the review
    // code must be worthless against it.
    const other = '919955000222';
    await prisma.otpChallenge.deleteMany({ where: { phone: other } });

    // That number takes the real path, which has no handset it can reach — so requesting
    // is refused rather than silently succeeding.
    const asked = await askForCode(other);
    expect(asked.status).toBe(422);

    // And with no live challenge, the review code is simply wrong.
    await verify(other, CODE).expect(401);
    await prisma.otpChallenge.deleteMany({ where: { phone: other } });
  });

  it('**a real number’s flow is unchanged by this feature existing**', async () => {
    // With the review vars set, an ordinary number must behave exactly as it did before —
    // here, refused because a test run may not send a real SMS.
    const res = await askForCode('919955000333');
    expect(res.status).toBe(422);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('**stops working the moment the configuration is removed**', async () => {
    delete process.env.PRODOTPFORTEST;

    // Now an ordinary number, so it falls through to the real delivery path and is refused.
    const res = await askForCode(E164);
    expect(res.status).toBe(422);
    expect(await prisma.otpChallenge.count({ where: { phone: E164 } })).toBe(0);
  });
});
