import { TZDate } from '@date-fns/tz';
import type { ScheduledSlot, ScheduleSlotsInput } from './types';

export class ScheduleInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScheduleInputError';
  }
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

function parseLocalDate(s: string): { y: number; m: number; d: number; utcMs: number } {
  const match = DATE_RE.exec(s);
  if (!match) throw new ScheduleInputError('startLocalDate must be YYYY-MM-DD');
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const utcMs = Date.UTC(y, m - 1, d);
  const check = new Date(utcMs);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) {
    throw new ScheduleInputError('startLocalDate is not a real calendar date');
  }
  return { y, m, d, utcMs };
}

function assertTimeZone(timeZone: string): void {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
  } catch {
    throw new ScheduleInputError(`Invalid time zone: ${timeZone}`);
  }
}

/** ISO weekday (Mon=1..Sun=7) of a UTC-midnight calendar date. */
function isoWeekday(utcMs: number): number {
  const dow = new Date(utcMs).getUTCDay();
  return dow === 0 ? 7 : dow;
}

function pad(n: number, w = 2): string {
  return String(n).padStart(w, '0');
}

function localInstant(
  y: number,
  m: number,
  d: number,
  h: number,
  min: number,
  timeZone: string,
): Date {
  const t = new TZDate(y, m - 1, d, h, min, 0, 0, timeZone);
  const date = new Date(t.getTime());
  if (Number.isNaN(date.getTime())) throw new ScheduleInputError(`Invalid time zone: ${timeZone}`);
  return date;
}

/**
 * Fill ordered program slots onto selected weekdays (D-010 #1). Pure and DST-correct:
 * dates are walked as calendar dates, then converted to UTC per local day.
 */
export function scheduleSlots(input: ScheduleSlotsInput): ScheduledSlot[] {
  const { slots, weekdays, startLocalDate, timeZone } = input;
  assertTimeZone(timeZone);
  const start = parseLocalDate(startLocalDate);

  if (new Set(weekdays).size !== weekdays.length) {
    throw new ScheduleInputError('weekdays must be distinct');
  }
  if (weekdays.some((w) => !Number.isInteger(w) || w < 1 || w > 7)) {
    throw new ScheduleInputError('weekdays must be ISO weekdays 1-7');
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
  if (slots.length > 0 && weekdays.length === 0) {
    throw new ScheduleInputError('weekdays required');
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
    const y = dt.getUTCFullYear();
    const m = dt.getUTCMonth() + 1;
    const d = dt.getUTCDate();
    out.push({
      slot,
      localDate: `${pad(y, 4)}-${pad(m)}-${pad(d)}`,
      scheduledAtUtc: localInstant(y, m, d, 0, 0, timeZone),
      dueAtUtc: localInstant(y, m, d, 23, 59, timeZone),
    });
    cursor += DAY_MS;
  }
  return out;
}
