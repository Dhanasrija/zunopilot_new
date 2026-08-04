import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { cn, formatDateTime } from '@/lib/utils';
import { toast } from 'sonner';
import { usePermissions } from '@/lib/permissions';
import { useAuthStore, useHasModule } from '@/stores/auth.store';
import { LifeBuoy } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { PRIORITY_LABEL, TICKET_PRIORITIES, type TicketPriority } from '@/lib/tickets';

interface Conversation {
  id: string;
  status: string;
  automationPaused: boolean;
  unreadCount: number;
  lastMessageAt: string | null;
  customer: { id: string; name?: string; waId: string };
  assignedAgent?: { id: string; fullName: string; email: string } | null;
}

type Scope = 'all' | 'mine' | 'unassigned';

interface TeamMember { id: string; fullName: string; role: string; isActive: boolean }

interface Message {
  id: string;
  direction: 'INBOUND' | 'OUTBOUND';
  type: string;
  body?: string | null;
  payload?: unknown;
  createdAt: string;
  /**
   * Who sent it. Null on an OUTBOUND message means the bot — the workflow
   * engine or the assistant — which is exactly what a shared inbox has to make
   * visible: a colleague's reply, your own, and an automated one all look
   * identical without it.
   */
  sentByUser?: { id: string; fullName: string; role: string } | null;
}

interface OfferedOption { id: string; title: string }

/**
 * The rows or buttons an outbound interactive message offered.
 *
 * Written by the engine's inbox mirror under `payload.outbound`. Read
 * defensively — `payload` also carries Meta's own inbound shapes, which this
 * must never try to interpret.
 */
const outboundOptions = (message: Message): OfferedOption[] => {
  const outbound = (message.payload as { outbound?: { options?: unknown } } | null)?.outbound;
  if (!outbound || !Array.isArray(outbound.options)) return [];
  return outbound.options.filter(
    (o): o is OfferedOption => !!o && typeof (o as OfferedOption).title === 'string',
  );
};

/**
 * Raise a support ticket from the conversation the agent is already reading.
 *
 * Carries the `conversationId`, which is the whole reason to raise it from here:
 * that link is what lets the ticket be answered on WhatsApp later, and the
 * server takes the customer from the conversation rather than from this form.
 */
function RaiseFromConversation({ conversationId, customerName, open, onOpenChange }: {
  conversationId: string;
  customerName: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [priority, setPriority] = useState<TicketPriority>('NORMAL');

  const raise = useMutation({
    mutationFn: () => api.post('/tickets', { subject, body, priority, conversationId }),
    onSuccess: (response) => {
      const ticket = (response.data as { data: { number: string } }).data;
      toast.success(`${ticket.number} raised for ${customerName}`);
      setSubject(''); setBody(''); setPriority('NORMAL');
      onOpenChange(false);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Raise a ticket for {customerName}</DialogTitle></DialogHeader>
        <div className="grid gap-3 py-2">
          <div className="grid gap-1">
            <Label htmlFor="ib-subject">Subject</Label>
            <Input id="ib-subject" value={subject} onChange={(e) => setSubject(e.target.value)}
              placeholder="Order never arrived" />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="ib-body">What happened</Label>
            <Textarea id="ib-body" value={body} onChange={(e) => setBody(e.target.value)} rows={4} />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="ib-priority">Priority</Label>
            <select
              id="ib-priority"
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
            Linked to this conversation, so replies from the ticket reach them on
            WhatsApp.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!subject.trim() || !body.trim() || raise.isPending} onClick={() => raise.mutate()}>
            {raise.isPending ? 'Raising…' : 'Raise ticket'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function Inbox() {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const initial = params.get('conversationId');
  const [selectedId, setSelectedId] = useState<string | null>(initial);
  const [draft, setDraft] = useState('');
  const [scope, setScope] = useState<Scope>('all');
  const [raisingTicket, setRaisingTicket] = useState(false);
  const { can } = usePermissions();
  const hasSupport = useHasModule('SUPPORT');
  const myId = useAuthStore((state) => state.user?.id);

  const conversations = useQuery({
    queryKey: ['conversations', scope],
    queryFn: async () => {
      const query = scope === 'mine' ? '?assignedToMe=true'
        : scope === 'unassigned' ? '?unassigned=true'
          : '';
      return (await api.get<{ data: Conversation[] }>(`/inbox/conversations${query}`)).data.data;
    },
    refetchInterval: 1_000,
  });

  // Keep the URL in sync so a refresh keeps the conversation selected.
  useEffect(() => {
    if (selectedId && params.get('conversationId') !== selectedId) {
      params.set('conversationId', selectedId);
      setParams(params, { replace: true });
    }
  }, [selectedId, params, setParams]);

  // If the deep-linked conversation isn't in the current page of results, refetch.
  useEffect(() => {
    if (initial && conversations.data && !conversations.data.find((c) => c.id === initial)) {
      qc.invalidateQueries({ queryKey: ['conversations'] });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial, conversations.data?.length]);

  const messages = useQuery({
    queryKey: ['messages', selectedId],
    enabled: !!selectedId,
    queryFn: async () => (await api.get<{ data: Message[] }>(`/inbox/conversations/${selectedId}/messages`)).data.data,
    refetchInterval: 1_000,
  });

  const conv = conversations.data?.find((c) => c.id === selectedId);

  // ── Keeping the newest message in view ──────────────────────────────────────
  //
  // The API returns up to 500 messages oldest-first, so the newest is at the
  // bottom and a busy conversation opened at its natural scroll position showed
  // the *oldest* message — an agent had to scroll through months of history to
  // find what they had just been asked.
  //
  // Two behaviours, and the second is why this is not a one-liner:
  //
  //   1. **Opening a conversation jumps to the bottom**, instantly. Animating a
  //      scroll through 147 messages is something to sit through, not a nicety.
  //   2. **A message arriving only scrolls if the agent is already at the bottom.**
  //      The list refetches every second, so unconditionally scrolling would yank
  //      them back down every second while they were reading history and make it
  //      impossible to look at anything but the latest message.
  const scrollRef = useRef<HTMLDivElement>(null);
  /** Is the agent parked at the bottom, i.e. following the conversation live? */
  const following = useRef(true);
  /** Which conversation the list is currently *showing*, to detect a switch. */
  const shown = useRef<string | null>(null);

  const list = messages.data;
  // Keyed on the last id rather than the array identity: `refetchInterval` hands
  // back a fresh array every second, and re-scrolling on each poll would fight the
  // agent even when nothing changed.
  const lastMessageId = list?.length ? list[list.length - 1].id : null;

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    // A tolerance, not an exact equality: sub-pixel heights and a partly visible
    // last bubble both mean `scrollTop` never quite reaches the maximum, and an
    // exact test would decide the agent had scrolled away when they had not.
    following.current = el.scrollHeight - el.scrollTop - el.clientHeight < 64;
  };

  useEffect(() => {
    const el = scrollRef.current;
    // No messages yet — the conversation was just selected and the fetch is still
    // in flight. `shown` is deliberately left alone so this runs again, and
    // still counts as a switch, once they arrive.
    if (!el || !lastMessageId) return;

    const switched = shown.current !== selectedId;
    if (switched) {
      shown.current = selectedId;
      following.current = true;
    }
    if (switched || following.current) el.scrollTop = el.scrollHeight;
  }, [selectedId, lastMessageId, list?.length]);

  const send = useMutation({
    mutationFn: async () => {
      await api.post(`/inbox/conversations/${selectedId}/messages`, { body: draft });
    },
    onSuccess: () => {
      setDraft('');
      // Sending is an explicit request to be at the bottom: if the agent had
      // scrolled up to check something before replying, their own message must not
      // land somewhere they cannot see.
      following.current = true;
      qc.invalidateQueries({ queryKey: ['messages', selectedId] });
      qc.invalidateQueries({ queryKey: ['conversations'] });
    },
  });

  const team = useQuery({
    queryKey: ['team'],
    queryFn: async () => (await api.get<{ data: TeamMember[] }>('/team')).data.data,
    staleTime: 60_000,
  });

  const assign = useMutation({
    mutationFn: async (agentId: string | null) => {
      await api.post(`/inbox/conversations/${selectedId}/assign`, { agentId });
    },
    onSuccess: () => {
      toast.success('Assignment updated');
      qc.invalidateQueries({ queryKey: ['conversations'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const toggleAutomation = useMutation({
    mutationFn: async (paused: boolean) => {
      await api.post(`/inbox/conversations/${selectedId}/automation`, { paused });
    },
    onSuccess: () => {
      toast.success('Automation updated');
      qc.invalidateQueries({ queryKey: ['conversations'] });
    },
  });

  return (
    <div className="flex flex-col gap-4 lg:h-[calc(100vh-var(--shell-offset))]">
      {/* Page header */}
      <div className="flex items-center gap-3 shrink-0">
        <div>
          <h1 className="text-h2 font-semibold">Inbox</h1>
          <p className="text-sm text-muted-foreground">Manage your WhatsApp conversations in real-time.</p>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-4 flex-1 min-h-0">
      <Card className="col-span-4 flex flex-col min-h-0">
        <CardHeader className="px-3 py-3 border-b shrink-0 space-y-2">
          <CardTitle className="text-sm font-semibold">Conversations</CardTitle>
          {/*
            One queue, three views. "Unassigned" is the shared pool an agent
            works from — without it, picking up what nobody has claimed means
            visually scanning the whole list.
          */}
          <div className="flex gap-1">
            {([
              ['all', 'All'],
              ['mine', 'Mine'],
              ['unassigned', 'Unassigned'],
            ] as Array<[Scope, string]>).map(([value, label]) => (
              <button
                key={value}
                onClick={() => setScope(value)}
                className={cn(
                  'rounded-md px-2 py-1 text-caption font-medium transition-colors',
                  scope === value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent',
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </CardHeader>
        <CardContent className="flex-1 overflow-auto p-0">
          {conversations.data?.length === 0 && (
            <div className="p-4 text-sm text-muted-foreground">
              {scope === 'mine' ? 'Nothing assigned to you.'
                : scope === 'unassigned' ? 'Nothing waiting to be picked up.'
                  : 'No conversations yet.'}
            </div>
          )}
          {conversations.data?.map((c) => (
            <button
              key={c.id}
              onClick={() => setSelectedId(c.id)}
              className={cn('w-full text-left p-3 border-b hover:bg-accent transition-colors', selectedId === c.id && 'bg-accent')}
            >
              <div className="flex justify-between items-start">
                <div className="font-medium">{c.customer.name || c.customer.waId}</div>
                {c.unreadCount > 0 && <Badge>{c.unreadCount}</Badge>}
              </div>
              <div className="text-caption text-muted-foreground mt-1 flex flex-wrap items-center gap-2">
                {c.lastMessageAt ? formatDateTime(c.lastMessageAt) : 'No messages'}
                {c.status === 'HUMAN_TAKEOVER' && <Badge variant="destructive" className="text-caption">HUMAN</Badge>}
                {c.assignedAgent ? (
                  <span className={cn(
                    'rounded-full px-1 py-px text-caption',
                    c.assignedAgent.id === myId ? 'bg-primary/10 text-primary' : 'bg-surface-0 text-ink-700',
                  )}
                  >
                    {c.assignedAgent.id === myId ? 'You' : c.assignedAgent.fullName}
                  </span>
                ) : (
                  <span className="rounded-full bg-warning/15 px-1 py-px text-caption text-ink-900">
                    Unassigned
                  </span>
                )}
              </div>
            </button>
          )) || <div className="p-4 text-sm text-muted-foreground">Loading…</div>}
        </CardContent>
      </Card>

      <Card className="col-span-8 flex flex-col min-h-0">
        {!conv ? (
          <CardContent className="flex-1 grid place-items-center text-muted-foreground">Select a conversation</CardContent>
        ) : (
          <>
            <CardHeader className="border-b flex flex-row items-center justify-between shrink-0">
              <div>
                <CardTitle>{conv.customer.name || conv.customer.waId}</CardTitle>
                <div className="text-caption text-muted-foreground">{conv.customer.waId}</div>
              </div>
              <div className="flex items-center gap-3 text-sm">
                {/*
                  Claiming is always allowed; handing to someone else needs
                  `inbox:assign_others`, because two people silently swapping a
                  live customer is how they get asked the same question twice.
                */}
                {conv.assignedAgent?.id === myId ? (
                  <Button size="sm" variant="outline" className="h-7 text-caption"
                    onClick={() => assign.mutate(null)}
                  >
                    Release
                  </Button>
                ) : !conv.assignedAgent ? (
                  <Button size="sm" variant="outline" className="h-7 text-caption"
                    onClick={() => assign.mutate(myId ?? null)}
                  >
                    Assign to me
                  </Button>
                ) : (
                  <span className="text-caption text-muted-foreground">
                    Assigned to <strong>{conv.assignedAgent.fullName}</strong>
                  </span>
                )}

                {can('inbox:assign_others') && (
                  <select
                    className="h-7 rounded-md border bg-background px-1 text-caption"
                    value={conv.assignedAgent?.id ?? ''}
                    onChange={(e) => assign.mutate(e.target.value || null)}
                  >
                    <option value="">Unassigned</option>
                    {(team.data ?? []).filter((m) => m.isActive).map((m) => (
                      <option key={m.id} value={m.id}>{m.id === myId ? 'Me' : m.fullName}</option>
                    ))}
                  </select>
                )}

                {/*
                  Raising from here rather than from the Support screen is the
                  point: it carries the `conversationId`, which is what lets the
                  ticket be replied to on WhatsApp at all. A ticket raised
                  standalone has nobody to send an update to.
                */}
                {hasSupport && can('tickets:write') && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-caption"
                    onClick={() => setRaisingTicket(true)}
                  >
                    <LifeBuoy className="mr-1 h-3 w-3" /> Raise ticket
                  </Button>
                )}

                <span className="text-muted-foreground">Automation</span>
                <Switch
                  checked={!conv.automationPaused}
                  onCheckedChange={(v) => toggleAutomation.mutate(!v)}
                />
              </div>

              <RaiseFromConversation
                conversationId={conv.id}
                customerName={conv.customer.name || conv.customer.waId}
                open={raisingTicket}
                onOpenChange={setRaisingTicket}
              />
            </CardHeader>
            <CardContent
              ref={scrollRef}
              onScroll={onScroll}
              className="flex-1 overflow-y-auto min-h-0 space-y-2 py-4 bg-muted/20"
            >
              {messages.data?.map((m) => (
                <div key={m.id} className={cn('max-w-[70%] rounded-lg p-2 px-3 text-sm', m.direction === 'OUTBOUND' ? 'ml-auto bg-primary text-primary-foreground' : 'bg-background border')}>
                  {/*
                    Who said this. The whole point of a shared inbox: without it
                    a colleague's reply, your own and the bot's all look the
                    same, and nobody can tell whether a customer has already
                    been answered.
                  */}
                  {m.direction === 'OUTBOUND' && (
                    <div className="mb-px text-caption font-medium text-primary-foreground/70">
                      {m.sentByUser
                        ? (m.sentByUser.id === myId ? 'You' : m.sentByUser.fullName)
                        : 'Bot'}
                    </div>
                  )}
                  <div className="whitespace-pre-wrap">{m.body || `[${m.type}]`}</div>
                  {/*
                    The choices a list or button message offered. Without these
                    the transcript shows the question but not the options, and
                    the customer's next reply — a row id — looks like it came
                    from nowhere.
                  */}
                  {outboundOptions(m).length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {outboundOptions(m).map((o) => (
                        <span
                          key={o.id}
                          title={o.id}
                          className={cn(
                            'rounded-full border px-1 py-px text-caption',
                            m.direction === 'OUTBOUND'
                              ? 'border-primary-foreground/30 text-primary-foreground/90'
                              : 'border-muted-foreground/30 text-muted-foreground',
                          )}
                        >
                          {o.title}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className={cn('text-caption mt-1', m.direction === 'OUTBOUND' ? 'text-primary-foreground/80' : 'text-muted-foreground')}>
                    {formatDateTime(m.createdAt)}
                  </div>
                </div>
              )) || <div className="text-sm text-muted-foreground">Loading…</div>}
            </CardContent>
            <div className="border-t p-3 flex gap-2 shrink-0">
              <Input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Type a reply…"
                onKeyDown={(e) => { if (e.key === 'Enter' && draft.trim()) send.mutate(); }}
              />
              <Button onClick={() => send.mutate()} disabled={!draft.trim() || send.isPending}>Send</Button>
            </div>
          </>
        )}
      </Card>
      </div>
    </div>
  );
}
