import { useState } from 'react';
import { EmptyState } from '@/components/ui/empty-state';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { UserPlus, Phone, Clock, Search } from 'lucide-react';
import { toast } from 'sonner';
import { useAuthStore } from '@/stores/auth.store';
import {
  LEAD_STATUSES, STATUS_TONE, type Lead, type LeadStatus, rupeesFromPaise, dueLabel,
} from '@/lib/leads';

// The pipeline list.
//
// Sorted by "needs attention" rather than by date: anything with a reminder
// already due comes first, then most recently touched. A list ordered by
// creation is one where the oldest lead is permanently at the bottom.

interface ListResponse {
  data: {
    leads: Lead[];
    total: number;
    counts: Partial<Record<LeadStatus, number>>;
  };
}

function AddLeadDialog({ open, onOpenChange, onSaved }: {
  open: boolean; onOpenChange: (v: boolean) => void; onSaved: () => void;
}) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [company, setCompany] = useState('');
  const [email, setEmail] = useState('');
  const [source, setSource] = useState('');
  const [value, setValue] = useState('');

  const reset = () => {
    setName(''); setPhone(''); setCompany(''); setEmail(''); setSource(''); setValue('');
  };

  const save = useMutation({
    mutationFn: () => api.post('/leads', {
      name,
      phone,
      company: company || null,
      email: email || null,
      source: source || null,
      // Rupees in the field, paise on the wire. Every amount in the product is an
      // integer number of paise; a float here eventually reports a pipeline total
      // that does not add up.
      valuePaise: value ? Math.round(Number(value) * 100) : null,
    }),
    onSuccess: () => {
      toast.success('Lead added');
      reset();
      onOpenChange(false);
      onSaved();
    },
    // The server refuses a duplicate number with a message naming the existing
    // lead, so showing it verbatim is more useful than "could not save".
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Add a lead</DialogTitle></DialogHeader>
        <div className="grid gap-3 py-2">
          <div className="grid gap-1">
            <Label htmlFor="lead-name">Name</Label>
            <Input id="lead-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Priya Sharma" />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="lead-phone">Phone</Label>
            <Input
              id="lead-phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+91 77020 00350"
            />
            <p className="text-caption text-muted-foreground">
              With the country code. This is what links them to their WhatsApp
              conversation if they message you.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1">
              <Label htmlFor="lead-company">Company</Label>
              <Input id="lead-company" value={company} onChange={(e) => setCompany(e.target.value)} />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="lead-source">Source</Label>
              <Input id="lead-source" value={source} onChange={(e) => setSource(e.target.value)} placeholder="Walk-in" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1">
              <Label htmlFor="lead-email">Email</Label>
              <Input id="lead-email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="lead-value">Value (₹)</Label>
              <Input id="lead-value" value={value} onChange={(e) => setValue(e.target.value)} placeholder="25000" />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!name.trim() || !phone.trim() || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? 'Adding…' : 'Add lead'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function Leads() {
  const qc = useQueryClient();
  const permissions = useAuthStore((s) => s.permissions);
  const canWrite = permissions.includes('leads:write');
  const canAssign = permissions.includes('leads:assign');

  const [status, setStatus] = useState<LeadStatus | ''>('');
  const [search, setSearch] = useState('');
  const [scope, setScope] = useState<'all' | 'mine' | 'unassigned' | 'due'>('all');
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (search.trim()) params.set('search', search.trim());
  if (scope === 'mine') params.set('owner', 'me');
  if (scope === 'unassigned') params.set('unassigned', 'true');
  if (scope === 'due') params.set('due', 'true');

  const { data, isLoading } = useQuery({
    queryKey: ['leads', status, search, scope],
    queryFn: async () => (await api.get<ListResponse>(`/leads?${params.toString()}`)).data.data,
  });

  const team = useQuery({
    queryKey: ['team-for-leads'],
    queryFn: async () => (await api.get<{ data: Array<{ id: string; fullName: string }> }>('/team')).data.data,
    enabled: canAssign,
  });

  const bulkAssign = useMutation({
    mutationFn: (ownerId: string | null) =>
      api.post('/leads/bulk-assign', { leadIds: [...selected], ownerId }),
    onSuccess: (response) => {
      const { assigned, failed } = (response.data as { data: { assigned: number; failed: unknown[] } }).data;
      toast.success(`${assigned} lead${assigned === 1 ? '' : 's'} reassigned${failed.length ? `, ${failed.length} could not be` : ''}`);
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ['leads'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const leads = data?.leads ?? [];
  const counts = data?.counts ?? {};

  const toggle = (id: string) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-h2 font-semibold tracking-tight">Leads</h1>
          <p className="text-sm text-muted-foreground">
            {data ? `${data.total} in this view` : 'Loading…'}
          </p>
        </div>
        {canWrite && (
          <Button onClick={() => setAdding(true)}>
            <UserPlus className="mr-2 h-4 w-4" /> Add a lead
          </Button>
        )}
      </div>

      {/* Scope first, then status. Most people start the day on "due". */}
      <div className="flex flex-wrap items-center gap-2">
        {([
          ['all', 'Everyone'], ['mine', 'Mine'], ['unassigned', 'Unassigned'], ['due', 'Action due'],
        ] as const).map(([key, label]) => (
          <Button
            key={key}
            size="sm"
            variant={scope === key ? 'default' : 'outline'}
            onClick={() => setScope(key)}
          >
            {label}
          </Button>
        ))}
        <div className="relative ml-auto w-full max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-8"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Name, number, company"
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant={status === '' ? 'secondary' : 'ghost'} onClick={() => setStatus('')}>
          All
        </Button>
        {LEAD_STATUSES.map((value) => (
          <Button
            key={value}
            size="sm"
            variant={status === value ? 'secondary' : 'ghost'}
            onClick={() => setStatus(value)}
          >
            {value.charAt(0) + value.slice(1).toLowerCase()}
            <span className="ml-1 text-caption text-muted-foreground">{counts[value] ?? 0}</span>
          </Button>
        ))}
      </div>

      {canAssign && selected.size > 0 && (
        <Card>
          <CardContent className="flex flex-wrap items-center gap-2 py-3">
            <span className="text-sm font-medium">{selected.size} selected</span>
            <select
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              defaultValue=""
              onChange={(e) => {
                if (e.target.value === '') return;
                bulkAssign.mutate(e.target.value === '__none' ? null : e.target.value);
                e.target.value = '';
              }}
            >
              <option value="" disabled>Assign to…</option>
              <option value="__none">Nobody (back to the pool)</option>
              {(team.data ?? []).map((member) => (
                <option key={member.id} value={member.id}>{member.fullName}</option>
              ))}
            </select>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-body">Pipeline</CardTitle></CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <p className="p-6 text-sm text-muted-foreground">Loading…</p>
          ) : leads.length === 0 ? (
            <EmptyState
              action={canWrite && !search && !status && scope === 'all' ? (
                <Button onClick={() => setAdding(true)}>
                  <UserPlus className="mr-2 h-4 w-4" /> Add a lead
                </Button>
              ) : undefined}
            >
              {search || status || scope !== 'all'
                ? 'Nothing matches this view. Clear the filters to see the whole pipeline.'
                : 'A lead is someone you are trying to win — a name and a number is enough to start. Move them through the pipeline as you talk to them.'}
            </EmptyState>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    {canAssign && <TableHead className="w-10" />}
                    <TableHead>Name</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Owner</TableHead>
                    <TableHead>Value</TableHead>
                    <TableHead>Next action</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {leads.map((lead) => {
                    const due = lead.nextActionAt && new Date(lead.nextActionAt) <= new Date();
                    return (
                      <TableRow key={lead.id}>
                        {canAssign && (
                          <TableCell>
                            <input
                              type="checkbox"
                              aria-label={`Select ${lead.name}`}
                              checked={selected.has(lead.id)}
                              onChange={() => toggle(lead.id)}
                            />
                          </TableCell>
                        )}
                        <TableCell>
                          <Link to={`/leads/${lead.id}`} className="font-medium hover:underline">
                            {lead.name}
                          </Link>
                          <div className="text-caption text-muted-foreground">
                            {lead.company ? `${lead.company} · ` : ''}+{lead.phone}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant={STATUS_TONE[lead.status]}>
                            {lead.status.charAt(0) + lead.status.slice(1).toLowerCase()}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm">
                          {lead.owner?.fullName ?? <span className="text-muted-foreground">Unassigned</span>}
                        </TableCell>
                        <TableCell className="text-sm">
                          {lead.valuePaise == null ? '—' : rupeesFromPaise(lead.valuePaise)}
                        </TableCell>
                        <TableCell className="text-sm">
                          {lead.nextActionAt ? (
                            <span className={due ? 'font-medium text-danger' : 'text-muted-foreground'}>
                              <Clock className="mr-1 inline h-3 w-3" />
                              {dueLabel(lead.nextActionAt)}
                            </span>
                          ) : <span className="text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell>
                          {/* A plain tel: link. On a desktop without a softphone
                              this does nothing visible, which is why the detail
                              page pairs it with an explicit "log the outcome". */}
                          <a
                            href={`tel:+${lead.phone}`}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-accent"
                            title={`Call +${lead.phone}`}
                          >
                            <Phone className="h-4 w-4" />
                          </a>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <AddLeadDialog
        open={adding}
        onOpenChange={setAdding}
        onSaved={() => qc.invalidateQueries({ queryKey: ['leads'] })}
      />
    </div>
  );
}
