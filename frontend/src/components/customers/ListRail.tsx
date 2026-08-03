import { useState } from 'react';
import { Check, Pencil, Plus, Trash2, Users, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import {
  useCreateList, useCustomerLists, useDeleteList, useRenameList,
} from '@/lib/customer-lists';

// The left rail: "All customers" pinned first, then one card per curated list.
//
// **"All customers" is a pseudo-list, not a row in the database.** It is what makes
// replacing the old flat Customers page safe — everything that page did is still reachable
// as the first entry, so nobody loses the plain view of everyone by having lists added
// around it. It carries `id: null`, and the table treats null as "no `listId` filter".
//
// The mockup shows a coloured dot per list. There is no colour column, and inventing one
// to decorate a rail is not worth a migration — the accent goes on the selected card
// instead, which is what actually needs to be legible at a glance.

export function ListRail({ selectedListId, onSelect, totalCustomers }: {
  selectedListId: string | null;
  onSelect: (listId: string | null) => void;
  totalCustomers: number;
}) {
  const { data: lists = [] } = useCustomerLists();
  const create = useCreateList();
  const rename = useRenameList();
  const remove = useDeleteList();

  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  /** Two-step delete: a list can represent real curation, so one click is not enough. */
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const submitCreate = () => {
    if (!name.trim()) return;
    create.mutate({ name: name.trim() }, {
      onSuccess: (list) => { setName(''); setCreating(false); onSelect(list.id); },
    });
  };

  return (
    <div className="flex h-full flex-col gap-2 overflow-y-auto pr-1">
      <p className="px-1 text-caption font-medium uppercase tracking-wide text-ink-500">Lists</p>

      <button
        type="button"
        onClick={() => onSelect(null)}
        className={cn(
          'rounded-lg border p-3 text-left transition-colors duration-micro',
          selectedListId === null
            ? 'border-accent-600 bg-accent-100'
            : 'border-ink-300 bg-surface-1 hover:bg-surface-0',
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium text-ink-900">All customers</span>
          <span className="text-caption text-ink-500">{totalCustomers}</span>
        </div>
        <p className="mt-1 text-caption text-ink-500">Everyone in this workspace</p>
      </button>

      {lists.map((list) => {
        const isSelected = selectedListId === list.id;
        if (renaming === list.id) {
          return (
            <div key={list.id} className="flex items-center gap-1 rounded-lg border border-ink-300 p-2">
              <Input
                value={draftName}
                autoFocus
                onChange={(e) => setDraftName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setRenaming(null);
                  if (e.key === 'Enter' && draftName.trim()) {
                    rename.mutate({ id: list.id, name: draftName.trim() }, {
                      onSuccess: () => setRenaming(null),
                    });
                  }
                }}
              />
              <Button variant="outline" size="icon" aria-label="Cancel rename"
                onClick={() => setRenaming(null)}>
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          );
        }

        return (
          <div
            key={list.id}
            className={cn(
              'group rounded-lg border p-3 transition-colors duration-micro',
              isSelected
                ? 'border-accent-600 bg-accent-100'
                : 'border-ink-300 bg-surface-1 hover:bg-surface-0',
            )}
          >
            <button type="button" className="w-full text-left" onClick={() => onSelect(list.id)}>
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium text-ink-900">{list.name}</span>
                <span className="flex shrink-0 items-center gap-1 text-caption text-ink-500">
                  <Users className="h-3 w-3" />
                  {list._count.members}
                </span>
              </div>
              {list.description && (
                <p className="mt-1 line-clamp-2 text-caption text-ink-500">{list.description}</p>
              )}
            </button>

            <div className="mt-2 flex items-center gap-1">
              {confirmDelete === list.id ? (
                <>
                  <Button variant="outline" size="sm" disabled={remove.isPending}
                    onClick={() => remove.mutate(list.id, {
                      onSuccess: () => {
                        setConfirmDelete(null);
                        // Fall back to everyone, or the table would keep filtering by a
                        // list that no longer exists and show nothing.
                        if (isSelected) onSelect(null);
                      },
                    })}
                  >
                    Delete list
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setConfirmDelete(null)}>
                    Keep
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="outline" size="icon" aria-label={`Rename ${list.name}`}
                    onClick={() => { setRenaming(list.id); setDraftName(list.name); }}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="outline" size="icon" aria-label={`Delete ${list.name}`}
                    onClick={() => setConfirmDelete(list.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </>
              )}
            </div>
          </div>
        );
      })}

      {creating ? (
        <div className="flex items-center gap-1 rounded-lg border border-ink-300 p-2">
          <Input
            value={name}
            autoFocus
            placeholder="Regulars"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') { setCreating(false); setName(''); }
              if (e.key === 'Enter') { e.preventDefault(); submitCreate(); }
            }}
          />
          <Button variant="outline" size="icon" aria-label="Create list"
            disabled={!name.trim() || create.isPending} onClick={submitCreate}>
            <Check className="h-3.5 w-3.5" />
          </Button>
        </div>
      ) : (
        <Button variant="outline" className="gap-1" onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4" /> New list
        </Button>
      )}

      <p className="px-1 pt-1 text-caption text-ink-500">
        Membership only changes when you change it, so what you review is what a campaign
        sends to.
      </p>
    </div>
  );
}
