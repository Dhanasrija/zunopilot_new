import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { cn } from '@/lib/utils';
import { specFor, type FlowNode as FlowNodeType } from '@/lib/workflow';

// The one custom React Flow node type. Every workflow node renders through
// this; what differs per type comes from its spec, so adding a node type never
// means adding a component.

const HANDLE = '!w-2.5 !h-2.5 !border-2 !border-surface-1 !bg-ink-500';

const BRANCH_STYLE: Record<string, { text: string; handle: string }> = {
  yes: { text: 'text-success', handle: '!bg-success' },
  no: { text: 'text-danger', handle: '!bg-danger' },
};

function FlowNode({ data, selected }: NodeProps<FlowNodeType>) {
  const spec = specFor(data.kind);
  const Icon = spec.icon;

  return (
    <div
      className={cn(
        'w-[236px] rounded-lg border bg-surface-1 shadow-none transition-all',
        selected
          ? 'border-accent-600 ring-2 ring-accent-100'
          : 'border-ink-300 hover:border-ink-300 hover:shadow-none',
      )}
    >
      {/* A trigger has nothing pointing into it, so it gets no target handle. */}
      {spec.kind !== 'trigger' && (
        <Handle type="target" position={Position.Top} className={HANDLE} />
      )}

      <div className="flex items-start gap-2 p-3 pb-2">
        <div className={cn('w-8 h-8 rounded-lg grid place-items-center shrink-0', spec.accent)}>
          <Icon className="w-4 h-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-ink-700 truncate">
            {data.label || spec.label}
          </div>
          <div className="text-caption text-ink-500 leading-tight">{spec.label}</div>
        </div>
      </div>

      <div className="px-3 pb-3 space-y-1">
        <p className="text-caption text-ink-500 leading-snug line-clamp-2 break-words">
          {spec.summary(data.config ?? {})}
        </p>

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
      ) : (
        <Handle type="source" position={Position.Bottom} className={HANDLE} />
      )}
    </div>
  );
}

export default memo(FlowNode);
