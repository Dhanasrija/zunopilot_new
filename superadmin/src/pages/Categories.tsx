import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Info, Plus, Trash2 } from 'lucide-react';
import { sa } from '../lib/api';
import { Badge, Button, Card, CardHeader, Empty, Input, Td, Th } from '../components/ui';

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
  const [draft, setDraft] = useState({ key: '', label: '', description: '', sortOrder: '100' });

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
    }),
    onSuccess: () => {
      toast.success('Category added');
      setAdding(false);
      setDraft({ key: '', label: '', description: '', sortOrder: '100' });
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
                  <Th>Key</Th><Th>Label</Th><Th>Description</Th>
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
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
