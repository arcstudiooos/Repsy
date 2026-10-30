/** ISO weekdays: 1 = Monday ... 7 = Sunday. */
export const WEEKDAYS = [
  { value: 1, short: 'Mon', long: 'Monday' },
  { value: 2, short: 'Tue', long: 'Tuesday' },
  { value: 3, short: 'Wed', long: 'Wednesday' },
  { value: 4, short: 'Thu', long: 'Thursday' },
  { value: 5, short: 'Fri', long: 'Friday' },
  { value: 6, short: 'Sat', long: 'Saturday' },
  { value: 7, short: 'Sun', long: 'Sunday' },
] as const;

/** Mon to Sun, whatever order the days were stored in. */
export function formatWeekdays(days: readonly number[]): string {
  return WEEKDAYS.filter((d) => days.includes(d.value))
    .map((d) => d.short)
    .join(', ');
}

export function weekdayError(daysPerWeek: number, selected: readonly number[]): string | null {
  return selected.length === daysPerWeek ? null : `Choose ${daysPerWeek} training days.`;
}

/** Today's calendar date (YYYY-MM-DD) in a time zone; falls back to UTC for an unknown zone. */
export function todayInZone(timeZone: string, now: Date = new Date()): string {
  const format = (zone: string) =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
  try {
    return format(timeZone);
  } catch {
    return format('UTC');
  }
}

export const READINESS_ERROR = 'Confirm this client is ready to start this program.';

export interface AssignFieldErrors {
  errors: Record<string, string>;
  /** The server wants the readiness confirmation even though the form did not show it. */
  needsReadiness: boolean;
}

/** Maps a 422 `fieldErrors` payload from the assign route to form errors. */
export function mapAssignFieldErrors(fe: Record<string, string[] | undefined>): AssignFieldErrors {
  const errors: Record<string, string> = {};
  if (fe.readinessConfirmed?.[0]) errors.readiness = READINESS_ERROR;
  if (fe.weekdays?.[0]) errors.weekdays = fe.weekdays[0];
  if (fe.startLocalDate?.[0]) errors.startDate = fe.startLocalDate[0];
  if (fe.templateProgramId?.[0]) errors.template = fe.templateProgramId[0];
  return { errors, needsReadiness: Boolean(errors.readiness) };
}
