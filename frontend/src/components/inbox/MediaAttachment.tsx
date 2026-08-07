import { Download, FileText, Mic, Video } from 'lucide-react';
import type { Message } from './types';
import { useAuthedMedia } from './useAuthedMedia';

// A file in the thread — one a customer sent, or one an agent sent them.
//
// **What this replaces.** Inbound media was stored as `SYSTEM` with no file behind it, and the
// bubble rendered `message.body || '[' + message.type + ']'` — so an agent opening a thread
// where somebody had photographed a damaged delivery saw a grey box reading `[SYSTEM]`, with
// no way to see the photo and nothing to say what it was.
//
// The bytes come from `/api/media/:id/file`, which is authenticated and tenant-scoped. Not a
// presigned S3 URL: a presigned URL keeps working for anyone holding it until it expires,
// while this one stops the moment the session does. For a photograph of somebody's ID that
// difference is the whole point. `useAuthedMedia` is what carries the token — see its header.

const ICON = { VIDEO: Video, AUDIO: Mic, DOCUMENT: FileText } as const;

const LABEL: Record<string, string> = {
  IMAGE: 'Photo',
  VIDEO: 'Video',
  AUDIO: 'Voice message',
  DOCUMENT: 'Document',
};

/** True when this message has a file we managed to store. */
export const hasAttachment = (message: Message): boolean =>
  Boolean(message.mediaUrl) && message.type in LABEL;

export function MediaAttachment({ message, outbound }: { message: Message; outbound: boolean }) {
  const { url, loading, failed } = useAuthedMedia(message.mediaUrl);
  if (!message.mediaUrl) return null;

  const label = LABEL[message.type] ?? 'Attachment';

  /*
   * An image renders inline; everything else gets a row you can click.
   *
   * Video is deliberately not auto-played and audio is a plain `<audio>` element — an inbox is
   * read in an office, and a voice note that starts playing because somebody scrolled is a
   * thing people learn to dread.
   */
  if (url && message.type === 'IMAGE') {
    return (
      <a href={url} target="_blank" rel="noreferrer" className="mt-1 block">
        <img
          src={url}
          alt={label}
          className="max-h-64 w-auto max-w-full rounded-md border border-ink-300 object-contain"
        />
      </a>
    );
  }

  if (url && message.type === 'VIDEO') {
    return (
      // eslint-disable-next-line jsx-a11y/media-has-caption -- a customer's video has no track
      <video
        src={url}
        controls
        preload="metadata"
        className="mt-1 max-h-64 w-full rounded-md border border-ink-300"
      />
    );
  }

  if (url && message.type === 'AUDIO') {
    return <audio src={url} controls preload="metadata" className="mt-1 w-full" />;
  }

  const Icon = ICON[message.type as keyof typeof ICON] ?? FileText;

  return (
    <a
      href={url ?? undefined}
      // A blob URL opens in a tab with no filename; `download` gives the saved file its name.
      download={url ? label : undefined}
      target="_blank"
      rel="noreferrer"
      aria-disabled={!url}
      className={[
        'mt-1 flex items-center gap-2 rounded-md border p-2 text-caption',
        outbound ? 'border-on-accent/40 text-on-accent' : 'border-ink-300 text-ink-700',
      ].join(' ')}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate">
        {/*
          The failure is named rather than hidden. A file that could not be fetched — an
          expired Meta id, a download that timed out — is a thing the agent needs to know
          about, because the customer believes they sent it.
        */}
        {failed ? `${label} could not be loaded` : loading ? `Loading ${label.toLowerCase()}…` : label}
      </span>
      {url && <Download className="h-4 w-4 shrink-0" />}
    </a>
  );
}
