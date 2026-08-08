import { X } from 'lucide-react';
import { cn, formatDateTime } from '@/lib/utils';
import { outboundOptions, type Message } from './types';
import { MediaAttachment, hasAttachment } from './MediaAttachment';
import { DeliveryTick } from './DeliveryTick';

// One message.
//
// **WhatsApp's own colours, and that is a reversal of what this file used to say.** Outbound was
// an `accent-600` violet fill, on the argument that "the two sides of a conversation should not
// be two tints of the same thing, or a transcript skimmed at speed reads as one voice."
//
// That argument is coherent and the evidence is against it. WhatsApp's answer is pale green
// against white — two tints of very nearly the same thing — and two billion people read it
// without difficulty, because *position and the tail* carry the distinction and colour only
// confirms it. Meanwhile the violet cost something real: white on `accent-600` is 5.36:1 at
// best, and the faded timestamp on it had already been caught once at 4.05:1. WhatsApp's
// near-black on pale green is **15.75:1**. The familiar choice is also the legible one.
//
// The people using this screen live in WhatsApp all day. Making them learn a second visual
// language for the same conversation was a cost with nothing on the other side of it.
//
// §2.2's hard rule still holds: WhatsApp green is never a *brand* colour. It is not a button, a
// nav item, a heading or a logo here — `accent-600` still owns every action in the product. This
// is the same sanctioned use as a template preview, which is what `wa-ui` exists for.
//
// The tail (one square corner on the side the message came from) is the only decoration:
// it survives at a glance in a way that alignment alone does not once bubbles are short.

export function MessageBubble({ message, myId, canDelete = false, onDelete }: {
  message: Message;
  myId?: string;
  /** `inbox:delete`. Absent for an agent unless the workspace grants it. */
  canDelete?: boolean;
  onDelete?: () => void;
}) {
  const outbound = message.direction === 'OUTBOUND';
  const options = outboundOptions(message);
  const removable = canDelete && !!onDelete;

  return (
    <div className={cn('flex items-center gap-1', outbound && 'justify-end')}>
      {/*
        On the leading edge for an outbound message and the trailing edge for an inbound one, so
        it always sits on the outside of the bubble and never over the text.
      */}
      {removable && outbound && <RemoveButton onDelete={onDelete!} />}

      <div
        className={cn(
          'max-w-[70%] px-3 py-2 text-sm text-wa-ui-ink',
          outbound
            ? 'rounded-lg rounded-br-sm bg-wa-ui-bubble-out'
            // The 1px border stays on the inbound bubble: white on the warm `wa-ui-chat`
            // background is a faint edge, and without it a short message reads as floating text
            // rather than a bubble.
            : 'rounded-lg rounded-bl-sm border border-ink-300 bg-wa-ui-bubble-in',
        )}
      >
        {/*
          Who said this. The whole point of a shared inbox: without it a colleague's reply,
          your own and the bot's all look the same, and nobody can tell whether a customer
          has already been answered.

          `wa-ui-meta` rather than a faded white. The old note here recorded a real fix — white
          at 70% on `accent-600` was 4.05:1 and needed lifting to 85% — and the violet bubble it
          describes is gone, so the fix is moot. `wa-ui-meta` is 4.74:1 on the green bubble and
          5.26:1 on the white one, both held by `check-contrast.mjs`. The lesson survives the
          bubble: metadata is text, and faded text is where contrast quietly fails.
        */}
        {outbound && (
          <p className="mb-1 text-caption font-medium text-wa-ui-meta">
            {message.sentByUser
              ? (message.sentByUser.id === myId ? 'You' : message.sentByUser.fullName)
              : 'Bot'}
          </p>
        )}

        {/*
          The body, then the file.

          `message.body` for a photo with no caption is now a short description written when
          the message was stored — "[photo]" — rather than the empty string it used to be. The
          fallback below still exists for a message type nothing understands, but it no longer
          fires for every image, video and document, which is what made an agent's screen read
          `[SYSTEM]`.
        */}
        {(message.body || !hasAttachment(message)) && (
          <p className="whitespace-pre-wrap break-words">{message.body || `[${message.type}]`}</p>
        )}

        {hasAttachment(message) && <MediaAttachment message={message} outbound={outbound} />}

        {/*
          The choices a list or button message offered. Without these the transcript shows
          the question but not the options, and the customer's next reply — a row id — looks
          like it came from nowhere.
        */}
        {options.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {options.map((o) => (
              <span
                key={o.id}
                title={o.id}
                className={cn(
                  'rounded-full border border-ink-300 bg-surface-1 px-2 py-px text-caption',
                  'text-ink-700',
                )}
              >
                {o.title}
              </span>
            ))}
          </div>
        )}

        {/*
          Time and tick on one line, the way every chat app puts them — and the tick is outbound
          only, because an inbound message's delivery state belongs to the customer's own client.
        */}
        {/* One colour for both sides now: the bubbles differ, the metadata need not. */}
        <div className="mt-1 flex items-center justify-end gap-1 text-caption text-wa-ui-meta">
          <span className="tabular-nums">{formatDateTime(message.createdAt)}</span>
          <DeliveryTick message={message} />
        </div>
      </div>

      {removable && !outbound && <RemoveButton onDelete={onDelete!} />}
    </div>
  );
}

/**
 * Take one message out of the thread.
 *
 * **"Remove", not "Delete", and the title says where it goes.** WhatsApp has no unsend, so the
 * customer keeps their copy whatever this does — a button labelled "Delete" would promise
 * something the platform does not offer. It is also a soft delete: the row survives for reports
 * and for the record of what was said.
 *
 * **Always present, quiet rather than hidden.** The first version revealed it on `group-hover`,
 * which is wrong here for a reason that has nothing to do with taste: **there is no hover on a
 * touch screen**, and this Inbox is built down to 375px — so on a phone the control would simply
 * never appear. Hover-reveal also hides a destructive action behind a gesture, and it depends on
 * a `group-hover` / `focus-within` interaction I could not verify in a browser harness, which is
 * a poor thing to rest an accessibility property on. `ink-350` keeps it from competing with the
 * message; hover and focus bring it to `danger`.
 *
 * No confirmation on a single message. It is one row, an agent can see exactly which one, and a
 * dialog on every tidy-up is the kind of friction that trains people to click through dialogs.
 * Clearing a whole thread does confirm — see `ThreadHeader`.
 */
function RemoveButton({ onDelete }: { onDelete: () => void }) {
  const label = 'Remove from inbox — the customer keeps their copy';

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onDelete}
      className={cn(
        'shrink-0 rounded-md p-1 text-ink-350 transition-colors',
        'hover:bg-surface-2 hover:text-danger focus-visible:text-danger',
      )}
    >
      <X aria-hidden className="h-3.5 w-3.5" />
    </button>
  );
}
