import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { cn } from '@/lib/utils';
import { specFor } from '@/lib/engine/nodes';
import type { FlowNode } from '@/lib/engine/types';

// The single custom React Flow node. Everything type-specific comes from the
// node's spec, so adding a node type never means adding a component.

const HANDLE = '!w-2.5 !h-2.5 !border-2 !border-surface-1 !bg-ink-500';

const BRANCH_STYLE: Record<string, { text: string; handle: string }> = {
  yes: { text: 'text-success', handle: '!bg-success' },
  no: { text: 'text-danger', handle: '!bg-danger' },
  success: { text: 'text-success', handle: '!bg-success' },
  error: { text: 'text-danger', handle: '!bg-danger' },
};

/** Ring painted on a node by the last test run. */
const RUN_STYLE: Record<string, string> = {
  SUCCESS: 'border-success/30 ring-2 ring-success/30',
  FAILED: 'border-danger ring-2 ring-danger/30',
  WAITING: 'border-warning ring-2 ring-warning/40',
  SKIPPED: 'border-ink-300 ring-2 ring-ink-300',
  RUNNING: 'border-accent-600 ring-2 ring-accent-100',
};

function EngineNode({ data, selected }: NodeProps<FlowNode>) {
  const spec = specFor(data.type);
  const Icon = spec.icon;
  const isEntry = spec.group === 'Entry';

  return (
    <div
      className={cn(
        'w-[248px] rounded-lg border bg-surface-1 shadow-none transition-all',
        selected
          ? 'border-accent-600 ring-2 ring-accent-100'
          : data.runStatus
            ? RUN_STYLE[data.runStatus]
            : 'border-ink-300 hover:border-ink-300 hover:shadow-none',
      )}
    >
      {!isEntry && <Handle type="target" position={Position.Top} className={HANDLE} />}

      <div className="flex items-start gap-2 p-3 pb-2">
        <div className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-lg', spec.accent)}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-ink-700">
            {data.name || spec.label}
          </div>
          <div className="text-caption leading-tight text-ink-500">{spec.label}</div>
        </div>
      </div>

      <div className="space-y-1 px-3 pb-3">
        <p className="line-clamp-2 break-words text-caption leading-snug text-ink-500">
          {spec.summary(data.config ?? {})}
        </p>

        {/* The entry node explains itself — a conversation workflow does not
            begin with a generic WhatsApp trigger, and that distinction is the
            whole point of the routing model. */}
        {isEntry && (
          <div className="rounded border border-success/30 bg-success/10 px-1 py-1 text-caption leading-snug text-success">
            Started by the Assistant Router
          </div>
        )}

        {data.outputVariable && (
          <div className="inline-flex items-center rounded bg-surface-0 px-1 py-px font-mono text-caption text-ink-700">
            → vars.{data.outputVariable}
          </div>
        )}

        {!spec.implemented && (
          <div className="inline-flex items-center rounded border border-warning/40 bg-warning/15 px-1 py-px text-caption font-medium text-ink-900">
            Skipped at runtime
          </div>
        )}
      </div>

      {spec.branches ? (
        <div className="flex border-t border-ink-300">
          {spec.branches.map((branch) => {
            const style = BRANCH_STYLE[branch] ?? { text: 'text-ink-500', handle: '' };
            return (
              <div
                key={branch}
                className={cn(
                  'relative flex-1 py-1 text-center text-caption font-semibold uppercase tracking-wide',
                  'first:border-r first:border-ink-300',
                  style.text,
                )}
              >
                {branch}
                <Handle
                  id={branch}
                  type="source"
                  position={Position.Bottom}
                  className={cn(HANDLE, style.handle)}
                />
              </div>
            );
          })}
        </div>
      ) : spec.terminal ? null : (
        <Handle type="source" position={Position.Bottom} className={HANDLE} />
      )}
    </div>
  );
}

export default memo(EngineNode);
