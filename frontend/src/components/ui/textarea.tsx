import * as React from 'react';
import { cn } from '@/lib/utils';

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  /**
   * Start at one line and grow, instead of holding a two-line floor.
   *
   * **A prop rather than a `className` override**, because `min-height` beats `height`: a caller
   * that sets its own height still renders 80px tall, and passing `min-h-0` in `className` relies
   * on which rule Tailwind happens to emit last. This says what it means and greps.
   *
   * The caller owns the growing — set `style.height` from `scrollHeight` in a layout effect.
   */
  grows?: boolean;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, grows = false, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        'flex w-full rounded-md border border-ink-400 bg-surface-1 px-3 py-2 text-sm text-ink-900 placeholder:text-ink-450 focus:border-accent-600 disabled:opacity-50',
        grows ? 'min-h-0 resize-none overflow-y-auto' : 'min-h-[80px]',
        className
      )}
      {...props}
    />
  )
);
Textarea.displayName = 'Textarea';
