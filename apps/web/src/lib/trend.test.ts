import { describe, expect, it } from 'vitest';
import { inRange, niceTicks, rangeStart, trailingAverage } from './trend';

describe('trend helpers (PRD E2)', () => {
  it('ranges end today and include it', () => {
    expect(rangeStart('2026-10-31', 4)).toBe('2026-10-04');
    expect(rangeStart('2026-10-31', 52)).toBe('2025-11-02');
    expect(
      inRange(
        [
          { date: '2026-10-10', value: 2 },
          { date: '2026-10-03', value: 1 },
          { date: '2026-10-04', value: 3 },
        ],
        '2026-10-04',
      ).map((p) => p.date),
    ).toEqual(['2026-10-04', '2026-10-10']);
  });

  it('averages the 7 days ending on each reading, counting earlier history', () => {
    const avg = trailingAverage([
      { date: '2026-10-01', value: 80 },
      { date: '2026-10-04', value: 81 },
      { date: '2026-10-07', value: 79 },
      { date: '2026-10-08', value: 78 },
    ]);
    expect(avg).toEqual([
      { date: '2026-10-01', value: 80 },
      { date: '2026-10-04', value: 80.5 },
      { date: '2026-10-07', value: 80 },
      // 1 Oct is 7 days back from 8 Oct, so it drops out.
      { date: '2026-10-08', value: 79.3 },
    ]);
  });

  it('picks clean ticks', () => {
    expect(niceTicks(78.2, 83.9)).toEqual([78, 80, 82, 84]);
    expect(niceTicks(0, 100)).toEqual([0, 25, 50, 75, 100]);
    expect(niceTicks(80, 80)).toEqual([76, 78, 80, 82, 84]);
  });
});
