import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { engine, type RoutingConflict, type RoutingWorkflowCard } from '@/lib/engine/api';
import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import RouteSimulator from '@/components/engine/RouteSimulator';
import {
  AlertTriangle, ArrowDown, Bot, CheckCircle2, ChevronRight, FlaskConical,
  Loader2, Pencil, Shield, ShieldAlert, Smartphone, Workflow as WorkflowIcon, Zap,
} from 'lucide-react';

// Assistant routing configuration — /assistants/:assistantId/routing
//
// The page is organised the way the runtime is, top to bottom: the chain, then
// the workflows the router picks from, then the deterministic rules that
// pre-empt it, then the thresholds, then the conflicts. Someone debugging "why
// did it reply that?" should be able to read down the page in the same order
// the message travelled.

const STAGES = [
  { label: 'Incoming message', icon: Smartphone, note: 'Signature verified, queued' },
  { label: 'Active workflow check', icon: WorkflowIcon, note: 'A running flow owns the reply' },
  { label: 'Deterministic rules', icon: Shield, note: 'Buttons, commands, keywords' },
  { label: 'AI workflow router', icon: Bot, note: 'Capability contracts only' },
  { label: 'Confidence gate', icon: Zap, note: 'Start · clarify · fall back' },
];

function ChainDiagram() {
  return (
    <div className="flex flex-col gap-1">
      {STAGES.map(({ label, icon: Icon, note }, i) => (
        <div key={label}>
          <div className="flex items-center gap-3 rounded-lg border border-ink-300 bg-surface-1 px-3 py-2">
            <div className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-surface-0 text-ink-700">
              <Icon className="h-3.5 w-3.5" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-medium text-ink-700">{label}</div>
              <div className="text-caption text-ink-500">{note}</div>
            </div>
            <span className="ml-auto text-caption font-semibold text-ink-300">{i + 1}</span>
          </div>
          {i < STAGES.length - 1 && (
            <div className="flex justify-center py-px">
              <ArrowDown className="h-3 w-3 text-ink-300" />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function WorkflowCard({ workflow, onOpen }: { workflow: RoutingWorkflowCard; onOpen: () => void }) {
  const transactional = workflow.sideEffects.length > 0;
  const thin = workflow.exampleCount.positive < 3 || workflow.exampleCount.negative < 2;

  return (
    <Card className="flex flex-col">
      <CardContent className="flex-1 space-y-3 pt-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <button
              className="text-left font-semibold text-ink-700 hover:text-accent-700 hover:underline"
              onClick={onOpen}
            >
              {workflow.name}
            </button>
            {workflow.slug && (
              <div className="font-mono text-caption text-ink-500">{workflow.slug}</div>
            )}
          </div>
          <Badge
            variant="outline"
            className={cn(
              'shrink-0',
              workflow.status === 'PUBLISHED'
                ? 'border-success/30 bg-success/10 text-success'
                : 'border-ink-300 bg-surface-0 text-ink-500',
            )}
          >
            {workflow.status === 'PUBLISHED' ? 'Published' : 'Draft'}
          </Badge>
        </div>

        <p className="min-h-[2.5rem] text-sm text-ink-500 line-clamp-2">
          {workflow.purpose || <span className="text-ink-500">No purpose set</span>}
        </p>

        {transactional && (
          <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/15 px-2 py-1">
            <ShieldAlert className="mt-px h-3.5 w-3.5 shrink-0 text-ink-900" />
            <span className="text-caption leading-snug text-ink-900">
              Performs an action the customer can't undo
              {workflow.requiresConfirmation ? ' — confirmation required.' : '.'}
            </span>
          </div>
        )}

        {!workflow.routable && workflow.status === 'PUBLISHED' && (
          <div className="rounded-md border border-danger/30 bg-danger/10 px-2 py-1 text-caption text-danger">
            Published but not routable — needs a slug and a capability contract.
          </div>
        )}

        <div className="flex flex-wrap gap-x-4 gap-y-1 text-caption text-ink-500">
          <span>Priority <strong className="text-ink-700">{workflow.priority}</strong></span>
          {workflow.minimumConfidence !== null && (
            <span>Min confidence <strong className="text-ink-700">{workflow.minimumConfidence}</strong></span>
          )}
          <span className={cn(thin && 'text-ink-900')}>
            {workflow.exampleCount.positive}+ / {workflow.exampleCount.negative}− examples
          </span>
          <span>{workflow.totalRuns} runs</span>
        </div>

        {workflow.requiredInputs.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {workflow.requiredInputs.map((input) => (
              <span key={input.key} className="rounded bg-surface-0 px-1 py-px font-mono text-caption text-ink-700">
                {input.key}
              </span>
            ))}
          </div>
        )}
      </CardContent>
      <div className="flex items-center justify-between border-t px-4 py-2">
        <span className="text-caption text-ink-500">
          {workflow.allowsInterruption ? 'Interruptible' : 'Not interruptible'}
        </span>
        <Button variant="ghost" size="sm" className="h-7 gap-1 text-caption" onClick={onOpen}>
          Edit <ChevronRight className="h-3 w-3" />
        </Button>
      </div>
    </Card>
  );
}

function ConflictPanel({ assistantId }: { assistantId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['engine', 'conflicts', assistantId],
    queryFn: () => engine.assistants.conflicts(assistantId),
  });

  if (isLoading) {
    return <div className="py-6 text-center"><Loader2 className="mx-auto h-4 w-4 animate-spin text-ink-500" /></div>;
  }

  const conflicts = data?.conflicts ?? [];
  const serious = conflicts.filter((c) => c.severity !== 'low');

  if (!conflicts.length) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-success/30 bg-success/10 p-3">
        <CheckCircle2 className="mt-px h-4 w-4 shrink-0 text-success" />
        <p className="text-caption text-success">
          No overlaps found across {data?.checked ?? 0} routable workflows.
        </p>
      </div>
    );
  }

  const style = (severity: RoutingConflict['severity']) => (severity === 'high'
    ? 'border-danger/30 bg-danger/10'
    : severity === 'medium' ? 'border-warning/40 bg-warning/15' : 'border-ink-300 bg-surface-0');

  return (
    <div className="space-y-2">
      {serious.length === 0 && (
        <p className="text-caption text-ink-500">
          {conflicts.length} pair{conflicts.length === 1 ? '' : 's'} overlap, and each already names the
          other in its negative examples. Those examples are what keeps them apart — removing one
          will move the pair up to high.
        </p>
      )}

      {conflicts.map((conflict, i) => (
        <div key={i} className={cn('rounded-lg border p-3', style(conflict.severity))}>
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant="outline"
              className={cn(
                'text-caption uppercase',
                conflict.severity === 'high' ? 'border-danger/30 text-danger'
                  : conflict.severity === 'medium' ? 'border-warning/40 text-ink-900'
                    : 'border-ink-300 text-ink-500',
              )}
            >
              {conflict.severity}
            </Badge>
            <span className="text-sm font-medium text-ink-700">
              {conflict.workflows[0]?.name} <span className="text-ink-500">↔</span> {conflict.workflows[1]?.name}
            </span>
            <span className="ml-auto text-caption text-ink-500">
              {conflict.detectedBy === 'declared-counter-example' ? 'declared counter-example' : 'similar examples'}
            </span>
          </div>

          {conflict.warning && (
            <p className="mt-1 flex items-start gap-1 text-caption font-medium text-danger">
              <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
              {conflict.warning}
            </p>
          )}

          <p className="mt-1 text-caption leading-snug text-ink-700">{conflict.suggestion}</p>
        </div>
      ))}
    </div>
  );
}

export default function AssistantRouting() {
  const { assistantId = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [simulatorOpen, setSimulatorOpen] = useState(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['engine', 'routing', assistantId],
    queryFn: () => engine.assistants.routing(assistantId),
    enabled: !!assistantId,
  });

  const [draft, setDraft] = useState<Record<string, unknown> | null>(null);
  const config = useMemo(
    () => ({ ...(data?.assistant ?? {}), ...(draft ?? {}) }),
    [data, draft],
  ) as RoutingConfigView;

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => engine.assistants.updateRouting(assistantId, body),
    onSuccess: () => {
      toast.success('Routing configuration saved');
      setDraft(null);
      qc.invalidateQueries({ queryKey: ['engine', 'routing', assistantId] });
    },
  });

  if (isLoading) {
    return <div className="grid place-items-center py-24"><Loader2 className="h-6 w-6 animate-spin text-accent-600" /></div>;
  }
  if (isError || !data) {
    return (
      <div className="space-y-3 py-24 text-center">
        <p className="text-sm text-ink-700">This assistant could not be loaded.</p>
        <Button variant="outline" onClick={() => navigate('/assistants')}>Back to assistants</Button>
      </div>
    );
  }

  const dirty = draft !== null && Object.keys(draft).length > 0;
  const set = (patch: Record<string, unknown>) => setDraft((d) => ({ ...(d ?? {}), ...patch }));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-h2 font-semibold">{data.assistant.name}</h1>
            <Badge
              variant="outline"
              className={data.assistant.status === 'ACTIVE'
                ? 'border-success/30 bg-success/10 text-success'
                : 'border-ink-300 bg-surface-0 text-ink-500'}
            >
              {data.assistant.status}
            </Badge>
          </div>
          <p className="mt-px text-sm text-muted-foreground">
            {data.assistant.channel.displayPhone ?? data.assistant.channel.phoneNumberId}
            {' · '}
            {data.workflows.filter((w) => w.routable).length} routable workflow
            {data.workflows.filter((w) => w.routable).length === 1 ? '' : 's'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" className="gap-1" onClick={() => setSimulatorOpen(true)}>
            <FlaskConical className="h-4 w-4" /> Test assistant
          </Button>
          <Button
            className="gap-1 bg-accent-600 hover:bg-accent-700"
            disabled={!dirty || save.isPending}
            onClick={() => save.mutate(draft!)}
          >
            {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {dirty ? 'Save changes' : 'Saved'}
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
        {/* Runtime sequence */}
        <div className="space-y-2">
          <h2 className="text-caption font-semibold uppercase tracking-wide text-ink-500">How a message is routed</h2>
          <ChainDiagram />
          <p className="px-px text-caption leading-snug text-ink-500">
            First match wins. A running workflow always owns the next message — it is never
            re-classified.
          </p>
        </div>

        <div className="space-y-6">
          {/* Confidence */}
          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-ink-700">Confidence thresholds</h2>
            <Card>
              <CardContent className="grid gap-4 pt-4 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="high">Start a workflow at or above</Label>
                  <Input
                    id="high" type="number" step="0.05" min="0" max="1"
                    value={config.highConfidenceThreshold}
                    onChange={(e) => set({ highConfidenceThreshold: Number(e.target.value) })}
                  />
                  <p className="text-caption text-ink-500">
                    A workflow's own minimum wins when it is stricter than this.
                  </p>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="medium">Ask for clarification at or above</Label>
                  <Input
                    id="medium" type="number" step="0.05" min="0" max="1"
                    value={config.mediumConfidenceThreshold}
                    onChange={(e) => set({ mediumConfidenceThreshold: Number(e.target.value) })}
                  />
                  <p className="text-caption text-ink-500">Below this, the assistant falls back.</p>
                </div>

                {config.highConfidenceThreshold < config.mediumConfidenceThreshold && (
                  <div className="sm:col-span-2 rounded-md border border-danger/30 bg-danger/10 p-2 text-caption text-danger">
                    The start threshold is below the clarification threshold. That leaves no
                    clarification band — every medium-confidence match would start a workflow.
                  </div>
                )}

                <div className="flex items-center justify-between gap-4 sm:col-span-2 border-t pt-4">
                  <div>
                    <Label htmlFor="general">General AI response</Label>
                    <p className="text-caption text-ink-500">
                      When nothing matches, let the assistant answer instead of falling silent.
                    </p>
                  </div>
                  <Switch
                    id="general"
                    checked={config.generalResponseEnabled}
                    onCheckedChange={(v) => set({ generalResponseEnabled: v })}
                  />
                </div>
              </CardContent>
            </Card>
          </section>

          {/* Workflows */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-ink-700">
                Workflows the router can select
              </h2>
              <Button
                variant="ghost" size="sm" className="h-7 gap-1 text-caption"
                onClick={() => navigate(`/assistants/${assistantId}/workflows`)}
              >
                Manage all <ChevronRight className="h-3 w-3" />
              </Button>
            </div>
            <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
              {data.workflows.map((workflow) => (
                <WorkflowCard
                  key={workflow.id}
                  workflow={workflow}
                  onOpen={() => navigate(`/workflows/${workflow.id}`)}
                />
              ))}
            </div>
          </section>

          {/* Deterministic rules */}
          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-ink-700">
              Deterministic rules
              <span className="ml-2 font-normal text-ink-500">evaluated before the model</span>
            </h2>
            <Card>
              <CardContent className="pt-4">
                {data.rules.length === 0 ? (
                  <p className="py-4 text-center text-sm text-ink-500">
                    No rules. Every message goes to the AI router.
                  </p>
                ) : (
                  <div className="divide-y">
                    {data.rules.map((rule) => {
                      const target = data.workflows.find((w) => w.id === rule.workflowId);
                      return (
                        <div key={rule.id} className="flex flex-wrap items-center gap-3 py-2 first:pt-0 last:pb-0">
                          <Badge variant="outline" className="shrink-0 font-mono text-caption">
                            {rule.type}
                          </Badge>
                          <span className="text-sm font-medium text-ink-700">{rule.name}</span>
                          <span className="text-caption text-ink-500">→ {target?.name ?? 'no workflow'}</span>
                          <div className="ml-auto flex items-center gap-3">
                            <span className="text-caption text-ink-500">priority {rule.priority}</span>
                            <span className={cn(
                              'rounded-full px-2 py-px text-caption font-semibold',
                              rule.enabled ? 'bg-success/10 text-success' : 'bg-surface-0 text-ink-500',
                            )}
                            >
                              {rule.enabled ? 'on' : 'off'}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </section>

          {/* Conflicts */}
          <section className="space-y-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-ink-700">
              <Pencil className="h-3.5 w-3.5 text-ink-500" />
              Capability overlaps
            </h2>
            <ConflictPanel assistantId={assistantId} />
          </section>
        </div>
      </div>

      <RouteSimulator
        assistantId={assistantId}
        open={simulatorOpen}
        onOpenChange={setSimulatorOpen}
      />
    </div>
  );
}

interface RoutingConfigView {
  highConfidenceThreshold: number;
  mediumConfidenceThreshold: number;
  generalResponseEnabled: boolean;
}
