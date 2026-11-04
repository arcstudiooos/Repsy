import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-control text-base font-medium whitespace-nowrap transition-colors duration-[var(--k-motion-fast)] disabled:pointer-events-none disabled:opacity-60 [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-accent-fill text-on-accent shadow-e1 hover:bg-accent-hover',
        secondary: 'border border-input-border bg-surface text-ink hover:bg-surface-2',
        ghost: 'text-ink hover:bg-surface-2',
        /** Tinted: secondary actions that should still read as "do this". */
        soft: 'bg-accent-soft text-accent-ink hover:bg-accent-soft/70',
        /** Looks like a link, behaves like a button; for actions inside text and Section headers. */
        link: 'min-h-0 px-0 font-semibold text-accent underline-offset-4 hover:underline',
        danger: 'bg-danger text-on-accent hover:bg-danger/90',
      },
      // Tap targets are at least 44px on mobile.
      size: {
        default: 'min-h-11 px-4',
        sm: 'min-h-11 px-3 text-sm md:min-h-9',
        icon: 'size-11',
      },
    },
    compoundVariants: [{ variant: 'link', className: 'min-h-0 px-0 md:min-h-0' }],
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
