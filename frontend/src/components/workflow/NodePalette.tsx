import { cn } from '@/lib/utils';
import { PALETTE, type NodeKind, type NodeSpec } from '@/lib/workflow';

// Left rail of the canvas. Nodes can be dragged onto the canvas or clicked to
// drop into the middle of the current viewport — dragging is nicer with a mouse,
// clicking is the only option on a trackpad-hostile setup.

export const DND_MIME = 'application/x-zuno-node';

function PaletteItem({
  spec, disabled, onAdd,
}: {
  spec: NodeSpec;
  disabled: boolean;
  onAdd: (kind: NodeKind) => void;
}) {
  const Icon = spec.icon;

  return (
    <button
      type="button"
      draggable={!disabled}
      disabled={disabled}
      title={disabled ? 'A workflow can only have one Trigger' : spec.blurb}
      onDragStart={(e) => {
        e.dataTransfer.setData(DND_MIME, spec.kind);
        e.dataTransfer.effectAllowed = 'move';
      }}
      onClick={() => !disabled && onAdd(spec.kind)}
      className={cn(
        'group w-full flex items-start gap-2 rounded-lg border p-2 text-left transition-colors',
        disabled
          ? 'border-ink-300 opacity-45 cursor-not-allowed'
          : 'border-ink-300 bg-surface-1 hover:border-accent-100 hover:bg-accent-100/50 cursor-grab active:cursor-grabbing',
      )}
    >
      <div className={cn('w-7 h-7 rounded-md grid place-items-center shrink-0', spec.accent)}>
        <Icon className="w-3.5 h-3.5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1">
          <span className="text-sm font-medium text-ink-700 truncate">{spec.label}</span>
          {!spec.implemented && (
            <span className="shrink-0 rounded bg-surface-0 px-1 py-px text-caption font-semibold uppercase tracking-wide text-ink-500">
              Soon
            </span>
          )}
        </div>
        <p className="text-caption leading-tight text-ink-500 line-clamp-2">{spec.blurb}</p>
      </div>
    </button>
  );
}

export default function NodePalette({
  usedKinds, onAdd,
}: {
  usedKinds: Set<string>;
  onAdd: (kind: NodeKind) => void;
}) {
  return (
    <aside className="w-60 shrink-0 border-r bg-surface-0/60 overflow-y-auto">
      <div className="px-3 py-3 border-b bg-surface-1/60">
        <h2 className="text-caption font-semibold uppercase tracking-wide text-ink-500">Nodes</h2>
        <p className="mt-px text-caption text-ink-500">Drag onto the canvas, or click to add.</p>
      </div>

      <div className="p-3 space-y-4">
        {PALETTE.map(({ group, items }) => (
          <div key={group} className="space-y-1">
            <div className="px-px text-caption font-semibold uppercase tracking-wide text-ink-500">
              {group}
            </div>
            {items.map((spec) => (
              <PaletteItem
                key={spec.kind}
                spec={spec}
                disabled={!!spec.once && usedKinds.has(spec.kind)}
                onAdd={onAdd}
              />
            ))}
          </div>
        ))}
      </div>
    </aside>
  );
}
