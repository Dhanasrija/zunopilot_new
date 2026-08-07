import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * What happens in production when `S3_BUCKET` is not set.
 *
 * **The incident.** The guard used to throw at boot and `server.ts` called `process.exit(1)`.
 * The variable went missing on one deploy and the API crash-looped: WhatsApp messaging,
 * billing and the console all went down over a file-storage setting, the health gate failed
 * after 80 seconds, and the deploy rolled back.
 *
 * Two properties have to hold together, and it is easy to fix one by breaking the other:
 *
 *   1. **Nothing is ever quietly written to disk in production.** That was the original point.
 *      A release directory is replaced on the next deploy, so a photograph stored there is
 *      already gone; the failure would surface weeks later as missing files.
 *   2. **The rest of the API still runs.** The blast radius should match what is broken.
 *
 * `storage.ts` reads `process.env` at import, so each case re-imports the module with the
 * environment it wants — `vi.resetModules()` between them is what makes that honest.
 */

const ORIGINAL = { ...process.env };

/** Load a fresh copy of the module under a given environment. */
const loadStorage = async (env: Record<string, string | undefined>) => {
  vi.resetModules();
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return import('./storage.js');
};

beforeEach(() => { vi.resetModules(); });

afterEach(() => {
  process.env = { ...ORIGINAL };
  vi.resetModules();
});

describe('production with no bucket', () => {
  const unconfigured = () => loadStorage({ NODE_ENV: 'production', S3_BUCKET: undefined });

  it('**refuses to write, rather than falling back to disk**', async () => {
    // The whole reason the guard exists. A silent disk write is data loss on a delay.
    const storage = await unconfigured();
    await expect(storage.putObject('tenants/a/upload/2026/08/x.png', Buffer.from('x'), 'image/png'))
      .rejects.toThrow(/S3_BUCKET/);
  });

  it('refuses to read, and says why instead of saying "not found"', async () => {
    // Returning null would report a missing file. Nothing was ever stored — a different
    // problem, with a different fix, and only one of them is the operator's to make.
    const storage = await unconfigured();
    await expect(storage.getObjectStream('tenants/a/upload/2026/08/x.png'))
      .rejects.toThrow(/S3_BUCKET/);
    await expect(storage.getObjectBuffer('tenants/a/upload/2026/08/x.png'))
      .rejects.toThrow(/S3_BUCKET/);
  });

  it('still lets a delete pass quietly, because there is nothing to delete', async () => {
    // `deleteObject` never throws by contract — the row is the record, and a failed unlink
    // must not 500 an operation that already succeeded.
    const storage = await unconfigured();
    await expect(storage.deleteObject('tenants/a/upload/2026/08/x.png')).resolves.toBeUndefined();
  });

  it('**reports the problem at boot without stopping the process**', async () => {
    const storage = await unconfigured();
    expect(storage.reportStorageAtBoot()).toBe(false);
    expect(storage.storageBackend()).toBe('UNCONFIGURED');
  });

  it('carries an error the API layer can turn into a 503', async () => {
    const storage = await unconfigured();
    const problem = storage.storageUnavailable();
    expect(problem).toBeInstanceOf(storage.StorageUnconfiguredError);
    // The message is sent to the caller verbatim, so it has to name the fix.
    expect(problem?.message).toMatch(/S3_BUCKET/);
    expect(problem?.message).toMatch(/S3_SETUP\.md/);
  });
});

describe('production with a bucket', () => {
  it('is simply configured, and says nothing is wrong', async () => {
    const storage = await loadStorage({ NODE_ENV: 'production', S3_BUCKET: 'zunopilot' });
    expect(storage.storageUnavailable()).toBeNull();
    expect(storage.storageBackend()).toBe('S3');
    expect(storage.reportStorageAtBoot()).toBe(true);
  });
});

describe('development with no bucket', () => {
  it('**writes to disk, and that is the point of the seam**', async () => {
    // Requiring an AWS account to run this project locally would be the wrong trade. The
    // guard is about production, where a release directory is not a durable place.
    const storage = await loadStorage({ NODE_ENV: 'test', S3_BUCKET: undefined });
    expect(storage.storageUnavailable()).toBeNull();
    expect(storage.storageBackend()).toBe('DISK');

    const key = storage.storageKeyFor({ tenantId: 'aaaa', purpose: 'upload', id: 'round-trip' });
    await storage.putObject(key, Buffer.from('hello'), 'text/plain');
    expect((await storage.getObjectBuffer(key))?.toString()).toBe('hello');
    await storage.deleteObject(key);
    expect(await storage.getObjectBuffer(key)).toBeNull();
  });
});
