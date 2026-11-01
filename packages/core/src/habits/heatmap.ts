/**
 * The coach's habit heat map (PRD G2): 12 weeks × 7 days for one client, built from the 84 days of logs a habit view
 * already carries. Pure: safe in the browser.
 */
export const HEATMAP_WEEKS = 12;

export interface HeatmapHabit {
  id: string;
  title: string;
  isTask: boolean;
  daysPerWeek: number | null;
  targetCount: number | null;
  startDate: string;
  endDate: string | null;
  logs: Record<string, number>;
}

export interface HeatmapDay {
  date: string;
  /** Habits active that day (within their dates); 0 before any started, and for days still to come. */
  active: number;
  /** Of those, how many met their target. */
  done: number;
  future: boolean;
}

export interface HabitHeatmap {
  /** Oldest week first; each Monday to Sunday. */
  weeks: { monday: string; days: HeatmapDay[] }[];
  /** Per habit over the 12 weeks: done of expected days (expected scales with days a week). */
  habits: { id: string; title: string; done: number; expected: number; percent: number | null }[];
}

const DAY = 86_400_000;
const add = (d: string, n: number) =>
  new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const mondayOf = (d: string) => add(d, -((new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7));

export function habitHeatmap(habits: HeatmapHabit[], today: string): HabitHeatmap {
  const tracked = habits.filter((h) => !h.isTask);
  const first = add(mondayOf(today), -7 * (HEATMAP_WEEKS - 1));
  const met = (h: HeatmapHabit, d: string) => (h.logs[d] ?? 0) >= (h.targetCount ?? 1);
  const activeOn = (h: HeatmapHabit, d: string) =>
    d >= h.startDate && (h.endDate === null || d <= h.endDate);

  const weeks: HabitHeatmap['weeks'] = [];
  for (let w = 0; w < HEATMAP_WEEKS; w++) {
    const monday = add(first, 7 * w);
    const days: HeatmapDay[] = [];
    for (let i = 0; i < 7; i++) {
      const date = add(monday, i);
      const future = date > today;
      const on = future ? [] : tracked.filter((h) => activeOn(h, date));
      days.push({ date, future, active: on.length, done: on.filter((h) => met(h, date)).length });
    }
    weeks.push({ monday, days });
  }

  const per = tracked.map((h) => {
    let activeDays = 0;
    let done = 0;
    for (let d = first; d <= today; d = add(d, 1)) {
      if (!activeOn(h, d)) continue;
      activeDays += 1;
      if (met(h, d)) done += 1;
    }
    const expected = Math.round((activeDays * (h.daysPerWeek ?? 7)) / 7);
    const capped = Math.min(done, expected);
    return {
      id: h.id,
      title: h.title,
      done: capped,
      expected,
      percent: expected > 0 ? Math.round((capped / expected) * 100) : null,
    };
  });
  return { weeks, habits: per };
}
