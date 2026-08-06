import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import type { NodeExecution, TestRunResult, ValidationIssue } from '@/lib/engine/api';
import { specFor } from '@/lib/engine/nodes';
import {
  AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, CircleDashed,
  MessageSquare, MinusCircle, XCircle,
} from 'lucide-react';

// Bottom panel: Execution Log · Test Results · Variables · Routing Metadata.
//
// It reads a real test run rather than a simulation of one — the same
// NodeExecution rows the engine writes in production — so what you see here is
// what actually happened, including the inputs each node received after
// template interpolation.

type Tab = 'log' | 'results' | 'variables' | 'issues';

const STATUS_ICON: Record<string, { icon: typeof CheckCircle2; className: string }> = {
  SUCCESS: { icon: CheckCircle2, className: 'text-success' },
  FAILED: { icon: XCircle, className: 'text-danger' },
  WAITING: { icon: CircleDashed, className: 'text-ink-900' },
  SKIPPED: { icon: MinusCircle, className: 'text-ink-500' },
  RUNNING: { icon: CircleDashed, className: 'text-accent-600' },
  PENDING: { icon: CircleDashed, className: 'text-ink-500' },
};

function Json({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <span className="text-ink-500">—</span>;
  return (
    <pre className="overflow-x-auto rounded bg-surface-0 p-2 font-mono text-caption leading-relaxed text-ink-700">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function ExecutionRow({ execution, onSelect }: { execution: NodeExecution; onSelect: () => void }) {
  const [open, setOpen] = useState(false);
  const meta = STATUS_ICON[execution.status] ?? STATUS_ICON.PENDING!;
  const Icon = meta.icon;
  const spec = specFor(execution.nodeType);

  return (
    <div className="border-b last:border-0">
      <button
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-surface-0"
        onClick={() => setOpen((v) => !v)}
      >
        <Icon className={cn('h-3.5 w-3.5 shrink-0', meta.className)} />
        <span
          className="font-mono text-caption text-ink-700 hover:underline"
          onClick={(e) => { e.stopPropagation(); onSelect(); }}
        >
          {execution.nodeId}
        </span>
        <span className="text-caption text-ink-500">{spec.label}</span>
        {execution.attempt > 1 && (
          <span className="rounded bg-warning/15 px-1 text-caption font-medium text-ink-900">
            attempt {execution.attempt}
          </span>
        )}
        <span className="ml-auto text-caption text-ink-500">
          {execution.durationMs !== null ? `${execution.durationMs} ms` : ''}
        </span>
        {open ? <ChevronUp className="h-3 w-3 text-ink-300" /> : <ChevronDown className="h-3 w-3 text-ink-300" />}
      </button>

      {open && (
        <div className="space-y-2 bg-surface-0/60 px-3 pb-3 pt-1">
          <div>
            <div className="mb-1 text-caption font-semibold uppercase tracking-wide text-ink-500">
              Input (after templates resolved)
            </div>
            <Json value={execution.input} />
          </div>
          <div>
            <div className="mb-1 text-caption font-semibold uppercase tracking-wide text-ink-500">Output</div>
            <Json value={execution.output} />
          </div>
          {execution.error != null && (
            <div>
              <div className="mb-1 text-caption font-semibold uppercase tracking-wide text-danger">Error</div>
              <Json value={execution.error} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function BottomPanel({
  run, issues, open, onToggle, onSelectNode,
}: {
  run: TestRunResult | null;
  issues: ValidationIssue[];
  open: boolean;
  onToggle: () => void;
  onSelectNode: (nodeId: string) => void;
}) {
  const [tab, setTab] = useState<Tab>('log');

  const errors = issues.filter((i) => i.level === 'error').length;
  const warnings = issues.length - errors;
  const variables = Object.entries(run?.variables ?? {});

  const tabs: Array<{ id: Tab; label: string; badge?: string | number; tone?: 'error' | 'warn' }> = [
    { id: 'log', label: 'Execution Log', badge: run?.executions.length || undefined },
    { id: 'results', label: 'Test Results', badge: run?.outboundMessages.length || undefined },
    { id: 'variables', label: 'Variables', badge: variables.length || undefined },
    {
      id: 'issues',
      label: 'Flow Check',
      badge: errors || warnings || undefined,
      tone: errors ? 'error' : warnings ? 'warn' : undefined,
    },
  ];

  return (
    <div className={cn('flex shrink-0 flex-col border-t bg-surface-1', open ? 'h-64' : 'h-9')}>
      <div className="flex h-9 shrink-0 items-center gap-1 border-b px-3">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => { setTab(t.id); if (!open) onToggle(); }}
            className={cn(
              'flex items-center gap-1 rounded px-2 py-1 text-caption font-medium transition-colors',
              open && tab === t.id ? 'bg-accent-100 text-accent-700' : 'text-ink-500 hover:bg-surface-0',
            )}
          >
            {t.label}
            {t.badge !== undefined && (
              <span className={cn(
                'rounded-full px-1 text-caption font-semibold',
                t.tone === 'error' ? 'bg-danger/10 text-danger'
                  : t.tone === 'warn' ? 'bg-warning/15 text-ink-900'
                    : 'bg-ink-300 text-ink-700',
              )}
              >
                {t.badge}
              </span>
            )}
          </button>
        ))}
        <button
          className="ml-auto rounded p-1 text-ink-500 hover:bg-surface-0"
          onClick={onToggle}
          aria-label={open ? 'Collapse panel' : 'Expand panel'}
        >
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
        </button>
      </div>

      {open && (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {tab === 'log' && (
            run?.executions.length ? (
              <div>
                {run.executions.map((execution) => (
                  <ExecutionRow
                    key={execution.id}
                    execution={execution}
                    onSelect={() => onSelectNode(execution.nodeId)}
                  />
                ))}
              </div>
            ) : (
              <p className="p-4 text-center text-caption text-ink-500">
                Run Test Flow to see each node's inputs and outputs.
              </p>
            )
          )}

          {tab === 'results' && (
            run ? (
              <div className="space-y-3 p-3">
                <div className="flex flex-wrap items-center gap-2 text-caption">
                  <span className={cn(
                    'rounded-full px-2 py-px font-semibold',
                    run.status === 'COMPLETED' ? 'bg-success/10 text-success'
                      : run.status === 'FAILED' ? 'bg-danger/10 text-danger'
                        : 'bg-warning/15 text-ink-900',
                  )}
                  >
                    {run.status.replace(/_/g, ' ').toLowerCase()}
                  </span>
                  {run.dryRun && (
                    <span className="rounded-full bg-surface-0 px-2 py-px text-caption text-ink-700">
                      dry run — nothing sent, no side effects
                    </span>
                  )}
                </div>

                {run.error && (
                  <div className="rounded-md border border-danger/30 bg-danger/10 p-2 text-caption text-danger">
                    {run.error}
                  </div>
                )}

                <div>
                  <div className="mb-1 text-caption font-semibold uppercase tracking-wide text-ink-500">
                    Messages the customer would receive
                  </div>
                  {run.outboundMessages.length === 0 ? (
                    <p className="text-caption text-ink-500">None.</p>
                  ) : (
                    <div className="space-y-1">
                      {run.outboundMessages.map((message, i) => (
                        <div key={i} className="flex items-start gap-2 rounded-lg bg-accent-100 p-2">
                          <MessageSquare className="mt-px h-3.5 w-3.5 shrink-0 text-accent-600" />
                          <span className="text-caption leading-snug text-ink-700">{message.body}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <p className="p-4 text-center text-caption text-ink-500">No test run yet.</p>
            )
          )}

          {tab === 'variables' && (
            variables.length ? (
              <table className="w-full text-caption">
                <tbody>
                  {variables.map(([key, value]) => (
                    <tr key={key} className="border-b last:border-0">
                      <td className="w-48 px-3 py-1 align-top font-mono text-ink-700">{key}</td>
                      <td className="px-3 py-1 font-mono text-ink-700">
                        {typeof value === 'object'
                          ? JSON.stringify(value)
                          : String(value)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="p-4 text-center text-caption text-ink-500">
                Variables appear here once a test run collects them.
              </p>
            )
          )}

          {tab === 'issues' && (
            issues.length ? (
              <ul>
                {issues.map((issue, i) => (
                  <li key={i} className="flex items-start gap-2 border-b px-3 py-2 last:border-0">
                    {issue.level === 'error'
                      ? <XCircle className="mt-px h-3.5 w-3.5 shrink-0 text-danger" />
                      : <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0 text-ink-900" />}
                    <div className="min-w-0 flex-1">
                      <p className="text-caption leading-snug text-ink-700">{issue.message}</p>
                      <span className="font-mono text-caption text-ink-500">{issue.code}</span>
                    </div>
                    {issue.nodeId && (
                      <Button
                        variant="ghost" size="sm" className="h-6 shrink-0 text-caption"
                        onClick={() => onSelectNode(issue.nodeId!)}
                      >
                        Show
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <div className="flex items-center justify-center gap-2 p-4 text-caption text-success">
                <CheckCircle2 className="h-4 w-4" />
                No problems found — this flow is ready to publish.
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
}
