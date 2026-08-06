import {
  ExternalLink, FileText, Film, Image as ImageIcon, MapPin, Phone, Reply,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { TemplateHeaderFormat } from '@/lib/media';

// What the customer will actually receive.
//
// The campaign screen used to show the body text in a grey box, which told an operator the
// words but not the shape — a template with a footer, three buttons and an image header reads
// nothing like its body alone, and the whole point of a preview is to catch "this is not what
// I meant" before several hundred people get it.
//
// **Not WhatsApp's colours.** brand-guidelines §2.2 reserves WhatsApp green for connection
// status and delivered/read ticks, never decoration, so this is a message-shaped preview on
// brand surfaces rather than a facsimile of the app. It is labelled as a preview for the same
// reason: Meta renders the approved template, so this is our reading of it, not the article.

export interface TemplateButton {
  type: string;
  text: string;
}

export interface PreviewTemplate {
  headerFormat: TemplateHeaderFormat;
  headerText: string | null;
  bodyPreview: string;
  footerText: string | null;
  buttons: TemplateButton[];
}

/** The icon for a media header's placeholder block. */
const MEDIA_ICON = {
  IMAGE: ImageIcon,
  VIDEO: Film,
  DOCUMENT: FileText,
} as const;

/**
 * Button kinds we can name. Anything else keeps its label and gets no icon — see the
 * `buttonsOf` note in `template-sync.service.ts` for why unknown kinds are shown rather
 * than dropped.
 */
const BUTTON_ICON: Record<string, typeof Reply> = {
  QUICK_REPLY: Reply,
  URL: ExternalLink,
  PHONE_NUMBER: Phone,
  VOICE_CALL: Phone,
  COPY_CODE: FileText,
  CATALOG: ExternalLink,
  MPM: ExternalLink,
  FLOW: ExternalLink,
  LOCATION: MapPin,
};

/**
 * Body text with `{{1}}` placeholders made visible.
 *
 * Rendered as chips rather than left as literal braces, because an operator reading
 * "Hi {{1}}, 20% off" needs to see at a glance that the name is filled in per recipient. A
 * template whose placeholders are never populated is a message that arrives saying `{{1}}`,
 * and this is where that becomes obvious.
 */
const withPlaceholders = (text: string) => {
  const parts = text.split(/(\{\{\s*\d+\s*\}\})/g);
  return parts.map((part, index) => {
    const match = /^\{\{\s*(\d+)\s*\}\}$/.exec(part);
    if (!match) return <span key={index}>{part}</span>;
    return (
      <span
        key={index}
        className="rounded-sm bg-accent-100 px-1 font-medium text-accent-700"
        title={`Placeholder ${match[1]} — filled in for each recipient`}
      >
        {part}
      </span>
    );
  });
};

export function TemplatePreview({
  template,
  className,
}: {
  template: PreviewTemplate;
  className?: string;
}) {
  const mediaHeader = template.headerFormat === 'IMAGE'
    || template.headerFormat === 'VIDEO'
    || template.headerFormat === 'DOCUMENT'
    ? template.headerFormat
    : null;
  const MediaIcon = mediaHeader ? MEDIA_ICON[mediaHeader] : null;

  return (
    <div className={cn('rounded-md border border-ink-300 bg-surface-0 p-4', className)}>
      <p className="mb-3 text-caption uppercase tracking-caption text-ink-500">Preview</p>

      {/* The bubble. §4.4 makes a 1px border the elevation model, so no shadow. */}
      <div className="max-w-sm overflow-hidden rounded-lg border border-ink-300 bg-surface-1">
        {mediaHeader && MediaIcon && (
          // A media header's content comes from the approved template, so there is nothing
          // to show but its shape. Saying which kind is the useful part.
          <div className="flex h-24 items-center justify-center gap-2 border-b border-ink-300 bg-surface-0 text-ink-500">
            <MediaIcon className="h-4 w-4" />
            <span className="text-caption">
              {mediaHeader.charAt(0) + mediaHeader.slice(1).toLowerCase()} from the approved
              template
            </span>
          </div>
        )}

        <div className="space-y-2 p-3">
          {template.headerText && (
            <p className="text-sm font-semibold text-ink-900">
              {withPlaceholders(template.headerText)}
            </p>
          )}

          <p className="whitespace-pre-wrap text-sm text-ink-900">
            {withPlaceholders(template.bodyPreview)}
          </p>

          {template.footerText && (
            // Meta renders the footer in a lighter, smaller style than the body, and an
            // operator should see that their disclaimer will be the quietest line.
            <p className="text-caption text-ink-500">{template.footerText}</p>
          )}
        </div>

        {template.buttons.length > 0 && (
          <div className="border-t border-ink-300">
            {template.buttons.map((button, index) => {
              const Icon = BUTTON_ICON[button.type];
              return (
                <div
                  key={`${button.type}-${button.text}-${index}`}
                  className={cn(
                    'flex items-center justify-center gap-1 px-3 py-2 text-sm text-accent-600',
                    index > 0 && 'border-t border-ink-300',
                  )}
                >
                  {Icon && <Icon className="h-3 w-3" />}
                  {button.text}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <p className="mt-3 text-caption text-ink-500">
        How this reads on a phone. WhatsApp does the final rendering, so spacing and button
        placement can differ slightly.
      </p>
    </div>
  );
}
