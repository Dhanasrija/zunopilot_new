import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { specFor, type FlowNode, type Issue } from '@/lib/workflow';
import { AlertTriangle, CheckCircle2, MousePointerSquareDashed, Trash2, XCircle } from 'lucide-react';

// Right rail. With a node selected it edits the canvas-level properties every
// node shares; with nothing selected it lists what would go wrong on publish.
//
// The per-node-type settings (message body, condition operands, delay duration)
// are the next piece of work — they slot into the marked gap below and write
// into the same `config` object the node card already summarises.

function IssueList({ issues, onSelect }: { issues: Issue[]; onSelect: (id: string) => void }) {
  if (!issues.length) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-success/30 bg-success/10 p-3">
        <CheckCircle2 className="mt-px h-4 w-4 shrink-0 text-success" />
        <p className="text-caption text-success">
          No problems found. This flow is ready to publish.
        </p>
      </div>
    );
  }

  return (
    <ul className="space-y-1">
      {issues.map((issue, i) => {
        const isError = issue.level === 'error';
        const Icon = isError ? XCircle : AlertTriangle;
        return (
          <li key={i}>
            <button
              type="button"
              disabled={!issue.nodeId}
              onClick={() => issue.nodeId && onSelect(issue.nodeId)}
              className={cn(
                'flex w-full items-start gap-2 rounded-lg border p-2 text-left',
                isError ? 'border-danger/30 bg-danger/10' : 'border-warning/40 bg-warning/15',
                issue.nodeId && 'hover:brightness-[0.98]',
              )}
            >
              <Icon className={cn('mt-px h-3.5 w-3.5 shrink-0', isError ? 'text-danger' : 'text-ink-900')} />
              <span className={cn('text-caption leading-snug', isError ? 'text-danger' : 'text-ink-900')}>
                {issue.message}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export default function NodeInspector({
  node, issues, onPatch, onDelete, onSelect,
}: {
  node: FlowNode | null;
  issues: Issue[];
  onPatch: (id: string, patch: { label?: string; outputVariable?: string | null }) => void;
  onDelete: (id: string) => void;
  onSelect: (id: string) => void;
}) {
  if (!node) {
    const errors = issues.filter((i) => i.level === 'error').length;
    const warnings = issues.length - errors;

    return (
      <aside className="w-80 shrink-0 border-l bg-surface-1 overflow-y-auto">
        <div className="border-b px-4 py-3">
          <h2 className="text-sm font-semibold text-ink-700">Flow check</h2>
          <p className="mt-px text-caption text-ink-500">
            {issues.length === 0
              ? 'Everything looks runnable.'
              : `${errors} ${errors === 1 ? 'error' : 'errors'} · ${warnings} ${warnings === 1 ? 'warning' : 'warnings'}`}
          </p>
        </div>

        <div className="space-y-4 p-4">
          <IssueList issues={issues} onSelect={onSelect} />

          <div className="flex items-start gap-2 rounded-lg border border-ink-300 bg-surface-0 p-3">
            <MousePointerSquareDashed className="mt-px h-4 w-4 shrink-0 text-ink-500" />
            <p className="text-caption leading-snug text-ink-500">
              Select a node to edit it. Drag from a node's bottom dot to another node's top dot to
              connect them.
            </p>
          </div>
        </div>
      </aside>
    );
  }

  const spec = specFor(node.data.kind);
  const Icon = spec.icon;
  const nodeIssues = issues.filter((i) => i.nodeId === node.id);

  return (
    <aside className="w-80 shrink-0 border-l bg-surface-1 overflow-y-auto">
      <div className="flex items-start gap-2 border-b px-4 py-3">
        <div className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-lg', spec.accent)}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold text-ink-700">{spec.label}</h2>
          <p className="text-caption leading-tight text-ink-500">{spec.blurb}</p>
        </div>
      </div>

      <div className="space-y-4 p-4">
        {nodeIssues.length > 0 && <IssueList issues={nodeIssues} onSelect={onSelect} />}

        <div className="space-y-1">
          <Label htmlFor="node-label">Name on the canvas</Label>
          <Input
            id="node-label"
            value={node.data.label}
            placeholder={spec.label}
            autoComplete="off"
            onChange={(e) => onPatch(node.id, { label: e.target.value })}
          />
        </div>

        {/* ── Per-type settings land here (next task) ────────────────────── */}
        <div className="rounded-lg border border-dashed border-ink-300 bg-surface-0 p-3">
          <p className="text-caption font-medium text-ink-700">{spec.label} settings</p>
          <p className="mt-1 text-caption leading-snug text-ink-500">
            The fields for this node type aren't built yet. Layout, connections and naming save
            today; the node keeps its default config until then.
          </p>
        </div>

        <div className="space-y-1">
          <Label htmlFor="node-var">Save output as</Label>
          <Input
            id="node-var"
            value={node.data.outputVariable ?? ''}
            placeholder="e.g. reply_id"
            autoComplete="off"
            className="font-mono text-caption"
            onChange={(e) => {
              // Only characters the engine's {{vars.x}} path lookup can address.
              const clean = e.target.value.replace(/[^a-zA-Z0-9_]/g, '');
              onPatch(node.id, { outputVariable: clean || null });
            }}
          />
          <p className="text-caption text-ink-500">
            {node.data.outputVariable
              ? <>Later nodes can use <code className="rounded bg-surface-0 px-1 font-mono">{`{{vars.${node.data.outputVariable}}}`}</code>.</>
              : "Leave blank if later nodes don't need this node's result."}
          </p>
        </div>

        <div className="border-t pt-3">
          <div className="mb-3 font-mono text-caption text-ink-300">{node.id}</div>
          <Button
            variant="outline"
            size="sm"
            className="w-full gap-1 border-danger/30 text-danger hover:bg-danger/10 hover:text-danger"
            onClick={() => onDelete(node.id)}
          >
            <Trash2 className="h-3.5 w-3.5" /> Delete node
          </Button>
        </div>
      </div>
    </aside>
  );
}
