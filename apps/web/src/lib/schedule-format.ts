/** Times and labels for sessions (PRD K10). Client-safe: no database code. */
export const SESSION_KIND_LABEL: Record<string, string> = {
  call: 'Video or phone call',
  checkin_call: 'Check-in call',
  in_person: 'In person',
};

export const BOOKING_STATUS_LABEL: Record<string, string> = {
  booked: 'Booked',
  canceled: 'Cancelled',
  completed: 'Done',
  no_show: 'Missed',
};

export function formatWhen(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone,
  }).format(new Date(iso));
}

export function formatTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone,
  }).format(new Date(iso));
}

export function dayKey(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone,
  }).format(new Date(iso));
}

export function formatDayLabel(key: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(`${key}T00:00:00Z`));
}
