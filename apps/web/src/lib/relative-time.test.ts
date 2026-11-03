import { describe, expect, it } from 'vitest';
import { greeting, longDay, relativeDay } from './relative-time';

describe('relative time', () => {
  const now = new Date('2026-11-03T09:00:00Z');
  it('relativeDay is coarse', () => {
    expect(relativeDay('2026-11-03T08:00:00Z', now)).toBe('today');
    expect(relativeDay('2026-11-02T09:00:00Z', now)).toBe('yesterday');
    expect(relativeDay('2026-10-31T09:00:00Z', now)).toBe('3 days ago');
    expect(relativeDay('2026-10-20T09:00:00Z', now)).toBe('2 weeks ago');
  });
  it('greeting follows the time zone', () => {
    expect(greeting('UTC', now)).toBe('Good morning');
    expect(greeting('Asia/Kolkata', now)).toBe('Good afternoon');
    expect(greeting('Not/AZone', now)).toBe('Good morning');
  });
  it('longDay', () => {
    expect(longDay('UTC', now)).toBe('Tuesday 3 November');
  });
});
