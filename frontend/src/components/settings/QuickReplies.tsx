import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, ChevronDown, ListChecks, MessageSquare, Plus, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { EmptyState } from '@/components/ui/empty-state';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  QUICK_REPLY_LIMITS, bodyLimitFor, createQuickReply, deleteQuickReply, fetchQuickReplies,
  isTextReply, updateQuickReply, type QuickReply,
} from '@/lib/quick-replies';

// Replies a team sends often, in two kinds.
//
// **No answers is a plain text reply; one to three make it a question.** The same row either way, so
// an operator turns one into the other by adding or removing rows — and the editor has to say what
// emptiness means, because nothing about a blank Answers section announces "this will send as text".
//
// **This screen is where a button gets its meaning, which is why it is not in the Inbox.** An
// answer can be bound to a workflow, so a tap starts it — and that is configuration to be written
// once and reviewed, not typed into a chat box while a customer waits. It also means this screen
// needs `automation:write` while sending needs only `inbox:reply`.
//
// The one thing the form has to say out loud is the consequence of binding: a tap on a bound answer
// hands the conversation back to the bot. An agent who has taken a thread over will not expect that
// unless somebody tells them, so it is said here and again in the composer.

/** A published workflow, for the binding picker. */
interface Publishable { id: string; name: string; status: string }

interface Draft {
  id: string | null;
  name: string;
  body: string;
  buttons: Array<{ label: string; workflowId: string | null }>;
}

/**
 * A plain text reply — no answers, and the default.
 *
 * The common case by some distance: a team saves its opening hours long before it saves a question.
 */
const BLANK_TEXT: Draft = { id: null, name: '', body: '', buttons: [] };

/**
 * A question, which starts with two blank rows.
 *
 * Two because a single button is a worse message than plain text — though one is allowed, so an
 * operator who removes a row is not stuck. **A separate starting point rather than the default**:
 * flipping the default to zero rows without offering this would make questions markedly harder to
 * discover, since nothing on an empty form suggests answers exist.
 */
const BLANK_QUESTION: Draft = {
  ...BLANK_TEXT,
  buttons: [{ label: '', workflowId: null }, { label: '', workflowId: null }],
};

const NONE = 'none';

const draftOf = (set: QuickReply): Draft => ({
  id: set.id,
  name: set.name,
  body: set.body,
  buttons: set.buttons.map((button) => ({ label: button.label, workflowId: button.workflowId })),
});

export default function QuickReplies() {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Draft | null>(null);

  const sets = useQuery({ queryKey: ['quick-replies'], queryFn: fetchQuickReplies });

  /**
   * Only published workflows can be bound, so only published ones are offered.
   *
   * The server refuses a draft anyway; offering one here would mean the refusal arrives after the
   * form has been filled in.
   */
  const workflows = useQuery({
    queryKey: ['workflows', 'published'],
    queryFn: async () => {
      const r = await api.get<{ data: Publishable[] }>('/workflows');
      return r.data.data.filter((w) => w.status === 'PUBLISHED');
    },
    staleTime: 5 * 60_000,
  });

  const done = (message: string) => {
    setDraft(null);
    qc.invalidateQueries({ queryKey: ['quick-replies'] });
    toast.success(message);
  };

  const save = useMutation({
    mutationFn: async (input: Draft) => {
      const body = {
        name: input.name.trim(),
        body: input.body.trim(),
        // Blank rows are how a person removes one without hunting for the X, so they are dropped
        // rather than refused.
        buttons: input.buttons
          .filter((button) => button.label.trim())
          .map((button) => ({ label: button.label.trim(), workflowId: button.workflowId })),
      };
      return input.id ? updateQuickReply(input.id, body) : createQuickReply(body);
    },
    onSuccess: (_, input) => done(input.id ? 'Saved' : 'Created'),
  });

  const retire = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      updateQuickReply(id, { isActive }),
    onSuccess: (_, input) => {
      qc.invalidateQueries({ queryKey: ['quick-replies'] });
      toast.success(input.isActive ? 'Back in use' : 'Retired');
    },
  });

  const remove = useMutation({
    mutationFn: deleteQuickReply,
    onSuccess: () => done('Deleted'),
  });

  const busy = save.isPending || remove.isPending;
  const filled = draft?.buttons.filter((button) => button.label.trim()) ?? [];
  /*
   * **Two different questions, and they have different answers while a row is still blank.**
   *
   * `hasRows` is what the operator is looking at — they chose "Question with answers" and there are
   * two empty boxes on screen, so the copy must call it a question. `filled` is what will actually be
   * saved, since blank rows are dropped, and that is what Meta's limit has to follow.
   *
   * Using `filled` for the copy told somebody who had just asked for a question that it would send as
   * plain text. Using `hasRows` for the limit would hold a draft to 1024 that is going to be saved as
   * text and is perfectly legal at 4000.
   */
  const hasRows = (draft?.buttons.length ?? 0) > 0;
  /** Which of Meta's two limits this draft is being judged against, as it stands right now. */
  const bodyLimit = bodyLimitFor(filled.length);
  const bodyLength = draft?.body.trim().length ?? 0;
  const tooLong = bodyLength > bodyLimit;
  /*
   * No floor on the answers any more — a set without them is the plain text kind, which is the whole
   * point. The length term replaces it, because the limit now moves as rows are added and removed.
   */
  const canSave = !!draft?.name.trim() && !!draft?.body.trim() && !tooLong && !busy;

  /** Which answers in the draft will hand the thread over. Published bindings only. */
  const bound = filled.filter((button) => button.workflowId);

  const patch = (change: Partial<Draft>) => setDraft((current) => (
    current ? { ...current, ...change } : current
  ));

  const patchButton = (index: number, change: Partial<Draft['buttons'][number]>) => {
    setDraft((current) => (current ? {
      ...current,
      buttons: current.buttons.map((button, i) => (i === index ? { ...button, ...change } : button)),
    } : current));
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div className="min-w-0">
            <CardTitle>Quick replies</CardTitle>
            <CardDescription>
              Replies your team sends often. Save one as plain text, or give it up to{' '}
              {QUICK_REPLY_LIMITS.buttons} tappable answers to make it a question — and an answer can
              start a workflow when it is tapped.
            </CardDescription>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button className="shrink-0 gap-2" disabled={!!draft}>
                <Plus aria-hidden className="h-4 w-4" />
                New reply
                <ChevronDown aria-hidden className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setDraft(BLANK_TEXT)}>
                <MessageSquare aria-hidden className="h-4 w-4" />
                Text reply
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setDraft(BLANK_QUESTION)}>
                <ListChecks aria-hidden className="h-4 w-4" />
                Question with answers
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </CardHeader>

        <CardContent className="space-y-3">
          {sets.isLoading && <p className="text-sm text-ink-500">Loading…</p>}

          {sets.data?.length === 0 && !draft && (
            <EmptyState>
              Save a reply your team sends often — your opening hours, or “delivery or pickup?” with
              two answers to tap — and any agent can send it in one click.
            </EmptyState>
          )}

          {sets.data?.map((set) => (
            <div
              key={set.id}
              className="rounded-md border border-ink-300 px-3 py-2"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-sm font-medium text-ink-900">
                    {set.name}
                    {/*
                      A question needs no badge — its answer pills below say what it is. A text reply
                      has nothing to show, and before this it rendered an empty pill row: a stray gap
                      that read as a rendering fault rather than as "no answers".
                    */}
                    {isTextReply(set) && <Badge variant="secondary">Text</Badge>}
                    {!set.isActive && (
                      <span className="text-caption font-normal text-ink-500">retired</span>
                    )}
                  </p>
                  <p className="mt-px text-caption text-ink-500">{set.body}</p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!!draft}
                    onClick={() => setDraft(draftOf(set))}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={retire.isPending}
                    onClick={() => retire.mutate({ id: set.id, isActive: !set.isActive })}
                  >
                    {/*
                      Retiring rather than deleting is offered first: a retired set stops being
                      offered to agents while taps on questions already sent keep resolving.
                    */}
                    {set.isActive ? 'Retire' : 'Use again'}
                  </Button>
                </div>
              </div>

              {set.buttons.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {set.buttons.map((button) => (
                  <span
                    key={button.id}
                    className="rounded-full border border-ink-300 bg-surface-2 px-2 py-px text-caption text-ink-700"
                  >
                    {button.label}
                    {button.workflow && (
                      <span className="ml-1 text-ink-500">→ {button.workflow.name}</span>
                    )}
                  </span>
                ))}
              </div>
              )}

              {/*
                Said on the list, not only in the editor: a workflow can be unpublished long after
                the set was written, and the person who did it is not the person who will notice.
              */}
              {set.buttons.some((b) => b.workflow && b.workflow.status !== 'PUBLISHED') && (
                <p className="mt-2 text-caption text-warning">
                  A workflow behind one of these answers is no longer published, so tapping it will
                  do nothing.
                </p>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      {draft && (
        <Card>
          <CardHeader>
            <CardTitle>
              {draft.id ? 'Edit reply' : (hasRows ? 'New question' : 'New text reply')}
            </CardTitle>
            <CardDescription>
              {/*
                Three sentences, and only the ones that are true. "The answers cannot" was still being
                said on a text reply that has none — noise on the form where it is least wanted.
              */}
              {draft.id
                ? 'Changing the answers replaces them, so a tap on a question already sent will no longer resolve. Editing the name or the message leaves them working.'
                : hasRows
                  ? 'The question can be edited each time it is sent. The answers cannot.'
                  : 'An agent can edit the message before sending it, without changing what is saved here.'}
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="qr-name">Name</Label>
              <Input
                id="qr-name"
                value={draft.name}
                maxLength={QUICK_REPLY_LIMITS.name}
                placeholder="Delivery or pickup"
                onChange={(e) => patch({ name: e.target.value })}
              />
              <p className="text-caption text-ink-500">
                How an agent finds it. The customer never sees this.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="qr-body">{hasRows ? 'Question' : 'Message'}</Label>
              <Textarea
                id="qr-body"
                rows={hasRows ? 2 : 4}
                value={draft.body}
                maxLength={QUICK_REPLY_LIMITS.textBody}
                placeholder={hasRows
                  ? 'Would you like delivery or pickup?'
                  : 'We are open 11am–11pm, every day.'}
                onChange={(e) => patch({ body: e.target.value })}
              />
              {/*
                **Said before Save, not by the server afterwards.**

                `maxLength` is the outer 4000 and cannot help here, because it does not truncate text
                already in the box: an operator who writes 2,000 characters and *then* adds an answer
                is holding a draft that cannot be saved, and nothing about the form would say why. The
                same discipline as the composer's refused-file line.
              */}
              {tooLong ? (
                <p className="text-caption text-warning">
                  This message is {bodyLength.toLocaleString()} characters. A question with tappable
                  answers allows {QUICK_REPLY_LIMITS.body} — shorten it, or remove the answers.
                </p>
              ) : (
                <p className="text-caption text-ink-500">
                  {hasRows
                    ? `Up to ${QUICK_REPLY_LIMITS.body} characters, which is what WhatsApp allows alongside answers.`
                    : 'Sent exactly as written, line breaks and all. The agent can edit it before sending.'}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label>Answers</Label>
              {draft.buttons.map((button, index) => (
                // eslint-disable-next-line react/no-array-index-key -- rows have no id until saved,
                // and reordering is not offered, so the index is stable for as long as the form is open.
                <div key={index} className="flex items-center gap-2">
                  <Input
                    aria-label={`Answer ${index + 1}`}
                    value={button.label}
                    maxLength={QUICK_REPLY_LIMITS.label}
                    placeholder={index === 0 ? 'Delivery' : 'Pickup'}
                    onChange={(e) => patchButton(index, { label: e.target.value })}
                  />
                  <Select
                    value={button.workflowId ?? NONE}
                    onValueChange={(value) => patchButton(index, {
                      workflowId: value === NONE ? null : value,
                    })}
                  >
                    <SelectTrigger className="w-56 shrink-0" aria-label={`What answer ${index + 1} starts`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>Just record the answer</SelectItem>
                      {workflows.data?.map((workflow) => (
                        <SelectItem key={workflow.id} value={workflow.id}>
                          Start {workflow.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {/*
                    No `length > 1` guard. Removing the last answer is a meaningful act now — it is
                    how an operator turns a question into a plain text reply, and the primary way
                    they will do it.
                  */}
                  <Button
                    variant="outline"
                    size="icon"
                    className="shrink-0"
                    aria-label={`Remove answer ${index + 1}`}
                    onClick={() => patch({
                      buttons: draft.buttons.filter((_, i) => i !== index),
                    })}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}

              {draft.buttons.length < QUICK_REPLY_LIMITS.buttons && (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  onClick={() => patch({
                    buttons: [...draft.buttons, { label: '', workflowId: null }],
                  })}
                >
                  <Plus aria-hidden className="h-3.5 w-3.5" />
                  Add an answer
                </Button>
              )}

              <p className="text-caption text-ink-500">
                {hasRows
                  ? <>Up to {QUICK_REPLY_LIMITS.buttons}, {QUICK_REPLY_LIMITS.label} characters
                    each — WhatsApp&rsquo;s limit. Leave one blank to drop it.</>
                  : <>No answers, so this sends as plain text. Add up to {QUICK_REPLY_LIMITS.buttons}{' '}
                    to make it a question the customer can tap.</>}
              </p>

              {/*
                The cost of demoting an existing question, said where the decision is made.

                Only for a saved set that had answers and now has none — the same trade `writeButtons`
                documents on the server, and one an operator should meet before Save rather than
                discover from a customer whose tap stopped working.
              */}
              {draft.id && !hasRows && (
                <p className="text-caption text-warning">
                  Saving with no answers turns this into a plain text reply, and taps on questions
                  already sent will no longer resolve.
                </p>
              )}
            </div>

            {/*
              The consequence of binding, before it is saved rather than after it surprises somebody.

              A workflow started into a paused conversation would never hear the customer's next
              message, so a bound tap has to end the takeover. That means an agent handling a thread
              can lose it to the bot because the customer pressed a button — which is fine when it
              is what they meant, and only then.
            */}
            {bound.length > 0 && (
              <p className="flex items-start gap-2 rounded-md border border-ink-300 bg-surface-2 px-3 py-2 text-caption text-ink-700">
                <Bot aria-hidden className="mt-px h-4 w-4 shrink-0 text-ink-500" />
                <span>
                  Tapping{' '}
                  <span className="font-medium">{bound.map((b) => b.label || 'an answer').join(' or ')}</span>{' '}
                  starts a workflow and hands the conversation back to the bot, ending any takeover
                  by an agent.
                </span>
              </p>
            )}

            <div className="flex items-center justify-between gap-3">
              {draft.id ? (
                <Button
                  variant="destructive"
                  className="gap-2"
                  disabled={busy}
                  onClick={() => remove.mutate(draft.id!)}
                >
                  <Trash2 aria-hidden className="h-4 w-4" />
                  Delete
                </Button>
              ) : <span />}

              <div className="flex gap-2">
                <Button variant="outline" disabled={busy} onClick={() => setDraft(null)}>
                  Cancel
                </Button>
                <Button disabled={!canSave} onClick={() => save.mutate(draft)}>
                  {save.isPending ? 'Saving…' : 'Save'}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
