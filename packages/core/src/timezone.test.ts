import { describe, expect, it } from 'vitest';
import { isIanaTimezone, todayInZone } from './timezone';

describe('isIanaTimezone', () => {
  it('accepts IANA zones and UTC', () => {
    for (const z of ['UTC', 'Europe/London', 'America/New_York', 'Asia/Tokyo']) {
      expect(isIanaTimezone(z)).toBe(true);
    }
  });
  it('rejects offsets, junk, blanks and non-strings that Intl.DateTimeFormat would partly accept', () => {
    for (const z of [
      '+05:30',
      '-0800',
      'utc ',
      '',
      ' ',
      'Mars/Olympus',
      'europe/london',
      42,
      null,
    ]) {
      expect(isIanaTimezone(z)).toBe(false);
    }
  });
});

describe('todayInZone', () => {
  it('is the local calendar date at the instant', () => {
    const now = new Date('2026-03-01T23:30:00Z');
    expect(todayInZone('UTC', now)).toBe('2026-03-01');
    expect(todayInZone('Asia/Tokyo', now)).toBe('2026-03-02');
    expect(todayInZone('America/Los_Angeles', now)).toBe('2026-03-01');
  });
});
