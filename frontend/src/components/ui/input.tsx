import * as React from 'react';
import { cn } from '@/lib/utils';

// §7 — inputs: 40px height, 1px `ink-300` border, focus border `accent-600` plus
// ring. "Error state: `--danger` border + message below (never placeholder-as-label)."
//
// `error` is a prop rather than something each page assembles by hand, because the
// half-applied version of this rule — red border, no message — is worse than no
// error state at all: the field is marked wrong and does not say why.
//
// The focus ring itself comes from the global `:focus-visible` rule in `index.css`;
// only the border colour is set here.
export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** Shown below the field. Sets `aria-invalid` and the danger border. */
  error?: string | null;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, error, id, ...props }, ref) => {
    const describedBy = error && id ? `${id}-error` : undefined;

    return (
      <>
        <input
          type={type}
          id={id}
          ref={ref}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(
            'flex h-10 w-full rounded-md border bg-surface-1 px-3 py-2 text-sm text-ink-900',
            'placeholder:text-ink-450 disabled:cursor-not-allowed disabled:opacity-50',
            'transition-colors duration-micro',
            error ? 'border-danger' : 'border-ink-400 focus:border-accent-600',
            className
          )}
          {...props}
        />
        {error && (
          <p id={describedBy} className="text-caption text-danger">
            {error}
          </p>
        )}
      </>
    );
  }
);
Input.displayName = 'Input';
