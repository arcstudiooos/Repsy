import { Inbox, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** Icon in a soft circle, a title, one sentence and a primary action. */
export function EmptyState({
  title,
  body,
  action,
  icon: Icon = Inbox,
  compact = false,
  className,
}: {
  title: string;
  body?: ReactNode;
  action?: ReactNode;
  icon?: LucideIcon;
  /** Inside a card: no border, less padding. */
  compact?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-3 text-center',
        compact
          ? 'px-4 py-8'
          : 'rounded-card border border-dashed border-input-border/60 bg-surface px-6 py-12',
        className,
      )}
    >
      <span className="flex size-12 items-center justify-center rounded-full bg-accent-soft text-accent-ink">
        <Icon aria-hidden className="size-6" />
      </span>
      <h2 className="text-h3 font-semibold">{title}</h2>
      {body && <p className="max-w-md text-sm text-secondary">{body}</p>}
      {action && <div className="mt-1 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}
