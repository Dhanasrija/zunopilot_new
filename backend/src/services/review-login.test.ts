import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reviewCodeFor, reviewLoginConfigured, reviewLoginPhones } from './review-login.js';

// The app-review login, as a bypass rather than as a feature.
//
// Every test here is a limit on how far it reaches. The feature working is one test; the
// other nineteen are about it *not* working — off when half-configured, off for a code the
// API would reject, and null for every number that is not the configured one.
//
// The two that would be a security incident rather than a bug are marked: a substring match
// on the number, and a blank code being accepted as a code.

const NUMBER = '9912345678';
const CODE = '7412';

beforeEach(() => {
  process.env.PRODOTPTESTNUMBER = NUMBER;
  process.env.PRODOTPFORTEST = CODE;
});

afterEach(() => {
  delete process.env.PRODOTPTESTNUMBER;
  delete process.env.PRODOTPFORTEST;
  vi.restoreAllMocks();
});

describe('when it is configured', () => {
  it('returns the fixed code for the configured number', () => {
    expect(reviewCodeFor(`91${NUMBER}`)).toBe(CODE);
  });

  it('**matches both the 91-prefixed and the bare form**', () => {
    // `normalisePhone` strips non-digits and adds nothing, so what arrives depends on what
    // the reviewer typed: the country picker yields `91` + ten digits, a bare entry yields
    // ten. Both have to work or the login depends on which field they used.
    expect(reviewCodeFor(`91${NUMBER}`)).toBe(CODE);
    expect(reviewCodeFor(NUMBER)).toBe(CODE);
  });

  it('reports itself configured, and which numbers it answers to', () => {
    // So the resolved forms can be confirmed before submitting to a store, rather than
    // learning from a rejection that the reviewer typed a form we never matched.
    expect(reviewLoginConfigured()).toBe(true);
    expect(reviewLoginPhones().sort()).toEqual([NUMBER, `91${NUMBER}`].sort());
  });

  it('never exposes the code through the reporting helpers', () => {
    expect(JSON.stringify(reviewLoginPhones())).not.toContain(CODE);
  });

  it('accepts a number already carrying its country code, and prepends nothing', () => {
    process.env.PRODOTPTESTNUMBER = `91${NUMBER}`;
    expect(reviewLoginPhones()).toEqual([`91${NUMBER}`]);
    expect(reviewCodeFor(`91${NUMBER}`)).toBe(CODE);
    // And does not invent a doubly-prefixed variant.
    expect(reviewCodeFor(`9191${NUMBER}`)).toBeNull();
  });

  it('tolerates a configured number written with spaces or a plus', () => {
    process.env.PRODOTPTESTNUMBER = '+91 99123 45678';
    expect(reviewCodeFor(`91${NUMBER}`)).toBe(CODE);
  });
});

describe('every other number', () => {
  it('**gets nothing**', () => {
    for (const other of [
      '917702000350',   // a real owner account
      '15550001234',    // a seeded demo account
      '919999000111',
      '',
    ]) {
      expect(reviewCodeFor(other)).toBeNull();
    }
  });

  it('**is not matched by containing the configured digits**', () => {
    // The incident case. A prefix or substring test would let a longer number that happens
    // to contain these digits sign in with the fixed code.
    expect(reviewCodeFor(`1${NUMBER}`)).toBeNull();
    expect(reviewCodeFor(`${NUMBER}9`)).toBeNull();
    expect(reviewCodeFor(`191${NUMBER}`)).toBeNull();
    expect(reviewCodeFor(`91${NUMBER}0`)).toBeNull();
  });

  it('is not matched by a one-digit difference', () => {
    expect(reviewCodeFor('919912345679')).toBeNull();
  });
});

describe('when it is not configured', () => {
  it('is off, silently, when neither variable is set', () => {
    // The normal case on a machine that is not preparing a store submission. No log noise.
    delete process.env.PRODOTPTESTNUMBER;
    delete process.env.PRODOTPFORTEST;
    expect(reviewLoginConfigured()).toBe(false);
    expect(reviewCodeFor(`91${NUMBER}`)).toBeNull();
  });

  it('**is off, loudly, when only the number is set**', () => {
    delete process.env.PRODOTPFORTEST;
    expect(reviewCodeFor(`91${NUMBER}`)).toBeNull();
  });

  it('is off when only the code is set', () => {
    delete process.env.PRODOTPTESTNUMBER;
    expect(reviewCodeFor(`91${NUMBER}`)).toBeNull();
  });

  it('**is off when the code is blank — an empty code is never a code**', () => {
    // The other incident case. `PRODOTPFORTEST=` in an `.env` file must not mean that
    // submitting nothing signs you in.
    process.env.PRODOTPFORTEST = '';
    expect(reviewCodeFor(`91${NUMBER}`)).toBeNull();

    process.env.PRODOTPFORTEST = '    ';
    expect(reviewCodeFor(`91${NUMBER}`)).toBeNull();
  });

  it('**is off for a code the verify endpoint would reject**', () => {
    // `auth.controller.ts` validates `^\d{4,8}$`. A configured code outside that is a
    // bypass that silently does not work, discovered during review.
    for (const bad of ['123', '123456789', 'abcd', '12a4', '12.4']) {
      process.env.PRODOTPFORTEST = bad;
      expect(reviewCodeFor(`91${NUMBER}`)).toBeNull();
    }
  });

  it('is off for an unusable number', () => {
    for (const bad of ['123', 'abcdefghij', '1234567890123456']) {
      process.env.PRODOTPTESTNUMBER = bad;
      expect(reviewCodeFor(`91${NUMBER}`)).toBeNull();
    }
  });
});

describe('what reaches the logs', () => {
  const logsFrom = async (run: () => void): Promise<string> => {
    const { logger } = await import('../config/logger.js');
    const captured: unknown[] = [];
    const spies = (['info', 'warn', 'error', 'debug'] as const).map((level) =>
      vi.spyOn(logger, level).mockImplementation(((...args: unknown[]) => {
        captured.push(...args);
        return logger;
      }) as never));
    run();
    spies.forEach((spy) => spy.mockRestore());
    return JSON.stringify(captured);
  };

  it('**never logs the code, even while rejecting it**', async () => {
    // The rejection branches are where a secret is most likely to slip out, because they
    // are the ones that want to explain what was wrong with the value.
    process.env.PRODOTPFORTEST = '12';
    const logged = await logsFrom(() => { reviewCodeFor(`91${NUMBER}`); });

    expect(logged).not.toContain('12345678');
    expect(logged).not.toContain('"12"');
    // It does say something actionable.
    expect(logged).toMatch(/DISABLED/);
  });

  it('says the feature is disabled when half-configured', async () => {
    delete process.env.PRODOTPFORTEST;
    const logged = await logsFrom(() => { reviewCodeFor(`91${NUMBER}`); });
    expect(logged).toMatch(/half-configured/i);
    expect(logged).toMatch(/DISABLED/);
  });

  it('**says nothing at all when the feature is simply not in use**', async () => {
    // Most machines. A warning on every OTP request would train people to ignore warnings.
    delete process.env.PRODOTPTESTNUMBER;
    delete process.env.PRODOTPFORTEST;
    const logged = await logsFrom(() => { reviewCodeFor(`91${NUMBER}`); });
    expect(logged).toBe('[]');
  });
});

describe('reading the environment', () => {
  it('**picks up a change without a restart**', () => {
    // Read at the point of use rather than from the `config/env.ts` snapshot, which is
    // taken at import — the trap this codebase has hit five times.
    expect(reviewCodeFor(`91${NUMBER}`)).toBe(CODE);

    process.env.PRODOTPFORTEST = '9999';
    expect(reviewCodeFor(`91${NUMBER}`)).toBe('9999');

    process.env.PRODOTPTESTNUMBER = '9800000000';
    expect(reviewCodeFor(`91${NUMBER}`)).toBeNull();
    expect(reviewCodeFor('919800000000')).toBe('9999');
  });
});
