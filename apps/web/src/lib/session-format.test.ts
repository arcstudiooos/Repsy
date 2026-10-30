import { describe, expect, it } from 'vitest';
import { formatSessionDate, sessionStateLabel } from './session-format';

describe('formatSessionDate', () => {
  it('names nearby days and formats the rest without a time zone shift', () => {
    expect(formatSessionDate('2026-11-04', '2026-11-04')).toBe('Today');
    expect(formatSessionDate('2026-11-05', '2026-11-04')).toBe('Tomorrow');
    expect(formatSessionDate('2026-11-03', '2026-11-04')).toBe('Yesterday');
    // DST-end day in New York: still the stored calendar date.
    expect(formatSessionDate('2026-11-01', '2026-11-04')).toBe('Sun 1 Nov');
    expect(formatSessionDate('2027-01-02', '2026-12-31')).toBe('Sat 2 Jan');
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
