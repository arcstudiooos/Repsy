import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

export function Input({ className, type = 'text', ...props }: ComponentProps<'input'>) {
  return (
    <input
      type={type}
      className={cn(
        'block min-h-11 w-full rounded-control border border-input-border bg-surface px-3 text-base text-ink shadow-xs transition-[border-color,box-shadow] duration-[var(--k-motion-fast)] placeholder:text-secondary hover:border-ink/50 focus-visible:border-accent focus-visible:shadow-[0_0_0_3px_var(--k-accent-soft)] focus-visible:outline-none disabled:opacity-60 aria-invalid:border-danger',
        className,
      )}
      {...props}
    />
  );
}
