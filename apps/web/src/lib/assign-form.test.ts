import { describe, expect, it } from 'vitest';
import { formatWeekdays, todayInZone, weekdayError } from './assign-form';

describe('assign form helpers', () => {
  it('formats weekdays Mon to Sun regardless of stored order', () => {
    expect(formatWeekdays([5, 1, 3])).toBe('Mon, Wed, Fri');
    expect(formatWeekdays([7, 2, 1])).toBe('Mon, Tue, Sun');
  });

  it('asks for exactly n training days', () => {
    expect(weekdayError(2, [1])).toBe('Choose 2 training days.');
    expect(weekdayError(2, [1, 2, 3])).toBe('Choose 2 training days.');
    expect(weekdayError(1, [])).toBe('Choose 1 training days.');
    expect(weekdayError(2, [1, 4])).toBeNull();
  });

  it('gives today as a calendar date in the given zone', () => {
    const instant = new Date('2026-01-01T23:30:00Z');
    expect(todayInZone('Pacific/Auckland', instant)).toBe('2026-01-02');
    expect(todayInZone('America/Los_Angeles', instant)).toBe('2026-01-01');
    expect(todayInZone('Not/AZone', instant)).toBe('2026-01-01');
  });
});
