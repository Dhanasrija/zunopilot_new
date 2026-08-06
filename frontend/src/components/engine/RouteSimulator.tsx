import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { engine, type RouteTestResult, type SuiteRun } from '@/lib/engine/api';
import { cn } from '@/lib/utils';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  ArrowRight, Bot, CheckCircle2, Loader2, PlayCircle, Send, Shield, XCircle, Zap,
} from 'lucide-react';

// Test Assistant.
//
// This is a *routing* simulator, not an execution one: it reports which
// workflow would be selected and why, and starts nothing. That separation is
// deliberate — someone tuning capability contracts iterates dozens of times,
// and each iteration creating a workflow instance would be both noisy and slow.
// Running a workflow is the builder's Test Flow.
//
// Two views, because two audiences: Business shows only the decision, Debug
// shows confidence, reason code, extracted inputs, candidates and latency.

const SOURCE_STYLE: Record<RouteTestResult['source'], { label: string; className: string; icon: typeof Bot }> = {
  ACTIVE_WORKFLOW: { label: 'Active workflow', className: 'bg-accent-100 text-accent-700 border-accent-100', icon: PlayCircle },
  DETERMINISTIC: { label: 'Deterministic rule', className: 'bg-success/10 text-success border-success/30', icon: Shield },
  AI_ROUTER: { label: 'AI router', className: 'bg-accent-100 text-accent-700 border-accent-100', icon: Bot },
  FALLBACK: { label: 'Fallback', className: 'bg-surface-0 text-ink-700 border-ink-300', icon: Zap },
};

const DECISION_STYLE: Record<string, string> = {
  START_WORKFLOW: 'text-success',
  ASK_CLARIFICATION: 'text-ink-900',
  HUMAN_HANDOFF: 'text-danger',
  GENERAL_RESPONSE: 'text-accent-700',
  NO_MATCH: 'text-ink-500',
};

interface Turn {
  message: string;
  result: RouteTestResult;
}

function ResultCard({ turn, debug }: { turn: Turn; debug: boolean }) {
  const source = SOURCE_STYLE[turn.result.source];
  const Icon = source.icon;
  const inputs = Object.entries(turn.result.extractedInputs);

  return (
    <div className="space-y-2">
      {/* The customer's message */}
      <div className="flex justify-end">
        <div className="max-w-[75%] rounded-lg rounded-br-sm bg-accent-600 px-3 py-2 text-sm text-on-accent">
          {turn.message}
        </div>
      </div>

      {/* What the router decided */}
      <div className="rounded-lg border border-ink-300 bg-surface-1 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className={cn('gap-1', source.className)}>
            <Icon className="h-3 w-3" /> {source.label}
          </Badge>
          <ArrowRight className="h-3 w-3 text-ink-300" />
          <span className={cn('text-sm font-semibold', DECISION_STYLE[turn.result.decision] ?? 'text-ink-700')}>
            {turn.result.decision.replace(/_/g, ' ').toLowerCase()}
          </span>
          {turn.result.workflow && (
            <span className="rounded bg-surface-0 px-1 py-px font-mono text-caption text-ink-700">
              {turn.result.workflow.slug ?? turn.result.workflow.name}
            </span>
          )}
        </div>

        {turn.result.clarificationQuestion && (
          <p className="mt-2 rounded-md bg-warning/15 px-2 py-1 text-caption text-ink-900">
            “{turn.result.clarificationQuestion}”
          </p>
        )}

        {debug && (
          <div className="mt-3 space-y-2 border-t pt-2 text-caption">
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-ink-500">
              <span>confidence <strong className="text-ink-700">{turn.result.confidence}</strong></span>
              <span>reason <strong className="font-mono text-ink-700">{turn.result.reasonCode}</strong></span>
              <span>{turn.result.latencyMs} ms</span>
              {turn.result.model && <span className="font-mono text-ink-500">{turn.result.model}</span>}
            </div>

            {inputs.length > 0 && (
              <div>
                <div className="mb-1 text-ink-500">Extracted inputs</div>
                <div className="flex flex-wrap gap-1">
                  {inputs.map(([key, value]) => (
                    <span key={key} className="rounded bg-surface-0 px-1 py-px font-mono text-ink-700">
                      {key}=<span className="text-accent-700">{value}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}

            {turn.result.missingInputs.length > 0 && (
              <div>
                <span className="text-ink-500">Missing: </span>
                <span className="font-mono text-ink-900">{turn.result.missingInputs.join(', ')}</span>
                <span className="text-ink-500"> — the workflow will ask for these.</span>
              </div>
            )}

            {turn.result.candidates.length > 0 && (
              <div className="text-ink-500">
                Considered: <span className="font-mono">{turn.result.candidates.join(', ')}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function SuiteResults({ run }: { run: SuiteRun }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3 rounded-lg border bg-surface-0 p-3">
        <span className="text-h2 font-semibold text-ink-700">{run.passed}<span className="text-ink-500">/{run.total}</span></span>
        <div className="text-caption">
          <div className="font-medium text-success">{run.passed} passed</div>
          {run.failed > 0 && <div className="font-medium text-danger">{run.failed} failed</div>}
        </div>
      </div>

      <div className="space-y-1">
        {run.results.map((result) => (
          <div
            key={result.id}
            className={cn(
              'rounded-md border p-2 text-caption',
              result.passed ? 'border-ink-300 bg-surface-1' : 'border-danger/30 bg-danger/10',
            )}
          >
            <div className="flex items-start gap-2">
              {result.passed
                ? <CheckCircle2 className="mt-px h-3.5 w-3.5 shrink-0 text-success" />
                : <XCircle className="mt-px h-3.5 w-3.5 shrink-0 text-danger" />}
              <div className="min-w-0 flex-1">
                <div className="text-ink-700">“{result.message}”</div>
                {!result.passed && (
                  <div className="mt-1 font-mono text-caption text-danger">
                    expected {result.expected.decision}
                    {result.expected.workflow ? ` → ${result.expected.workflow}` : ''}
                    {' · got '}
                    {result.actual.decision}
                    {result.actual.workflow ? ` → ${result.actual.workflow}` : ''}
                  </div>
                )}
                {result.passed && (
                  <div className="mt-px text-caption text-ink-500">
                    {result.actual.workflow ?? result.actual.decision} · conf {result.actual.confidence} · {result.latencyMs} ms
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function RouteSimulator({
  assistantId, open, onOpenChange,
}: {
  assistantId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [tab, setTab] = useState<'chat' | 'suite'>('chat');
  const [debug, setDebug] = useState(true);
  const [message, setMessage] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);

  const { data: cases } = useQuery({
    queryKey: ['engine', 'routing-tests', assistantId],
    queryFn: () => engine.routing.listTests(assistantId),
    enabled: open,
  });

  const route = useMutation({
    mutationFn: (text: string) => engine.routing.test(assistantId, text),
    onSuccess: (result, text) => {
      setTurns((t) => [...t, { message: text, result }]);
      setMessage('');
    },
  });

  const suite = useMutation({
    mutationFn: () => engine.routing.runSuite(assistantId),
  });

  const send = () => {
    const text = message.trim();
    if (text) route.mutate(text);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] w-[min(46rem,92vw)] max-w-none flex-col gap-0 p-0">
        <DialogHeader className="border-b px-4 py-3">
          <DialogTitle className="flex items-center gap-2 text-body">
            <Bot className="h-4 w-4 text-accent-600" />
            Test assistant
          </DialogTitle>
          <p className="text-caption text-ink-500">
            Shows what the router would decide. Nothing is started, and no message is sent.
          </p>
        </DialogHeader>

        <div className="flex items-center gap-1 border-b px-4 py-2">
          {(['chat', 'suite'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                'rounded-md px-2 py-1 text-caption font-medium transition-colors',
                tab === t ? 'bg-accent-100 text-accent-700' : 'text-ink-500 hover:bg-surface-0',
              )}
            >
              {t === 'chat' ? 'Try a message' : `Test suite${cases?.length ? ` (${cases.length})` : ''}`}
            </button>
          ))}

          {tab === 'chat' && (
            <div className="ml-auto flex items-center gap-1 rounded-md bg-surface-0 p-px">
              {(['Business', 'Debug'] as const).map((view) => (
                <button
                  key={view}
                  onClick={() => setDebug(view === 'Debug')}
                  className={cn(
                    'rounded px-2 py-px text-caption font-medium transition-colors',
                    (view === 'Debug') === debug ? 'bg-surface-1 text-ink-700 shadow-none' : 'text-ink-500',
                  )}
                >
                  {view}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {tab === 'chat' ? (
            turns.length === 0 ? (
              <div className="space-y-3 py-8 text-center">
                <Bot className="mx-auto h-8 w-8 text-ink-300" />
                <p className="text-sm text-ink-500">Type a message a customer might send.</p>
                <div className="flex flex-wrap justify-center gap-1">
                  {cases?.slice(0, 4).map((c) => (
                    <button
                      key={c.id}
                      onClick={() => route.mutate(c.message)}
                      className="rounded-full border border-ink-300 px-2 py-1 text-caption text-ink-700 hover:border-accent-100 hover:bg-accent-100"
                    >
                      {c.message}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {turns.map((turn, i) => <ResultCard key={i} turn={turn} debug={debug} />)}
              </div>
            )
          ) : (
            suite.data
              ? <SuiteResults run={suite.data} />
              : (
                <div className="space-y-3 py-8 text-center">
                  <p className="text-sm text-ink-500">
                    {cases?.length
                      ? `${cases.length} saved test cases. Running the suite calls the router once per case.`
                      : 'No saved test cases yet.'}
                  </p>
                  <Button
                    className="gap-1 bg-accent-600 hover:bg-accent-700"
                    disabled={!cases?.length || suite.isPending}
                    onClick={() => suite.mutate()}
                  >
                    {suite.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
                    Run suite
                  </Button>
                </div>
              )
          )}
        </div>

        {tab === 'chat' && (
          <div className="flex items-center gap-2 border-t px-4 py-3">
            <Input
              value={message}
              placeholder="Is Dr Rao available tomorrow?"
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') send(); }}
              disabled={route.isPending}
            />
            <Button
              className="gap-1 bg-accent-600 hover:bg-accent-700"
              disabled={!message.trim() || route.isPending}
              onClick={send}
            >
              {route.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
            {turns.length > 0 && (
              <Button variant="ghost" size="sm" onClick={() => setTurns([])}>Clear</Button>
            )}
          </div>
        )}

        {tab === 'suite' && suite.data && (
          <div className="flex justify-end gap-2 border-t px-4 py-3">
            <Button variant="outline" size="sm" onClick={() => suite.reset()}>Clear</Button>
            <Button
              size="sm" className="gap-1 bg-accent-600 hover:bg-accent-700"
              disabled={suite.isPending} onClick={() => suite.mutate()}
            >
              {suite.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlayCircle className="h-3.5 w-3.5" />}
              Re-run
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
