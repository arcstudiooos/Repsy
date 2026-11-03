import type { ComponentProps } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const pill = cva(
  'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs leading-5 font-medium whitespace-nowrap',
  {
    variants: {
      tone: {
        neutral: 'bg-surface-muted text-secondary',
        accent: 'bg-accent-soft text-accent-ink',
        success: 'bg-success-soft text-success-ink',
        warning: 'bg-warning-soft text-warning-ink',
        danger: 'bg-danger-soft text-danger-ink',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

export type PillTone = NonNullable<VariantProps<typeof pill>['tone']>;

/** A short status label. Colour is never the only signal: the text says the state. */
export function Pill({
  tone,
  dot = false,
  className,
  children,
  ...props
}: ComponentProps<'span'> & VariantProps<typeof pill> & { dot?: boolean }) {
  return (
    <span className={cn(pill({ tone }), className)} {...props}>
      {dot && <span aria-hidden className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}
