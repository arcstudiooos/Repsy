import { describe, expect, it } from 'vitest';
import { formatWeekdays, mapAssignFieldErrors, todayInZone, weekdayError } from './assign-form';

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

describe('mapAssignFieldErrors', () => {
  it('maps readiness and flags that the checkbox must be shown', () => {
    const r = mapAssignFieldErrors({ readinessConfirmed: ['x'], weekdays: ['Pick days.'] });
    expect(r.errors).toEqual({
      readiness: 'Confirm this client is ready to start this program.',
      weekdays: 'Pick days.',
    });
    expect(r.needsReadiness).toBe(true);
  });

  it('maps the other fields without forcing readiness', () => {
    const r = mapAssignFieldErrors({ startLocalDate: ['Bad.'], templateProgramId: ['Save it.'] });
    expect(r.errors).toEqual({ startDate: 'Bad.', template: 'Save it.' });
    expect(r.needsReadiness).toBe(false);
  });
});
