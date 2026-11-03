import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-control text-base font-medium whitespace-nowrap transition-colors duration-[var(--k-motion-fast)] disabled:pointer-events-none disabled:opacity-60',
  {
    variants: {
      variant: {
        default: 'bg-accent text-white shadow-sm hover:bg-accent-hover active:translate-y-px',
        secondary:
          'border border-input-border bg-surface text-ink shadow-sm hover:border-ink/40 hover:bg-surface-muted active:translate-y-px',
        ghost: 'text-ink hover:bg-surface-muted',
        /** A quieter call to action: the accent's tint (selected filters, secondary suggestions). */
        soft: 'bg-accent-soft text-accent-ink hover:bg-accent-soft/70',
        danger: 'bg-danger text-white shadow-sm hover:bg-danger/90 active:translate-y-px',
      },
      // Tap targets are at least 44px on mobile.
      size: {
        default: 'min-h-11 px-4',
        sm: 'min-h-11 px-3 text-sm md:min-h-9',
        icon: 'size-11',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: ComponentProps<'button'> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : 'button';
  return <Comp className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
