import { cn, formatDateTime } from '@/lib/utils';
import { outboundOptions, type Message } from './types';
import { MediaAttachment, hasAttachment } from './MediaAttachment';

// One message.
//
// Outbound is an `accent-600` fill; inbound is a white card on a 1px `ink-300` border. The
// asymmetry is deliberate — the two sides of a conversation should not be two tints of the
// same thing, or a transcript skimmed at speed reads as one voice.
//
// The tail (one square corner on the side the message came from) is the only decoration:
// it survives at a glance in a way that alignment alone does not once bubbles are short.

export function MessageBubble({ message, myId }: { message: Message; myId?: string }) {
  const outbound = message.direction === 'OUTBOUND';
  const options = outboundOptions(message);

  return (
    <div className={cn('flex', outbound && 'justify-end')}>
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

        <p className={cn(
          'mt-1 text-caption tabular-nums',
          outbound ? 'text-on-accent/85' : 'text-ink-500',
        )}
        >
          {formatDateTime(message.createdAt)}
        </p>
      </div>
    </div>
  );
}
