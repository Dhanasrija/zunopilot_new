import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

// §7 — badges are **status pills only**.
//
// This is the one place §4.3 permits `rounded-full`: "No pills except status
// badges." If something here is not reporting a state, it should not be a badge.
//
// Each variant is a tint background with a readable foreground rather than a solid
// fill, so a row of them reads as data and does not compete with the accent for
// attention — §2.4's 60-30-10 falls apart quickly if every table cell is saturated.
const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2 py-px text-caption font-medium transition-colors duration-micro',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-accent-100 text-accent-700',
        secondary: 'border-ink-300 bg-surface-0 text-ink-700',
        destructive: 'border-transparent bg-danger/10 text-danger',
        outline: 'border-ink-300 text-ink-700',
        // §2.2/§7 — approved and connected states. `wa-green` is allowlisted for
        // this file in `scripts/check-brand.mjs` and belongs nowhere else.
        connected: 'border-transparent bg-wa-green/15 text-success',
        // §7 — template pending approval, quota warnings.
        pending: 'border-transparent bg-warning/15 text-ink-900',
      },
    },
    defaultVariants: { variant: 'default' },
  }
);

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

export const Badge = ({ className, variant, ...props }: BadgeProps) => (
  <div className={cn(badgeVariants({ variant }), className)} {...props} />
);
