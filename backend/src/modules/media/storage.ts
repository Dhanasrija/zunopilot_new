import { createReadStream } from 'node:fs';
import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { Readable } from 'node:stream';
import {
  DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client,
} from '@aws-sdk/client-s3';
import { logger } from '../../config/logger.js';

/*
 * Where media bytes live.
 *
 * Two backends behind one interface: S3 in production, the local filesystem for development
 * and tests. The seam exists because the alternative — S3 everywhere — would mean nobody can
 * run this project without an AWS account, and the alternative to *that* is a disk write on a
 * server whose release directory is replaced on every deploy.
 *
 * **Production has no disk fallback.** With `S3_BUCKET` unset in production, every operation
 * here throws. Quietly writing to disk instead is exactly the failure this codebase has had
 * five separate times: an absent environment variable that reads as a working configuration,
 * discovered weeks later when the files are gone.
 *
 * **What it does NOT do is stop the server.** It used to: `assertStorageConfigured` threw at
 * boot and `server.ts` called `process.exit(1)`. That was disproportionate and it cost an
 * outage — a missing storage variable took down messaging, billing and the console, the health
 * gate failed, and the deploy rolled back. The blast radius should match the thing that is
 * broken. So the API starts, says loudly and repeatedly that media is unconfigured, and
 * refuses the media operations alone. Everything that does not touch a file carries on.
 */

const BUCKET = process.env.S3_BUCKET?.trim() || null;
const REGION = process.env.AWS_REGION?.trim() || 'ap-south-1';

/**
 * The disk path, for development only.
 *
 * Under the OS temp directory in tests, so a suite run never leaves files in the working tree.
 */
const MEDIA_DIR = resolve(
  process.env.MEDIA_DIR
  || (process.env.NODE_ENV === 'test'
    ? join(tmpdir(), 'zunopilot-media-test')
    : join(process.cwd(), '.media')),
);

/** Thrown by every operation when production has nowhere safe to put a file. */
export class StorageUnconfiguredError extends Error {
  readonly isStorageUnconfigured = true;

  constructor() {
    // The message names the variable and the consequence, because the person reading it at 2am
    // is not the person who wrote this.
    super(
      'S3_BUCKET is not set, so there is nowhere to store files. Writing them to the release '
      + 'directory is not an option — the next deploy replaces it, and every customer '
      + 'photograph and campaign attachment would go with it. Set S3_BUCKET (and AWS_REGION) '
      + 'in the environment. See deploy/S3_SETUP.md.',
    );
  }
}

/** Why media is unavailable, or null when it is fine. */
export const storageUnavailable = (): StorageUnconfiguredError | null =>
  (process.env.NODE_ENV === 'production' && !BUCKET ? new StorageUnconfiguredError() : null);

const requireStorage = (): void => {
  const problem = storageUnavailable();
  if (problem) throw problem;
};

/**
 * Say so at boot, without refusing to boot.
 *
 * Returns whether media works, so the caller can decide how loud to be. It is deliberately not
 * fatal — see the note at the top of this file.
 */
export const reportStorageAtBoot = (): boolean => {
  const problem = storageUnavailable();
  if (problem) {
    logger.error(
      `${problem.message} The API is starting anyway; everything except files will work, and `
      + 'every attempt to send or store one will be refused until this is set.',
    );
    return false;
  }
  logger.info('Media storage', { backend: storageBackend() });
  return true;
};

export const storageBackend = (): 'S3' | 'DISK' | 'UNCONFIGURED' => {
  if (BUCKET) return 'S3';
  return process.env.NODE_ENV === 'production' ? 'UNCONFIGURED' : 'DISK';
};

/**
 * One client for the process.
 *
 * No credentials passed: the SDK's default chain finds the EC2 instance role in production and
 * whatever a developer has configured locally. Nothing to put in a file, nothing to rotate,
 * nothing to leak.
 */
let client: S3Client | null = null;
const s3 = (): S3Client => {
  client ??= new S3Client({ region: REGION });
  return client;
};

/**
 * Where an object goes.
 *
 * **Tenant first, deliberately.** Everything one workspace owns shares a prefix, which is what
 * makes "how much is this customer storing", "delete everything for this workspace" and a
 * lifecycle rule scoped to one tenant single operations rather than a scan of the bucket. The
 * date segments keep any one prefix from growing without limit, which matters to the console
 * more than to S3 itself.
 *
 * The extension is cosmetic — nothing reads it — but it makes the bucket browsable by a human
 * trying to work out what something is.
 */
export const storageKeyFor = (input: {
  tenantId: string;
  purpose: 'inbound' | 'upload';
  id: string;
  extension?: string | null;
}): string => {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const ext = input.extension?.replace(/[^a-z0-9]/gi, '').slice(0, 8).toLowerCase();
  return `tenants/${input.tenantId}/${input.purpose}/${yyyy}/${mm}/${input.id}${ext ? `.${ext}` : ''}`;
};

/** A disk path for a key, with the traversal check that makes a key safe to join. */
const diskPath = (key: string): string | null => {
  const path = resolve(join(MEDIA_DIR, key));
  // Keys are built by `storageKeyFor` from ids we generated, so this cannot fail today. It is
  // here because the day somebody passes a key from a request is the day it matters.
  return path.startsWith(MEDIA_DIR) ? path : null;
};

export const putObject = async (key: string, body: Buffer, contentType: string): Promise<void> => {
  requireStorage();
  if (!BUCKET) {
    const path = diskPath(key);
    if (!path) throw new Error(`Refusing to write outside the media directory: ${key}`);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
    return;
  }

  await s3().send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: body,
    ContentType: contentType,
  }));
};

/**
 * The bytes, as a stream.
 *
 * Streamed rather than buffered because a 100 MB document held in memory while Express writes
 * it out is 100 MB of heap in a process that also runs the inbound queue.
 *
 * Returns null when the object is missing, rather than throwing — a deleted file and a stale id
 * are the same thing to a caller, and both mean 404.
 */
export const getObjectStream = async (key: string): Promise<Readable | null> => {
  // Throws rather than returning null: "unconfigured" and "this file does not exist" are very
  // different problems, and collapsing them would show an operator a missing-file message when
  // the truth is that nothing was ever stored.
  requireStorage();
  if (!BUCKET) {
    const path = diskPath(key);
    if (!path) return null;
    try {
      await stat(path);
    } catch {
      return null;
    }
    return createReadStream(path);
  }

  try {
    const res = await s3().send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    return res.Body as Readable;
  } catch (err) {
    logger.warn('Media object could not be read', {
      key, error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
};

/** For the rare caller that needs the whole thing in memory. */
export const getObjectBuffer = async (key: string): Promise<Buffer | null> => {
  requireStorage();
  if (!BUCKET) {
    const path = diskPath(key);
    if (!path) return null;
    return readFile(path).catch(() => null);
  }

  const stream = await getObjectStream(key);
  if (!stream) return null;
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
};

/**
 * Remove an object.
 *
 * Never throws. The database row is the record of what exists; a file left behind is untidy,
 * and a delete that fails loudly after the row is gone is a 500 on an operation that already
 * succeeded from the user's point of view.
 */
export const deleteObject = async (key: string): Promise<void> => {
  // No `requireStorage()`, and not an oversight: this one never throws by contract, and with
  // nowhere configured nothing was ever stored, so there is nothing to remove.
  if (storageUnavailable()) return;
  if (!BUCKET) {
    const path = diskPath(key);
    if (path) await unlink(path).catch(() => {});
    return;
  }

  await s3().send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key })).catch((err) => {
    logger.warn('Media object could not be deleted', {
      key, error: err instanceof Error ? err.message : String(err),
    });
  });
};
