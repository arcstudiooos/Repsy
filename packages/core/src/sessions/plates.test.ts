import { describe, expect, it } from 'vitest';
import { convertWeight, plateBreakdown } from './plates';

describe('plate helper (PRD D18)', () => {
  it('loads each side from the heaviest plate', () => {
    expect(plateBreakdown(100, 'kg')).toEqual({
      perSide: [
        [25, 1],
        [15, 1],
      ],
      loaded: 100,
      remainder: 0,
    });
    expect(plateBreakdown(102.5, 'kg')?.perSide).toEqual([
      [25, 1],
      [15, 1],
      [1.25, 1],
    ]);
    expect(plateBreakdown(225, 'lb')?.perSide).toEqual([[45, 2]]);
    expect(plateBreakdown(20, 'kg')).toEqual({ perSide: [], loaded: 20, remainder: 0 });
  });

  it('reports what the plates cannot make, and refuses less than the bar', () => {
    expect(plateBreakdown(101.3, 'kg')).toMatchObject({ loaded: 101, remainder: 0.3 });
    expect(plateBreakdown(15, 'kg')).toBeNull();
    expect(plateBreakdown(Number.NaN, 'kg')).toBeNull();
    expect(plateBreakdown(60, 'kg', 15)?.perSide).toEqual([
      [20, 1],
      [2.5, 1],
    ]);
  });

  it('converts between kg and lb', () => {
    expect(convertWeight(100, 'kg')).toBe(220.5);
    expect(convertWeight(225, 'lb')).toBe(102.1);
  });
});
