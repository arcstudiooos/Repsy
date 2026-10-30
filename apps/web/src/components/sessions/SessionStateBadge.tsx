import type { SessionState } from '@kinetic/core';
import { sessionStateLabel } from '@/lib/session-format';
import { cn } from '@/lib/utils';

const badge = 'inline-flex items-center rounded-control border px-2 py-0.5 text-sm font-medium';

/** Text label always shown, so state never relies on color alone. */
export function SessionStateBadge({ state, overdue }: { state: SessionState; overdue: boolean }) {
  const label = sessionStateLabel(state, overdue);
  return (
    <span
      className={cn(
        badge,
        label === 'Overdue'
          ? 'border-warning text-warning'
          : state === 'completed' || state === 'in_progress'
            ? 'border-accent text-accent'
            : 'border-input-border text-secondary',
      )}
    >
      {label}
    </span>
  );
}

/** D-008 #7: shown to the coach and the client alike. */
export function LoggedByCoachBadge() {
  return <span className={cn(badge, 'border-input-border text-ink')}>Logged by coach</span>;
}

/** S3-4: a set changed after the workout was finished ("Edited", "Corrected by your coach"). */
export function RevisionMark({ label }: { label: string }) {
  return <span className={cn(badge, 'border-input-border text-secondary')}>{label}</span>;
}
