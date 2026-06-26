import { useEffect, useState } from 'react';
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

interface Conversation {
  id: string;
  status: string;
  automationPaused: boolean;
  unreadCount: number;
  lastMessageAt: string | null;
  customer: { id: string; name?: string; waId: string };
}

interface Message {
  id: string;
  direction: 'INBOUND' | 'OUTBOUND';
  type: string;
  body?: string | null;
  createdAt: string;
}

export default function Inbox() {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const initial = params.get('conversationId');
  const [selectedId, setSelectedId] = useState<string | null>(initial);
  const [draft, setDraft] = useState('');

  const conversations = useQuery({
    queryKey: ['conversations'],
    queryFn: async () => (await api.get<{ data: Conversation[] }>('/inbox/conversations')).data.data,
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

  const send = useMutation({
    mutationFn: async () => {
      await api.post(`/inbox/conversations/${selectedId}/messages`, { body: draft });
    },
    onSuccess: () => {
      setDraft('');
      qc.invalidateQueries({ queryKey: ['messages', selectedId] });
      qc.invalidateQueries({ queryKey: ['conversations'] });
    },
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
    <div className="flex flex-col gap-4 h-[calc(100vh-2rem)]">
      {/* Page header */}
      <div className="flex items-center gap-3 shrink-0">
        <div>
          <h1 className="text-2xl font-bold">Inbox</h1>
          <p className="text-sm text-muted-foreground">Manage your WhatsApp conversations in real-time.</p>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-4 flex-1 min-h-0">
      <Card className="col-span-4 flex flex-col">
        <CardHeader className="px-3 py-3 border-b shrink-0"><CardTitle className="text-sm font-semibold">Conversations</CardTitle></CardHeader>
        <CardContent className="flex-1 overflow-auto p-0">
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
              <div className="text-xs text-muted-foreground mt-1 flex items-center gap-2">
                {c.lastMessageAt ? formatDateTime(c.lastMessageAt) : 'No messages'}
                {/* {c.status === 'HUMAN_TAKEOVER' && <Badge variant="destructive" className="text-[10px]">HUMAN</Badge>} */}
              </div>
            </button>
          )) || <div className="p-4 text-sm text-muted-foreground">Loading…</div>}
        </CardContent>
      </Card>

      <Card className="col-span-8 flex flex-col">
        {!conv ? (
          <CardContent className="flex-1 grid place-items-center text-muted-foreground">Select a conversation</CardContent>
        ) : (
          <>
            <CardHeader className="border-b flex flex-row items-center justify-between">
              <div>
                <CardTitle>{conv.customer.name || conv.customer.waId}</CardTitle>
                <div className="text-xs text-muted-foreground">{conv.customer.waId}</div>
              </div>
              {/* <div className="flex items-center gap-2 text-sm">
                <span>Automation</span>
                <Switch
                  checked={!conv.automationPaused}
                  onCheckedChange={(v) => toggleAutomation.mutate(!v)}
                />
              </div> */}
            </CardHeader>
            <CardContent className="flex-1 overflow-auto space-y-2 py-4 bg-muted/20">
              {messages.data?.map((m) => (
                <div key={m.id} className={cn('max-w-[70%] rounded-lg p-2 px-3 text-sm', m.direction === 'OUTBOUND' ? 'ml-auto bg-primary text-primary-foreground' : 'bg-background border')}>
                  <div>{m.body || `[${m.type}]`}</div>
                  <div className={cn('text-[10px] mt-1', m.direction === 'OUTBOUND' ? 'text-primary-foreground/80' : 'text-muted-foreground')}>
                    {formatDateTime(m.createdAt)}
                  </div>
                </div>
              )) || <div className="text-sm text-muted-foreground">Loading…</div>}
            </CardContent>
            <div className="border-t p-3 flex gap-2">
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
