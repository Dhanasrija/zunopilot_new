import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

// §7 — buttons.
//
// 40px default height, 8px radius, `accent-600` primary going to `accent-700` on
// hover. Secondary and outline are a 1px border with ink text, because §4.4 makes
// the border the elevation model rather than a shadow.
//
// **No `focus-visible:ring-*` here.** §7 asks for a 2px accent ring at 2px offset,
// and that is now a single global `:focus-visible` rule in `index.css` — one
// mechanism for the whole app, so a new control cannot ship without a focus state
// and two implementations cannot drift.
const buttonVariants = cva(
  'inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium '
  + 'transition-colors duration-micro disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-accent-600 text-on-accent hover:bg-accent-700',
        destructive: 'bg-danger text-on-accent hover:bg-danger/90',
        outline: 'border border-ink-300 bg-surface-1 text-ink-900 hover:bg-accent-100/40',
        secondary: 'border border-ink-300 bg-surface-0 text-ink-900 hover:bg-accent-100/40',
        ghost: 'text-ink-700 hover:bg-accent-100/40 hover:text-ink-900',
        link: 'text-accent-600 underline-offset-4 hover:underline',
      },
      size: {
        // §7 — 40px. The 44px minimum target of §10 is met by the surrounding
        // row spacing.
        default: 'h-10 px-4 py-2',
        sm: 'h-8 rounded-md px-3',
        lg: 'h-12 rounded-md px-6',
        // §7 — "No icon-only buttons without aria-label." That is a call-site
        // obligation; this variant only sizes the target.
        icon: 'h-10 w-10',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  }
);
Button.displayName = 'Button';

export { buttonVariants };
