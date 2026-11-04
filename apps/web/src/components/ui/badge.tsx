import { cva, type VariantProps } from 'class-variance-authority';
import type { LucideIcon } from 'lucide-react';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

export const badgeVariants = cva(
  'inline-flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-caption font-medium whitespace-nowrap',
  {
    variants: {
      tone: {
        neutral: 'bg-surface-2 text-secondary',
        brand: 'bg-accent-soft text-accent-ink',
        success: 'bg-success-soft text-success-ink',
        warning: 'bg-warning-soft text-warning-ink',
        danger: 'bg-danger-soft text-danger-ink',
        info: 'bg-info-soft text-info-ink',
        outline: 'border border-input-border text-ink',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

export type BadgeTone = NonNullable<VariantProps<typeof badgeVariants>['tone']>;

/** Status label: icon + text + semantic colour. The text always says the state; colour is the second signal. */
export function Badge({
  tone,
  icon: Icon,
  className,
  children,
  ...props
}: ComponentProps<'span'> & VariantProps<typeof badgeVariants> & { icon?: LucideIcon }) {
  return (
    <span className={cn(badgeVariants({ tone }), className)} {...props}>
      {Icon && <Icon aria-hidden className="size-3.5 shrink-0" />}
      {children}
    </span>
  );
}
