import type { MediaKind, MessageType } from '@prisma/client';
import { graphHttp } from '../../services/whatsapp.service.js';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { storeInboundMedia } from './media.service.js';

/*
 * Files a customer sent us.
 *
 * **This runs on receipt, not lazily when an agent opens the conversation, and that is the
 * whole design.** Meta does not hand over the file — it hands over a media *id*, and that id
 * expires. Fetching it when somebody happens to look would work for a few minutes and then
 * stop, and the failure would arrive weeks later as "the photos from last month are all
 * broken". Every photograph sent to this platform before this shipped is already unrecoverable
 * for exactly that reason.
 *
 * Two Graph calls: one to turn the id into a short-lived download URL, one to fetch the bytes.
 * Both go through `graphHttp`, so both inherit the timeout — a stalled media download must not
 * be able to hold an inbound worker.
 */

/** What Meta calls it, and what we call it. */
const KIND_BY_TYPE: Record<string, MediaKind> = {
  image: 'IMAGE',
  video: 'VIDEO',
  document: 'DOCUMENT',
  audio: 'AUDIO',
  // A sticker is a WebP image. Filing it as IMAGE means the Inbox renders it rather than
  // showing a placeholder for a thing it has no concept of.
  sticker: 'IMAGE',
  // A voice note is audio that Meta labels separately because it was recorded rather than
  // attached. Nothing downstream cares about the difference.
  voice: 'AUDIO',
};

/** The `Message.type` for a WhatsApp message type — the mapping that used to say SYSTEM. */
export const messageTypeOf = (whatsappType: string): MessageType => {
  switch (whatsappType) {
    case 'text': return 'TEXT';
    case 'interactive':
    case 'button': return 'INTERACTIVE';
    case 'location': return 'LOCATION';
    case 'image':
    case 'sticker': return 'IMAGE';
    case 'video': return 'VIDEO';
    case 'document': return 'DOCUMENT';
    case 'audio':
    case 'voice': return 'AUDIO';
    // Contacts, reactions, orders, system notices. Genuinely "something else happened".
    default: return 'SYSTEM';
  }
};

export const isMediaType = (whatsappType: string): boolean => whatsappType in KIND_BY_TYPE;

/** The media id and filename Meta buried in the type-specific object. */
const mediaRefOf = (raw: unknown, whatsappType: string): { id: string; filename: string } | null => {
  const message = raw as Record<string, Record<string, string> | undefined> | null;
  const node = message?.[whatsappType];
  if (!node?.id) return null;

  return {
    id: node.id,
    // Only documents carry a real filename. For everything else the id is the least
    // misleading thing to call it until the mime type gives us an extension.
    filename: node.filename || `${whatsappType}-${node.id.slice(-8)}`,
  };
};

export interface CapturedMedia {
  mediaAssetId: string;
  kind: MediaKind;
  mimeType: string;
  sizeBytes: number;
  originalName: string;
}

/**
 * Fetch a customer's file and put it in our own storage.
 *
 * Returns null on any failure, and the caller carries on. **A message must be recorded and
 * answered even when its attachment could not be fetched** — an expired id, a Graph timeout, a
 * bucket misconfiguration. Losing the file is bad; losing the fact that a customer wrote to
 * you, because fetching an image failed, is worse.
 */
export const captureInboundMedia = async (input: {
  tenantId: string;
  accessToken: string;
  whatsappType: string;
  raw: unknown;
}): Promise<CapturedMedia | null> => {
  const ref = mediaRefOf(input.raw, input.whatsappType);
  const kind = KIND_BY_TYPE[input.whatsappType];
  if (!ref || !kind) return null;

  const log = logger.child?.({ tenantId: input.tenantId, mediaId: ref.id }) ?? logger;

  try {
    // 1. The id becomes a URL. Short-lived, single-use in practice, and only fetchable with
    //    the same token — which is why the download below carries the Authorization header
    //    even though the URL already looks like a signed one.
    const meta = await graphHttp.get<{ url?: string; mime_type?: string; file_size?: number }>(
      `https://graph.facebook.com/${env.meta.graphVersion}/${ref.id}`,
      { headers: { Authorization: `Bearer ${input.accessToken}` } },
    );

    if (!meta.data?.url) {
      log.warn('Media id resolved to no URL', { whatsappType: input.whatsappType });
      return null;
    }

    // 2. The bytes.
    const file = await graphHttp.get<ArrayBuffer>(meta.data.url, {
      responseType: 'arraybuffer',
      headers: { Authorization: `Bearer ${input.accessToken}` },
    });

    const buffer = Buffer.from(file.data);
    const mimeType = meta.data.mime_type?.split(';')[0]?.trim() || 'application/octet-stream';

    const asset = await storeInboundMedia({
      tenantId: input.tenantId,
      kind,
      mimeType,
      originalName: ref.filename,
      buffer,
    });

    log.info('Stored inbound media', {
      whatsappType: input.whatsappType, kind, sizeBytes: buffer.length,
    });

    return {
      mediaAssetId: asset.id,
      kind,
      mimeType,
      sizeBytes: buffer.length,
      originalName: ref.filename,
    };
  } catch (err) {
    // Deliberately not rethrown — see the note above. The message still gets recorded.
    log.error('Could not fetch inbound media', {
      whatsappType: input.whatsappType,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
};

/**
 * What to say about a file when the customer sent no caption.
 *
 * Used as the message body so the Inbox, the notification and the assistant all describe the
 * same thing. Without it the body is an empty string, which reaches the router as nothing at
 * all — the customer gets the generic "sorry, I didn't catch that", which reads as though the
 * photo never arrived.
 */
export const describeMedia = (kind: MediaKind, originalName?: string | null): string => {
  switch (kind) {
    case 'IMAGE': return '[photo]';
    case 'VIDEO': return '[video]';
    case 'AUDIO': return '[voice message]';
    case 'DOCUMENT': return originalName ? `[document: ${originalName}]` : '[document]';
    default: return '[attachment]';
  }
};
