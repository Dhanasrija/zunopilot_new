import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

// §7 — "Empty states: mini flow-diagram illustration + one sentence + one primary
// action. Never a sad-face illustration."
//
// The illustration is the §6 signature element rather than a decorative graphic:
// "Nodes: `--surface-1` cards, 1px `--ink-300` border, `--radius-md`, mono-labeled
// type… Edges: 1.5px lines in `--ink-300`". §6 also requires that the language be
// "visually identical" in the hero, the empty states and the actual flow builder —
// so this draws the same shapes the builder does, at a smaller size.
//
// Inline SVG rather than an asset: it inherits the tokens, stays crisp at any
// density, and cannot drift from the palette the way an exported PNG would.

/**
 * One node in the mini diagram.
 *
 * Sized so the mono label can be **12px** — §3.2's floor, and it applies to text
 * inside an illustration as much as anywhere else. The first version of this
 * component set 9px to fit smaller nodes, which a runtime audit caught: the
 * diagram is decorative, but the words in it are still words someone reads.
 */
const NODE_W = 72;
const NODE_H = 32;
const LABEL_SIZE = 12;

const Node = ({ x, label }: { x: number; label: string }) => (
  <g>
    <rect
      x={x}
      y={16}
      width={NODE_W}
      height={NODE_H}
      // §4.3 / §6 — nodes are `--radius-md`, `surface-1`, 1px `ink-300`.
      rx={8}
      className="fill-surface-1 stroke-ink-300"
      strokeWidth={1}
    />
    <text
      x={x + NODE_W / 2}
      y={36}
      textAnchor="middle"
      className="fill-ink-500 font-mono"
      style={{ fontSize: LABEL_SIZE }}
    >
      {label}
    </text>
  </g>
);

/**
 * The three-node diagram: trigger → logic → action.
 *
 * The labels are §6's own vocabulary, not invented ones, because this shape is
 * meant to teach the product's mental model in the place a person has nothing else
 * to look at.
 */
const FlowDiagram = () => (
  <svg
    width={264}
    height={64}
    viewBox="0 0 264 64"
    role="img"
    aria-label="A trigger connected to a condition, connected to an action"
    className="mx-auto"
  >
    {/* §6 — 1.5px edges in ink-300. */}
    <line x1={72} y1={32} x2={96} y2={32} className="stroke-ink-300" strokeWidth={1.5} />
    <line x1={168} y1={32} x2={192} y2={32} className="stroke-ink-300" strokeWidth={1.5} />
    <Node x={0} label="trigger" />
    <Node x={96} label="logic" />
    <Node x={192} label="action" />
  </svg>
);

export interface EmptyStateProps {
  /**
   * One sentence. §7 says one, and §8 asks for specifics over adjectives — say
   * what is missing and what happens next, not "nothing to see here".
   */
  children: ReactNode;
  /** The single primary action. §7 permits exactly one. */
  action?: ReactNode;
  className?: string;
}

export const EmptyState = ({ children, action, className }: EmptyStateProps) => (
  <div className={cn('flex flex-col items-center gap-4 px-6 py-16 text-center', className)}>
    <FlowDiagram />
    {/* §3.2 — this is body copy, so it takes the body token, not a smaller one.
        `max-w-prose` keeps it inside the 68ch measure. */}
    <p className="max-w-prose text-body text-ink-700">{children}</p>
    {action}
  </div>
);
