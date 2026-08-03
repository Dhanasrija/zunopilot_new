import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { engine } from '@/lib/engine/api';
import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Bot, ChevronRight, Info, Loader2, Smartphone, Workflow as WorkflowIcon } from 'lucide-react';

// Assistant list. One assistant per WhatsApp channel — two answering the same
// number would race to reply to the same message, so the backend enforces it
// with a unique constraint and this page never offers a "create" for a channel
// that already has one.

export default function Assistants() {
  const navigate = useNavigate();

  const { data = [], isLoading } = useQuery({
    queryKey: ['engine', 'assistants'],
    queryFn: () => engine.assistants.list(),
  });

  if (isLoading) {
    return <div className="grid place-items-center py-24"><Loader2 className="h-6 w-6 animate-spin text-accent-600" /></div>;
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-h2 font-semibold">Assistants</h1>
        <p className="text-sm text-muted-foreground">
          One assistant answers each WhatsApp number and decides which workflow handles a message.
        </p>
      </div>

      {data.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <Bot className="h-9 w-9 text-ink-300" />
            <div>
              <p className="text-sm font-medium text-ink-700">No assistants yet</p>
              <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                An assistant is created against a connected WhatsApp channel. Until one exists and is
                active, inbound messages keep using the original keyword automation.
              </p>
            </div>
            <Button variant="outline" onClick={() => navigate('/whatsapp')}>
              Go to WhatsApp settings
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {data.map((assistant) => (
            <Card key={assistant.id} className="flex flex-col">
              <CardContent className="flex-1 space-y-3 pt-4">
                <div className="flex items-start justify-between gap-2">
                  <button
                    className="text-left font-semibold text-ink-700 hover:text-accent-700 hover:underline"
                    onClick={() => navigate(`/assistants/${assistant.id}/routing`)}
                  >
                    {assistant.name}
                  </button>
                  <Badge
                    variant="outline"
                    className={cn(
                      'shrink-0',
                      assistant.status === 'ACTIVE'
                        ? 'border-success/30 bg-success/10 text-success'
                        : 'border-ink-300 bg-surface-0 text-ink-500',
                    )}
                  >
                    {assistant.status}
                  </Badge>
                </div>

                <p className="min-h-[2.5rem] text-sm text-ink-500 line-clamp-2">
                  {assistant.description || <span className="text-ink-500">No description</span>}
                </p>

                <div className="flex items-center gap-1 text-caption text-ink-500">
                  <Smartphone className="h-3.5 w-3.5 text-ink-500" />
                  {assistant.whatsappChannel.displayPhone ?? assistant.whatsappChannel.phoneNumberId}
                </div>

                {assistant.status !== 'ACTIVE' && (
                  <div className="flex items-start gap-2 rounded-md border border-ink-300 bg-surface-0 px-2 py-1">
                    <Info className="mt-px h-3.5 w-3.5 shrink-0 text-ink-500" />
                    <span className="text-caption leading-snug text-ink-500">
                      Not active — this number still uses the original keyword automation.
                    </span>
                  </div>
                )}
              </CardContent>

              <div className="flex items-center justify-between border-t px-4 py-2 text-caption text-ink-500">
                <span className="flex items-center gap-1">
                  <WorkflowIcon className="h-3.5 w-3.5" />
                  {assistant._count.workflows} workflow{assistant._count.workflows === 1 ? '' : 's'}
                </span>
                <Button
                  variant="ghost" size="sm" className="h-7 gap-1 text-caption"
                  onClick={() => navigate(`/assistants/${assistant.id}/routing`)}
                >
                  Routing <ChevronRight className="h-3 w-3" />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
