import { describe, expect, it } from 'vitest';
import { canonicalTimezone, isIanaTimezone, todayInZone } from './timezone';

const supported = new Set(Intl.supportedValuesOf('timeZone'));

describe('canonicalTimezone / isIanaTimezone', () => {
  it('accepts IANA zones and UTC', () => {
    for (const z of ['UTC', 'Europe/London', 'America/New_York', 'Asia/Tokyo']) {
      expect(isIanaTimezone(z)).toBe(true);
      expect(canonicalTimezone(z)).toBe(z);
    }
  });

  it('accepts current names that browsers send, whatever the runtime lists (aliases resolve to one canonical id)', () => {
    const pairs: [string, string][] = [
      ['Asia/Kolkata', 'Asia/Calcutta'],
      ['Europe/Kyiv', 'Europe/Kiev'],
      ['Asia/Ho_Chi_Minh', 'Asia/Saigon'],
      ['America/Nuuk', 'America/Godthab'],
      ['Pacific/Kanton', 'Pacific/Enderbury'],
    ];
    for (const [current, legacy] of pairs) {
      expect(isIanaTimezone(current)).toBe(true);
      expect(isIanaTimezone(legacy)).toBe(true);
      const c = canonicalTimezone(current);
      expect(c).toBe(canonicalTimezone(legacy));
      expect(supported.has(c as string)).toBe(true);
    }
  });

  it('canonicalizes Etc/UTC and letter case', () => {
    expect(canonicalTimezone('Etc/UTC')).toBe('UTC');
    expect(canonicalTimezone('europe/london')).toBe('Europe/London');
    expect(isIanaTimezone('europe/london')).toBe(true);
  });

  it('rejects offsets, junk, blanks and non-strings', () => {
    for (const z of [
      '+05:30',
      '-08:00',
      '-0800',
      'Not/AZone',
      'Mars/Olympus',
      '',
      ' ',
      42,
      null,
      undefined,
    ]) {
      expect(canonicalTimezone(z)).toBeNull();
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
