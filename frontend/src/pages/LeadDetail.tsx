import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  ArrowLeft, Phone, MessageSquare, Clock, Check, Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { formatDateTime } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth.store';
import {
  CALL_OUTCOMES, LEAD_STATUSES, STATUS_TONE, dueLabel, inHours, rupeesFromPaise,
  type CallLog, type CallOutcome, type Lead, type LeadEvent, type Reminder,
} from '@/lib/leads';

// One lead: who they are, what has happened, and the three things you can do
// next — call them, move them along, or set a reminder.

interface DetailResponse {
  data: { lead: Lead; events: LeadEvent[]; calls: CallLog[]; reminders: Reminder[] };
}

/**
 * Log what happened on a call.
 *
 * Opens after the `tel:` link fires. Nothing here places the call and nothing
 * observes it — the agent says how it went. That is why there is no duration
 * field: an estimate stored where a provider's measurement would go is worse
 * than a blank, because later nobody can tell which is which.
 */
function LogCallDialog({ leadId, phone, open, onOpenChange, onSaved }: {
  leadId: string; phone: string;
  open: boolean; onOpenChange: (v: boolean) => void; onSaved: () => void;
}) {
  const [outcome, setOutcome] = useState<CallOutcome>('CONNECTED');
  const [notes, setNotes] = useState('');

  const save = useMutation({
    mutationFn: () => api.post(`/leads/${leadId}/calls`, { outcome, notes: notes || null }),
    onSuccess: () => {
      toast.success('Call logged');
      setNotes('');
      setOutcome('CONNECTED');
      onOpenChange(false);
      onSaved();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>How did the call go?</DialogTitle></DialogHeader>
        <div className="grid gap-3 py-2">
          <p className="text-sm text-muted-foreground">
            Calling <span className="font-medium text-foreground">+{phone}</span>
          </p>
          <div className="grid gap-1">
            <Label htmlFor="call-outcome">Outcome</Label>
            <select
              id="call-outcome"
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              value={outcome}
              onChange={(e) => setOutcome(e.target.value as CallOutcome)}
            >
              {CALL_OUTCOMES.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <p className="text-caption text-muted-foreground">
              Only a connected call counts as contact — a lead that rang out should
              not look freshly worked.
            </p>
          </div>
          <div className="grid gap-1">
            <Label htmlFor="call-notes">Notes</Label>
            <Textarea
              id="call-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="What was said, what happens next"
              rows={3}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? 'Saving…' : 'Log the call'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function LeadDetail() {
  const { leadId = '' } = useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const permissions = useAuthStore((s) => s.permissions);
  const canWrite = permissions.includes('leads:write');
  const canAssign = permissions.includes('leads:assign');
  const canDelete = permissions.includes('leads:delete');

  const [logging, setLogging] = useState(false);
  const [note, setNote] = useState('');
  const [reminderNote, setReminderNote] = useState('');
  const [reminderAt, setReminderAt] = useState(inHours(24));

  const { data, isLoading } = useQuery({
    queryKey: ['lead', leadId],
    queryFn: async () => (await api.get<DetailResponse>(`/leads/${leadId}`)).data.data,
    enabled: Boolean(leadId),
  });

  const team = useQuery({
    queryKey: ['team-for-leads'],
    queryFn: async () => (await api.get<{ data: Array<{ id: string; fullName: string }> }>('/team')).data.data,
    enabled: canAssign,
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ['lead', leadId] });

  // Written out rather than generated by a helper. A factory that calls
  // `useMutation` internally happens to work while the call order is fixed, but
  // it hides a hook from both React's linter and the next reader — and the day
  // one of these becomes conditional it breaks in a way that is very hard to see.
  const onError = (err: Error) => toast.error(err.message);
  const done = (message: string) => () => { toast.success(message); refresh(); };

  const setStatus = useMutation({
    mutationFn: (status: string) => api.patch(`/leads/${leadId}/status`, { status }),
    onSuccess: done('Status updated'),
    onError,
  });
  const setOwner = useMutation({
    mutationFn: (ownerId: string | null) => api.patch(`/leads/${leadId}/owner`, { ownerId }),
    onSuccess: done('Owner updated'),
    onError,
  });
  const addNote = useMutation({
    mutationFn: (body: string) => api.post(`/leads/${leadId}/notes`, { body }),
    onSuccess: done('Note added'),
    onError,
  });
  const addReminder = useMutation({
    mutationFn: (body: { dueAt: string; note: string }) => api.post(`/leads/${leadId}/reminders`, body),
    onSuccess: done('Reminder set'),
    onError,
  });
  const completeReminder = useMutation({
    mutationFn: (id: string) => api.patch(`/leads/reminders/${id}/complete`),
    onSuccess: done('Reminder done'),
    onError,
  });

  const remove = useMutation({
    mutationFn: () => api.delete(`/leads/${leadId}`),
    onSuccess: () => {
      toast.success('Lead deleted');
      qc.invalidateQueries({ queryKey: ['leads'] });
      navigate('/leads');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!data) return <p className="text-sm text-muted-foreground">Lead not found.</p>;

  const { lead, events, calls, reminders } = data;
  const openReminders = reminders.filter((r) => !r.completedAt);

  return (
    <div className="space-y-4">
      <Link to="/leads" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to leads
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-h2 font-semibold tracking-tight">{lead.name}</h1>
            <Badge variant={STATUS_TONE[lead.status]}>
              {lead.status.charAt(0) + lead.status.slice(1).toLowerCase()}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            +{lead.phone}
            {lead.company ? ` · ${lead.company}` : ''}
            {lead.valuePaise != null ? ` · ${rupeesFromPaise(lead.valuePaise)}` : ''}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {canWrite && (
            <>
              {/* The dial and the log are two steps on purpose: the browser can
                  open a dialler but has no way to know what happened next. */}
              <Button asChild variant="outline">
                <a href={`tel:+${lead.phone}`} onClick={() => setLogging(true)}>
                  <Phone className="mr-2 h-4 w-4" /> Call
                </a>
              </Button>
              <Button variant="ghost" onClick={() => setLogging(true)}>Log a call</Button>
            </>
          )}
          {/* Straight to the thread. This used to link at bare `/inbox`, which dropped the
              agent on the conversation list to find the person by hand — the id comes down
              with the lead now. Hidden when the linked customer has no thread yet, because
              there would be nothing to open. */}
          {lead.customer?.conversations[0] && (
            <Button asChild variant="ghost">
              <Link to={`/inbox?conversationId=${lead.customer.conversations[0].id}`}>
                <MessageSquare className="mr-2 h-4 w-4" /> Open conversation
              </Link>
            </Button>
          )}
          {canDelete && (
            <Button
              variant="ghost"
              className="text-destructive"
              onClick={() => remove.mutate()}
              disabled={remove.isPending}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-body">Timeline</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {canWrite && (
                <div className="flex gap-2">
                  <Input
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Add a note"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && note.trim()) { addNote.mutate(note.trim()); setNote(''); }
                    }}
                  />
                  <Button
                    disabled={!note.trim() || addNote.isPending}
                    onClick={() => { addNote.mutate(note.trim()); setNote(''); }}
                  >
                    Add
                  </Button>
                </div>
              )}

              <ol className="space-y-3">
                {events.map((event) => (
                  <li key={event.id} className="flex gap-3 border-b pb-3 last:border-0 last:pb-0">
                    <div className="w-36 shrink-0 text-caption text-muted-foreground">
                      {formatDateTime(event.createdAt)}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm">
                        {event.type === 'STATUS_CHANGED' && event.fromStatus && event.toStatus
                          ? `Moved from ${event.fromStatus.toLowerCase()} to ${event.toStatus.toLowerCase()}`
                          : event.body ?? event.type.toLowerCase().replace(/_/g, ' ')}
                      </p>
                      {event.type === 'STATUS_CHANGED' && event.body && (
                        <p className="text-caption text-muted-foreground">{event.body}</p>
                      )}
                      <p className="text-caption text-muted-foreground">
                        {event.actor?.fullName ?? 'System'}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>

          {calls.length > 0 && (
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-body">Calls ({calls.length})</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {calls.map((call) => (
                  <div key={call.id} className="flex items-start justify-between gap-3 border-b pb-2 last:border-0 last:pb-0">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">
                        {CALL_OUTCOMES.find((o) => o.value === call.outcome)?.label ?? call.outcome}
                      </p>
                      {call.notes && <p className="text-caption text-muted-foreground">{call.notes}</p>}
                      <p className="text-caption text-muted-foreground">
                        {call.actor?.fullName ?? 'Someone'} · +{call.phone}
                      </p>
                    </div>
                    <span className="shrink-0 text-caption text-muted-foreground">
                      {formatDateTime(call.createdAt)}
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-body">Move it along</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-1">
                <Label htmlFor="lead-status">Status</Label>
                <select
                  id="lead-status"
                  className="h-9 rounded-md border border-input bg-background px-2 text-sm disabled:opacity-50"
                  value={lead.status}
                  disabled={!canWrite || setStatus.isPending}
                  onChange={(e) => setStatus.mutate(e.target.value)}
                >
                  {LEAD_STATUSES.map((value) => (
                    <option key={value} value={value}>
                      {value.charAt(0) + value.slice(1).toLowerCase()}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid gap-1">
                <Label htmlFor="lead-owner">Owner</Label>
                <select
                  id="lead-owner"
                  className="h-9 rounded-md border border-input bg-background px-2 text-sm disabled:opacity-50"
                  value={lead.ownerId ?? ''}
                  disabled={!canAssign || setOwner.isPending}
                  onChange={(e) => setOwner.mutate(e.target.value || null)}
                >
                  <option value="">Unassigned</option>
                  {(team.data ?? []).map((member) => (
                    <option key={member.id} value={member.id}>{member.fullName}</option>
                  ))}
                </select>
                {!canAssign && (
                  <p className="text-caption text-muted-foreground">
                    Your role cannot reassign leads.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-body">
                Reminders {openReminders.length > 0 && `(${openReminders.length} open)`}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {canWrite && (
                <div className="space-y-2">
                  <Input
                    type="datetime-local"
                    value={reminderAt}
                    onChange={(e) => setReminderAt(e.target.value)}
                  />
                  <Input
                    value={reminderNote}
                    onChange={(e) => setReminderNote(e.target.value)}
                    placeholder="What to do"
                  />
                  <Button
                    className="w-full"
                    disabled={!reminderNote.trim() || addReminder.isPending}
                    onClick={() => {
                      addReminder.mutate({
                        dueAt: new Date(reminderAt).toISOString(),
                        note: reminderNote.trim(),
                      });
                      setReminderNote('');
                    }}
                  >
                    <Clock className="mr-2 h-4 w-4" /> Set a reminder
                  </Button>
                  <p className="text-caption text-muted-foreground">
                    Goes to the lead's owner. It appears in the app — there is no
                    email or SMS reminder yet.
                  </p>
                </div>
              )}

              {reminders.length === 0 ? (
                <p className="text-caption text-muted-foreground">None set.</p>
              ) : reminders.map((reminder) => {
                const due = !reminder.completedAt && new Date(reminder.dueAt) <= new Date();
                return (
                  <div key={reminder.id} className="flex items-start justify-between gap-2 border-b pb-2 last:border-0 last:pb-0">
                    <div className="min-w-0">
                      <p className={`text-sm ${reminder.completedAt ? 'text-muted-foreground line-through' : ''}`}>
                        {reminder.note}
                      </p>
                      <p className={`text-caption ${due ? 'font-medium text-danger' : 'text-muted-foreground'}`}>
                        {dueLabel(reminder.dueAt)} · {reminder.assignee?.fullName ?? 'Unassigned'}
                      </p>
                    </div>
                    {!reminder.completedAt && canWrite && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => completeReminder.mutate(reminder.id)}
                        title="Mark done"
                      >
                        <Check className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-body">Details</CardTitle></CardHeader>
            <CardContent>
              <dl className="space-y-2 text-sm">
                {([
                  ['Email', lead.email ?? '—'],
                  ['Source', lead.source ?? '—'],
                  ['Last contacted', lead.lastContactedAt ? formatDateTime(lead.lastContactedAt) : 'Never'],
                  ['Added', formatDateTime(lead.createdAt)],
                  ['WhatsApp', lead.customer ? 'Has messaged' : 'Not yet'],
                ] as Array<[string, string]>).map(([label, value]) => (
                  <div key={label} className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="text-right">{value}</dd>
                  </div>
                ))}
              </dl>
              {lead.notes && <p className="mt-3 border-t pt-3 text-sm">{lead.notes}</p>}
            </CardContent>
          </Card>
        </div>
      </div>

      <LogCallDialog
        leadId={leadId}
        phone={lead.phone}
        open={logging}
        onOpenChange={setLogging}
        onSaved={refresh}
      />
    </div>
  );
}
