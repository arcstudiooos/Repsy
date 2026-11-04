import type { ComponentProps, ReactNode } from 'react';
import { useId } from 'react';
import { cn } from '@/lib/utils';

/** A titled group on a page, with an optional action (a link-button) on the right. */
export function Section({
  title,
  description,
  action,
  children,
  className,
  headingLevel: H = 'h2',
  ...props
}: Omit<ComponentProps<'section'>, 'title'> & {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  headingLevel?: 'h2' | 'h3';
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={cn('flex flex-col gap-3', className)} {...props}>
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <H id={id} className="text-h2 font-semibold">
            {title}
          </H>
          {description && <p className="text-sm text-secondary">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
