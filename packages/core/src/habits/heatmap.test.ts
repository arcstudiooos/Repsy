import { describe, expect, it } from 'vitest';
import { habitHeatmap } from './heatmap';

const habit = (over: Partial<Parameters<typeof habitHeatmap>[0][number]> = {}) => ({
  id: 'h1',
  title: 'Water',
  isTask: false,
  daysPerWeek: 7,
  targetCount: 8,
  startDate: '2026-10-01',
  endDate: null,
  logs: {},
  ...over,
});

describe('habit heat map (PRD G2)', () => {
  it('lays out 12 Monday-Sunday weeks ending this week, counting habits met per day', () => {
    // 2026-11-04 is a Wednesday.
    const map = habitHeatmap(
      [
        habit({ logs: { '2026-11-02': 8, '2026-11-03': 5 } }),
        habit({ id: 'h2', title: 'Walk', targetCount: null, logs: { '2026-11-02': 1 } }),
        habit({ id: 't', title: 'Task', isTask: true, logs: { '2026-11-02': 1 } }),
      ],
      '2026-11-04',
    );
    expect(map.weeks).toHaveLength(12);
    expect(map.weeks[0]!.monday).toBe('2026-08-17');
    const thisWeek = map.weeks[11]!;
    expect(thisWeek.monday).toBe('2026-11-02');
    expect(thisWeek.days.slice(0, 4).map((d) => [d.done, d.active, d.future])).toEqual([
      [2, 2, false],
      [0, 2, false],
      [0, 2, false],
      [0, 0, true],
    ]);
    // Before the habits started: nothing active.
    expect(map.weeks[0]!.days[0]).toMatchObject({ active: 0, done: 0 });
    expect(map.habits.map((h) => h.id)).toEqual(['h1', 'h2']);
  });

  it('scales the expected days by days a week', () => {
    const logs: Record<string, number> = {};
    for (const d of ['2026-10-26', '2026-10-28', '2026-10-30', '2026-11-02']) logs[d] = 1;
    const map = habitHeatmap(
      [habit({ daysPerWeek: 3, targetCount: null, startDate: '2026-10-26', logs })],
      '2026-11-04',
    );
    // 10 active days × 3/7 ≈ 4 expected; 4 done.
    expect(map.habits[0]).toMatchObject({ done: 4, expected: 4, percent: 100 });
  });
});
