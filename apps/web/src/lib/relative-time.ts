const rtf = new Intl.RelativeTimeFormat('en-GB', { numeric: 'auto' });

/** "today", "yesterday", "3 days ago", "2 weeks ago": coarse on purpose, for lists. */
export function relativeDay(iso: string, now: Date = new Date()): string {
  const days = Math.round((new Date(iso).getTime() - now.getTime()) / 86_400_000);
  if (Math.abs(days) < 7) return rtf.format(days, 'day');
  if (Math.abs(days) < 35) return rtf.format(Math.round(days / 7), 'week');
  return rtf.format(Math.round(days / 30), 'month');
}

/** "Good morning" / "Good afternoon" / "Good evening" for an IANA time zone. */
export function greeting(timeZone: string, now: Date = new Date()): string {
  let hour = now.getUTCHours();
  try {
    hour = Number(
      new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone }).format(now),
    );
  } catch {
    // An unknown zone falls back to UTC.
  }
  return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
}

/** "Tuesday 3 November" in a time zone. */
export function longDay(timeZone: string, now: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      timeZone,
    }).format(now);
  } catch {
    return new Intl.DateTimeFormat('en-GB', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    }).format(now);
  }
}
