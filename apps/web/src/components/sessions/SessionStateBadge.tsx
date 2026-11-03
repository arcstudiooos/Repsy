import type { SessionState } from '@kinetic/core';
import { Pill } from '@/components/ui/pill';
import { sessionStateLabel } from '@/lib/session-format';

/** Text label always shown, so state never relies on color alone. */
export function SessionStateBadge({ state, overdue }: { state: SessionState; overdue: boolean }) {
  const label = sessionStateLabel(state, overdue);
  const tone =
    label === 'Overdue'
      ? 'warning'
      : state === 'completed'
        ? 'success'
        : state === 'in_progress'
          ? 'accent'
          : 'neutral';
  return (
    <Pill tone={tone} dot={label === 'Overdue' || state === 'in_progress'} className="text-sm">
      {label}
    </Pill>
  );
}

/** D-008 #7: shown to the coach and the client alike. */
export function LoggedByCoachBadge() {
  return (
    <Pill tone="neutral" className="text-sm text-ink">
      Logged by coach
    </Pill>
  );
}

/** PRD D13: logged unplanned by the client; not part of adherence. */
export function ExtraWorkoutBadge() {
  return (
    <Pill tone="neutral" className="text-sm text-ink">
      Extra
    </Pill>
  );
}

/** S3-4: a set changed after the workout was finished ("Edited", "Corrected by your coach"). */
export function RevisionMark({ label }: { label: string }) {
  return (
    <Pill tone="neutral" className="text-sm">
      {label}
    </Pill>
  );
}
