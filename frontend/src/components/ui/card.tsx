import * as React from 'react';
import { cn } from '@/lib/utils';

// §4.4 — "Prefer 1px borders over shadows… No decorative drop shadows on cards."
//
// The `shadow-none` that used to be here is gone, and `shadow-none` is no longer a
// class that exists. Cards are `surface-1` on a `surface-0` page, separated by a
// 1px `ink-300` border — which is what gives the flat, documentation-adjacent
// register §1 asks for instead of the soft-shadow look §11 rules out.
export const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('rounded-lg border border-ink-300 bg-surface-1 text-ink-900', className)}
      {...props}
    />
  )
);
Card.displayName = 'Card';

// §4.1 — 24px card padding.
export const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex flex-col gap-1 p-6', className)} {...props} />
  )
);
CardHeader.displayName = 'CardHeader';

// §3.2 — `--text-h3` is the card-title token: 1.25rem / 1.3 / 600.
export const CardTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3 ref={ref} className={cn('text-h3 font-semibold', className)} {...props} />
  )
);
CardTitle.displayName = 'CardTitle';

export const CardDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p ref={ref} className={cn('text-sm text-ink-500', className)} {...props} />
  )
);
CardDescription.displayName = 'CardDescription';

export const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div ref={ref} className={cn('p-6 pt-0', className)} {...props} />
);
CardContent.displayName = 'CardContent';

export const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex items-center p-6 pt-0', className)} {...props} />
  )
);
CardFooter.displayName = 'CardFooter';
