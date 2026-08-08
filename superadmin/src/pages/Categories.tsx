import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Bot, Info, Plus, Trash2 } from 'lucide-react';
import { sa } from '../lib/api';
import {
  Badge, Button, Card, CardHeader, Empty, Input, Td, Textarea, Th,
} from '../components/ui';

// Business categories.
//
// These used to be a Prisma enum, so adding "Pharmacy" meant a migration and a
// deploy. Now they are rows, and this is where they are managed.
//
// **The key is immutable after creation**, and that is the one rule worth knowing:
// workflow templates declare `suitedTo: ['RESTAURANT']` and the AI router is told
// the category, so renaming a key silently stops every template being offered to
// the workspaces it was written for — a failure with no error message anywhere.
// The label is free to change and is all a customer ever sees.

export default function Categories() {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  /*
   * The category whose assistant copy is open, and the text being edited.
   *
   * One row at a time. These are paragraphs, and two open at once in a table makes it easy to save
   * the wrong one — which here means changing what a hundred workspaces' assistants say.
   */
  const [editing, setEditing] = useState<string | null>(null);
  const [copyDraft, setCopyDraft] = useState({ persona: '', topics: '' });
  const [draft, setDraft] = useState({
    key: '', label: '', description: '', sortOrder: '100',
    catalogueNoun: '', catalogueItemNoun: '',
  });

  const { data, isLoading } = useQuery({
    queryKey: ['categories'],
    queryFn: () => sa.categories.list(),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['categories'] });

  const create = useMutation({
    mutationFn: () => sa.categories.create({
      key: draft.key,
      label: draft.label.trim(),
      description: draft.description.trim() || undefined,
      sortOrder: Number(draft.sortOrder) || 100,
      // Blank is a real answer: the app falls back to "Catalogue"/"Item" rather than
      // borrowing another category's word.
      catalogueNoun: draft.catalogueNoun.trim() || undefined,
      catalogueItemNoun: draft.catalogueItemNoun.trim() || undefined,
    }),
    onSuccess: () => {
      toast.success('Category added');
      setAdding(false);
      setDraft({
        key: '', label: '', description: '', sortOrder: '100',
        catalogueNoun: '', catalogueItemNoun: '',
      });
      invalidate();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      sa.categories.update(id, body),
    onSuccess: () => { toast.success('Category updated'); invalidate(); },
    onError: (err: Error) => toast.error(err.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => sa.categories.remove(id),
    onSuccess: () => { toast.success('Category deleted'); invalidate(); },
    onError: (err: Error) => toast.error(err.message),
  });

  const rows = data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Business categories</h1>
          <p className="text-sm text-slate-500">
            What a workspace picks when it signs up. {rows.filter((r) => r.isActive).length} active.
          </p>
        </div>
        <Button onClick={() => setAdding(true)}><Plus className="h-3.5 w-3.5" /> Add category</Button>
      </div>

      <div className="flex items-start gap-2 rounded-lg border border-slate-200 bg-white p-3">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
        <p className="text-xs leading-snug text-slate-600">
          The <strong>key</strong> cannot be changed after a category is created. Workflow templates
          match on it, so renaming one would quietly stop those templates being offered to the
          workspaces they were written for. Labels can be changed freely.
        </p>
      </div>

      {adding && (
        <Card>
          <CardHeader title="New category" />
          <div className="space-y-2 p-4">
            <div className="grid gap-2 sm:grid-cols-2">
              <div>
                <Input
                  value={draft.key}
                  onChange={(v) => setDraft((d) => ({
                    ...d,
                    key: v.toUpperCase().replace(/[^A-Z0-9_]/g, ''),
                  }))}
                  placeholder="PHARMACY"
                  className="font-mono text-xs"
                />
                <p className="mt-1 text-[11px] text-slate-500">
                  SCREAMING_SNAKE_CASE. Permanent — choose carefully.
                </p>
              </div>
              <Input
                value={draft.label}
                onChange={(v) => setDraft((d) => ({ ...d, label: v }))}
                placeholder="Pharmacy"
              />
            </div>
            <Input
              value={draft.description}
              onChange={(v) => setDraft((d) => ({ ...d, description: v }))}
              placeholder="One line shown under the picker on the signup form"
            />
            {/*
              What this kind of business calls the things it sells.

              "Menu" is a restaurant word; a grocery has Products and a consultancy has
              Services. Left blank, the workspace reads "Catalogue" and "Item" — generic, which
              is the right failure. Two fields because the screen needs both: "Add Product" and
              "Product Category" cannot be derived from "Products".
            */}
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Input
                  value={draft.catalogueNoun}
                  onChange={(v) => setDraft((d) => ({ ...d, catalogueNoun: v }))}
                  placeholder="Menu / Products / Services"
                />
                <p className="mt-1 text-[11px] text-slate-500">
                  What they call the whole catalogue. Blank = &ldquo;Catalogue&rdquo;.
                </p>
              </div>
              <div>
                <Input
                  value={draft.catalogueItemNoun}
                  onChange={(v) => setDraft((d) => ({ ...d, catalogueItemNoun: v }))}
                  placeholder="Item / Product / Service"
                />
                <p className="mt-1 text-[11px] text-slate-500">
                  One of them, singular. Blank = &ldquo;Item&rdquo;.
                </p>
              </div>
            </div>
            <Input
              value={draft.sortOrder}
              onChange={(v) => setDraft((d) => ({ ...d, sortOrder: v.replace(/[^0-9]/g, '') }))}
              placeholder="Sort order (lower shows first)"
              className="w-48"
            />
            <div className="flex gap-2">
              <Button
                disabled={!draft.key || draft.label.trim().length < 2 || create.isPending}
                onClick={() => create.mutate()}
              >
                {create.isPending ? 'Adding…' : 'Add'}
              </Button>
              <Button variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
            </div>
          </div>
        </Card>
      )}

      <Card className="overflow-hidden">
        {isLoading ? <Empty>Loading…</Empty> : rows.length === 0 ? (
          <Empty>No categories. Signups have nothing to pick.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[46rem]">
              <thead className="border-b border-slate-100 bg-slate-50/60">
                <tr>
                  <Th>Key</Th><Th>Label</Th><Th>Description</Th><Th>Calls it</Th>
                  <Th className="text-right">Order</Th>
                  <Th className="text-right">Workspaces</Th>
                  <Th className="text-right">Actions</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-slate-50 last:border-0">
                    <Td>
                      <code className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px]">{row.key}</code>
                      {!row.isActive && <span className="ml-1.5"><Badge tone="slate">hidden</Badge></span>}
                    </Td>
                    <Td className="font-medium">{row.label}</Td>
                    <Td className="max-w-[18rem] text-xs text-slate-500">{row.description ?? '—'}</Td>
                    <Td className="text-xs text-slate-500">
                      {row.catalogueNoun ?? 'Catalogue'}
                      <span className="text-slate-400"> / {row.catalogueItemNoun ?? 'Item'}</span>
                    </Td>
                    <Td className="text-right tabular-nums">{row.sortOrder}</Td>
                    <Td className="text-right tabular-nums">{row.workspaces}</Td>
                    <Td>
                      <div className="flex justify-end gap-1.5">
                        <Button
                          variant="outline"
                          disabled={update.isPending}
                          onClick={() => update.mutate({ id: row.id, body: { isActive: !row.isActive } })}
                        >
                          {row.isActive ? 'Hide from signups' : 'Show again'}
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => {
                            if (editing === row.id) { setEditing(null); return; }
                            setEditing(row.id);
                            setCopyDraft({
                              persona: row.defaultPersona ?? '',
                              topics: row.defaultOutOfScopeTopics ?? '',
                            });
                          }}
                        >
                          <Bot className="h-3 w-3" />
                          {editing === row.id ? 'Close' : 'Assistant'}
                        </Button>
                        <Button
                          variant="danger"
                          disabled={row.workspaces > 0 || remove.isPending}
                          onClick={() => {
                            if (window.confirm(`Delete "${row.label}"? Nothing is using it.`)) {
                              remove.mutate(row.id);
                            }
                          }}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                      {row.workspaces > 0 && (
                        <p className="mt-1 text-right text-[10px] text-slate-400">
                          In use — hide it instead
                        </p>
                      )}
                    </Td>
                  </tr>
                ))}
                {rows.filter((row) => row.id === editing).map((row) => (
                  <tr key={`${row.id}-copy`} className="border-b border-slate-50 bg-slate-50/50 last:border-0">
                    <td colSpan={7} className="px-3 py-4">
                      <div className="space-y-4">
                        <p className="text-xs leading-snug text-slate-600">
                          Where a <strong>{row.label}</strong> workspace&rsquo;s assistant starts.
                          {' '}
                          {row.workspaces === 1
                            ? 'One workspace inherits this'
                            : `${row.workspaces} workspaces inherit this`}
                          {' '}
                          until it writes its own — so improving it here improves every one of them
                          that never did. Leave a field blank and they fall back to generic house
                          text, which is bland but never wrong.
                        </p>

                        <div className="space-y-1">
                          <label htmlFor={`persona-${row.id}`} className="text-xs font-medium text-slate-700">
                            How the assistant sounds
                          </label>
                          <Textarea
                            id={`persona-${row.id}`}
                            value={copyDraft.persona}
                            onChange={(v) => setCopyDraft((d) => ({ ...d, persona: v }))}
                            placeholder="Warm and quick. Short sentences, no sales language…"
                            rows={4}
                          />
                          <p className="text-[11px] text-slate-500">
                            Tone and manner only. The rules that stop it quoting prices or promising
                            refunds are in the code and are not editable here.
                          </p>
                        </div>

                        <div className="space-y-1">
                          <label htmlFor={`topics-${row.id}`} className="text-xs font-medium text-slate-700">
                            Topics it declines — one per line
                          </label>
                          <Textarea
                            id={`topics-${row.id}`}
                            value={copyDraft.topics}
                            onChange={(v) => setCopyDraft((d) => ({ ...d, topics: v }))}
                            placeholder={'nutrition or dietary advice\nrecruitment enquiries'}
                            rows={4}
                          />
                          <p className="text-[11px] text-slate-500">
                            {/*
                              Says what this field is *added to*, because the alternative reading —
                              that clearing it makes the assistant answer anything — is the bug this
                              whole mechanism was built to fix.
                            */}
                            Added to the topics every assistant already declines: personal matters,
                            health, other companies, anything unrelated to the business. Ten lines
                            at most.
                          </p>
                        </div>

                        <div className="flex gap-2">
                          <Button
                            disabled={update.isPending}
                            onClick={() => update.mutate({
                              id: row.id,
                              // Blank means "no category default", which is null rather than an
                              // empty string — the server reads null as "inherit the house text".
                              body: {
                                defaultPersona: copyDraft.persona.trim() || null,
                                defaultOutOfScopeTopics: copyDraft.topics.trim() || null,
                              },
                            })}
                          >
                            {update.isPending ? 'Saving…' : 'Save assistant copy'}
                          </Button>
                          <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
                        </div>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
