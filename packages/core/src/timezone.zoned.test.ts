import { describe, expect, it } from 'vitest';
import { zonedTimeToUtc } from './timezone';

describe('zonedTimeToUtc (PRD H5)', () => {
  it('converts wall-clock times, across DST changes', () => {
    expect(zonedTimeToUtc('2026-11-04', '09:30', 'America/New_York')?.toISOString()).toBe(
      '2026-11-04T14:30:00.000Z',
    );
    expect(zonedTimeToUtc('2026-07-04', '09:30', 'America/New_York')?.toISOString()).toBe(
      '2026-07-04T13:30:00.000Z',
    );
    expect(zonedTimeToUtc('2026-11-04', '18:00', 'Asia/Kolkata')?.toISOString()).toBe(
      '2026-11-04T12:30:00.000Z',
    );
    // 02:30 doesn't exist on 2026-03-08 in New York: the instant after the jump.
    expect(zonedTimeToUtc('2026-03-08', '02:30', 'America/New_York')?.toISOString()).toBe(
      '2026-03-08T07:30:00.000Z',
    );
  });

  it('refuses malformed dates and times', () => {
    expect(zonedTimeToUtc('2026-02-30', '09:00', 'UTC')).toBeNull();
    expect(zonedTimeToUtc('2026-11-04', '24:00', 'UTC')).toBeNull();
    expect(zonedTimeToUtc('soon', '09:00', 'UTC')).toBeNull();
  });
});
