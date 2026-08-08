import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { prisma } from '../config/prisma.js';
import { buildApp } from '../app.js';
import { countryFromPhone, echoAllowed, normalisePhone } from './otp.service.js';

// OTP login.
//
// The code is a credential, so the tests are about the properties that make it one
// rather than about the happy path: it is not readable at rest, not guessable at
// leisure, not reusable, and requesting one tells a caller nothing about whether a
// number has an account.

const app = buildApp();
const PHONE = '+91 98111 22233';
const DIGITS = '919811122233';
const OTHER = '447700900123';

let savedEcho: string | undefined;

const wipe = async () => {
  await prisma.otpChallenge.deleteMany({ where: { phone: { in: [DIGITS, OTHER] } } });
  const users = await prisma.user.findMany({
    where: { phone: { in: [DIGITS, OTHER] } },
    select: { tenantId: true },
  });
  await prisma.tenant.deleteMany({ where: { id: { in: users.map((u) => u.tenantId) } } });
};

beforeEach(async () => {
  savedEcho = process.env.OTP_ECHO;
  process.env.OTP_ECHO = 'true';
  await wipe();
});

afterEach(() => {
  if (savedEcho === undefined) delete process.env.OTP_ECHO;
  else process.env.OTP_ECHO = savedEcho;
});

afterAll(async () => {
  await wipe();
  await prisma.$disconnect();
});

/** Ask for a code and read it back. Only possible because echo is on. */
const askForCode = async (phone = PHONE): Promise<string> => {
  const response = await request(app).post('/api/auth/otp').send({ phone }).expect(200);
  return response.body.data.devCode as string;
};

describe('normalising a number', () => {
  it('strips formatting down to E.164 digits', () => {
    expect(normalisePhone('+91 98111 22233')).toBe(DIGITS);
    expect(normalisePhone('+91-98111-22233')).toBe(DIGITS);
    expect(normalisePhone('(91) 98111 22233')).toBe(DIGITS);
  });

  it('refuses anything too short or too long to be a number', () => {
    expect(() => normalisePhone('12345')).toThrow();
    expect(() => normalisePhone('1234567890123456789')).toThrow();
  });

  it('never guesses a country code', () => {
    // A ten-digit Indian number without its prefix must not be silently promoted
    // to +91 — the same local number exists in dozens of countries, and guessing
    // is how someone signs in as a stranger.
    expect(normalisePhone('9811122233')).toBe('9811122233');
    expect(countryFromPhone('9811122233')).not.toBe('IN');
  });
});

describe('country from the calling code', () => {
  it('reads it from the number rather than an IP', () => {
    expect(countryFromPhone(DIGITS)).toBe('IN');
    expect(countryFromPhone('447700900123')).toBe('GB');
    expect(countryFromPhone('14155550123')).toBe('US');
  });

  it('prefers the longest matching prefix', () => {
    // 1 is US/Canada and 1242 is the Bahamas; a shortest-match lookup gets this
    // wrong for every country whose code extends another.
    expect(countryFromPhone('971501234567')).toBe('AE');
    expect(countryFromPhone('97712345678')).toBe('NP');
  });

  it('returns null rather than guessing', () => {
    expect(countryFromPhone('99912345678')).toBeNull();
  });
});

describe('the echo escape hatch', () => {
  it('is off unless explicitly asked for', () => {
    delete process.env.OTP_ECHO;
    expect(echoAllowed()).toBe(false);
    process.env.OTP_ECHO = 'false';
    expect(echoAllowed()).toBe(false);
    process.env.OTP_ECHO = 'true';
    expect(echoAllowed()).toBe(true);
  });

  it('is REFUSED in production even when set', () => {
    // Returning the code in the response lets anyone sign in as anyone, so this is
    // not a preference the environment can override.
    const savedEnv = process.env.NODE_ENV;
    process.env.OTP_ECHO = 'true';
    process.env.NODE_ENV = 'production';
    expect(echoAllowed()).toBe(false);
    process.env.NODE_ENV = savedEnv;
  });
});

describe('requesting a code', () => {
  it('answers identically for a number with an account and one without', async () => {
    const firstTime = await request(app).post('/api/auth/otp').send({ phone: PHONE }).expect(200);
    const code = firstTime.body.data.devCode as string;
    await request(app).post('/api/auth/otp/verify').send({ phone: PHONE, code }).expect(201);

    await prisma.otpChallenge.deleteMany({ where: { phone: DIGITS } });

    const returning = await request(app).post('/api/auth/otp').send({ phone: PHONE }).expect(200);

    // Same shape, same status. Anything else turns this into a way to test a
    // leaked phone list against our customer list.
    expect(Object.keys(returning.body.data).sort())
      .toEqual(Object.keys(firstTime.body.data).sort());
  });

  it('stores the code hashed, never in the clear', async () => {
    const code = await askForCode();
    const challenge = await prisma.otpChallenge.findFirstOrThrow({ where: { phone: DIGITS } });

    // A database dump must not be a list of live login codes.
    expect(challenge.codeHash).not.toContain(code);
    expect(challenge.codeHash.startsWith('$2')).toBe(true);
  });

  it('retires the previous code, so only one works at a time', async () => {
    const first = await askForCode();
    await prisma.otpChallenge.updateMany({
      where: { phone: DIGITS },
      data: { createdAt: new Date(Date.now() - 120_000) },
    });
    const second = await askForCode();

    expect(first).not.toBe(second);
    await request(app).post('/api/auth/otp/verify').send({ phone: PHONE, code: first }).expect(401);
    await request(app).post('/api/auth/otp/verify').send({ phone: PHONE, code: second }).expect(201);
  });

  it('holds off a resend for a moment', async () => {
    await askForCode();
    const again = await request(app).post('/api/auth/otp').send({ phone: PHONE }).expect(429);
    expect(again.body.message).toMatch(/just sent/i);
  });

  it('caps how many codes one number can be sent in an hour', async () => {
    // Per phone, not per IP: the abuse this stops is spending our SMS balance on
    // somebody else's handset, and that attacker rotates IPs freely.
    for (let i = 0; i < 5; i += 1) {
      await prisma.otpChallenge.create({
        data: {
          phone: DIGITS,
          codeHash: 'x',
          expiresAt: new Date(Date.now() - 1000),
          createdAt: new Date(Date.now() - 60_000 * (i + 1)),
        },
      });
    }
    const refused = await request(app).post('/api/auth/otp').send({ phone: PHONE }).expect(429);
    expect(refused.body.message).toMatch(/too many/i);
  });

  it('does not spend the cooldown when delivery fails', async () => {
    // A provider outage must not also lock the customer out of retrying.
    delete process.env.OTP_ECHO;
    await request(app).post('/api/auth/otp').send({ phone: PHONE }).expect(422);
    expect(await prisma.otpChallenge.count({ where: { phone: DIGITS } })).toBe(0);

    process.env.OTP_ECHO = 'true';
    await request(app).post('/api/auth/otp').send({ phone: PHONE }).expect(200);
  });
});

describe('verifying a code', () => {
  it('signs in, creates the workspace, and says onboarding is unfinished', async () => {
    const code = await askForCode();
    const response = await request(app)
      .post('/api/auth/otp/verify').send({ phone: PHONE, code }).expect(201);

    expect(response.body.data.isNew).toBe(true);
    expect(response.body.data.profileComplete).toBe(false);
    expect(response.body.data.user.phone).toBe(DIGITS);
    // Derived from the calling code, with no external lookup.
    expect(response.body.data.user.country).toBe('IN');
    expect(response.body.data.token).toBeTruthy();

    // A workspace exists immediately, so `User.tenantId` is never absent.
    const user = await prisma.user.findUniqueOrThrow({
      where: { phone: DIGITS },
      include: { tenant: true },
    });
    expect(user.role).toBe('OWNER');
    expect(user.passwordHash).toBeNull();
    expect(user.tenant.onboardingCompletedAt).toBeNull();

    /*
     * **And a membership for the founder, on the owner role.**
     *
     * The membership is what will decide which workspaces a login can reach. A signup that
     * created the user and not the membership would produce an account that works today and can
     * reach nothing at all the moment the switch flips — the worst failure available here.
     *
     * Asserted at this path rather than left to the whole-database invariant in
     * `membership-backfill.integration.test.ts`: that file scans persistent rows, and this suite
     * deletes its tenant in teardown, so an un-synced founder is gone before the scan. Removing
     * the sync from signup left that invariant green.
     */
    const membership = await prisma.membership.findUniqueOrThrow({
      where: { userId_tenantId: { userId: user.id, tenantId: user.tenantId } },
    });
    expect(membership.isActive).toBe(true);
    expect(membership.legacyRole).toBe('OWNER');
    // Synced *after* the role attach, so it copies the seeded owner role rather than a null.
    expect(membership.roleId).toBe(user.roleId);
    expect(membership.roleId).not.toBeNull();
  });

  it('cannot be used twice', async () => {
    const code = await askForCode();
    await request(app).post('/api/auth/otp/verify').send({ phone: PHONE, code }).expect(201);
    await request(app).post('/api/auth/otp/verify').send({ phone: PHONE, code }).expect(401);
  });

  it('burns the challenge after a few wrong guesses', async () => {
    const code = await askForCode();

    for (let i = 0; i < 5; i += 1) {
      await request(app).post('/api/auth/otp/verify').send({ phone: PHONE, code: '000000' }).expect(401);
    }

    // The real code no longer works either — a six-digit secret cannot be walked
    // through at leisure.
    await request(app).post('/api/auth/otp/verify').send({ phone: PHONE, code }).expect(401);
  });

  it('gives the same answer for a wrong code and no code at all', async () => {
    const noChallenge = await request(app)
      .post('/api/auth/otp/verify').send({ phone: '+44 7700 900123', code: '123456' }).expect(401);

    await askForCode();
    const wrongCode = await request(app)
      .post('/api/auth/otp/verify').send({ phone: PHONE, code: '000000' }).expect(401);

    expect(noChallenge.body.message).toBe(wrongCode.body.message);
  });

  it('refuses an expired code', async () => {
    const code = await askForCode();
    await prisma.otpChallenge.updateMany({
      where: { phone: DIGITS },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await request(app).post('/api/auth/otp/verify').send({ phone: PHONE, code }).expect(401);
  });

  it('sends a returning, set-up workspace straight through', async () => {
    const code = await askForCode();
    const created = await request(app)
      .post('/api/auth/otp/verify').send({ phone: PHONE, code }).expect(201);
    const token = created.body.data.token as string;

    const categories = await request(app).get('/api/auth/business-categories').expect(200);
    await request(app).put('/api/auth/profile')
      .set({ Authorization: `Bearer ${token}` })
      .send({
        businessName: 'OTP Test Kitchen',
        businessCategoryId: categories.body.data[0].id,
        fullName: 'Test Owner',
      })
      .expect(200);

    await prisma.otpChallenge.deleteMany({ where: { phone: DIGITS } });
    const second = await askForCode();
    const returning = await request(app)
      .post('/api/auth/otp/verify').send({ phone: PHONE, code: second }).expect(200);

    expect(returning.body.data.isNew).toBe(false);
    expect(returning.body.data.profileComplete).toBe(true);
    expect(returning.body.data.tenant.businessName).toBe('OTP Test Kitchen');
  });
});

describe('completing the profile', () => {
  const signIn = async (): Promise<string> => {
    const code = await askForCode();
    const response = await request(app)
      .post('/api/auth/otp/verify').send({ phone: PHONE, code }).expect(201);
    return response.body.data.token as string;
  };

  it('accepts no email at all', async () => {
    const token = await signIn();
    const categories = await request(app).get('/api/auth/business-categories').expect(200);

    const result = await request(app).put('/api/auth/profile')
      .set({ Authorization: `Bearer ${token}` })
      .send({
        businessName: 'No Email Co',
        businessCategoryId: categories.body.data[0].id,
        fullName: 'Nobody',
      })
      .expect(200);

    // Email is optional and nothing signs in with it, so requiring one would be
    // asking for a detail purely to have it.
    expect(result.body.data.user.email).toBeNull();
    expect(result.body.data.profileComplete).toBe(true);
  });

  it('refuses a category that does not exist or is hidden', async () => {
    const token = await signIn();
    const hidden = await prisma.businessCategory.create({
      data: { key: 'OTP_TEST_HIDDEN', label: 'Hidden', isActive: false },
    });

    await request(app).put('/api/auth/profile')
      .set({ Authorization: `Bearer ${token}` })
      .send({ businessName: 'X Co', businessCategoryId: hidden.id, fullName: 'Someone' })
      .expect(400);

    await prisma.businessCategory.delete({ where: { id: hidden.id } });
  });

  it('links the workspace to the managed category row, not an enum', async () => {
    const token = await signIn();
    const categories = await request(app).get('/api/auth/business-categories').expect(200);
    const restaurant = categories.body.data.find((c: { key: string }) => c.key === 'RESTAURANT');

    const result = await request(app).put('/api/auth/profile')
      .set({ Authorization: `Bearer ${token}` })
      .send({
        businessName: 'Linked Co',
        businessCategoryId: restaurant.id,
        fullName: 'Someone',
      })
      .expect(200);

    // The key is what workflow templates match on, so it has to survive the round
    // trip through a row.
    expect(result.body.data.tenant.category).toBe('RESTAURANT');
    expect(result.body.data.tenant.categoryId).toBe(restaurant.id);
  });
});
