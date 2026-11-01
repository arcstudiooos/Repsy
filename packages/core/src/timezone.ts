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

/** Minutes `timeZone` is ahead of UTC at `at`. */
function offsetMinutes(timeZone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60_000);
}

/**
 * The instant a wall-clock time (`YYYY-MM-DD`, `HH:MM`) has in `timeZone` (PRD H5). A time skipped by a DST jump
 * resolves to the instant after the jump; a repeated one to its first occurrence. Null for malformed input.
 */
export function zonedTimeToUtc(
  localDate: string,
  localTime: string,
  timeZone: string,
): Date | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(localDate);
  const t = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(localTime);
  if (!d || !t) return null;
  const wall = Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3]), Number(t[1]), Number(t[2]));
  if (Number.isNaN(wall) || new Date(wall).toISOString().slice(0, 10) !== localDate) return null;
  // Two passes settle the offset across a DST change.
  const first = wall - offsetMinutes(timeZone, new Date(wall)) * 60_000;
  const second = wall - offsetMinutes(timeZone, new Date(first)) * 60_000;
  // In a skipped hour neither guess shows the asked wall time: take the later one (after the jump).
  const shows = (at: number) => at + offsetMinutes(timeZone, new Date(at)) * 60_000 === wall;
  return new Date(shows(second) ? second : Math.max(first, second));
}
