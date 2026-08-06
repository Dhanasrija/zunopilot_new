import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Pagination } from '@/components/ui/pagination';
import { ListRail } from '@/components/customers/ListRail';
import { EmptyListArt } from '@/components/customers/EmptyListArt';
import { StatusPill, STATUS_OPTIONS, statusLabel, type ContactStatus } from '@/components/customers/ContactStatus';
import { TagEditor } from '@/components/customers/TagEditor';
import {
  useAddToList, useCustomerLists, useRemoveFromList,
} from '@/lib/customer-lists';
import { splitNumber } from '@/lib/countries';
import { usePermissions } from '@/lib/permissions';
import { useHasModule } from '@/stores/auth.store';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn, formatCurrency, formatDateTime, initialsOf, timeAgo } from '@/lib/utils';
import { tintFor } from '@/lib/categorical-tint';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose,
} from '@/components/ui/dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Label } from '@/components/ui/label';
import {
  MessageSquarePlus, UserPlus, Pencil, Info, MoreHorizontal, Search, Filter, Send, Tag, Check,
  Target,
} from 'lucide-react';
import { toast } from 'sonner';

// Customers, as lists of contacts.
//
// **This replaced a flat table**, and the risk of replacing a page is quietly losing what
// it did. Everything the old one carried is still here: Add customer, Edit, Start chat, the
// detail dialog with order history, search and pagination. Edit and Start chat moved into
// the per-row menu; the rest is where it was.
//
// The rail's first entry, "All customers", is what makes that safe — it is the old view,
// still one click away, with lists added around it rather than in front of it.

interface Customer {
  id: string; name?: string; waId: string; phone?: string; lifetimeSpend: number | string;
  lastSeenAt?: string; _count?: { orders: number; messages: number };
  /** Free-form labels. Lowercased by the server. */
  tags?: string[];
  /** Newest conversation's `lastMessageAt`, flattened by the API. Null if never messaged. */
  lastMessageAt?: string | null;
  /**
   * The newest message itself, for the preview under the timestamp.
   *
   * `body` is null on a media message — WhatsApp images and documents carry no text — so the
   * cell shows the timestamp alone rather than inventing copy the operator never wrote.
   */
  lastMessage?: { body: string | null; direction: 'INBOUND' | 'OUTBOUND' } | null;
  marketingOptIn?: boolean;
  optedOutAt?: string | null;
  /**
   * The lead behind this number, when there is one.
   *
   * **Absent, not null, when the workspace does not have Leads** — the server omits the key
   * entirely rather than sending null, so an undefined here means "cannot say" and a null
   * means "this customer is not a lead". Nothing on this page needs to tell those apart, but
   * the distinction is why the field is optional rather than nullable.
   */
  lead?: { id: string; name: string; status: string; ownerId: string | null } | null;
}
interface CustomerDetail extends Customer {
  orders: { id: string; orderNumber: number; status: string; totalAmount: number; placedAt: string }[];
}

/**
 * "+91 98450 22831 · India" from the stored `waId`.
 *
 * The country is derived, not a column: `splitNumber` runs the number through
 * libphonenumber and returns null when it cannot be attributed to one country — a `+1`
 * number, say, which twenty-odd territories share. In that case the label is simply left
 * off rather than guessed at.
 */
const phoneLabel = (customer: Customer): string => {
  const raw = customer.phone || customer.waId;
  const parts = splitNumber(raw);
  // No single country — a `+1` number, which twenty-odd territories share, or a number
  // libphonenumber cannot parse. Still shown with a leading `+` so it reads as an
  // international number rather than a bare run of digits.
  if (!parts) return raw.startsWith('+') ? raw : `+${raw}`;
  return `${parts.country.dialCode} ${parts.national} · ${parts.country.name}`;
};

/**
 * The last message, as something a person would want to read.
 *
 * **Not every stored body is prose.** When a customer taps a list row or a button, some paths
 * store the reply's payload id rather than its title — real rows in this database read
 * `cat:18989181-4eff-468e-86e0-20ba57373749`. Rendering that in a preview column makes the
 * screen look broken, and it is the kind of thing a mockup with invented data never shows.
 *
 * A media message has no body at all and comes back null. Both cases return null here and the
 * cell falls back to the timestamp alone, rather than inventing copy the operator never wrote.
 */
const MACHINE_PAYLOAD = /^[a-z][a-z0-9_]*:[0-9a-f-]{8,}$/i;

const previewOf = (message: Customer['lastMessage']): string | null => {
  const body = message?.body?.trim();
  if (!body || MACHINE_PAYLOAD.test(body)) return null;
  return body;
};

/**
 * The two halves of the lead filter.
 *
 * "Not a lead" is as useful as "is a lead" — it is how someone finds the customers their
 * pipeline has never picked up, which is the whole reason to look at this from the Customers
 * side rather than from Leads.
 */
const LEAD_OPTIONS = [
  { value: 'yes' as const, label: 'Is a lead' },
  { value: 'no' as const, label: 'Not a lead' },
];

// ── Add / edit dialog ─────────────────────────────────────────────────────────
// One component for both modes. In edit mode the WhatsApp number is shown but not
// editable: it is the identity the inbound webhook matches on, so changing it
// would orphan this record from its conversation history.

function CustomerFormDialog({
  mode, customer, open, onOpenChange, onSaved,
}: {
  mode: 'create' | 'edit';
  customer?: Customer | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved: () => void;
}) {
  const [waId, setWaId] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');

  // Re-seed the fields whenever the dialog opens for a different record.
  useEffect(() => {
    if (!open) return;
    setWaId(customer?.waId ?? '');
    setName(customer?.name ?? '');
    setPhone(customer?.phone ?? '');
  }, [open, customer]);

  const save = useMutation({
    mutationFn: async () => {
      if (mode === 'create') {
        return (await api.post('/customers', { waId, name: name || null, phone: phone || null })).data;
      }
      return (await api.patch(`/customers/${customer!.id}`, { name: name || null, phone: phone || null })).data;
    },
    onSuccess: () => {
      toast.success(mode === 'create' ? 'Customer added' : 'Customer updated');
      onOpenChange(false);
      onSaved();
    },
    // The api client already surfaces the server message (duplicate number,
    // missing country code) as a toast, so nothing extra to do here.
  });

  const digits = waId.replace(/\D/g, '').replace(/^0+/, '');
  const canSave = mode === 'edit' || digits.length >= 8;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{mode === 'create' ? 'Add customer' : 'Edit customer'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="cust-waid">WhatsApp number</Label>
            <Input
              id="cust-waid"
              value={waId}
              disabled={mode === 'edit'}
              autoComplete="off"
              placeholder="917702000350"
              onChange={(e) => setWaId(e.target.value)}
            />
            <p className="text-caption text-muted-foreground">
              {mode === 'edit'
                ? 'Cannot be changed — it links this record to their WhatsApp conversation.'
                : 'Include the country code, no + or spaces. Normalised on save.'}
            </p>
          </div>

          <div className="space-y-1">
            <Label htmlFor="cust-name">Name</Label>
            <Input id="cust-name" value={name} autoComplete="off" placeholder="Optional"
              onChange={(e) => setName(e.target.value)} />
            {mode === 'edit' && (
              <p className="text-caption text-muted-foreground">
                Note: this is overwritten by their WhatsApp profile name on their next message.
              </p>
            )}
          </div>

          <div className="space-y-1">
            <Label htmlFor="cust-phone">Contact phone</Label>
            <Input id="cust-phone" value={phone} autoComplete="off" placeholder="Optional — defaults to the WhatsApp number"
              onChange={(e) => setPhone(e.target.value)} />
          </div>

          {mode === 'create' && (
            <div className="flex gap-2 rounded-md bg-warning/15 border border-warning/40 p-3 text-caption text-ink-900">
              <Info className="w-4 h-4 shrink-0 mt-px" />
              <span>
                Adding a customer here records them for CRM only. WhatsApp will not let you send
                them a free-form message until <strong>they message you first</strong> (which opens a
                24-hour window) or you send an approved template.
              </span>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
          <Button onClick={() => save.mutate()} disabled={!canSave || save.isPending}>
            {save.isPending ? 'Saving…' : mode === 'create' ? 'Add customer' : 'Save changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Matches the Orders page, so paging feels the same in both places. */
const PAGE_SIZE = 10;

export default function Customers() {
  const qc = useQueryClient();
  const nav = useNavigate();

  /** `null` is the "All customers" pseudo-list — no `listId` sent. */
  const [listId, setListId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<ContactStatus | ''>('');
  const [tag, setTag] = useState('');
  /** `true` = only leads, `false` = only non-leads, `''` = don't filter. */
  const [leadOnly, setLeadOnly] = useState<'' | 'yes' | 'no'>('');
  const [page, setPage] = useState(1);

  /**
   * Leads is optional and separately permissioned, so this page shows lead information only
   * when both are true. The server enforces it as well and omits the field regardless — this
   * is here so a workspace without Leads never sees a filter for something it does not have.
   */
  const hasLeads = useHasModule('LEADS');
  const { can } = usePermissions();
  const showLeads = hasLeads && can('leads:read');

  const [selected, setSelected] = useState<string | null>(null);
  const [formMode, setFormMode] = useState<'create' | 'edit' | null>(null);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [taggingId, setTaggingId] = useState<string | null>(null);

  /**
   * Ticked rows, by id, kept across page changes so people can be gathered from several
   * pages into one list. The count is always on screen because of that — a selection you
   * cannot see is one you will act on by mistake.
   */
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const openAdd = () => { setEditing(null); setFormMode('create'); };
  const openEdit = (c: Customer) => { setEditing(c); setFormMode('edit'); };
  const afterSave = () => {
    qc.invalidateQueries({ queryKey: ['customers'] });
    if (selected) qc.invalidateQueries({ queryKey: ['customer', selected] });
  };

  // Every filter is in the key, so changing one refetches rather than reusing the previous
  // answer. Leaving any of them out is the bug where picking a list changes nothing.
  const { data, isLoading } = useQuery({
    queryKey: ['customers', { listId, search, status, tag, leadOnly, page }],
    queryFn: async () => {
      const response = await api.get<{ data: Customer[]; meta: { total: number } }>('/customers', {
        params: {
          listId: listId ?? undefined,
          search: search || undefined,
          status: status || undefined,
          tag: tag || undefined,
          isLead: leadOnly ? leadOnly === 'yes' : undefined,
          take: PAGE_SIZE,
          skip: (page - 1) * PAGE_SIZE,
        },
      });
      return { rows: response.data.data, total: response.data.meta.total };
    },
  });
  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;

  /** The workspace total, for the rail. Unfiltered, so it does not move as filters change. */
  const workspaceTotal = useQuery({
    queryKey: ['customers-total'],
    queryFn: async () => (await api.get<{ meta: { total: number } }>('/customers', {
      params: { take: 1 },
    })).data.meta.total,
  });

  const tags = useQuery({
    queryKey: ['customer-tags'],
    queryFn: async () => (await api.get<{ data: Array<{ tag: string; count: number }> }>(
      '/customers/tags',
    )).data.data,
  });

  const lists = useCustomerLists();
  const addToList = useAddToList();
  const removeFromList = useRemoveFromList();
  const selectedList = lists.data?.find((l) => l.id === listId) ?? null;

  const detail = useQuery({
    queryKey: ['customer', selected],
    enabled: !!selected,
    queryFn: async () => (await api.get<{ data: CustomerDetail }>(`/customers/${selected}`)).data.data,
  });

  // Get-or-create an open conversation, then jump into the Inbox preselected on it.
  const startConversation = useMutation({
    mutationFn: async (customerId: string) =>
      (await api.post<{ data: { id: string } }>('/inbox/conversations', { customerId })).data.data,
    onSuccess: (conv) => {
      qc.invalidateQueries({ queryKey: ['conversations'] });
      toast.success('Conversation ready');
      nav(`/inbox?conversationId=${conv.id}`);
    },
  });

  /** Any filter change returns to page 1, or a narrower result shows an empty table. */
  const resetTo = <T,>(setter: (v: T) => void) => (value: T) => { setter(value); setPage(1); };

  /** One place, so a filter added later cannot be forgotten by the Clear buttons. */
  const clearFilters = () => {
    resetTo(setStatus)('');
    resetTo(setTag)('');
    resetTo(setLeadOnly)('');
  };

  const pageIds = rows.map((c) => c.id);
  const allOnPageSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.has(id));
  const togglePage = () => setSelectedIds((current) => {
    const next = new Set(current);
    // Page-only, and the label says so. A control that quietly ticked all 265 is how the
    // whole database ends up on a list meant for forty people.
    if (allOnPageSelected) pageIds.forEach((id) => next.delete(id));
    else pageIds.forEach((id) => next.add(id));
    return next;
  });
  const toggleRow = (id: string) => setSelectedIds((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const taggingCustomer = rows.find((c) => c.id === taggingId) ?? null;

  return (
    <div className="flex flex-col gap-4 lg:h-[calc(100vh-var(--shell-offset))]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-h2 font-semibold">Customers</h1>
          <p className="text-sm text-muted-foreground">
            Everyone who has messaged you, and the lists you have grouped them into.
          </p>
        </div>
        <Button onClick={openAdd} className="gap-1">
          <UserPlus className="h-4 w-4" /> Add customer
        </Button>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-12">
        {/* Stacks below `lg`, where two panes side by side would crush both. */}
        <div className="lg:col-span-4 lg:min-h-0">
          <ListRail
            selectedListId={listId}
            onSelect={(next) => { setListId(next); setPage(1); }}
            totalCustomers={workspaceTotal.data ?? 0}
          />
        </div>

        <Card className="flex min-h-0 flex-col lg:col-span-8">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
            <div className="min-w-0">
              <h2 className="truncate text-body font-semibold text-ink-900">
                {selectedList?.name ?? 'All customers'}
              </h2>
              <p className="truncate text-caption text-muted-foreground">
                {selectedList?.description
                  ?? 'Filter by status or tag, or pick a list on the left.'}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-500" />
                <Input
                  className="w-56 pl-8"
                  placeholder="Search name, phone, tag"
                  value={search}
                  onChange={(e) => resetTo(setSearch)(e.target.value)}
                />
              </div>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon" aria-label="Filter contacts">
                    <Filter className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={clearFilters}>
                    Clear filters
                  </DropdownMenuItem>
                  {showLeads && LEAD_OPTIONS.map((option) => (
                    <DropdownMenuItem key={option.value} onClick={() => resetTo(setLeadOnly)(option.value)}>
                      <span className="mr-2 w-3.5">
                        {leadOnly === option.value && <Check className="h-3.5 w-3.5" />}
                      </span>
                      {option.label}
                    </DropdownMenuItem>
                  ))}
                  {STATUS_OPTIONS.map((option) => (
                    <DropdownMenuItem key={option} onClick={() => resetTo(setStatus)(option)}>
                      {/* An icon rather than a tick character — §8 keeps glyphs like that
                          out of UI chrome, and a fixed-width slot stops the labels shifting
                          as the selection moves. */}
                      <span className="mr-2 w-3.5">
                        {status === option && <Check className="h-3.5 w-3.5" />}
                      </span>
                      {statusLabel(option)}
                    </DropdownMenuItem>
                  ))}
                  {(tags.data ?? []).slice(0, 10).map((row) => (
                    <DropdownMenuItem key={row.tag} onClick={() => resetTo(setTag)(row.tag)}>
                      <span className="mr-2 w-3.5">
                        {tag === row.tag && <Check className="h-3.5 w-3.5" />}
                      </span>
                      {row.tag} ({row.count})
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>

              {/* Carries the list through, so the campaign opens with this audience already
                  chosen. Consent still applies, so the preview may honestly show fewer
                  reachable than the list has members. */}
              <Button
                className="gap-1"
                onClick={() => nav(listId ? `/campaigns/new?listId=${listId}` : '/campaigns/new')}
              >
                <Send className="h-4 w-4" /> Broadcast
              </Button>
            </div>
          </div>

          {(status || tag || leadOnly) && (
            <div className="flex flex-wrap items-center gap-2 border-b bg-surface-0/40 px-4 py-2">
              <span className="text-caption text-ink-500">Filtered by</span>
              {status && <Badge variant="secondary">{statusLabel(status)}</Badge>}
              {tag && <Badge variant="secondary">{tag}</Badge>}
              {leadOnly && (
                <Badge variant="secondary">
                  {LEAD_OPTIONS.find((o) => o.value === leadOnly)?.label}
                </Badge>
              )}
              <Button variant="outline" size="sm" onClick={clearFilters}>Clear</Button>
            </div>
          )}

          {selectedIds.size > 0 && (
            <div className="flex flex-wrap items-center gap-2 border-b border-accent-100 bg-accent-100/40 px-4 py-2">
              <span className="text-sm font-medium text-ink-900">{selectedIds.size} selected</span>
              <select
                aria-label="Add selected to list"
                className="h-9 rounded-md border border-ink-400 bg-surface-1 px-2 text-sm text-ink-900"
                value=""
                disabled={addToList.isPending || (lists.data ?? []).length === 0}
                onChange={(e) => {
                  if (!e.target.value) return;
                  addToList.mutate(
                    { listId: e.target.value, customerIds: [...selectedIds] },
                    { onSuccess: () => setSelectedIds(new Set()) },
                  );
                }}
              >
                <option value="">Add to list…</option>
                {(lists.data ?? []).map((list) => (
                  <option key={list.id} value={list.id}>{list.name}</option>
                ))}
              </select>
              {/* Only offered while a real list is open — "remove from list" has no meaning
                  under All customers, and would read as "delete". */}
              {listId && (
                <Button variant="outline" size="sm" disabled={removeFromList.isPending}
                  onClick={() => removeFromList.mutate(
                    { listId, customerIds: [...selectedIds] },
                    { onSuccess: () => setSelectedIds(new Set()) },
                  )}
                >
                  Remove from this list
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={() => setSelectedIds(new Set())}>
                Clear
              </Button>
            </div>
          )}

          <CardContent className="min-h-0 flex-1 overflow-auto p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8">
                    <input
                      type="checkbox"
                      aria-label="Select every contact on this page"
                      className="h-4 w-4 rounded border-ink-400 text-accent-600"
                      checked={allOnPageSelected}
                      onChange={togglePage}
                    />
                  </TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Tags</TableHead>
                  <TableHead>Last message</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={6}>
                    <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>
                  </TableCell></TableRow>
                ) : total === 0 ? (
                  <TableRow><TableCell colSpan={6}>
                    {/* Three different empty states, because they need three different
                        answers. An empty list wants "add someone"; a search with no hits
                        wants "clear the search", and offering "Add customer" there would be
                        answering a question nobody asked. */}
                    <div className="py-12 text-center">
                      <EmptyListArt />
                      <p className="mt-4 text-body font-semibold text-ink-900">
                        {listId ? 'No customers on this list' : 'No customers match'}
                      </p>
                      <p className="mx-auto mt-1 max-w-sm text-sm text-ink-500">
                        {listId
                          ? 'Pick people under All customers and use “Add to list”, or add someone new.'
                          : 'Try a different search, or clear the filters to see everyone.'}
                      </p>
                      {/* `openAdd`, the same handler the header button uses, and ungated for
                          the same reason it is — a second, stricter rule here would mean the
                          two Add buttons on one screen disagreed about who may click them. */}
                      {listId && (
                        <Button className="mt-4 gap-1" onClick={openAdd}>
                          <UserPlus className="h-4 w-4" /> Add customer
                        </Button>
                      )}
                    </div>
                  </TableCell></TableRow>
                ) : rows.map((c) => (
                  <TableRow key={c.id} className="cursor-pointer" onClick={() => setSelected(c.id)}>
                    {/* `stopPropagation`, or ticking a box also opens the detail dialog. */}
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        aria-label={`Select ${c.name || c.waId}`}
                        className="h-4 w-4 rounded border-ink-400 text-accent-600"
                        checked={selectedIds.has(c.id)}
                        onChange={() => toggleRow(c.id)}
                      />
                    </TableCell>

                    <TableCell>
                      <div className="flex items-center gap-3">
                        {/* Tinted per customer, stably — the same person is the same colour
                            on every visit, which makes the avatar a weak recognition cue when
                            scanning. Categorical hues, never semantic: a colour here must not
                            read as "this customer is in a good or bad state", which is what
                            StatusPill is for. See lib/categorical-tint.ts. */}
                        <span
                          aria-hidden
                          className={cn(
                            'flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-caption font-semibold',
                            tintFor(c.name || c.waId),
                          )}
                        >
                          {initialsOf(c.name, c.waId)}
                        </span>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="truncate text-sm font-medium text-ink-900">
                              {c.name || '—'}
                            </p>
                            {/* Straight to the lead. `stopPropagation` because the row itself
                                opens the customer dialog, and a link inside a clickable row
                                otherwise does both. */}
                            {showLeads && c.lead && (
                              <Link
                                to={`/leads/${c.lead.id}`}
                                onClick={(e) => e.stopPropagation()}
                                title={`${c.lead.name} — ${c.lead.status.toLowerCase()} in the pipeline`}
                              >
                                <Badge variant="outline" className="gap-1">
                                  <Target className="h-3 w-3" />
                                  Lead
                                </Badge>
                              </Link>
                            )}
                          </div>
                          <p className="truncate text-caption text-ink-500">{phoneLabel(c)}</p>
                        </div>
                      </div>
                    </TableCell>

                    <TableCell><StatusPill customer={c} /></TableCell>

                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {/* Tinted by tag name, so "VIP" is the same colour on every row and
                            the eye can group by colour down the column rather than reading
                            each pill. Same categorical scale as the avatars. */}
                        {(c.tags ?? []).length === 0
                          ? <span className="text-caption text-ink-500">—</span>
                          : c.tags!.map((t) => (
                            <span
                              key={t}
                              className={cn(
                                'rounded-full px-2 py-1 text-caption font-medium',
                                tintFor(t),
                              )}
                            >
                              {t}
                            </span>
                          ))}
                      </div>
                    </TableCell>

                    {/* Message above, time below — the reference's shape, and the right one:
                        what was said is what identifies the conversation, and when it was said
                        is the qualifier. Truncated to one line so a long message cannot push
                        the row height around and break the scan down the column. */}
                    <TableCell className="max-w-[16rem]">
                      {previewOf(c.lastMessage)
                        ? <p className="truncate text-sm text-ink-900">{previewOf(c.lastMessage)}</p>
                        : <p className="text-sm text-ink-500">—</p>}
                      <p className="truncate text-caption text-ink-500">{timeAgo(c.lastMessageAt)}</p>
                    </TableCell>

                    <TableCell onClick={(e) => e.stopPropagation()} className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="outline" size="icon" aria-label={`Actions for ${c.name || c.waId}`}>
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openEdit(c)}>
                            <Pencil className="mr-2 h-3.5 w-3.5" /> Edit details
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => startConversation.mutate(c.id)}
                            disabled={startConversation.isPending}
                          >
                            <MessageSquarePlus className="mr-2 h-3.5 w-3.5" /> Start chat
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setTaggingId(c.id)}>
                            <Tag className="mr-2 h-3.5 w-3.5" /> Manage tags
                          </DropdownMenuItem>
                          {showLeads && c.lead && (
                            <DropdownMenuItem onClick={() => nav(`/leads/${c.lead!.id}`)}>
                              <Target className="mr-2 h-3.5 w-3.5" /> Open lead
                            </DropdownMenuItem>
                          )}
                          {listId && (
                            <DropdownMenuItem
                              onClick={() => removeFromList.mutate({ listId, customerIds: [c.id] })}
                            >
                              Remove from this list
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-2">
            <span className="text-caption text-ink-500">
              {rows.length} of {total} contact{total === 1 ? '' : 's'}
            </span>
            <span className="text-caption text-ink-500">{selectedIds.size} selected</span>
          </div>
          <Pagination
            page={page}
            onPageChange={setPage}
            pageSize={PAGE_SIZE}
            total={total}
            noun="contacts"
          />
        </Card>
      </div>

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>{detail.data?.name || detail.data?.waId || 'Customer'}</DialogTitle></DialogHeader>
          {detail.data && (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-2 text-sm">
                <div><div className="text-muted-foreground">Phone</div><div>{detail.data.phone || detail.data.waId}</div></div>
                <div><div className="text-muted-foreground">Orders</div><div>{detail.data.orders.length}</div></div>
                <div><div className="text-muted-foreground">Lifetime</div><div>{formatCurrency(detail.data.lifetimeSpend as number)}</div></div>
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                {showLeads && detail.data.lead && (
                  <Button asChild variant="outline">
                    <Link to={`/leads/${detail.data.lead.id}`}>
                      <Target className="mr-1 h-3.5 w-3.5" />
                      Open lead ({detail.data.lead.status.toLowerCase()})
                    </Link>
                  </Button>
                )}
                <Button variant="outline" onClick={() => detail.data && openEdit(detail.data)}>
                  <Pencil className="mr-1 h-3.5 w-3.5" />Edit details
                </Button>
                <Button
                  onClick={() => detail.data && startConversation.mutate(detail.data.id)}
                  disabled={startConversation.isPending}
                >
                  <MessageSquarePlus className="mr-1 h-4 w-4" />Start conversation
                </Button>
              </div>
              <div className="border-t pt-3">
                <div className="mb-2 text-sm font-medium">Recent orders</div>
                <Table>
                  <TableHeader><TableRow><TableHead>#</TableHead><TableHead>Status</TableHead><TableHead>Total</TableHead><TableHead>Date</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {detail.data.orders.map((o) => (
                      <TableRow key={o.id}><TableCell>{o.orderNumber}</TableCell><TableCell>{o.status}</TableCell><TableCell>{formatCurrency(o.totalAmount)}</TableCell><TableCell>{formatDateTime(o.placedAt)}</TableCell></TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <TagEditor
        customer={taggingCustomer}
        open={taggingId !== null}
        onOpenChange={(v) => { if (!v) setTaggingId(null); }}
      />

      <CustomerFormDialog
        mode={formMode ?? 'create'}
        customer={editing}
        open={formMode !== null}
        onOpenChange={(v) => { if (!v) setFormMode(null); }}
        onSaved={afterSave}
      />
    </div>
  );
}
