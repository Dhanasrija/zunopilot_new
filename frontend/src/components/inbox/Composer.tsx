import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Bot, CornerUpLeft, ListChecks, Paperclip, SendHorizonal, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { formatBytes } from '@/lib/media';
import { cn } from '@/lib/utils';
import {
  handoverButtons, isTextReply, quickReplyMatches, type QuickReply,
} from '@/lib/quick-replies';

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
//
// **The field is a textarea, not an input, and that is not cosmetic.** An `<input>`'s value cannot
// hold a line break — the browser strips CR and LF silently — so a reply with a blank line between
// two paragraphs was impossible to type and a saved multi-line reply would have been flattened on
// its way in. Enter still sends, because that is what every chat app does; Shift+Enter is the
// newline.

/**
 * How tall the reply field may grow before it scrolls instead.
 *
 * Roughly six lines. Beyond that the thread above is being squeezed out of view, and an agent
 * writing an essay into a chat composer is better served by scrolling than by losing the
 * conversation they are answering.
 */
const MAX_FIELD_PX = 160;

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
  /**
   * Whether a `/` typed into an empty field has opened the saved-reply list.
   *
   * Only ever set by the transition below and cleared by Escape, blur or backspacing past the slash —
   * never derived from `value`, so a `/` in the middle of a message can never open it.
   */
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashActive, setSlashActive] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const slashList = useRef<HTMLDivElement>(null);
  const busy = sending || attaching || askingWithButtons;

  /*
   * Grow with the text, up to a ceiling.
   *
   * `useLayoutEffect` rather than `useEffect`: it runs before paint, so a field that opens holding a
   * long saved reply is never drawn one line tall and then jumped. Reset to `auto` first or
   * `scrollHeight` reports the height it already has and the field can only ever grow.
   *
   * The cap is in the element, not in a class, because the height is set here — a `max-h-*` class
   * would be fighting an inline style.
   */
  useLayoutEffect(() => {
    const node = field.current;
    if (!node) return;
    node.style.height = 'auto';
    node.style.height = `${Math.min(node.scrollHeight, MAX_FIELD_PX)}px`;
  }, [value]);

  const sets = quickReplies ?? [];

  /*
   * ── The two kinds of saved reply, and why only one of them is "staged" ──────
   *
   * A **question** changes what Send means: a different route, a different message type, and
   * possibly a handover. That is what staging is for.
   *
   * A **plain text reply** changes only the words in the field. The ordinary text mutation already
   * sends words, so it is inserted and nothing is staged — no second route, no second home for the
   * 4000-character limit, and nothing to clear afterwards. Send still says "Send", because nothing
   * about the send is unusual.
   */
  const textReplies = sets.filter(isTextReply);
  const questions = sets.filter((set) => !isTextReply(set));

  /**
   * What may be chosen right now.
   *
   * A question needs the 24-hour window; a plain reply needs nothing the text field does not already
   * have. **So `windowClosed` no longer disables this control** — doing that would forbid, one inch
   * to the left, exactly what the field to its right still permits. The questions are absent
   * instead, with a line saying why: a control that does nothing is worse than an absent one.
   */
  const canAsk = !!onSendQuickReply && !windowClosed;
  const offerable = [...textReplies, ...(canAsk ? questions : [])];

  /*
   * Staged only if it is still a question.
   *
   * The list is five minutes stale, so a set whose answers were removed in another tab must degrade
   * to "not staged" rather than to "a question with no answers" — which the server would refuse
   * after the click.
   */
  const staged = sets.find((set) => set.id === quickReplyId && !isTextReply(set)) ?? null;
  /** Which of its answers will hand the thread back to the bot. Published bindings only. */
  const handovers = staged ? handoverButtons(staged) : [];

  /*
   * ── The `/` list ───────────────────────────────────────────────────────────
   *
   * Derived, not stored, and the derivation is the contract: **rows present means the list owns the
   * keyboard; no rows means it is invisible and inert.**
   *
   * That single rule is what stops Enter from ever becoming a dead key. A visible "no matches" panel
   * that did not own Enter would be worse than no panel at all, because the same key would do
   * different things depending on a match count nobody is watching.
   */
  const slashQuery = slashOpen ? value.slice(1) : '';
  const slashMatches = slashOpen
    ? offerable.filter((set) => quickReplyMatches(set, slashQuery))
    : [];
  const slashListOpen = slashMatches.length > 0;

  // Back to the top whenever the query changes, so the highlight is never left pointing at a row
  // that has been filtered out from under it.
  useEffect(() => { setSlashActive(0); }, [slashQuery]);

  // Keep the highlighted row in view — same idiom as the country list.
  useEffect(() => {
    if (!slashListOpen) return;
    slashList.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [slashListOpen, slashActive]);

  /*
   * A question needs words. Everything else follows the file's rule.
   *
   * **The leading guard is the `/` list.** While it is open the field holds a search, not a message,
   * and the composer's whole discipline is that what the agent is looking at and what Send does must
   * never disagree. Without it, clicking Send blurs the field, closes the list, and fires `/deliv` at
   * a customer.
   */
  const canSend = slashListOpen
    ? false
    : (staged ? !!value.trim() && !busy : (file ? !busy : !!value.trim() && !busy));

  const clearQuickReply = () => setQuickReplyId(null);

  /**
   * Put a saved reply into the composer.
   *
   * One function for both entry points, so the dropdown and anything added later cannot drift.
   *
   * **The `null` for a text reply is load-bearing.** Choosing a plain reply while a question is
   * staged has to cancel the question — otherwise the composer holds the question's id with the
   * plain reply's words, and Send fires `onSendQuickReply`, so the customer gets buttons the agent
   * never chose.
   */
  const chooseSet = (set: QuickReply) => {
    // Choosing always dismisses, whichever door it came through.
    setSlashOpen(false);
    setQuickReplyId(isTextReply(set) ? null : set.id);
    // Mutually exclusive with a file: an interactive message with a media header is a real Meta
    // feature and deliberately out of scope, so half-building it would be worse than not offering it.
    setFile(null);
    setRefused(null);
    // The saved words, to edit rather than retype. A starting point — the send carries whatever
    // ends up in the field.
    onChange(set.body);
  };

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

  const askTitle = offerable.length === 0
    ? 'WhatsApp only allows buttons within 24 hours of the customer’s last message'
    : 'Insert a saved reply';

  const fieldLabel = staged ? 'Question' : (file ? 'Caption' : 'Reply');

  /**
   * The keys the `/` list takes, and only while it has rows.
   *
   * **Returns whether it handled the key**, so the field's `onKeyDown` can guard on it and otherwise
   * fall through to exactly the line it had before. That shape is deliberate: Enter-to-send is the
   * composer's oldest behaviour and has two tests on it, and neither may need editing for this.
   *
   * `preventDefault` matters twice for the arrows — without it they would also move the caret to
   * either end of the field, so the list and the cursor would jump at once.
   *
   * `Home`, `End` and `Tab` are deliberately **not** taken: the first two are caret movement and
   * stealing them inside a text field is hostile, and Tab means "leave this control" everywhere else.
   */
  const handleSlashKey = (event: React.KeyboardEvent): boolean => {
    if (!slashListOpen) return false;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      // Clamped rather than wrapping, for consistency with the country list.
      setSlashActive((current) => Math.min(current + 1, slashMatches.length - 1));
      return true;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setSlashActive((current) => Math.max(current - 1, 0));
      return true;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const chosen = slashMatches[slashActive];
      if (chosen) chooseSet(chosen);
      return true;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      /*
       * Closes the list and **changes not one character of the draft.**
       *
       * Escape clearing a field is silent data loss on the key people press when they are confused.
       * What is in the field is literally what will be sent, so leaving `/deliv` behind is a message
       * the agent can see and judge — and Send lights up the moment the list is gone, which is what
       * the footer hint promises.
       *
       * It stays dismissed without a flag: reopening needs the empty-field transition, and the field
       * still holds the query.
       */
      setSlashOpen(false);
      return true;
    }
    return false;
  };

  return (
    // `relative` so the `/` list can be positioned against it — it opens upward, since the composer
    // sits at the bottom of the thread.
    <div className="relative shrink-0 border-t border-ink-300 bg-surface-1 p-3">
      {/*
        The saved replies a `/` has filtered to.
        Hand-built rather than `DropdownMenu` or `Select`: both move focus into themselves, so the
        next keystroke would go to their own typeahead and the filtering would die. `CountrySelect` in
        `ui/phone-field.tsx` solves the same problem the same way, and this follows it.
      */}
      {slashListOpen && (
        <div
          id="composer-saved-replies"
          role="listbox"
          aria-label="Saved replies"
          className="absolute bottom-full left-3 right-3 z-20 mb-2 max-h-64 overflow-y-auto rounded-md border border-ink-300 bg-surface-1 shadow-overlay"
        >
          <div ref={slashList}>
            {slashMatches.map((set, index) => (
              <button
                key={set.id}
                id={`saved-reply-${set.id}`}
                type="button"
                role="option"
                aria-selected={index === slashActive}
                data-active={index === slashActive}
                className={cn(
                  'flex w-full flex-col items-start gap-px px-3 py-2 text-left',
                  index === slashActive && 'bg-accent-100',
                )}
                /*
                  **`preventDefault` on mousedown, and it is not decoration.** It keeps focus in the
                  field, which is what makes dismissing on blur safe — without it the row unmounts
                  before its click can land, which is the classic autocomplete bug.
                */
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setSlashActive(index)}
                onClick={() => chooseSet(set)}
              >
                <span className="w-full truncate text-sm text-ink-900">{set.name}</span>
                <span className="w-full truncate text-caption text-ink-500">
                  {isTextReply(set) ? set.body : `Question · ${set.buttons.length} answers`}
                </span>
              </button>
            ))}
          </div>

          {/*
            The dismissal contract, taught in six words where it is needed.
            After Escape, Send lights up and sends the literal text — which is exactly what this
            promises, so the promise has to be visible before the agent presses anything.
          */}
          <p className="border-t border-ink-300 px-3 py-2 text-caption text-ink-500">
            Enter to insert · Esc to type it as text
          </p>
        </div>
      )}
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
          <div className="flex items-end gap-2">
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

      <div className="flex items-end gap-2">
        {/*
          Rendered whenever the workspace has saved anything, even if none of it can be sent right
          now — because the reason it cannot is worth reading, and an absent control explains nothing.
        */}
        {onSendQuickReply && sets.length > 0 && (
          <Select
            value={quickReplyId ?? ''}
            onValueChange={(id) => {
              const chosen = sets.find((set) => set.id === id);
              if (chosen) chooseSet(chosen);
            }}
            disabled={busy || offerable.length === 0}
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
              {/*
                Grouped rather than marked with a suffix on each name. The heading is not selectable,
                so it cannot be chosen by accident and it does not change what any option is called.
              */}
              {textReplies.length > 0 && (
                <SelectGroup>
                  <SelectLabel>Replies</SelectLabel>
                  {textReplies.map((set) => (
                    <SelectItem key={set.id} value={set.id}>{set.name}</SelectItem>
                  ))}
                </SelectGroup>
              )}

              {canAsk && questions.length > 0 && (
                <SelectGroup>
                  <SelectLabel>Questions with answers</SelectLabel>
                  {questions.map((set) => (
                    <SelectItem key={set.id} value={set.id}>{set.name}</SelectItem>
                  ))}
                </SelectGroup>
              )}

              {/*
                Why the questions are missing, said where they would have been.

                Only when there are some to be missing — a workspace with none has nothing to explain.
              */}
              {!canAsk && questions.length > 0 && (
                <p className="px-3 py-2 text-caption text-ink-500">
                  Questions with answers need the 24-hour window.
                </p>
              )}
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

        <Textarea
          ref={field}
          grows
          rows={1}
          aria-label={fieldLabel}
          value={value}
          aria-autocomplete="list"
          aria-controls={slashListOpen ? 'composer-saved-replies' : undefined}
          aria-activedescendant={
            slashListOpen && slashMatches[slashActive]
              ? `saved-reply-${slashMatches[slashActive]!.id}`
              : undefined
          }
          onChange={(e) => {
            const next = e.target.value;
            /*
             * **The transition, not the state.** `/` only opens the list when it is the first
             * character typed into an empty field — so a paste of `/foo` does not open it, and a `/`
             * in the middle of a message is untouched. That matters more than it sounds: agents type
             * URLs, "and/or", "24/7", "9/10".
             *
             * Not while a file or a question is staged, because the field is then a caption or a
             * question rather than a reply.
             */
            if (value === '' && next === '/' && !file && !staged && offerable.length > 0) {
              setSlashOpen(true);
            } else if (slashOpen && !next.startsWith('/')) {
              // Backspacing past the slash puts the field back to being an ordinary reply.
              setSlashOpen(false);
            }
            onChange(next);
          }}
          onBlur={() => setSlashOpen(false)}
          placeholder={
            staged ? 'Ask a question…' : (file ? 'Add a caption (optional)…' : 'Type a reply…')
          }
          /*
           * Enter sends; Shift+Enter is a newline.
           *
           * The `preventDefault` is what stops Enter also inserting the line break it would
           * normally mean in a textarea — without it every send would leave a trailing newline in
           * the field and, on a slow send, in the message.
           */
          onKeyDown={(e) => {
            // Guard first, fall through unchanged. See `handleSlashKey`.
            if (handleSlashKey(e)) return;
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
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
