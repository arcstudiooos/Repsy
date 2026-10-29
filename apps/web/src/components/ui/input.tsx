import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

export function Input({ className, type = 'text', ...props }: ComponentProps<'input'>) {
  return (
    <input
      type={type}
      className={cn(
        'block min-h-11 w-full rounded-control border border-input-border bg-surface px-3 text-base text-ink transition-colors duration-[var(--k-motion-fast)] placeholder:text-secondary disabled:opacity-60 aria-invalid:border-danger',
        className,
      )}
      {...props}
    />
  );
}
