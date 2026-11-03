import { Inbox, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

/** An empty list or page: what goes here, and the one thing to do about it. */
export function EmptyState({
  title,
  body,
  action,
  icon: Icon = Inbox,
}: {
  title: string;
  body?: ReactNode;
  action?: ReactNode;
  /** A lucide icon that says what will live here (defaults to an inbox). */
  icon?: LucideIcon;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-card border border-dashed border-input-border/40 bg-surface px-6 py-14 text-center">
      <span className="mb-1 flex size-12 items-center justify-center rounded-full bg-accent-soft text-accent-ink">
        <Icon aria-hidden className="size-6" />
      </span>
      <h2 className="text-lg font-semibold">{title}</h2>
      {body && <p className="max-w-md text-sm text-secondary">{body}</p>}
      {action && <div className="mt-2 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}
