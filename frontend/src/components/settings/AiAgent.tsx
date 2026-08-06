import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useCan, useHasModule } from '@/stores/auth.store';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Lock, Sparkles } from 'lucide-react';

// Settings → whether the AI agent answers customers.
//
// **Two switches decide this, and only one of them is here.** This card writes
// `Tenant.aiAgentEnabled`, the workspace's own preference. Above it sits an operator switch —
// the `AI_AGENT` module — which we control and a workspace cannot change. Off at either level
// means no model call is made.
//
// So the card has three states, not two, and the third is the one worth getting right: the
// switch is present, off, and cannot be moved. Saying "AI is off" there would be true and
// useless. Saying who turned it off is what stops a support ticket.
//
// **What "off" does not mean.** The bot keeps working. Order flows, keyword replies and
// published workflows are ordinary code and keep running; only the model is skipped, and
// anything the bot cannot answer gets the fallback message from Automation.

interface TenantProfile {
  aiAgentEnabled?: boolean;
}

export default function AiAgent() {
  const queryClient = useQueryClient();
  const canWrite = useCan('settings:write');
  // The operator's ceiling. `modules` arrives in the session payload; missing means revoked.
  const allowedByOperator = useHasModule('AI_AGENT');

  // `['tenant.me']` — the same key Settings.tsx and NumberMasking already use. A separate key
  // for the same row is how one card ends up showing state another card just changed.
  const profile = useQuery({
    queryKey: ['tenant.me'],
    queryFn: async () => (await api.get<{ data: TenantProfile }>('/tenant/me')).data.data,
  });

  const save = useMutation({
    mutationFn: async (aiAgentEnabled: boolean) =>
      (await api.patch<{ data: TenantProfile }>('/tenant/me', { aiAgentEnabled })).data.data,
    onSuccess: (tenant) => {
      queryClient.invalidateQueries({ queryKey: ['tenant.me'] });
      toast.success(
        tenant.aiAgentEnabled
          ? 'The AI agent will answer customers again'
          : 'The AI agent is off — your keyword replies and workflows still run',
      );
    },
    onError: () => toast.error('That setting could not be saved'),
  });

  const wanted = profile.data?.aiAgentEnabled ?? true;
  // What is actually happening, which is not the same as what the switch shows.
  const effectivelyOn = allowedByOperator && wanted;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-ink-500" />
          AI agent
        </CardTitle>
        <CardDescription>
          Whether AI reads open-ended messages and decides how to answer them.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <Label htmlFor="ai-agent" className="text-sm text-ink-900">
              Let AI answer customers
            </Label>
            <p className="mt-px text-caption leading-snug text-ink-500">
              With this off, no message is sent to an AI model. Your order flow, keyword replies
              and published workflows keep working exactly as they do now.
            </p>
          </div>
          <Switch
            id="ai-agent"
            // Shows the workspace's own choice even when the operator switch overrides it, so
            // turning it back on is one click if we restore access.
            checked={wanted}
            disabled={!canWrite || !allowedByOperator || profile.isLoading || save.isPending}
            onCheckedChange={(checked) => save.mutate(checked)}
          />
        </div>

        {!allowedByOperator && (
          // The state that needs explaining. The switch is not broken and it is not their doing.
          <p className="flex items-start gap-2 text-caption leading-snug text-ink-500">
            <Lock className="mt-px h-3.5 w-3.5 shrink-0" />
            The AI agent is switched off for this workspace by ZunoPilot, so this setting has no
            effect right now. Contact support if you were expecting to have it.
          </p>
        )}

        {allowedByOperator && !canWrite && (
          <p className="flex items-start gap-2 text-caption leading-snug text-ink-500">
            <Lock className="mt-px h-3.5 w-3.5 shrink-0" />
            Only the workspace owner can change this.
          </p>
        )}

        {allowedByOperator && !effectivelyOn && (
          // Said plainly, because the thing people assume is that switching AI off switches the
          // bot off — and then they wonder why customers are still getting replies.
          <div className="rounded-lg border border-ink-300 bg-surface-0 p-3">
            <p className="text-caption leading-snug text-ink-700">
              Your bot is still replying. Anything it recognises — a menu button, an order, one of
              your keywords — is handled without AI. Anything it does not recognise gets your
              fallback message, which you can edit in
              <span className="font-medium"> Automation</span>.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
