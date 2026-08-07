import { randomUUID } from 'node:crypto';
import type { MediaKind } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { env } from '../../config/env.js';
import { ApiError } from '../../utils/ApiError.js';
import {
  deleteObject, getObjectStream, putObject, storageKeyFor,
} from './storage.js';

// Media uploaded to fill a template's media header.
//
// **The served URL has to be public.** Meta fetches template media from its own servers
// when the message is sent — it cannot present a bearer token, so no amount of auth on the
// serving route would work. The protection is that the path contains a uuid and nothing
// enumerable, which is the trade every WhatsApp integration makes. Worth stating plainly
// rather than leaving somebody to infer it from an unauthenticated route.

/**
 * What each header format will accept, and how large.
 *
 * The ceilings are **Meta's**, not ours — a file over them is rejected by the Graph API at
 * send time, once per recipient, which is a campaign that fails hundreds of times for a
 * reason visible only in a log. Refusing at upload is the same rule enforced somewhere a
 * person can act on it.
 */
type HeaderKind = Extract<MediaKind, 'IMAGE' | 'VIDEO' | 'DOCUMENT'>;

// AUDIO is deliberately absent: a customer can send a voice note, a template header cannot
// be one, and this table is only about what may be uploaded to fill a header.
const RULES: Record<HeaderKind, { mimeTypes: string[]; maxBytes: number; label: string }> = {
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
export const kindForMime = (mimeType: string): HeaderKind | null => {
  for (const [kind, rule] of Object.entries(RULES)) {
    if (rule.mimeTypes.includes(mimeType)) return kind as HeaderKind;
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

  const id = randomUUID();
  const storageKey = storageKeyFor({
    tenantId: input.tenantId,
    purpose: 'upload',
    id,
    extension: input.originalName.split('.').pop(),
  });
  await putObject(storageKey, input.buffer, input.mimeType);

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
  await deleteObject(asset.storageKey);
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
    select: {
      storageKey: true, mimeType: true, sizeBytes: true, originalName: true, source: true,
    },
  });
  if (!asset) return null;

  /*
   * **An inbound file is never served here.** This route is unauthenticated because Meta has
   * to fetch template media without a token, and that trade is acceptable for an image a
   * business chose to broadcast. It is not acceptable for a photograph a customer sent —
   * a damaged delivery, an ID, a prescription. Those go through `openForTenant` below, which
   * checks who is asking. Same answer as a missing file, so the route cannot be used to
   * discover that an id exists.
   */
  if (asset.source !== 'UPLOAD') return null;

  const stream = await getObjectStream(asset.storageKey);
  if (!stream) return null;
  return { ...asset, stream: () => stream };
};

/**
 * Open an inbound file for somebody who works at the business that received it.
 *
 * The tenant is in the `where`, not checked afterwards, so there is no version of this that
 * returns another workspace's customer's photograph.
 */
export const openForTenant = async (tenantId: string, id: string) => {
  const asset = await prisma.mediaAsset.findFirst({
    where: { id, tenantId },
    select: { storageKey: true, mimeType: true, sizeBytes: true, originalName: true },
  });
  if (!asset) return null;

  const stream = await getObjectStream(asset.storageKey);
  if (!stream) return null;
  return { ...asset, stream: () => stream };
};

/**
 * Store a file a customer sent us.
 *
 * Separate from `storeUpload` because the rules are different in both directions: the MIME
 * type is whatever the customer's phone produced rather than something from our list, and
 * there is no uploading user. What it must not do is inherit `source: UPLOAD` and become
 * publicly readable.
 */
export const storeInboundMedia = async (input: {
  tenantId: string;
  kind: MediaKind;
  mimeType: string;
  originalName: string;
  buffer: Buffer;
}): Promise<{ id: string; storageKey: string }> => {
  const id = randomUUID();
  const storageKey = storageKeyFor({
    tenantId: input.tenantId,
    purpose: 'inbound',
    id,
    extension: input.mimeType.split('/').pop(),
  });

  await putObject(storageKey, input.buffer, input.mimeType);

  const asset = await prisma.mediaAsset.create({
    data: {
      id,
      tenantId: input.tenantId,
      kind: input.kind,
      mimeType: input.mimeType,
      sizeBytes: input.buffer.length,
      originalName: input.originalName.slice(0, 200),
      storageKey,
      source: 'INBOUND',
    },
    select: { id: true, storageKey: true },
  });

  return asset;
};
