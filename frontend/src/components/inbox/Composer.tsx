import { useRef, useState } from 'react';
import { Bot, CornerUpLeft, ListChecks, Paperclip, SendHorizonal, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { formatBytes } from '@/lib/media';
import { handoverButtons, type QuickReply } from '@/lib/quick-replies';

// The reply box.
//
// **No emoji picker**, though the reference shows one. A control that does nothing is worse
// than an absent one, which is the same call made on the Customers page.
//
// **There is an attachment button**, and there did not use to be. The note that stood here
// said sending media meant "an upload, a Meta media id and a `type` this thread cannot
// render" — all three of those now exist: `POST /media` stores the file, WhatsApp fetches it
// from us by link rather than by media id, and `MediaAttachment` renders every kind.
//
// One file at a time, and the reply field becomes its caption. WhatsApp carries a single
// caption per file, so a picker that took several would have to invent a rule about which
// text belonged to which — and the agent would find out what it chose only after sending.

export function Composer({
  value, onChange, onSend, sending,
  onSendFile, attaching = false, fileAccept, checkFile, windowClosed = false,
  replyingTo, onCancelReply,
  quickReplies, onSendQuickReply, askingWithButtons = false,
}: {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  sending: boolean;
  /** Upload and send a file, with the reply field as its caption. */
  onSendFile?: (file: File, caption: string) => void;
  attaching?: boolean;
  /** The MIME types the server will accept, so the file browser cannot offer a refusal. */
  fileAccept?: string;
  /**
   * Why a chosen file cannot be sent, or null.
   *
   * The `accept` attribute above is a filter, not a guarantee — it says nothing about size,
   * and a person can always pick "All files". Without this, an oversized video was uploaded
   * in full and then refused, or worse, cut off by nginx and reported as a bare 413.
   */
  checkFile?: (file: File) => string | null;
  /**
   * True when 24 hours have passed since the customer last wrote.
   *
   * WhatsApp then accepts templates only, and a template's media is fixed at approval — so
   * there is no version of "send this person a photo" that works. The server refuses it too;
   * this is only so the agent finds out before they pick a file rather than after.
   */
  windowClosed?: boolean;
  /** The message this reply will quote, shown above the field so it cannot be forgotten. */
  replyingTo?: { body?: string | null; type: string; direction: 'INBOUND' | 'OUTBOUND' } | null;
  onCancelReply?: () => void;
  /** The workspace's saved questions. Absent or empty hides the control entirely. */
  quickReplies?: QuickReply[];
  /** Send one, with the reply field as the question. */
  onSendQuickReply?: (quickReplyId: string, body: string) => void;
  askingWithButtons?: boolean;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [refused, setRefused] = useState<string | null>(null);
  /**
   * The staged set, if the agent is asking rather than replying.
   *
   * Local, like `file` and for the same reason: nothing outside the composer reads it, and it has
   * to be cleared when it is sent. `value` stays lifted because the thread and the file path share
   * it.
   */
  const [quickReplyId, setQuickReplyId] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const busy = sending || attaching || askingWithButtons;

  const sets = quickReplies ?? [];
  const staged = sets.find((set) => set.id === quickReplyId) ?? null;
  /** Which of its answers will hand the thread back to the bot. Published bindings only. */
  const handovers = staged ? handoverButtons(staged) : [];

  // A question needs words. Everything else follows the file's rule.
  const canSend = staged ? !!value.trim() && !busy : (file ? !busy : !!value.trim() && !busy);

  const clearQuickReply = () => setQuickReplyId(null);

  const submit = () => {
    if (!canSend) return;
    // Before the file branch: the two are mutually exclusive, and staging one clears the other,
    // but the order makes that impossible to get wrong from here.
    if (staged && onSendQuickReply) {
      onSendQuickReply(staged.id, value.trim());
      clearQuickReply();
      return;
    }
    if (file && onSendFile) {
      onSendFile(file, value.trim());
      setFile(null);
      setRefused(null);
      return;
    }
    onSend();
  };

  const attachTitle = windowClosed
    ? 'WhatsApp only allows a file within 24 hours of the customer’s last message'
    : 'Attach a file';

  const askTitle = windowClosed
    ? 'WhatsApp only allows buttons within 24 hours of the customer’s last message'
    : 'Ask with reply buttons';

  const fieldLabel = staged ? 'Question' : (file ? 'Caption' : 'Reply');

  return (
    <div className="shrink-0 border-t border-ink-300 bg-surface-1 p-3">
      {/*
        What this reply will quote.

        Above the field and impossible to miss, because the quote is invisible in the text you are
        typing — an agent who picked Reply four minutes ago and then wrote something unrelated
        should see what it is about to be attached to. Cancelling is one click.
      */}
      {replyingTo && (
        <div className="mb-2 flex items-start gap-2 rounded-md border-l-2 border-wa-ui-tick bg-surface-2 px-3 py-2">
          <CornerUpLeft aria-hidden className="mt-px h-3.5 w-3.5 shrink-0 text-ink-500" />
          <div className="min-w-0 flex-1">
            <p className="text-caption font-medium text-ink-700">
              Replying to {replyingTo.direction === 'OUTBOUND' ? 'your message' : 'the customer'}
            </p>
            <p className="line-clamp-2 text-caption text-ink-500">
              {replyingTo.body || `[${replyingTo.type.toLowerCase()}]`}
            </p>
          </div>
          {onCancelReply && (
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="Cancel reply"
              disabled={busy}
              onClick={onCancelReply}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      )}

      {/*
        The staged file, named before it is sent. An agent who picked the wrong one from a
        folder of near-identical filenames finds out here rather than from the customer.
      */}
      {/*
        Said here rather than in a toast. The reason is about the file the agent is looking at,
        it names a limit they need while choosing the next one, and a toast is gone in four
        seconds.
      */}
      {refused && (
        <p role="alert" className="mb-2 rounded-md border border-warning/40 bg-warning/15 px-3 py-2 text-caption text-ink-900">
          {refused}
        </p>
      )}

      {file && (
        <div className="mb-2 flex items-center gap-2 rounded-md border border-ink-300 px-3 py-2">
          <Paperclip aria-hidden className="h-4 w-4 shrink-0 text-ink-500" />
          <span className="min-w-0 flex-1 truncate text-sm text-ink-900">{file.name}</span>
          <span className="shrink-0 text-caption text-ink-500">{formatBytes(file.size)}</span>
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label={`Remove ${file.name}`}
            disabled={busy}
            onClick={() => { setFile(null); setRefused(null); }}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}

      {/*
        The staged question, and what tapping each answer will do.

        Above the row, like the quote and the staged file, because all three change what Send means
        and none of them is visible in the text being typed.
      */}
      {staged && (
        <div className="mb-2 rounded-md border border-ink-300 bg-surface-2 px-3 py-2">
          <div className="flex items-center gap-2">
            <ListChecks aria-hidden className="h-4 w-4 shrink-0 text-ink-500" />
            <span className="min-w-0 flex-1 truncate text-caption font-medium text-ink-700">
              {staged.name}
            </span>
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="Cancel the question"
              disabled={busy}
              onClick={clearQuickReply}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>

          {/* The answers exactly as the customer will see them, so there is no guessing. */}
          <div className="mt-2 flex flex-wrap gap-1">
            {staged.buttons.map((button) => (
              <span
                key={button.id}
                className="rounded-full border border-ink-300 bg-surface-1 px-2 py-px text-caption text-ink-700"
              >
                {button.label}
              </span>
            ))}
          </div>

          {/*
            **The consequence, in words, before Send** — not a tooltip and not a colour.

            A tap on a bound answer starts its workflow, and a workflow started into a paused
            conversation would be deaf, so the tap also ends the takeover. That is the agent handing
            the thread back to the bot, and they should be doing it on purpose.
          */}
          {handovers.length > 0 && (
            <p className="mt-2 flex items-start gap-2 text-caption text-ink-500">
              <Bot aria-hidden className="mt-px h-3.5 w-3.5 shrink-0" />
              <span>
                Tapping{' '}
                <span className="font-medium text-ink-700">
                  {handovers.map((b) => b.label).join(' or ')}
                </span>{' '}
                hands this conversation back to the bot.
              </span>
            </p>
          )}
        </div>
      )}

      <div className="flex items-center gap-2">
        {onSendQuickReply && sets.length > 0 && (
          <Select
            value={quickReplyId ?? ''}
            onValueChange={(id) => {
              setQuickReplyId(id);
              // Mutually exclusive with a file: an interactive message with a media header is a
              // real Meta feature and deliberately out of scope, so half-building it here would be
              // worse than not offering it.
              setFile(null);
              setRefused(null);
              // Load the saved question so the agent edits it rather than retyping it. It is a
              // starting point — the send carries whatever ends up in the field.
              const chosen = sets.find((set) => set.id === id);
              if (chosen) onChange(chosen.body);
            }}
            disabled={busy || windowClosed}
          >
            <SelectTrigger
              className="w-auto shrink-0"
              aria-label={askTitle}
              title={askTitle}
            >
              {/* Icon only: the row is already three controls wide, and the label is on the
                  trigger for anyone who cannot see it. */}
              <ListChecks aria-hidden className="h-4 w-4" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {sets.map((set) => (
                <SelectItem key={set.id} value={set.id}>{set.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {onSendFile && (
          <>
            <input
              ref={fileInput}
              type="file"
              className="hidden"
              // Labelled even though it is hidden: the button drives it, but assistive
              // technology and tests both reach the input itself.
              aria-label="Attach a file"
              accept={fileAccept}
              onChange={(e) => {
                const chosen = e.target.files?.[0];
                // Cleared so choosing the same file twice still fires a change.
                e.target.value = '';
                if (!chosen) return;

                const problem = checkFile?.(chosen) ?? null;
                setRefused(problem);
                setFile(problem ? null : chosen);
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="shrink-0"
              aria-label={attachTitle}
              title={attachTitle}
              disabled={busy || windowClosed}
              onClick={() => fileInput.current?.click()}
            >
              <Paperclip className="h-4 w-4" />
            </Button>
          </>
        )}

        <Input
          aria-label={fieldLabel}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={
            staged ? 'Ask a question…' : (file ? 'Add a caption (optional)…' : 'Type a reply…')
          }
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
        />

        {/* Icon plus word: the icon alone reads as "send" to anyone who has used a chat app,
            but the label is what makes it unambiguous the first time and readable to a screen
            reader without an `aria-label` that could drift from what is drawn. */}
        <Button className="shrink-0 gap-2" disabled={!canSend} onClick={submit}>
          <SendHorizonal aria-hidden className="h-4 w-4" />
          {busy ? 'Sending…' : (staged ? 'Ask' : 'Send')}
        </Button>
      </div>
    </div>
  );
}
