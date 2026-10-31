/** Pure helpers for progress trend charts (PRD E2). Dates are client-local YYYY-MM-DD strings. */

export interface TrendPoint {
  date: string;
  value: number;
}

export const RANGES = [4, 12, 26, 52] as const;
export type RangeWeeks = (typeof RANGES)[number];

const DAY_MS = 86_400_000;
const t = (d: string) => Date.parse(`${d}T00:00:00Z`);
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** The first day shown for a range ending today: `weeks` weeks back, today included. */
export function rangeStart(today: string, weeks: number): string {
  return iso(t(today) - (weeks * 7 - 1) * DAY_MS);
}

/** Points on or after `start`, oldest first. */
export function inRange(points: TrendPoint[], start: string): TrendPoint[] {
  return points.filter((p) => p.date >= start).sort((a, b) => (a.date < b.date ? -1 : 1));
}

/**
 * The trailing average at each point: the mean of every reading in the `days` days ending on that date (the date
 * included), rounded to one decimal. Readings before the visible range still count, so pass the full history.
 */
export function trailingAverage(points: TrendPoint[], days = 7): TrendPoint[] {
  const sorted = [...points].sort((a, b) => (a.date < b.date ? -1 : 1));
  return sorted.map((p) => {
    const from = t(p.date) - (days - 1) * DAY_MS;
    const window = sorted.filter((q) => t(q.date) >= from && q.date <= p.date);
    const mean = window.reduce((s, q) => s + q.value, 0) / window.length;
    return { date: p.date, value: Math.round(mean * 10) / 10 };
  });
}

/** About `count` clean y-axis ticks (1, 2, 2.5 or 5 × 10^n steps) covering min..max. */
export function niceTicks(min: number, max: number, count = 4): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (min === max) {
    const pad = Math.abs(min) > 0 ? Math.abs(min) * 0.05 : 1;
    min -= pad;
    max += pad;
  }
  const raw = (max - min) / Math.max(1, count);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 2.5, 5, 10].find((m) => m * mag >= raw) ?? 10) * mag;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v * 1000) / 1000);
  return ticks;
}

/** Days between two dates (b - a). */
export const daysBetween = (a: string, b: string) => Math.round((t(b) - t(a)) / DAY_MS);
