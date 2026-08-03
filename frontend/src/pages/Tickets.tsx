import { useState } from 'react';
import { EmptyState } from '@/components/ui/empty-state';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { LifeBuoy, Search, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { formatDateTime } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth.store';
import {
  PRIORITY_LABEL, STATUS_LABEL, STATUS_TONE, TICKET_PRIORITIES, TICKET_STATUSES,
  type Ticket, type TicketPriority, type TicketStatus,
} from '@/lib/tickets';

interface ListResponse {
  data: { tickets: Ticket[]; total: number; counts: Partial<Record<TicketStatus, number>> };
}

function RaiseTicketDialog({ open, onOpenChange, onSaved }: {
  open: boolean; onOpenChange: (v: boolean) => void; onSaved: () => void;
}) {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [priority, setPriority] = useState<TicketPriority>('NORMAL');

  const save = useMutation({
    mutationFn: () => api.post('/tickets', { subject, body, priority }),
    onSuccess: (response) => {
      const ticket = (response.data as { data: Ticket }).data;
      toast.success(`${ticket.number} raised`);
      setSubject(''); setBody(''); setPriority('NORMAL');
      onOpenChange(false);
      onSaved();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Raise a ticket</DialogTitle></DialogHeader>
        <div className="grid gap-3 py-2">
          <div className="grid gap-1">
            <Label htmlFor="t-subject">Subject</Label>
            <Input id="t-subject" value={subject} onChange={(e) => setSubject(e.target.value)}
              placeholder="Order never arrived" />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="t-body">What happened</Label>
            <Textarea id="t-body" value={body} onChange={(e) => setBody(e.target.value)} rows={4} />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="t-priority">Priority</Label>
            <select
              id="t-priority"
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              value={priority}
              onChange={(e) => setPriority(e.target.value as TicketPriority)}
            >
              {TICKET_PRIORITIES.map((p) => (
                <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>
              ))}
            </select>
          </div>
          <p className="text-caption text-muted-foreground">
            To attach a ticket to a customer's WhatsApp thread, raise it from that
            conversation in the Inbox — that is what lets you reply to them from here.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!subject.trim() || !body.trim() || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? 'Raising…' : 'Raise ticket'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function Tickets() {
  const qc = useQueryClient();
  const permissions = useAuthStore((s) => s.permissions);
  const canWrite = permissions.includes('tickets:write');

  const [scope, setScope] = useState<'open' | 'mine' | 'unassigned' | 'all'>('open');
  const [status, setStatus] = useState<TicketStatus | ''>('');
  const [search, setSearch] = useState('');
  const [raising, setRaising] = useState(false);

  const params = new URLSearchParams();
  if (status) params.set('status', status);
  else if (scope === 'open') params.set('open', 'true');
  if (scope === 'mine') params.set('assignee', 'me');
  if (scope === 'unassigned') params.set('unassigned', 'true');
  if (search.trim()) params.set('search', search.trim());

  const { data, isLoading } = useQuery({
    queryKey: ['tickets', scope, status, search],
    queryFn: async () => (await api.get<ListResponse>(`/tickets?${params.toString()}`)).data.data,
  });

  const tickets = data?.tickets ?? [];
  const counts = data?.counts ?? {};

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-h2 font-semibold tracking-tight">Support</h1>
          <p className="text-sm text-muted-foreground">
            {data ? `${data.total} in this view` : 'Loading…'}
          </p>
        </div>
        {canWrite && (
          <Button onClick={() => setRaising(true)}>
            <LifeBuoy className="mr-2 h-4 w-4" /> Raise a ticket
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {([
          ['open', 'Open queue'], ['mine', 'Mine'], ['unassigned', 'Unassigned'], ['all', 'Everything'],
        ] as const).map(([key, label]) => (
          <Button
            key={key}
            size="sm"
            variant={scope === key ? 'default' : 'outline'}
            onClick={() => { setScope(key); setStatus(''); }}
          >
            {label}
          </Button>
        ))}
        <div className="relative ml-auto w-full max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-8" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Number, subject, customer" />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {TICKET_STATUSES.map((value) => (
          <Button
            key={value}
            size="sm"
            variant={status === value ? 'secondary' : 'ghost'}
            onClick={() => setStatus(status === value ? '' : value)}
          >
            {STATUS_LABEL[value]}
            <span className="ml-1 text-caption text-muted-foreground">{counts[value] ?? 0}</span>
          </Button>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-body">Tickets</CardTitle></CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <p className="p-6 text-sm text-muted-foreground">Loading…</p>
          ) : tickets.length === 0 ? (
            <EmptyState
              action={canWrite && scope === 'open' && !search && !status ? (
                <Button onClick={() => setRaising(true)}>
                  <LifeBuoy className="mr-2 h-4 w-4" /> Raise a ticket
                </Button>
              ) : undefined}
            >
              {scope === 'open' && !search && !status
                ? 'Nothing open — everything raised has been dealt with. Raise a ticket from a conversation in the Inbox and you can reply to the customer from here.'
                : 'Nothing matches this view. Clear the filters to see every ticket.'}
            </EmptyState>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Ticket</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Priority</TableHead>
                    <TableHead>Assignee</TableHead>
                    <TableHead>Opened</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tickets.map((ticket) => (
                    <TableRow key={ticket.id}>
                      <TableCell>
                        <Link to={`/tickets/${ticket.id}`} className="font-medium hover:underline">
                          {ticket.subject}
                        </Link>
                        <div className="font-mono text-caption text-muted-foreground">{ticket.number}</div>
                      </TableCell>
                      <TableCell className="text-sm">
                        {ticket.customer
                          ? (ticket.customer.name ?? `+${ticket.customer.waId}`)
                          : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell>
                        <Badge variant={STATUS_TONE[ticket.status]}>{STATUS_LABEL[ticket.status]}</Badge>
                      </TableCell>
                      <TableCell className="text-sm">
                        {ticket.priority === 'URGENT' || ticket.priority === 'HIGH' ? (
                          <span className="inline-flex items-center gap-1 font-medium text-danger">
                            <AlertTriangle className="h-3 w-3" />
                            {PRIORITY_LABEL[ticket.priority]}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">{PRIORITY_LABEL[ticket.priority]}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">
                        {ticket.assignee?.fullName
                          ?? <span className="text-muted-foreground">Unassigned</span>}
                      </TableCell>
                      <TableCell className="text-caption text-muted-foreground">
                        {formatDateTime(ticket.openedAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <RaiseTicketDialog
        open={raising}
        onOpenChange={setRaising}
        onSaved={() => qc.invalidateQueries({ queryKey: ['tickets'] })}
      />
    </div>
  );
}
