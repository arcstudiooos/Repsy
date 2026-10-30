import type { PreviousPerformance, SessionState } from '@kinetic/core';
import { toDisplay, type Units } from '@kinetic/core/units';

const DAY_MS = 86_400_000;
const utcDate = (localDate: string) => new Date(`${localDate}T00:00:00Z`);

/**
 * A stored client-local date (YYYY-MM-DD) as a short label: Today, Tomorrow, Yesterday, else "Mon 2 Nov".
 * Formatted in UTC so the calendar date never shifts with the viewer's zone (Review Focus #1).
 */
export function formatSessionDate(localDate: string, todayLocal: string): string {
  const diff = Math.round((utcDate(localDate).getTime() - utcDate(todayLocal).getTime()) / DAY_MS);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  })
    .format(utcDate(localDate))
    .replace(',', '');
}

export const SESSION_STATE_LABEL: Record<SessionState, string> = {
  scheduled: 'Scheduled',
  in_progress: 'In progress',
  completed: 'Completed',
  skipped: 'Skipped',
  missed: 'Missed',
  incomplete: 'Incomplete',
  cancelled: 'Cancelled',
};

/** The badge label: an open session past its due time reads "Overdue". */
export function sessionStateLabel(state: SessionState, overdue: boolean): string {
  return overdue && (state === 'scheduled' || state === 'in_progress')
    ? 'Overdue'
    : SESSION_STATE_LABEL[state];
}

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** D-007 #5, verbatim: shown on the portal home until the client's first workout starts. */
export const SAFETY_REMINDER =
  'Tell your coach about anything that affects safe training before you begin.';

/** A logged set as "5 × 60 kg", "8 reps", "45 s" or "1000 m" (loads in `units`); null for a cleared set. */
export function formatLoggedSet(
  s: PreviousPerformance['sets'][number],
  units: Units,
): string | null {
  const load = s.weightKg !== null ? `${toDisplay(s.weightKg, units)} ${units}` : null;
  if (s.reps !== null && load) return `${s.reps} × ${load}`;
  if (s.reps !== null) return `${s.reps} reps`;
  if (load) return load;
  if (s.durationSeconds !== null) return `${s.durationSeconds} s`;
  if (s.distanceM !== null) return `${s.distanceM} m`;
  return null;
}
