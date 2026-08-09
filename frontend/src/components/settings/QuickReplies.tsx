import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, ListChecks, Plus, Trash2, X } from 'lucide-react';
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
import {
  QUICK_REPLY_LIMITS, createQuickReply, deleteQuickReply, fetchQuickReplies, updateQuickReply,
  type QuickReply,
} from '@/lib/quick-replies';

// Questions an agent can ask with tappable answers.
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

const BLANK: Draft = {
  id: null,
  name: '',
  body: '',
  // Two, because a single button is a worse message than plain text — but one is allowed, so an
  // agent who removes one is not stuck.
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
  const canSave = !!draft?.name.trim() && !!draft?.body.trim() && filled.length > 0 && !busy;

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
              Questions an agent can send with up to {QUICK_REPLY_LIMITS.buttons} tappable answers.
              An answer can start a workflow when it is tapped.
            </CardDescription>
          </div>
          <Button className="shrink-0 gap-2" disabled={!!draft} onClick={() => setDraft(BLANK)}>
            <Plus aria-hidden className="h-4 w-4" />
            New set
          </Button>
        </CardHeader>

        <CardContent className="space-y-3">
          {sets.isLoading && <p className="text-sm text-ink-500">Loading…</p>}

          {sets.data?.length === 0 && !draft && (
            <EmptyState>
              Save a question your team asks often — “delivery or pickup?” — and any agent can send
              it in one click.
            </EmptyState>
          )}

          {sets.data?.map((set) => (
            <div
              key={set.id}
              className="rounded-md border border-ink-300 px-3 py-2"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink-900">
                    {set.name}
                    {!set.isActive && (
                      <span className="ml-2 text-caption font-normal text-ink-500">retired</span>
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
            <CardTitle>{draft.id ? 'Edit set' : 'New set'}</CardTitle>
            <CardDescription>
              {draft.id
                ? 'Changing the answers replaces them, so a tap on a question already sent will no longer resolve. Editing the name or the question leaves them working.'
                : 'The question can be edited each time it is sent. The answers cannot.'}
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
              <Label htmlFor="qr-body">Question</Label>
              <Textarea
                id="qr-body"
                rows={2}
                value={draft.body}
                maxLength={QUICK_REPLY_LIMITS.body}
                placeholder="Would you like delivery or pickup?"
                onChange={(e) => patch({ body: e.target.value })}
              />
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
                  {draft.buttons.length > 1 && (
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
                  )}
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
                Up to {QUICK_REPLY_LIMITS.buttons}, {QUICK_REPLY_LIMITS.label} characters each —
                WhatsApp&rsquo;s limit. Leave one blank to drop it.
              </p>
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
