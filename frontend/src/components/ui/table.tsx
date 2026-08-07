import * as React from 'react';
import { cn } from '@/lib/utils';

// §7 — tables: "mono tabular numerals for all metrics, row hover `--accent-100` at
// 40% opacity, sticky header."
//
// Tabular numerals are applied to `td`/`th` globally in `index.css` rather than
// per cell, because a column of figures that jitters as it updates is the exact
// problem the rule exists to prevent and it only takes one unmarked cell.
export const Table = React.forwardRef<
  HTMLTableElement,
  React.HTMLAttributes<HTMLTableElement> & {
    /**
     * Below `sm`, render each row as a card instead of a table row.
     *
     * Worth turning on for anything past about three columns. A wide table on a phone
     * either overflows the document — see `.table-stack` in index.css for why `w-full`
     * does not prevent that — or scrolls sideways inside its card, which hides the column
     * headings exactly when you need them. Pass a `label` to each TableCell so the
     * heading travels with the value.
     */
    stack?: boolean;
  }
>(({ className, stack = false, ...props }, ref) => (
  <div className="relative w-full overflow-auto">
    <table
      ref={ref}
      className={cn('w-full caption-bottom text-sm', stack && 'table-stack', className)}
      {...props}
    />
  </div>
));
Table.displayName = 'Table';

// Sticky header per §7. `surface-1` background so rows scrolling underneath do not
// show through, and a border rather than a shadow per §4.4.
export const TableHeader = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => (
    <thead
      ref={ref}
      className={cn('sticky top-0 z-10 bg-surface-1 [&_tr]:border-b [&_tr]:border-ink-300', className)}
      {...props}
    />
  )
);
TableHeader.displayName = 'TableHeader';

export const TableBody = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => (
    <tbody ref={ref} className={cn('[&_tr:last-child]:border-0', className)} {...props} />
  )
);
TableBody.displayName = 'TableBody';

// §7 — row hover is accent-100 at 40%. Subtle on purpose: it marks the row the
// cursor is on without turning a long table into stripes of colour.
export const TableRow = React.forwardRef<HTMLTableRowElement, React.HTMLAttributes<HTMLTableRowElement>>(
  ({ className, ...props }, ref) => (
    <tr
      ref={ref}
      className={cn('border-b border-ink-300 transition-colors duration-micro hover:bg-accent-100/40', className)}
      {...props}
    />
  )
);
TableRow.displayName = 'TableRow';

// §3.2 — column headers are the caption token: uppercase, tracked, 12px. That is
// what lets them sit quietly above the data instead of competing with it.
export const TableHead = React.forwardRef<HTMLTableCellElement, React.ThHTMLAttributes<HTMLTableCellElement>>(
  ({ className, ...props }, ref) => (
    <th
      ref={ref}
      className={cn('eyebrow px-3 py-3 text-left align-middle text-ink-500', className)}
      {...props}
    />
  )
);
TableHead.displayName = 'TableHead';

// §4.1 — "Dense tables: 12px cell padding."
export const TableCell = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement> & {
    /**
     * The column heading, repeated on this cell for the stacked phone layout.
     *
     * Ignored above `sm`, where the real `<thead>` is visible. Rendered as `data-label`
     * rather than markup so the desktop table gains no extra DOM. Leave it off for a cell
     * that needs no heading — an actions column — and the card gives it a full-width row.
     */
    label?: string;
  }
>(({ className, label, ...props }, ref) => (
  <td ref={ref} data-label={label} className={cn('px-3 py-3 align-middle', className)} {...props} />
));
TableCell.displayName = 'TableCell';
