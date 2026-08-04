import { useRef } from 'react';
import { Check, FileText, Film, Image as ImageIcon, Trash2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  formatBytes, useDeleteMedia, useMediaLibrary, useMediaRules, useUploadMedia,
  type MediaKind,
} from '@/lib/media';

// Choosing the file that fills a template's media header.
//
// **PARKED — nothing imports this.** Media headers were taken off the New campaign screen;
// `CampaignNew.tsx` disables those templates instead and says why. Everything underneath is
// intact and tested — `MediaAsset`, `/api/media`, the public serving route, and the header
// component in `MetaWhatsAppProvider.sendTemplate` — so turning this back on is one JSX block
// plus `headerMediaId` state. Kept rather than deleted for exactly that reason.
//
// When it does come back: it is only rendered when the selected template declares a media
// header, and the `kind` comes from that template rather than from a choice here. Meta refuses
// a video against an image header, so offering the wrong sort of file would only produce a
// campaign that fails on every message.

const ICON: Record<MediaKind, typeof ImageIcon> = {
  IMAGE: ImageIcon,
  VIDEO: Film,
  DOCUMENT: FileText,
};

const NOUN: Record<MediaKind, string> = {
  IMAGE: 'image',
  VIDEO: 'video',
  DOCUMENT: 'document',
};

export function MediaPicker({ kind, value, onChange }: {
  /** The header format the template declares. Filters the library and the file input. */
  kind: MediaKind;
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  const { data: library = [], isLoading } = useMediaLibrary(kind);
  const { data: rules } = useMediaRules();
  const upload = useUploadMedia();
  const remove = useDeleteMedia();
  const fileInput = useRef<HTMLInputElement>(null);

  const rule = rules?.kinds?.[kind];
  const Icon = ICON[kind];

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={fileInput}
          type="file"
          className="hidden"
          // Narrowed to what Meta accepts for this header, so the file browser cannot offer
          // something the server is about to refuse.
          accept={rule?.mimeTypes.join(',')}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            upload.mutate(file, { onSuccess: (asset) => onChange(asset.id) });
            // Cleared so choosing the same file twice still fires a change.
            e.target.value = '';
          }}
        />
        <Button
          type="button"
          variant="outline"
          className="gap-1"
          disabled={upload.isPending}
          onClick={() => fileInput.current?.click()}
        >
          <Upload className="h-4 w-4" />
          {upload.isPending ? 'Uploading…' : `Upload ${NOUN[kind]}`}
        </Button>
        {rule && <span className="text-caption text-muted-foreground">{rule.label}</span>}
      </div>

      {/*
        In development `APP_URL` is localhost, which Meta cannot fetch. Said here rather than
        letting every send fail with a media download error whose cause is invisible.
      */}
      {rules && !rules.publicUrlReachable && (
        <p className="rounded-md border border-warning/40 bg-warning/15 px-3 py-2 text-caption text-ink-900">
          Media is served from <code>{'APP_URL'}</code>, which is not reachable from the
          internet right now. Meta fetches header media itself, so a real send needs
          <code> APP_URL</code> pointing at a public HTTPS address.
        </p>
      )}

      {isLoading ? (
        <p className="text-caption text-muted-foreground">Loading…</p>
      ) : library.length === 0 ? (
        <p className="text-caption text-muted-foreground">
          No {NOUN[kind]}s uploaded yet. This template needs one before it can send.
        </p>
      ) : (
        <div className="divide-y rounded-md border">
          {library.map((asset) => {
            const selected = value === asset.id;
            return (
              <div
                key={asset.id}
                className={cn(
                  'flex items-center gap-3 px-3 py-2',
                  selected && 'bg-accent-100/40',
                )}
              >
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  onClick={() => onChange(selected ? null : asset.id)}
                >
                  <Icon className="h-4 w-4 shrink-0 text-ink-500" />
                  <span className="min-w-0 flex-1 truncate text-sm text-ink-900">
                    {asset.originalName}
                  </span>
                  <span className="shrink-0 text-caption text-ink-500">
                    {formatBytes(asset.sizeBytes)}
                  </span>
                  {selected && <Badge className="shrink-0 gap-1"><Check className="h-3 w-3" />Chosen</Badge>}
                </button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label={`Delete ${asset.originalName}`}
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(asset.id, {
                    // Clear the selection if the chosen file is the one being deleted, or
                    // the form would submit an id that no longer exists.
                    onSuccess: () => { if (selected) onChange(null); },
                  })}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
