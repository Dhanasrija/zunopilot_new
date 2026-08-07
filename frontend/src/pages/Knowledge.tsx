import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, MessageCircleQuestion, Pencil, Plus, Trash2, X } from 'lucide-react';
import { api } from '@/lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { EmptyState } from '@/components/ui/empty-state';

// What the assistant knows about the business.
//
// **Why this page exists.** The agent's only knowledge used to be the keyword rules, which are
// question-to-canned-answer — so it could only answer a question somebody had guessed the
// wording of in advance. A workspace with no rules produced a prompt whose knowledge section
// read "(none configured)" above an instruction never to guess: an assistant that could only
// ever offer to check with the team, however good the model was.
//
// Two things here are not decoration. The **word budget** is shown because everything active is
// sent with every single message, so the point at which an entry stops reaching the model is a
// fact the operator has to be able to see. The **try-it box** is shown because knowledge that
// reads well to its author can still leave the assistant saying "I'll check" — and without a
// preview, the first person to find that out is a customer.

interface Entry {
  id: string;
  title: string;
  body: string;
  isActive: boolean;
  sortOrder: number;
  words: number;
  /** False when this entry is past the budget and the assistant never sees it. */
  inPrompt: boolean;
}

interface Usage {
  used: number;
  budget: number;
  droppedEntries: number;
  entryWordLimit: number;
}

interface Draft { title: string; body: string }

const EMPTY: Draft = { title: '', body: '' };

export default function Knowledge() {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [edit, setEdit] = useState<Draft>(EMPTY);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [question, setQuestion] = useState('');

  const knowledge = useQuery({
    queryKey: ['knowledge'],
    queryFn: async () => {
      const res = await api.get<{ data: Entry[]; meta: Usage }>('/knowledge');
      return { entries: res.data.data, usage: res.data.meta };
    },
  });

  const entries = knowledge.data?.entries ?? [];
  const usage = knowledge.data?.usage;

  const refresh = () => qc.invalidateQueries({ queryKey: ['knowledge'] });

  const create = useMutation({
    mutationFn: async () => api.post('/knowledge', draft),
    onSuccess: () => { setDraft(EMPTY); setAdding(false); toast.success('Added'); refresh(); },
  });

  const patch = useMutation({
    mutationFn: async ({ id, ...fields }: { id: string } & Partial<Entry>) =>
      api.patch(`/knowledge/${id}`, fields),
    onSuccess: refresh,
  });

  const remove = useMutation({
    mutationFn: async (id: string) => api.delete(`/knowledge/${id}`),
    onSuccess: () => { setConfirmDelete(null); toast.success('Removed'); refresh(); },
  });

  const ask = useMutation({
    mutationFn: async () => (await api.post<{
      data: { answer: string; entriesUsed: number; latencyMs: number };
    }>('/knowledge/try', { question })).data.data,
  });

  const startEdit = (entry: Entry) => {
    setEditing(entry.id);
    setEdit({ title: entry.title, body: entry.body });
  };

  const commitEdit = (id: string) => {
    if (!edit.title.trim() || !edit.body.trim()) return;
    patch.mutate(
      { id, title: edit.title.trim(), body: edit.body.trim() },
      { onSuccess: () => setEditing(null) },
    );
  };

  const overBudget = usage ? usage.droppedEntries > 0 : false;
  const pct = usage ? Math.min(100, Math.round((usage.used / usage.budget) * 100)) : 0;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-h2 font-semibold">Knowledge</h1>
        <p className="text-sm text-muted-foreground">
          What the assistant knows about your business. It answers customers from this and
          nothing else — it will never invent a fact that is not written here.
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>Your knowledge</CardTitle>
              <CardDescription>
                Short, titled sections work better than one long one. The assistant is told the
                titles, so it can find the right part.
              </CardDescription>
            </div>
            {!adding && (
              <Button variant="outline" className="gap-1" onClick={() => setAdding(true)}>
                <Plus className="h-4 w-4" /> Add a section
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {usage && (
            <div className="space-y-1">
              <div className="flex items-center justify-between text-caption">
                <span className="text-muted-foreground">
                  {usage.used.toLocaleString()} of {usage.budget.toLocaleString()} words reaching
                  the assistant
                </span>
                <span className="text-muted-foreground">{pct}%</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-ink-200">
                <div
                  className={overBudget ? 'h-full bg-danger' : 'h-full bg-accent-600'}
                  style={{ width: `${pct}%` }}
                />
              </div>
              {overBudget && (
                <p className="text-caption text-danger">
                  {usage.droppedEntries} section{usage.droppedEntries === 1 ? '' : 's'} past the
                  limit — the assistant cannot see {usage.droppedEntries === 1 ? 'it' : 'them'}.
                  Shorten something, or switch off what is out of date.
                </p>
              )}
            </div>
          )}

          {adding && (
            <div className="space-y-3 rounded-md border p-3">
              <div className="space-y-1">
                <Label htmlFor="new-title">Title</Label>
                <Input
                  id="new-title"
                  autoFocus
                  value={draft.title}
                  placeholder="What we do"
                  onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="new-body">What the assistant should know</Label>
                <Textarea
                  id="new-body"
                  rows={6}
                  value={draft.body}
                  placeholder="mTouch Labs builds custom software — web applications, mobile apps and WhatsApp automation. We work with businesses across India and typically start with a short discovery call."
                  onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                />
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant={draft.title && draft.body ? 'default' : 'outline'}
                  disabled={!draft.title.trim() || !draft.body.trim() || create.isPending}
                  onClick={() => create.mutate()}
                >
                  {create.isPending ? 'Saving…' : 'Save section'}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => { setAdding(false); setDraft(EMPTY); }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {knowledge.isLoading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>
          ) : entries.length === 0 && !adding ? (
            <EmptyState
              action={<Button className="gap-1" onClick={() => setAdding(true)}>
                <Plus className="h-4 w-4" /> Add a section
              </Button>}
            >
              The assistant knows nothing about your business yet, so it can only offer to check
              with the team. Tell it what you do and it will start answering.
            </EmptyState>
          ) : (
            <ul className="divide-y">
              {entries.map((entry) => (
                <li key={entry.id} className="py-3 first:pt-0 last:pb-0">
                  {editing === entry.id ? (
                    <div className="space-y-2">
                      <Input
                        aria-label={`Title of ${entry.title}`}
                        value={edit.title}
                        autoFocus
                        onChange={(e) => setEdit({ ...edit, title: e.target.value })}
                        onKeyDown={(e) => e.key === 'Escape' && setEditing(null)}
                      />
                      <Textarea
                        aria-label={`Text of ${entry.title}`}
                        rows={6}
                        value={edit.body}
                        onChange={(e) => setEdit({ ...edit, body: e.target.value })}
                        onKeyDown={(e) => e.key === 'Escape' && setEditing(null)}
                      />
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          disabled={patch.isPending}
                          onClick={() => commitEdit(entry.id)}
                        >
                          <Check className="mr-1 h-4 w-4" /> Save
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                          <X className="mr-1 h-4 w-4" /> Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium">{entry.title}</span>
                          <span className="text-caption text-muted-foreground">
                            {entry.words} words
                          </span>
                          {!entry.inPrompt && entry.isActive && (
                            <Badge variant="destructive">past the limit</Badge>
                          )}
                          {!entry.isActive && <Badge variant="outline">off</Badge>}
                        </div>
                        <p className="mt-1 line-clamp-3 text-caption text-muted-foreground">
                          {entry.body}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <Switch
                          aria-label={`${entry.title} active`}
                          checked={entry.isActive}
                          onCheckedChange={(isActive) => patch.mutate({ id: entry.id, isActive })}
                        />
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={`Edit ${entry.title}`}
                          onClick={() => startEdit(entry)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        {confirmDelete === entry.id ? (
                          <>
                            <Button
                              size="sm"
                              variant="destructive"
                              disabled={remove.isPending}
                              onClick={() => remove.mutate(entry.id)}
                            >
                              Delete
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(null)}>
                              Keep
                            </Button>
                          </>
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={`Delete ${entry.title}`}
                            onClick={() => setConfirmDelete(entry.id)}
                          >
                            <Trash2 className="h-4 w-4 text-danger" />
                          </Button>
                        )}
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Try a question</CardTitle>
          <CardDescription>
            Ask what a customer might ask and see what the assistant would say. Nothing is sent
            to anyone.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            aria-label="A question to try"
            rows={2}
            value={question}
            placeholder="Do you build mobile apps?"
            onChange={(e) => setQuestion(e.target.value)}
          />
          <Button
            className="gap-1"
            disabled={!question.trim() || ask.isPending}
            onClick={() => ask.mutate()}
          >
            <MessageCircleQuestion className="h-4 w-4" />
            {ask.isPending ? 'Asking…' : 'Ask the assistant'}
          </Button>

          {ask.data && (
            <div className="space-y-2 rounded-md border bg-muted/40 p-3">
              <p className="text-sm">{ask.data.answer}</p>
              <p className="text-caption text-muted-foreground">
                Answered from {ask.data.entriesUsed} section
                {ask.data.entriesUsed === 1 ? '' : 's'} in {(ask.data.latencyMs / 1000).toFixed(1)}s.
                {ask.data.entriesUsed === 0
                  ? ' With nothing written down, this is all it can ever say.'
                  : ''}
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
