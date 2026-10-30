let zones: ReadonlySet<string> | undefined;

/**
 * The one time zone check (M2): the runtime's canonical IANA id for `tz`, or null when it is not a region zone.
 * Aliases resolve first (`Intl.DateTimeFormat#resolvedOptions`), so the names browsers send today (Asia/Kolkata,
 * Europe/Kyiv, Etc/UTC, any letter case) match the runtime's list even when that list uses the older spelling
 * (Asia/Calcutta, Europe/Kiev). Accepted results are `UTC` or a member of `Intl.supportedValuesOf('timeZone')`;
 * offset zones (`+05:30`), which resolve to themselves, are rejected explicitly.
 * Store the returned value, never the raw input, so one zone is always one string.
 */
export function canonicalTimezone(tz: unknown): string | null {
  if (typeof tz !== 'string' || tz.trim() === '' || tz !== tz.trim()) return null;
  let canonical: string;
  try {
    canonical = new Intl.DateTimeFormat('en', { timeZone: tz }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
  if (/^[+-]/.test(canonical)) return null;
  zones ??= new Set(Intl.supportedValuesOf('timeZone'));
  return canonical === 'UTC' || zones.has(canonical) ? canonical : null;
}

/** True when `canonicalTimezone` accepts `tz`. */
export function isIanaTimezone(tz: unknown): tz is string {
  return canonicalTimezone(tz) !== null;
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
