import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

export const cardVariants = cva('rounded-card text-ink', {
  variants: {
    variant: {
      /** Resting card: hairline border + e1. */
      default: 'border border-border bg-surface p-4 shadow-e1 sm:p-6',
      /** A well inside a card or page section. */
      inset: 'bg-surface-2 p-4',
      /** Brand hero tile (next workout, KPI hero), 20px radius. Text is white; acid for highlights. */
      hero: 'rounded-xl bg-midnight p-5 text-on-midnight shadow-e2 sm:p-6',
      /** A win or highlight (PRs, streaks): acid-soft with an acid edge; text stays ink. */
      highlight:
        'relative overflow-hidden border border-border bg-acid-soft p-4 shadow-e1 before:absolute before:inset-y-0 before:left-0 before:w-1 before:bg-acid before:shadow-[inset_-1px_0_0_var(--k-on-acid)] sm:p-6',
      /** A whole-card link or button target. */
      interactive:
        'border border-border bg-surface p-4 shadow-e1 transition-[border-color,box-shadow] duration-[var(--k-motion-fast)] hover:border-input-border hover:shadow-e2 sm:p-6',
    },
  },
  defaultVariants: { variant: 'default' },
});

export function Card({
  className,
  variant,
  ...props
}: ComponentProps<'div'> & VariantProps<typeof cardVariants>) {
  return <div className={cn(cardVariants({ variant }), className)} {...props} />;
}

export function CardHeader({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('mb-4 flex flex-col gap-1', className)} {...props} />;
}

export function CardTitle({
  className,
  as: Heading = 'h2',
  ...props
}: ComponentProps<'h2'> & { as?: 'h2' | 'h3' | 'h4' }) {
  return <Heading className={cn('text-h2 font-semibold', className)} {...props} />;
}

export function CardDescription({ className, ...props }: ComponentProps<'p'>) {
  return <p className={cn('text-sm text-secondary', className)} {...props} />;
}

export function CardContent({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('text-base', className)} {...props} />;
}
