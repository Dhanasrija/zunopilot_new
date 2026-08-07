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
 * **The choice is made once, at boot, and production has no fallback.** If `S3_BUCKET` is
 * unset in production the process refuses to start. Quietly writing to disk instead is exactly
 * the failure this codebase has had five separate times: an absent environment variable that
 * reads as a working configuration, discovered weeks later when the files are gone. A server
 * that will not start is a loud, immediate, five-minute problem; a server that silently stores
 * customer photographs in a directory the next deploy deletes is not.
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

/**
 * Fail at boot rather than at the first photograph.
 *
 * Called from the startup checks. The message names the variable and the consequence, because
 * the person reading it at 2am is not the person who wrote this.
 */
export const assertStorageConfigured = (): void => {
  if (process.env.NODE_ENV === 'production' && !BUCKET) {
    throw new Error(
      'S3_BUCKET is not set. Media would be written to the release directory, which the next '
      + 'deploy replaces — every customer photograph and campaign attachment would be lost with '
      + 'it. Set S3_BUCKET (and AWS_REGION) in the environment. See deploy/S3_SETUP.md.',
    );
  }
};

export const storageBackend = (): 'S3' | 'DISK' => (BUCKET ? 'S3' : 'DISK');

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
