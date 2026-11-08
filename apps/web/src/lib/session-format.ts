import type { PreviousPerformance, RevisionValues, SessionState } from '@repsy/core';
import type { TrackingType } from '@repsy/core/exercise-options';
import { toDisplay, type Units } from '@repsy/core/units';

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

const REVISION_FIELDS: Record<TrackingType, (keyof RevisionValues)[]> = {
  reps_load: ['reps', 'weightKg', 'rpe'],
  duration: ['durationSeconds'],
  distance: ['distanceM'],
};

/**
 * What a set log revision changed (S3-4), e.g. "8 → 10 reps" or "60 → 62.5 kg, RPE 8 → 9" (loads in `units`). A
 * field that was empty reads "–". Only the fields the exercise's tracking type shows are described.
 */
export function describeRevisionChange(
  before: RevisionValues | null,
  after: RevisionValues,
  trackingType: TrackingType,
  units: Units,
): string {
  const show = (key: keyof RevisionValues, v: number | null) =>
    v === null ? '–' : key === 'weightKg' ? String(toDisplay(v, units)) : String(v);
  const parts = REVISION_FIELDS[trackingType]
    .filter((key) => (before?.[key] ?? null) !== after[key])
    .map((key) => {
      const change = `${show(key, before?.[key] ?? null)} → ${show(key, after[key])}`;
      if (key === 'reps') return `${change} reps`;
      if (key === 'weightKg') return `${change} ${units}`;
      if (key === 'rpe') return `RPE ${change}`;
      if (key === 'durationSeconds') return `${change} s`;
      return `${change} m`;
    });
  return parts.length > 0 ? parts.join(', ') : 'no visible change';
}

/** An instant as "Fri 30 Oct, 14:05" in `timeZone` (the client's): the edit window deadline, revision times. */
export function formatLocalDateTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone,
  }).format(new Date(iso));
}

/** S3-4: true while a client's edit window (`editableUntil` from the session detail) is still open. */
export const editWindowOpen = (editableUntil: string | null, now: Date = new Date()): boolean =>
  editableUntil !== null && Date.parse(editableUntil) > now.getTime();
