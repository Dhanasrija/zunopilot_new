import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { ArrowLeft, Send, Lock, MessageSquare, EyeOff } from 'lucide-react';
import { toast } from 'sonner';
import { formatDateTime } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth.store';
import {
  CLOSED_STATUSES, PRIORITY_LABEL, STATUS_LABEL, STATUS_TONE, TICKET_STATUSES,
  windowLabel, type Ticket, type TicketEvent, type TicketStatus, type WindowState,
} from '@/lib/tickets';

interface DetailResponse {
  data: { ticket: Ticket; events: TicketEvent[]; window: WindowState };
}

export default function TicketDetail() {
  const { ticketId = '' } = useParams();
  const qc = useQueryClient();
  const permissions = useAuthStore((s) => s.permissions);
  const canWrite = permissions.includes('tickets:write');
  const canAssign = permissions.includes('tickets:assign');
  const canClose = permissions.includes('tickets:close');

  const [update, setUpdate] = useState('');
  const [note, setNote] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['ticket', ticketId],
    queryFn: async () => (await api.get<DetailResponse>(`/tickets/${ticketId}`)).data.data,
    enabled: Boolean(ticketId),
  });

  const team = useQuery({
    queryKey: ['team-for-tickets'],
    queryFn: async () => (await api.get<{ data: Array<{ id: string; fullName: string }> }>('/team')).data.data,
    enabled: canAssign,
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ['ticket', ticketId] });
  const onError = (err: Error) => toast.error(err.message);

  const setStatus = useMutation({
    mutationFn: (status: string) => api.patch(`/tickets/${ticketId}/status`, { status }),
    onSuccess: () => { toast.success('Status updated'); refresh(); },
    onError,
  });
  const setAssignee = useMutation({
    mutationFn: (assigneeId: string | null) => api.patch(`/tickets/${ticketId}/assignee`, { assigneeId }),
    onSuccess: () => { toast.success('Assignee updated'); refresh(); },
    onError,
  });
  const addNote = useMutation({
    mutationFn: (body: string) => api.post(`/tickets/${ticketId}/notes`, { body }),
    onSuccess: () => { toast.success('Note added'); setNote(''); refresh(); },
    onError,
  });

  const sendUpdate = useMutation({
    mutationFn: (body: string) => api.post<{ data: { sent: boolean; reason?: string } }>(
      `/tickets/${ticketId}/updates`, { body }),
    onSuccess: (response) => {
      const result = response.data.data;
      // The server answers 200 with `sent: false` when the window has closed —
      // not an error, because the agent cannot fix it by retrying and their text
      // was kept. Showing the server's own explanation beats a generic failure.
      if (result.sent) toast.success('Sent to the customer');
      else toast.warning(result.reason ?? 'Could not be sent — saved on the ticket');
      setUpdate('');
      refresh();
    },
    onError,
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!data) return <p className="text-sm text-muted-foreground">Ticket not found.</p>;

  const { ticket, events, window } = data;

  return (
    <div className="space-y-4">
      <Link to="/tickets" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to support
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-h2 font-semibold tracking-tight">{ticket.subject}</h1>
            <Badge variant={STATUS_TONE[ticket.status]}>{STATUS_LABEL[ticket.status]}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            <span className="font-mono">{ticket.number}</span>
            {ticket.customer ? ` · ${ticket.customer.name ?? `+${ticket.customer.waId}`}` : ''}
            {` · ${PRIORITY_LABEL[ticket.priority]} priority`}
          </p>
        </div>
        {ticket.conversationId && (
          <Button asChild variant="outline">
            <Link to="/inbox"><MessageSquare className="mr-2 h-4 w-4" /> Open conversation</Link>
          </Button>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-body">What was reported</CardTitle></CardHeader>
            <CardContent>
              <p className="whitespace-pre-wrap text-sm">{ticket.body}</p>
              <p className="mt-2 text-caption text-muted-foreground">
                Raised by {ticket.openedBy?.fullName ?? 'someone'} · {formatDateTime(ticket.openedAt)}
              </p>
            </CardContent>
          </Card>

          {canWrite && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-body">Reply to the customer</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {/*
                  The window is stated before the box, not after the send fails.
                  An agent who types a resolution and only then learns it cannot be
                  delivered has already spent the effort and may assume it went.
                */}
                <div
                  className={`flex items-center gap-2 rounded-md border px-3 py-2 text-caption ${
                    window.open
                      ? 'border-success/30 bg-success/10 text-success'
                      : 'border-warning/40 bg-warning/15 text-ink-900'
                  }`}
                >
                  {window.open ? <Send className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
                  {windowLabel(window)}
                </div>

                <Textarea
                  value={update}
                  onChange={(e) => setUpdate(e.target.value)}
                  rows={3}
                  placeholder={window.open
                    ? 'This goes to the customer on WhatsApp'
                    : 'This will be saved on the ticket but not delivered'}
                />
                <Button
                  disabled={!update.trim() || sendUpdate.isPending}
                  onClick={() => sendUpdate.mutate(update.trim())}
                >
                  <Send className="mr-2 h-4 w-4" />
                  {window.open ? 'Send to customer' : 'Save (cannot be delivered)'}
                </Button>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-body">History</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {canWrite && (
                <div className="space-y-2">
                  <Textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    rows={2}
                    placeholder="Internal note — the customer never sees this"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!note.trim() || addNote.isPending}
                    onClick={() => addNote.mutate(note.trim())}
                  >
                    Add internal note
                  </Button>
                </div>
              )}

              <ol className="space-y-3">
                {events.map((event) => (
                  <li key={event.id} className="flex gap-3 border-b pb-3 last:border-0 last:pb-0">
                    <div className="w-36 shrink-0 text-caption text-muted-foreground">
                      {formatDateTime(event.createdAt)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        {/*
                          The one label that must never be wrong in either
                          direction: an internal note shown as delivered would let
                          an agent believe the customer was told something they
                          were not.
                        */}
                        {event.type === 'CUSTOMER_UPDATE' && (
                          <Badge variant="default" className="text-caption">Sent to customer</Badge>
                        )}
                        {event.type === 'UPDATE_NOT_SENT' && (
                          <Badge variant="destructive" className="text-caption">Not delivered</Badge>
                        )}
                        {event.type === 'NOTE' && (
                          <span className="inline-flex items-center gap-1 text-caption text-muted-foreground">
                            <EyeOff className="h-3 w-3" /> Internal
                          </span>
                        )}
                      </div>
                      <p className="mt-px text-sm">
                        {event.type === 'STATUS_CHANGED' && event.fromStatus && event.toStatus
                          ? `Moved from ${STATUS_LABEL[event.fromStatus].toLowerCase()} to ${STATUS_LABEL[event.toStatus].toLowerCase()}`
                          : event.body ?? event.type.toLowerCase().replace(/_/g, ' ')}
                      </p>
                      <p className="text-caption text-muted-foreground">
                        {event.actor?.fullName ?? 'System'}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-body">Work it</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-1">
                <Label htmlFor="t-status">Status</Label>
                <select
                  id="t-status"
                  className="h-9 rounded-md border border-input bg-background px-2 text-sm disabled:opacity-50"
                  value={ticket.status}
                  disabled={!canWrite || setStatus.isPending}
                  onChange={(e) => setStatus.mutate(e.target.value)}
                >
                  {TICKET_STATUSES.map((value) => (
                    <option
                      key={value}
                      value={value}
                      // Resolving or closing needs `tickets:close`. Disabling the
                      // option rather than letting it 403 on click.
                      disabled={CLOSED_STATUSES.includes(value) && !canClose}
                    >
                      {STATUS_LABEL[value]}
                      {CLOSED_STATUSES.includes(value) && !canClose ? ' (not allowed)' : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid gap-1">
                <Label htmlFor="t-assignee">Assignee</Label>
                <select
                  id="t-assignee"
                  className="h-9 rounded-md border border-input bg-background px-2 text-sm disabled:opacity-50"
                  value={ticket.assigneeId ?? ''}
                  disabled={!canAssign || setAssignee.isPending}
                  onChange={(e) => setAssignee.mutate(e.target.value || null)}
                >
                  <option value="">Unassigned</option>
                  {(team.data ?? []).map((member) => (
                    <option key={member.id} value={member.id}>{member.fullName}</option>
                  ))}
                </select>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-body">Timings</CardTitle></CardHeader>
            <CardContent>
              <dl className="space-y-2 text-sm">
                {([
                  ['Opened', formatDateTime(ticket.openedAt)],
                  ['First reply', ticket.firstRespondedAt ? formatDateTime(ticket.firstRespondedAt) : 'Not yet'],
                  ['Resolved', ticket.resolvedAt ? formatDateTime(ticket.resolvedAt) : '—'],
                  ['Closed', ticket.closedAt ? formatDateTime(ticket.closedAt) : '—'],
                ] as Array<[string, string]>).map(([label, value]) => (
                  <div key={label} className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="text-right">{value}</dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
