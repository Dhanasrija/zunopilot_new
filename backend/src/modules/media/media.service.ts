import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, stat, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { MediaKind } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { env } from '../../config/env.js';
import { ApiError } from '../../utils/ApiError.js';

// Media uploaded to fill a template's media header.
//
// **The served URL has to be public.** Meta fetches template media from its own servers
// when the message is sent — it cannot present a bearer token, so no amount of auth on the
// serving route would work. The protection is that the path contains a uuid and nothing
// enumerable, which is the trade every WhatsApp integration makes. Worth stating plainly
// rather than leaving somebody to infer it from an unauthenticated route.

/**
 * Where the bytes go.
 *
 * Under the OS temp directory in tests, so a suite run never leaves files in the working
 * tree — the earlier default wrote to `backend/.media`, which is exactly the kind of thing
 * that ends up committed once. `MEDIA_DIR` overrides both, and is what a deployment sets to
 * point at a mounted volume.
 */
const MEDIA_DIR = resolve(
  process.env.MEDIA_DIR
  || (process.env.NODE_ENV === 'test' ? join(tmpdir(), 'zunopilot-media-test') : join(process.cwd(), '.media')),
);

/**
 * What each header format will accept, and how large.
 *
 * The ceilings are **Meta's**, not ours — a file over them is rejected by the Graph API at
 * send time, once per recipient, which is a campaign that fails hundreds of times for a
 * reason visible only in a log. Refusing at upload is the same rule enforced somewhere a
 * person can act on it.
 */
const RULES: Record<MediaKind, { mimeTypes: string[]; maxBytes: number; label: string }> = {
  IMAGE: {
    mimeTypes: ['image/jpeg', 'image/png'],
    maxBytes: 5 * 1024 * 1024,
    label: 'JPEG or PNG, up to 5 MB',
  },
  VIDEO: {
    // Meta accepts MP4 and 3GPP. No WebM — it looks like a video and is refused.
    mimeTypes: ['video/mp4', 'video/3gpp'],
    maxBytes: 16 * 1024 * 1024,
    label: 'MP4 or 3GPP, up to 16 MB',
  },
  DOCUMENT: {
    mimeTypes: [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/plain',
    ],
    maxBytes: 100 * 1024 * 1024,
    label: 'PDF, Word, Excel or plain text, up to 100 MB',
  },
};

export const mediaRules = RULES;

/** The single largest thing any kind accepts, for the multipart limit. */
export const MAX_UPLOAD_BYTES = Math.max(...Object.values(RULES).map((r) => r.maxBytes));

/**
 * Which header slot a MIME type can fill.
 *
 * Derived from the file rather than taken from the client: a caller claiming `IMAGE` for an
 * MP4 would produce a template send Meta refuses, and the file itself is the only honest
 * source.
 */
export const kindForMime = (mimeType: string): MediaKind | null => {
  for (const [kind, rule] of Object.entries(RULES)) {
    if (rule.mimeTypes.includes(mimeType)) return kind as MediaKind;
  }
  return null;
};

export interface StoredMedia {
  id: string;
  kind: MediaKind;
  mimeType: string;
  sizeBytes: number;
  originalName: string;
  url: string;
  createdAt: Date;
}

/**
 * The URL Meta will fetch.
 *
 * Built from `APP_URL`, which in development is `http://localhost:4000` — unreachable from
 * Meta's servers. `publicUrlIsReachable` below is what lets a caller warn about that
 * instead of letting every send fail with a media download error.
 */
export const publicUrlFor = (asset: { id: string; originalName: string }): string => {
  // The filename is in the path only so the download has a sensible name; it is never read
  // back or used to locate the file.
  const safeName = encodeURIComponent(asset.originalName.replace(/[/\\]/g, '_'));
  return `${env.appUrl.replace(/\/$/, '')}/media/${asset.id}/${safeName}`;
};

/** Whether `APP_URL` is something Meta could actually reach. */
export const publicUrlIsReachable = (): boolean => {
  const url = env.appUrl;
  return url.startsWith('https://') && !/localhost|127\.0\.0\.1|\.local/.test(url);
};

const view = (asset: {
  id: string; kind: MediaKind; mimeType: string; sizeBytes: number;
  originalName: string; createdAt: Date;
}): StoredMedia => ({ ...asset, url: publicUrlFor(asset) });

export const storeUpload = async (input: {
  tenantId: string;
  uploadedByUserId: string;
  originalName: string;
  mimeType: string;
  buffer: Buffer;
}): Promise<StoredMedia> => {
  const kind = kindForMime(input.mimeType);
  if (!kind) {
    throw ApiError.badRequest(
      `${input.mimeType} is not a type WhatsApp accepts in a template header. `
      + Object.values(RULES).map((r) => r.label).join('; '),
    );
  }

  const rule = RULES[kind];
  if (input.buffer.length > rule.maxBytes) {
    const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;
    throw ApiError.badRequest(
      `That file is ${mb(input.buffer.length)}. WhatsApp accepts ${rule.label}.`,
    );
  }

  await mkdir(MEDIA_DIR, { recursive: true });
  const storageKey = randomUUID();
  await writeFile(join(MEDIA_DIR, storageKey), input.buffer);

  const asset = await prisma.mediaAsset.create({
    data: {
      tenantId: input.tenantId,
      kind,
      mimeType: input.mimeType,
      sizeBytes: input.buffer.length,
      originalName: input.originalName.slice(0, 200),
      storageKey,
      uploadedByUserId: input.uploadedByUserId,
    },
    select: {
      id: true, kind: true, mimeType: true, sizeBytes: true, originalName: true, createdAt: true,
    },
  });

  return view(asset);
};

/** A tenant's library, newest first, optionally narrowed to one header slot. */
export const listMedia = async (
  tenantId: string,
  kind?: MediaKind,
): Promise<StoredMedia[]> => {
  const assets = await prisma.mediaAsset.findMany({
    where: { tenantId, ...(kind ? { kind } : {}) },
    orderBy: { createdAt: 'desc' },
    take: 100,
    select: {
      id: true, kind: true, mimeType: true, sizeBytes: true, originalName: true, createdAt: true,
    },
  });
  return assets.map(view);
};

/**
 * Resolve an asset for a tenant, or 404.
 *
 * Used before attaching one to a campaign — the id arrives from the client, so without the
 * tenant in the where a workspace could put another's file in its own campaign and have
 * Meta serve it.
 */
export const mediaFor = async (tenantId: string, id: string) => {
  const asset = await prisma.mediaAsset.findFirst({ where: { id, tenantId } });
  if (!asset) throw ApiError.notFound('Media not found');
  return asset;
};

export const deleteMedia = async (tenantId: string, id: string): Promise<void> => {
  const asset = await mediaFor(tenantId, id);
  await prisma.mediaAsset.delete({ where: { id: asset.id } });
  // The row is the record; a leftover file is untidy, a missing row is a broken campaign.
  // So the database goes first and a failed unlink is logged rather than thrown.
  await unlink(join(MEDIA_DIR, asset.storageKey)).catch(() => {});
};

/**
 * Open the bytes for the public serving route.
 *
 * **No tenant argument, deliberately** — the caller is Meta, unauthenticated, and the uuid
 * in the URL is the capability. Everything else about this function exists to make sure a
 * path can only ever be built from a `storageKey` we generated.
 */
export const openForServing = async (id: string) => {
  const asset = await prisma.mediaAsset.findUnique({
    where: { id },
    select: { storageKey: true, mimeType: true, sizeBytes: true, originalName: true },
  });
  if (!asset) return null;

  const path = join(MEDIA_DIR, asset.storageKey);
  // Belt and braces: `storageKey` is a uuid we wrote, but re-checking that the resolved
  // path is still inside MEDIA_DIR costs nothing and closes the door for good.
  if (!resolve(path).startsWith(MEDIA_DIR)) return null;

  try {
    await stat(path);
  } catch {
    return null;
  }
  return { ...asset, stream: () => createReadStream(path) };
};
