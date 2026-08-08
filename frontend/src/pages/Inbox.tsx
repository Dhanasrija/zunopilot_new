import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { usePermissions } from '@/lib/permissions';
import { rejectReason, useMediaRules } from '@/lib/media';
import { useAuthStore, useHasModule } from '@/stores/auth.store';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { PRIORITY_LABEL, TICKET_PRIORITIES, type TicketPriority } from '@/lib/tickets';
import { ConversationList } from '@/components/inbox/ConversationList';
import { ThreadHeader } from '@/components/inbox/ThreadHeader';
import { MessageBubble } from '@/components/inbox/MessageBubble';
import { Composer } from '@/components/inbox/Composer';
import {
  displayName, type Conversation, type Message, type Scope, type TeamMember,
} from '@/components/inbox/types';

// The inbox page: state, queries and mutations. Everything that draws is in
// `components/inbox/` — this file was 574 lines with the list rows, the header, the bubbles
// and the composer all inlined, which is why two colour systems had been living in it side by
// side (shadcn aliases on the scope tabs, brand tokens three lines below on the assignment
// pills).

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
              className="h-9 rounded-md border border-ink-400 bg-surface-1 px-2 text-sm text-ink-900"
              value={priority}
              onChange={(e) => setPriority(e.target.value as TicketPriority)}
            >
              {TICKET_PRIORITIES.map((p) => (
                <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>
              ))}
            </select>
          </div>
          <p className="text-caption text-ink-500">
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

/**
 * Is this tab in front?
 *
 * State rather than a bare read of `document.visibilityState`, because the answer changes while
 * the page is mounted and the thing that depends on it — marking a thread read — has to run
 * again when the agent comes back. A one-shot check would leave a badge sitting on the thread
 * they are looking at until the next message arrived.
 */
const useTabVisible = (): boolean => {
  const [visible, setVisible] = useState(() => document.visibilityState === 'visible');

  useEffect(() => {
    const onChange = () => setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, []);

  return visible;
};

export default function Inbox() {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const initial = params.get('conversationId');
  const [selectedId, setSelectedId] = useState<string | null>(initial);
  const [draft, setDraft] = useState('');
  /*
   * The message the next send will quote, held as an id rather than the row.
   *
   * The row would go stale — the thread refetches every second, and a quote rendered from a
   * four-second-old copy would keep showing a message somebody had just removed. Resolved out of
   * the live list below instead.
   */
  const [replyToId, setReplyToId] = useState<string | null>(null);
  const [scope, setScope] = useState<Scope>('all');
  const [raisingTicket, setRaisingTicket] = useState(false);
  const { can } = usePermissions();
  const tabVisible = useTabVisible();
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
      // A pending quote belongs to the thread it was picked in. The server refuses a cross-thread
      // quote anyway; clearing it here means the agent never sees the refusal.
      setReplyToId(null);
    }
    if (switched || following.current) el.scrollTop = el.scrollHeight;
  }, [selectedId, lastMessageId, list?.length]);

  // ── Telling the server the thread has been read ─────────────────────────────
  //
  // **This is the half that never existed.** `POST /conversations/:id/read` has been there all
  // along and nothing called it, so `Conversation.unreadCount` only ever incremented — which
  // turned the badge on every row into a lifetime count of inbound messages, and left the bell
  // holding notifications for threads an agent had read hours ago.
  //
  // Fires when the thread is opened and again whenever a new message lands in the open thread,
  // which is what WhatsApp Web does.

  const markRead = useMutation({
    mutationFn: async (conversationId: string) => api.post(`/inbox/conversations/${conversationId}/read`),
    onSuccess: () => {
      // Both, because one action clears both counters. The conversation list polls every second
      // and the bell every thirty, so without this the badge would clear and the bell would
      // keep claiming eight things were waiting for up to half a minute.
      qc.invalidateQueries({ queryKey: ['conversations'] });
      qc.invalidateQueries({ queryKey: ['notifications'] });
    },
    // No onError toast. Failing to *record* a read is not something an agent can act on, and a
    // toast every second from a poll-driven page would be worse than the stale badge.
  });

  /**
   * The (thread, newest message) pair already reported.
   *
   * **Not what stops a POST per poll today** — that is the narrow dependency list below, plus
   * react-query returning the identical array when a refetch is structurally equal, so nothing
   * the effect watches changes while a thread sits idle. Verified by removing this ref and
   * finding the "once per thread" test still passed.
   *
   * It earns its place one step further out: swap a dependency for anything that ticks on every
   * refetch — `messages.dataUpdatedAt` is the obvious slip — and this is the only thing standing
   * between an open Inbox and one request per second, per tab, all day. With the ref that edit is
   * harmless; without it the test fails immediately. Cheap insurance against a change nobody
   * would look at twice.
   *
   * The pair is the right key: the same thread with a new message at the end is genuinely
   * something new to mark read, and nothing else is.
   */
  const readReported = useRef<string | null>(null);

  useEffect(() => {
    // `isSuccess` rather than firing on selection: the id changes before the fetch resolves, so
    // without it every open would report twice — once with no messages, once with them.
    if (!selectedId || !messages.isSuccess) return;
    /*
     * **Only while the tab is in front.**
     *
     * The Inbox polls in the background, so a tab left open on a thread would silently swallow
     * every message that arrived overnight — marked read, notification cleared, nobody told.
     * Being open is not the same as being looked at.
     */
    if (!tabVisible) return;

    // `?? 'empty'` rather than requiring a message: a thread whose messages have all been
    // removed can still carry an unread count, and it should clear on open like any other.
    const key = `${selectedId}:${lastMessageId ?? 'empty'}`;
    if (readReported.current === key) return;
    readReported.current = key;
    markRead.mutate(selectedId);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the mutation is stable; keying on
    // it would re-run this on every render of the page.
  }, [selectedId, lastMessageId, messages.isSuccess, tabVisible]);

  const send = useMutation({
    mutationFn: async () => {
      await api.post(`/inbox/conversations/${selectedId}/messages`, {
        body: draft,
        replyToId,
      });
    },
    onSuccess: () => {
      setDraft('');
      setReplyToId(null);
      // Sending is an explicit request to be at the bottom: if the agent had
      // scrolled up to check something before replying, their own message must not
      // land somewhere they cannot see.
      following.current = true;
      qc.invalidateQueries({ queryKey: ['messages', selectedId] });
      qc.invalidateQueries({ queryKey: ['conversations'] });
    },
  });

  /**
   * Upload the file, then send it.
   *
   * Two requests rather than one multipart send, because `POST /media` already validates the
   * type and size, stores it under the tenant's prefix and gives it the URL WhatsApp will
   * fetch. A second uploader living in the Inbox would eventually disagree with that one.
   */
  const sendFile = useMutation({
    mutationFn: async ({ file, caption }: { file: File; caption: string }) => {
      const form = new FormData();
      form.append('file', file);
      // No explicit Content-Type: the browser sets the multipart boundary.
      const asset = (await api.post<{ data: { id: string } }>('/media', form)).data.data;
      await api.post(`/inbox/conversations/${selectedId}/media`, {
        mediaId: asset.id,
        caption: caption || null,
      });
    },
    onSuccess: () => {
      setDraft('');
      following.current = true;
      qc.invalidateQueries({ queryKey: ['messages', selectedId] });
      qc.invalidateQueries({ queryKey: ['conversations'] });
      qc.invalidateQueries({ queryKey: ['media'] });
    },
    // No onError toast: the api interceptor already toasts the server's message, and the
    // refusals here — an expired window, a file too large — are all worth reading verbatim.
  });

  /*
   * Removing messages.
   *
   * No optimistic update: the list refetches every second anyway, so the message vanishes within
   * one tick either way — and an optimistic removal that the server then refuses would put it
   * back, which reads as the click not having worked rather than as an error.
   */
  const removeMessage = useMutation({
    mutationFn: async (messageId: string) => api.delete(`/inbox/messages/${messageId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['messages', selectedId] });
      qc.invalidateQueries({ queryKey: ['conversations'] });
    },
  });

  const clearThread = useMutation({
    mutationFn: async () => api.delete(`/inbox/conversations/${selectedId}/messages`),
    onSuccess: (response) => {
      const { removed } = (response.data as { data: { removed: number } }).data;
      toast.success(removed === 1 ? '1 message removed' : `${removed} messages removed`);
      qc.invalidateQueries({ queryKey: ['messages', selectedId] });
      qc.invalidateQueries({ queryKey: ['conversations'] });
    },
  });

  const mediaRules = useMediaRules();

  /*
   * The quoted message, resolved fresh on every render from the live thread.
   *
   * Falls to null the moment it stops being visible — removed by a colleague, or the thread
   * cleared — which is what stops the composer quoting something that is no longer there.
   */
  const replyingTo = replyToId
    ? messages.data?.find((m) => m.id === replyToId) ?? null
    : null;

  /*
   * Whether WhatsApp still allows a plain reply.
   *
   * Computed from the thread the page already has rather than fetched: the last inbound
   * message's timestamp is the whole rule. The server checks it too and is the authority —
   * this only stops the agent picking a file that was never going to be accepted.
   */
  const lastInboundAt = messages.data
    ?.filter((m) => m.direction === 'INBOUND')
    .at(-1)?.createdAt;
  const windowClosed = !!messages.data
    && (!lastInboundAt || Date.now() - new Date(lastInboundAt).getTime() > 24 * 60 * 60 * 1000);

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

  /**
   * Hand the conversation back to the bot.
   *
   * This existed on the server from the start and had no button, which meant a conversation
   * that reached a handoff was automated exactly once and never again: Release clears the
   * agent and the Automation toggle flips a different flag, but neither cancels the parked
   * instance holding the workflow slot.
   */
  const handBackToBot = useMutation({
    mutationFn: async () => {
      await api.post(`/conversations/${selectedId}/resume-bot`);
    },
    onSuccess: () => {
      toast.success('Handed back to the bot');
      qc.invalidateQueries({ queryKey: ['conversations'] });
      qc.invalidateQueries({ queryKey: ['messages', selectedId] });
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
      <div className="shrink-0">
        <h1 className="text-h2 font-semibold text-ink-900">Inbox</h1>
        <p className="text-sm text-ink-500">Manage your WhatsApp conversations in real-time.</p>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-12 gap-4">
        <Card className="col-span-12 flex min-h-0 flex-col overflow-hidden lg:col-span-4">
          <ConversationList
            conversations={conversations.data}
            isLoading={conversations.isLoading}
            scope={scope}
            onScopeChange={setScope}
            selectedId={selectedId}
            onSelect={setSelectedId}
            myId={myId}
          />
        </Card>

        <Card className="col-span-12 flex min-h-0 flex-col overflow-hidden lg:col-span-8">
          {!conv ? (
            <div className="grid flex-1 place-items-center p-6 text-sm text-ink-500">
              Select a conversation
            </div>
          ) : (
            <>
              <ThreadHeader
                conversation={conv}
                team={team.data ?? []}
                myId={myId}
                canAssignOthers={can('inbox:assign_others')}
                hasSupport={hasSupport}
                canRaiseTicket={can('tickets:write')}
                onAssign={(agentId) => assign.mutate(agentId)}
                onHandBackToBot={() => handBackToBot.mutate()}
                handingBack={handBackToBot.isPending}
                onToggleAutomation={(paused) => toggleAutomation.mutate(paused)}
                onRaiseTicket={() => setRaisingTicket(true)}
                canDelete={can('inbox:delete')}
                onClearThread={() => clearThread.mutate()}
              />

              <RaiseFromConversation
                conversationId={conv.id}
                customerName={displayName(conv.customer)}
                open={raisingTicket}
                onOpenChange={setRaisingTicket}
              />

              <div
                ref={scrollRef}
                onScroll={onScroll}
                className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-wa-ui-chat p-4"
              >
                {/*
                  `mt-auto` bottom-aligns a thread shorter than the pane, so two messages sit
                  above the composer instead of stranded at the top with a field of empty
                  white beneath them. Once the thread overflows, `mt-auto` has no effect and
                  the scroll behaviour above takes over unchanged.
                */}
                <div className="mt-auto space-y-2">
                  {messages.data
                    ? messages.data.map((m) => (
                      <MessageBubble
                        key={m.id}
                        message={m}
                        myId={myId}
                        canDelete={can('inbox:delete')}
                        onDelete={() => removeMessage.mutate(m.id)}
                        onReply={can('inbox:reply') ? () => setReplyToId(m.id) : undefined}
                      />
                    ))
                    : <p className="text-sm text-ink-500">Loading…</p>}
                </div>
              </div>

              <Composer
                value={draft}
                onChange={setDraft}
                onSend={() => send.mutate()}
                sending={send.isPending}
                onSendFile={(file, caption) => sendFile.mutate({ file, caption })}
                attaching={sendFile.isPending}
                fileAccept={mediaRules.data
                  ? Object.values(mediaRules.data.kinds).flatMap((k) => k.mimeTypes).join(',')
                  : undefined}
                checkFile={(file) => rejectReason(file, mediaRules.data)}
                windowClosed={windowClosed}
                replyingTo={replyingTo}
                onCancelReply={() => setReplyToId(null)}
              />
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
