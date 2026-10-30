import { describe, expect, it } from 'vitest';
import { formatLoggedSet, formatSessionDate, sessionStateLabel } from './session-format';

describe('formatSessionDate', () => {
  it('names nearby days and formats the rest without a time zone shift', () => {
    expect(formatSessionDate('2026-11-04', '2026-11-04')).toBe('Today');
    expect(formatSessionDate('2026-11-05', '2026-11-04')).toBe('Tomorrow');
    expect(formatSessionDate('2026-11-03', '2026-11-04')).toBe('Yesterday');
    // DST-end day in New York: still the stored calendar date.
    expect(formatSessionDate('2026-11-01', '2026-11-04')).toBe('Sun 1 Nov');
    expect(formatSessionDate('2027-01-02', '2026-12-31')).toBe('Sat 2 Jan');
  });

  it('does not depend on the process time zone', () => {
    const original = process.env.TZ;
    try {
      for (const tz of ['Pacific/Kiritimati', 'Pacific/Pago_Pago', 'America/New_York']) {
        process.env.TZ = tz;
        expect(formatSessionDate('2026-11-01', '2026-11-04')).toBe('Sun 1 Nov');
      }
    } finally {
      process.env.TZ = original;
    }
  });
});

describe('sessionStateLabel', () => {
  it('shows Overdue only for open sessions', () => {
    expect(sessionStateLabel('scheduled', true)).toBe('Overdue');
    expect(sessionStateLabel('in_progress', true)).toBe('Overdue');
    expect(sessionStateLabel('completed', true)).toBe('Completed');
    expect(sessionStateLabel('in_progress', false)).toBe('In progress');
  });
});

describe('formatLoggedSet (builder performance rail)', () => {
  const set = (over: Partial<Parameters<typeof formatLoggedSet>[0]>) => ({
    setIndex: 0,
    reps: null,
    weightKg: null,
    rpe: null,
    durationSeconds: null,
    distanceM: null,
    ...over,
  });
  it('reps × load in the coach units; partial and other tracking types; a cleared set is null', () => {
    expect(formatLoggedSet(set({ reps: 5, weightKg: 60 }), 'kg')).toBe('5 × 60 kg');
    expect(formatLoggedSet(set({ reps: 5, weightKg: 100 }), 'lb')).toBe('5 × 220.5 lb');
    expect(formatLoggedSet(set({ reps: 8 }), 'kg')).toBe('8 reps');
    expect(formatLoggedSet(set({ weightKg: 20 }), 'kg')).toBe('20 kg');
    expect(formatLoggedSet(set({ durationSeconds: 45 }), 'kg')).toBe('45 s');
    expect(formatLoggedSet(set({ distanceM: 1000 }), 'kg')).toBe('1000 m');
    expect(formatLoggedSet(set({}), 'kg')).toBeNull();
  });
});
