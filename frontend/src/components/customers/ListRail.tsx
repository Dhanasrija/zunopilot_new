import { useState } from 'react';
import { Check, Info, MoreVertical, Pencil, Plus, Tag, Trash2, Users, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
// Every row is icon, name, one line of context, a count, and a menu. The count sits in a
// chip rather than as bare text because it is the number people scan for; the actions moved
// from two always-visible buttons into a menu, which is the same two actions taking a third
// of the vertical space and no longer competing with the list name for attention.
//
// **Two icons, not one per list.** The design reference shows a different icon per list — a
// tag, a star — but there is no icon column and guessing one from the name ("VIP" → star)
// would be wrong the moment somebody names a list something else. `Users` marks the
// pseudo-list because it genuinely is a different kind of thing; every real list gets `Tag`.

/** The icon tile. Square with `--radius-md`, so it reads as a marker rather than an avatar. */
const RowIcon = ({ icon: Icon, active }: { icon: typeof Users; active: boolean }) => (
  <span
    aria-hidden
    className={cn(
      'flex h-8 w-8 shrink-0 items-center justify-center rounded-md',
      active ? 'bg-accent-600 text-on-accent' : 'bg-accent-100 text-accent-700',
    )}
  >
    <Icon className="h-4 w-4" />
  </span>
);

/** The member count. Tabular so the digits do not jitter between rows. */
const CountChip = ({ value, active }: { value: number; active: boolean }) => (
  <span
    className={cn(
      'shrink-0 rounded-full px-2 py-1 text-caption font-medium tabular-nums',
      active ? 'bg-accent-600 text-on-accent' : 'bg-surface-0 text-ink-700',
    )}
  >
    {value}
  </span>
);

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

  const rowClass = (active: boolean) => cn(
    'w-full rounded-lg border p-3 text-left transition-colors duration-micro',
    active
      ? 'border-accent-600 bg-accent-100'
      : 'border-ink-300 bg-surface-1 hover:bg-surface-0',
  );

  return (
    <div className="flex h-full flex-col gap-2 overflow-y-auto pr-1">
      <p className="px-1 text-sm font-medium text-ink-900">Lists</p>

      <button type="button" onClick={() => onSelect(null)} className={rowClass(selectedListId === null)}>
        <div className="flex items-center gap-3">
          <RowIcon icon={Users} active={selectedListId === null} />
          <div className="min-w-0 flex-1">
            <p className={cn(
              'truncate text-sm font-medium',
              selectedListId === null ? 'text-accent-700' : 'text-ink-900',
            )}
            >
              All customers
            </p>
            <p className="truncate text-caption text-ink-500">Everyone in this workspace</p>
          </div>
          <CountChip value={totalCustomers} active={selectedListId === null} />
        </div>
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

        if (confirmDelete === list.id) {
          return (
            <div key={list.id} className="rounded-lg border border-danger p-3">
              <p className="text-caption text-ink-700">
                Delete &ldquo;{list.name}&rdquo;? The customers on it are not deleted.
              </p>
              <div className="mt-2 flex items-center gap-1">
                <Button
                  variant="outline" size="sm" disabled={remove.isPending}
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
                <Button variant="outline" size="sm" onClick={() => setConfirmDelete(null)}>Keep</Button>
              </div>
            </div>
          );
        }

        return (
          <div key={list.id} className={cn(rowClass(isSelected), 'flex items-center gap-3 p-3')}>
            <button
              type="button"
              className="flex min-w-0 flex-1 items-center gap-3 text-left"
              onClick={() => onSelect(list.id)}
            >
              <RowIcon icon={Tag} active={isSelected} />
              <div className="min-w-0 flex-1">
                <p className={cn(
                  'truncate text-sm font-medium',
                  isSelected ? 'text-accent-700' : 'text-ink-900',
                )}
                >
                  {list.name}
                </p>
                {/* The member count doubles as the subtitle, which is what the count chip
                    means — the description only appears when somebody wrote one. */}
                <p className="truncate text-caption text-ink-500">
                  {list.description || `${list._count.members} ${list._count.members === 1 ? 'member' : 'members'}`}
                </p>
              </div>
            </button>

            <CountChip value={list._count.members} active={isSelected} />

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label={`Actions for ${list.name}`}>
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => { setRenaming(list.id); setDraftName(list.name); }}>
                  <Pencil className="mr-2 h-3.5 w-3.5" /> Rename
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setConfirmDelete(list.id)}>
                  <Trash2 className="mr-2 h-3.5 w-3.5" /> Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
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
        <Button
          variant="outline"
          className="w-full gap-1 border-accent-600 text-accent-700"
          onClick={() => setCreating(true)}
        >
          <Plus className="h-4 w-4" /> New list
        </Button>
      )}

      {/* The one thing about lists people get wrong: they are snapshots, not saved searches. */}
      <div className="mt-1 flex items-start gap-2 rounded-md bg-surface-0 p-3">
        <Info aria-hidden className="mt-px h-3.5 w-3.5 shrink-0 text-ink-500" />
        <p className="text-caption leading-snug text-ink-500">
          Membership only changes when you change it, so what you review is what a campaign
          sends to.
        </p>
      </div>
    </div>
  );
}
