let zones: ReadonlySet<string> | undefined;

/**
 * The one time zone check (M2): true only for IANA names in `Intl.supportedValuesOf('timeZone')`, plus `UTC`, which
 * that list omits. Stricter than "Intl.DateTimeFormat accepts it" (which also takes offsets like `+05:30`).
 */
export function isIanaTimezone(tz: unknown): tz is string {
  if (typeof tz !== 'string') return false;
  zones ??= new Set(Intl.supportedValuesOf('timeZone'));
  return tz === 'UTC' || zones.has(tz);
}

/** The calendar date (YYYY-MM-DD) at `now` in `timeZone`. Throws RangeError for a zone Intl cannot use. */
export function todayInZone(timeZone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}
