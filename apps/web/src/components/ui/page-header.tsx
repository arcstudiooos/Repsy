import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * The top of every screen: one h1, an optional line saying what the screen is for, and the screen's primary
 * actions on the right (below the title on phones).
 */
export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  eyebrow?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between md:mb-8',
        className,
      )}
    >
      <div className="min-w-0">
        {eyebrow && <p className="mb-1 text-sm font-medium text-accent-ink">{eyebrow}</p>}
        <h1 className="text-2xl font-semibold md:text-3xl">{title}</h1>
        {description && <p className="mt-1 max-w-prose text-base text-secondary">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
