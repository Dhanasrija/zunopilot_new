import { X } from 'lucide-react';
import { cn, formatDateTime } from '@/lib/utils';
import { outboundOptions, type Message } from './types';
import { MediaAttachment, hasAttachment } from './MediaAttachment';
import { DeliveryTick } from './DeliveryTick';

// One message.
//
// Outbound is an `accent-600` fill; inbound is a white card on a 1px `ink-300` border. The
// asymmetry is deliberate — the two sides of a conversation should not be two tints of the
// same thing, or a transcript skimmed at speed reads as one voice.
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
          'max-w-[70%] px-3 py-2 text-sm',
          outbound
            ? 'rounded-lg rounded-br-sm bg-accent-600 text-on-accent'
            : 'rounded-lg rounded-bl-sm border border-ink-300 bg-surface-1 text-ink-900',
        )}
      >
        {/*
          Who said this. The whole point of a shared inbox: without it a colleague's reply,
          your own and the bot's all look the same, and nobody can tell whether a customer
          has already been answered.

          `/85`, not the `/70` this used to be. White at 70% on `accent-600` measures 4.05:1
          and at 80% 4.49:1 — both under §2.4's 4.5 for text this size, on the sender label
          and on the timestamp below, in every outbound bubble in the product. 85% is 4.70:1,
          and `check-contrast.mjs` now holds the pair so it cannot drift back.
        */}
        {outbound && (
          <p className="mb-1 text-caption font-medium text-on-accent/85">
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
                  'rounded-full border px-2 py-px text-caption',
                  outbound
                    ? 'border-on-accent/35 text-on-accent/90'
                    : 'border-ink-300 bg-surface-0 text-ink-700',
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
        <div className={cn(
          'mt-1 flex items-center justify-end gap-1 text-caption',
          outbound ? 'text-on-accent/85' : 'text-ink-500',
        )}
        >
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
