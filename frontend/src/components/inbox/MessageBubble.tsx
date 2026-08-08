import { AlertCircle, ChevronDown, CornerUpLeft, Trash2 } from 'lucide-react';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn, formatDateTime } from '@/lib/utils';
import { outboundOptions, type Message } from './types';
import { MediaAttachment, hasAttachment } from './MediaAttachment';
import { Linkify } from './Linkify';
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

export function MessageBubble({ message, myId, canDelete = false, onDelete, onReply }: {
  message: Message;
  myId?: string;
  /** `inbox:delete`. Absent for an agent unless the workspace grants it. */
  canDelete?: boolean;
  onDelete?: () => void;
  /** Quote this message in the composer. Absent for someone who cannot reply. */
  onReply?: () => void;
}) {
  const outbound = message.direction === 'OUTBOUND';
  const options = outboundOptions(message);
  const actions = [
    onReply && { key: 'reply', label: 'Reply', icon: CornerUpLeft, run: onReply },
    canDelete && onDelete && {
      key: 'delete',
      // "Remove from inbox", not "Delete". WhatsApp has no unsend, so the customer keeps their
      // copy — and this is a soft delete besides. A menu has room for the accurate word.
      label: 'Remove from inbox',
      icon: Trash2,
      run: onDelete,
    },
  ].filter(Boolean) as Array<{ key: string; label: string; icon: typeof Trash2; run: () => void }>;

  return (
    <div className={cn('flex items-center gap-1', outbound && 'justify-end')}>
      {/*
        On the leading edge for an outbound message and the trailing edge for an inbound one, so
        it always sits on the outside of the bubble and never over the text.
      */}
      {actions.length > 0 && outbound && <MessageActions actions={actions} />}

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
        {/*
          What this message replies to.
          A left bar and the quoted text, WhatsApp's own shape. Not clickable: scrolling a
          transcript to a message that may be 400 rows up is its own piece of work, and a link
          that jumps somewhere unhelpful is worse than text that does not pretend to.
        */}
        {message.replyTo && (
          <div
            className={cn(
              'mb-1 border-l-2 pl-2 text-caption',
              // The bar takes the colour of whoever is being quoted, so "you are quoting the
              // customer" and "you are quoting yourself" are distinguishable at a glance.
              message.replyTo.direction === 'OUTBOUND' ? 'border-wa-ui-tick' : 'border-ink-400',
            )}
          >
            <p className="font-medium text-wa-ui-meta">
              {message.replyTo.direction === 'OUTBOUND' ? 'You' : 'Customer'}
            </p>
            <p className="line-clamp-2 whitespace-pre-wrap break-words text-wa-ui-meta">
              {message.replyTo.body || `[${message.replyTo.type.toLowerCase()}]`}
            </p>
          </div>
        )}

        {(message.body || !hasAttachment(message)) && (
          <p className="whitespace-pre-wrap break-words">
            {message.body ? <Linkify text={message.body} /> : `[${message.type}]`}
          </p>
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
          Why it did not arrive.

          **In the bubble, not in a tooltip.** The reason was already on the tick as `title`, and
          that made it invisible in practice: a native tooltip needs a hover held for about a
          second, and **there is no hover on a touch screen** — the same mistake the actions menu
          below was already corrected for. An agent looking at a red icon with no text has no way
          to tell "the 24-hour window closed" from "this number is not on the allow-list", and
          those want opposite responses: send a template, or stop retrying.

          `no reason recorded` rather than `WhatsApp gave no reason`, because both are possible
          and they are not distinguishable from here. Meta only attaches `errors[]` to some
          failures — and any message that failed before delivery statuses were captured has
          nothing stored either way. Meta never replays a status webhook, so those are gone for
          good; claiming WhatsApp was silent would be inventing a fact about the past.
        */}
        {outbound && message.status === 'FAILED' && (
          <p className="mt-1 flex items-start gap-1 rounded-md bg-danger/10 px-2 py-1 text-caption text-danger">
            <AlertCircle aria-hidden className="mt-px h-3 w-3 shrink-0" />
            <span className="min-w-0 break-words">
              {message.statusError
                ? `Not delivered — ${message.statusError}`
                : 'Not delivered — no reason recorded'}
            </span>
          </p>
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

      {actions.length > 0 && !outbound && <MessageActions actions={actions} />}
    </div>
  );
}

/**
 * The actions available on one message.
 *
 * A menu rather than a row of icons, which is what WhatsApp does and for the same reason: the
 * list is going to grow. Reply and Remove today; React, Star, Pin, Forward and Copy are the
 * obvious candidates, and each of those as its own visible button would put five controls beside
 * every bubble in a thread of five hundred.
 *
 * **Always present, quiet rather than hidden.** An earlier version revealed the control on
 * `group-hover`, which is wrong here for a reason that is not taste: **there is no hover on a
 * touch screen** and this Inbox is built down to 375px, so on a phone it would never have
 * appeared at all. `ink-350` keeps it from competing with the message.
 *
 * No confirmation on either action. Reply is not destructive, and Remove is one row an agent can
 * see — a dialog on every tidy-up is the friction that trains people to click through dialogs.
 * Clearing a whole thread does confirm; see `ThreadHeader`.
 */
function MessageActions({ actions }: {
  actions: Array<{ key: string; label: string; icon: typeof Trash2; run: () => void }>;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Message actions"
          title="Message actions"
          className={cn(
            'shrink-0 rounded-md p-1 text-ink-350 transition-colors',
            'hover:bg-surface-2 hover:text-ink-700 focus-visible:text-ink-700',
          )}
        >
          <ChevronDown aria-hidden className="h-3.5 w-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {actions.map(({ key, label, icon: Icon, run }) => (
          <DropdownMenuItem key={key} onClick={run}>
            <Icon aria-hidden className="mr-2 h-3.5 w-3.5" />
            {label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
