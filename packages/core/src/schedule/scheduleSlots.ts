import { TZDate } from '@date-fns/tz';
import { canonicalTimezone } from '../timezone';
import type { ScheduledSlot, ScheduleSlotsInput } from './types';

export class ScheduleInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScheduleInputError';
  }
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

function parseLocalDate(
  s: string,
  field = 'startLocalDate',
): { y: number; m: number; d: number; utcMs: number } {
  const match = DATE_RE.exec(s);
  if (!match) throw new ScheduleInputError(`${field} must be YYYY-MM-DD`);
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const utcMs = Date.UTC(y, m - 1, d);
  const check = new Date(utcMs);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) {
    throw new ScheduleInputError(`${field} is not a real calendar date`);
  }
  return { y, m, d, utcMs };
}

/** The canonical id of a valid IANA zone (aliases resolve), else ScheduleInputError. */
function resolveTimeZone(timeZone: string): string {
  const zone = canonicalTimezone(timeZone);
  if (!zone) throw new ScheduleInputError(`Invalid time zone: ${timeZone}`);
  return zone;
}

/** ISO weekday (Mon=1..Sun=7) of a UTC-midnight calendar date. */
function isoWeekday(utcMs: number): number {
  const dow = new Date(utcMs).getUTCDay();
  return dow === 0 ? 7 : dow;
}

function pad(n: number, w = 2): string {
  return String(n).padStart(w, '0');
}

/** UTC offset (ms) of `timeZone` at the given instant. */
function offsetMs(instantMs: number, timeZone: string): number {
  return -new TZDate(instantMs, timeZone).getTimezoneOffset() * 60_000;
}

/** Wall-clock fields of the instant in `timeZone`, expressed as a UTC-epoch ms. */
function wallMs(instantMs: number, timeZone: string): number {
  const t = new TZDate(instantMs, timeZone);
  return Date.UTC(
    t.getFullYear(),
    t.getMonth(),
    t.getDate(),
    t.getHours(),
    t.getMinutes(),
    t.getSeconds(),
    t.getMilliseconds(),
  );
}

/**
 * Resolve local wall time y-m-d h:min in `timeZone` to a UTC instant, deterministically:
 * - normal time: the single matching instant;
 * - ambiguous (DST fold, wall time occurs twice): the FIRST (earlier) occurrence;
 * - non-existent (DST gap): the transition instant, i.e. the next valid local time.
 * Candidates are wall - offset for each offset in effect within a day either side; a
 * candidate is valid when it maps back to the same wall time.
 */
function localInstant(
  y: number,
  m: number,
  d: number,
  h: number,
  min: number,
  timeZone: string,
): Date {
  const wall = Date.UTC(y, m - 1, d, h, min, 0, 0);
  const offsets = new Set<number>();
  for (const k of [-1, 0, 1]) offsets.add(offsetMs(wall + k * DAY_MS, timeZone));
  const candidates = [...offsets].map((o) => wall - o).sort((a, b) => a - b);
  const valid = candidates.filter((c) => wallMs(c, timeZone) === wall);
  const picked = valid.length > 0 ? valid[0]! : candidates[candidates.length - 1]!;
  const date = new Date(picked);
  if (Number.isNaN(date.getTime())) throw new ScheduleInputError(`Invalid time zone: ${timeZone}`);
  return date;
}

/**
 * 00:00 and 23:59 local on `localDate` (YYYY-MM-DD) in `timeZone`, as UTC instants, with the same DST rules as
 * `scheduleSlots` (gap: next valid local time; fold: first occurrence). Throws ScheduleInputError for a bad date or
 * zone.
 */
export function localDayBounds(
  localDate: string,
  timeZone: string,
): { scheduledAtUtc: Date; dueAtUtc: Date } {
  const zone = resolveTimeZone(timeZone);
  const { y, m, d } = parseLocalDate(localDate, 'localDate');
  return {
    scheduledAtUtc: localInstant(y, m, d, 0, 0, zone),
    dueAtUtc: localInstant(y, m, d, 23, 59, zone),
  };
}

/**
 * Fill ordered program slots onto selected weekdays (D-010 #1). Pure and DST-correct:
 * dates are walked as calendar dates, then converted to UTC per local day.
 */
export function scheduleSlots(input: ScheduleSlotsInput): ScheduledSlot[] {
  const { slots, weekdays, startLocalDate } = input;
  const timeZone = resolveTimeZone(input.timeZone);
  const start = parseLocalDate(startLocalDate);

  if (new Set(weekdays).size !== weekdays.length) {
    throw new ScheduleInputError('weekdays must be distinct');
  }
  if (weekdays.some((w) => !Number.isInteger(w) || w < 1 || w > 7)) {
    throw new ScheduleInputError('weekdays must be ISO weekdays 1-7');
  }

  const seen = new Set<string>();
  for (const { weekIndex, dayIndex } of slots) {
    if (
      !Number.isInteger(weekIndex) ||
      weekIndex < 0 ||
      !Number.isInteger(dayIndex) ||
      dayIndex < 0
    ) {
      throw new ScheduleInputError('slot indices must be non-negative integers');
    }
    const key = `${weekIndex}:${dayIndex}`;
    if (seen.has(key)) throw new ScheduleInputError('duplicate slot key');
    seen.add(key);
  }

  const perWeek = new Map<number, number>();
  for (const s of slots) perWeek.set(s.weekIndex, (perWeek.get(s.weekIndex) ?? 0) + 1);
  for (const count of perWeek.values()) {
    if (count !== weekdays.length) {
      throw new ScheduleInputError(
        'weekday count must equal the number of training days in every week',
      );
    }
  }

  const sortedSlots = [...slots].sort(
    (a, b) => a.weekIndex - b.weekIndex || a.dayIndex - b.dayIndex,
  );
  const selected = new Set<number>(weekdays);
  const out: ScheduledSlot[] = [];

  let cursor = start.utcMs;
  for (const slot of sortedSlots) {
    // Advance to the next selected weekday on or after the cursor.
    while (!selected.has(isoWeekday(cursor))) cursor += DAY_MS;
    const dt = new Date(cursor);
    const localDate = `${pad(dt.getUTCFullYear(), 4)}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
    out.push({ slot, localDate, ...localDayBounds(localDate, timeZone) });
    cursor += DAY_MS;
  }
  return out;
}
