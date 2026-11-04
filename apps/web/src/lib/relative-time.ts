const rtf = new Intl.RelativeTimeFormat('en-GB', { numeric: 'auto' });

/** "today", "yesterday", "3 days ago", "2 weeks ago", "in 2 days": coarse on purpose, for lists. */
export function relativeDay(iso: string, now: Date = new Date()): string {
  const days = Math.round((new Date(iso).getTime() - now.getTime()) / 86_400_000);
  if (Math.abs(days) < 7) return rtf.format(days, 'day');
  if (Math.abs(days) < 35) return rtf.format(Math.round(days / 7), 'week');
  return rtf.format(Math.round(days / 30), 'month');
}

/** "Good morning" / "Good afternoon" / "Good evening" for an IANA time zone (UTC when it is unknown). */
export function greeting(timeZone: string, now: Date = new Date()): string {
  let hour = now.getUTCHours();
  try {
    hour = Number(
      new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone }).format(now),
    );
  } catch {
    // Unknown zone: UTC.
  }
  return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
}

/** "Tuesday 3 November" in a time zone. */
export function longDay(timeZone: string, now: Date = new Date()): string {
  const opts = { weekday: 'long', day: 'numeric', month: 'long' } as const;
  try {
    return new Intl.DateTimeFormat('en-GB', { ...opts, timeZone }).format(now);
  } catch {
    return new Intl.DateTimeFormat('en-GB', { ...opts, timeZone: 'UTC' }).format(now);
  }
}

/** "Mon", "Tue" for a YYYY-MM-DD local date. */
export const weekdayShort = (localDate: string) =>
  new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: 'UTC' }).format(
    new Date(`${localDate}T00:00:00Z`),
  );

/** "3 Nov" for a YYYY-MM-DD local date. */
export const dayMonth = (localDate: string) =>
  new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(
    new Date(`${localDate}T00:00:00Z`),
  );
