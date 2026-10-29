import type { ClientStatus } from '@kinetic/core';
import { cn } from '@/lib/utils';

const LABEL: Record<ClientStatus, string> = {
  invited: 'Invited',
  active: 'Active',
  paused: 'Paused',
  archived: 'Archived',
};

/** Text label always shown, so status never relies on color alone. */
export function StatusBadge({ status }: { status: ClientStatus }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-control border px-2 py-0.5 text-sm font-medium',
        status === 'active' ? 'border-accent text-accent' : 'border-input-border text-secondary',
      )}
    >
      {LABEL[status]}
    </span>
  );
}

export function formatDate(date: string | null): string {
  if (!date) return '-';
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00Z`));
}
