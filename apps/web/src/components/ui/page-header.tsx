import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** One per page: optional breadcrumb or eyebrow, the h1, a one-line subtitle, and the page's actions. */
export function PageHeader({
  title,
  subtitle,
  actions,
  eyebrow,
  breadcrumb,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  eyebrow?: ReactNode;
  breadcrumb?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn('mb-6 md:mb-8', className)}>
      {breadcrumb}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          {eyebrow && <p className="label-micro mb-1 text-accent">{eyebrow}</p>}
          <h1 className="text-h1 font-semibold break-words md:text-display">{title}</h1>
          {subtitle && <p className="mt-1 max-w-prose text-body text-secondary">{subtitle}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}
