import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';

// Media for template headers.

export type MediaKind = 'IMAGE' | 'VIDEO' | 'DOCUMENT';

/** The header formats that need a file. `TEXT` and `NONE` are headers that do not. */
export type TemplateHeaderFormat = 'NONE' | 'TEXT' | MediaKind;
export const MEDIA_HEADERS: TemplateHeaderFormat[] = ['IMAGE', 'VIDEO', 'DOCUMENT'];
export const needsMedia = (format: TemplateHeaderFormat | undefined): format is MediaKind =>
  !!format && MEDIA_HEADERS.includes(format);

export interface MediaAsset {
  id: string;
  kind: MediaKind;
  mimeType: string;
  sizeBytes: number;
  originalName: string;
  /** The public URL Meta will fetch. */
  url: string;
  createdAt: string;
}

export interface MediaRules {
  kinds: Record<MediaKind, { mimeTypes: string[]; maxBytes: number; label: string }>;
  /**
   * Whether `APP_URL` is something Meta could actually reach.
   *
   * False in development, where it is `http://localhost:4000`. Surfaced on the page because
   * the alternative is a campaign that starts, fails every send with a media download error,
   * and explains itself only in a server log.
   */
  publicUrlReachable: boolean;
}

export const useMediaRules = () => useQuery({
  queryKey: ['media-rules'],
  queryFn: async () => (await api.get<{ data: MediaRules }>('/media/rules')).data.data,
  staleTime: 5 * 60_000,
});

export const useMediaLibrary = (kind?: MediaKind) => useQuery({
  queryKey: ['media', kind ?? 'all'],
  queryFn: async () => (await api.get<{ data: MediaAsset[] }>('/media', {
    params: kind ? { kind } : {},
  })).data.data,
});

export const useUploadMedia = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append('file', file);
      // No explicit Content-Type: the browser has to set the multipart boundary, and
      // overriding it with 'multipart/form-data' produces a body the server cannot parse.
      const response = await api.post<{ data: MediaAsset }>('/media', form);
      return response.data.data;
    },
    onSuccess: (asset) => {
      toast.success(`${asset.originalName} uploaded`);
      qc.invalidateQueries({ queryKey: ['media'] });
    },
    // Size and type refusals come back from the server with a readable message, which the
    // api client already toasts.
  });
};

export const useDeleteMedia = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => api.delete(`/media/${id}`),
    onSuccess: () => {
      toast.success('Media deleted');
      qc.invalidateQueries({ queryKey: ['media'] });
    },
  });
};

/**
 * Why this file cannot be sent, or null when it can.
 *
 * Checked in the browser as well as on the server, which is worth the duplication here: the
 * server's refusal costs a full upload first, and for a 20 MB video over a phone connection
 * that is a minute of waiting for a no. Bigger still and it never reaches the server at all —
 * nginx caps the request body and answers 413 with no message of its own.
 *
 * The rules come from `GET /media/rules`, so this reads the server's numbers rather than
 * keeping a second copy that would drift.
 */
export const rejectReason = (file: File, rules: MediaRules | undefined): string | null => {
  if (!rules) return null; // Not loaded yet — let the server decide rather than guess.

  const kinds = Object.values(rules.kinds);
  const rule = kinds.find((k) => k.mimeTypes.includes(file.type));
  if (!rule) {
    const accepted = kinds.map((k) => k.label).join('; ');
    return file.type
      ? `WhatsApp will not accept a ${file.type} file. Send one of: ${accepted}.`
      : `That file type cannot be identified. Send one of: ${accepted}.`;
  }

  if (file.size > rule.maxBytes) {
    return `That file is ${formatBytes(file.size)}. The limit is ${rule.label}.`;
  }

  return null;
};

export const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};
