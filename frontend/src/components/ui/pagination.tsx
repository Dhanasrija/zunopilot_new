import { useMemo } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// Page-number pagination, shared by the list pages.
//
// Lifted out of `pages/Orders.tsx`, which had the only implementation. Two pages had
// been about to carry the same ellipsis arithmetic, and that arithmetic is the part
// nobody wants to debug twice.
//
// **`total` must be the server's count, not the length of the rows on screen.** The
// version this replaces measured a client-side filtered array over a hard `take: 200`,
// so once a workspace passed 200 orders the control paged confidently through a
// truncated set and the "of N" label was simply wrong.

export interface PaginationProps {
  /** 1-based. */
  page: number;
  onPageChange: (page: number) => void;
  pageSize: number;
  /** Total matching rows on the server, across all pages. */
  total: number;
  /** What is being counted, for the label: "orders", "customers". */
  noun: string;
}

/**
 * Which page buttons to render.
 *
 * Five slots at most, so the control never reflows as the count changes: the ends are
 * always reachable and the middle collapses to an ellipsis.
 */
const pageNumbersFor = (page: number, totalPages: number): Array<number | '…'> => {
  if (totalPages <= 5) return Array.from({ length: totalPages }, (_, i) => i + 1);
  if (page <= 3) return [1, 2, 3, '…', totalPages];
  if (page >= totalPages - 2) return [1, '…', totalPages - 2, totalPages - 1, totalPages];
  return [1, '…', page, '…', totalPages];
};

export function Pagination({ page, onPageChange, pageSize, total, noun }: PaginationProps) {
  // At least one page even when empty, so the label reads "0 of 0" rather than
  // rendering a control with no buttons in it.
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const numbers = useMemo(() => pageNumbersFor(page, totalPages), [page, totalPages]);

  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t bg-surface-0/40 px-4 py-3">
      <p className="text-caption text-ink-500">
        Showing {first} to {last} of {total} {noun}
      </p>
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="icon"
          className="h-7 w-7"
          aria-label="Previous page"
          disabled={page === 1}
          onClick={() => onPageChange(page - 1)}
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </Button>

        {numbers.map((n, i) => (n === '…' ? (
          // eslint-disable-next-line react/no-array-index-key
          <span key={`gap-${i}`} className="w-7 text-center text-caption text-ink-500">…</span>
        ) : (
          <Button
            key={n}
            variant={page === n ? 'default' : 'outline'}
            size="icon"
            aria-label={`Page ${n}`}
            aria-current={page === n ? 'page' : undefined}
            className={cn('h-7 w-7 text-caption', page === n && 'border-accent-600 bg-accent-600 hover:bg-accent-700')}
            onClick={() => onPageChange(n)}
          >
            {n}
          </Button>
        )))}

        <Button
          variant="outline"
          size="icon"
          className="h-7 w-7"
          aria-label="Next page"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
