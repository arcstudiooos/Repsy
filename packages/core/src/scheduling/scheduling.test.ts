import { describe, expect, it } from 'vitest';
import {
  generateVerificationToken,
  isValidHostname,
  resolveWorkspaceByHost,
} from '../domains/domains';
import { packBalance, packStatusOf } from './packs';
import { generateSlots, spansOverlap, validateCallLink } from './scheduling';
import { cleanJourneySteps, renewalReminderDate } from './journeys';

/**
 * Pure-logic tests only: no database, no network, no provider. Slot math,
 * buffers, call-link validation, pack balances, domain tokens and journey
 * date math are all computed in memory here.
 */
const AVAIL = [{ weekday: 1, startTime: '09:00', endTime: '12:00' }];

const hourInZone = (d: Date, timeZone: string) =>
  Number(
    new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone }).format(d),
  );

describe('generateSlots', () => {
  it('chops a window into duration + bufferAfter steps', () => {
    // 09:00-12:00, 60-minute sessions, 15-minute buffer after: 09:00, 10:15, 11:30 would
    // overrun, so only 09:00 and 10:15 fit.
    const slots = generateSlots({
      availability: AVAIL,
      dateFrom: '2026-11-02', // a Monday
      dateTo: '2026-11-02',
      timeZone: 'UTC',
      durationMinutes: 60,
      bufferAfterMinutes: 15,
    });
    expect(slots.map((s) => s.start.toISOString())).toEqual([
      '2026-11-02T09:00:00.000Z',
      '2026-11-02T10:15:00.000Z',
    ]);
  });

  it('drops slots that clash with a booking expanded by buffers', () => {
    const slots = generateSlots({
      availability: AVAIL,
      dateFrom: '2026-11-02',
      dateTo: '2026-11-02',
      timeZone: 'UTC',
      durationMinutes: 60,
      bufferBeforeMinutes: 15,
      bufferAfterMinutes: 15,
      existingBookings: [
        { startsAt: new Date('2026-11-02T10:00:00Z'), endsAt: new Date('2026-11-02T11:00:00Z') },
      ],
    });
    // 09:00 would end at 10:00, inside the 15-minute buffer before 10:00; 11:00 starts
    // inside the 15-minute buffer after 11:00. Only a slot clear of both survives — none here.
    expect(slots).toEqual([]);
  });

  it('keeps the local time across a DST spring-forward', () => {
    // 2026-03-08: US clocks jump forward. A 09:00 slot must still be 09:00 local on both days.
    const slots = generateSlots({
      availability: [{ weekday: 7, startTime: '09:00', endTime: '10:00' }],
      dateFrom: '2026-03-01',
      dateTo: '2026-03-08',
      timeZone: 'America/New_York',
      durationMinutes: 60,
    });
    expect(slots).toHaveLength(2);
    for (const s of slots) expect(hourInZone(s.start, 'America/New_York')).toBe(9);
    // And the UTC instant really does shift by an hour across the change.
    expect(slots[0]!.start.toISOString()).toBe('2026-03-01T14:00:00.000Z');
    expect(slots[1]!.start.toISOString()).toBe('2026-03-08T13:00:00.000Z');
  });

  it('rejects a bad zone, a reversed range, and a bad duration', () => {
    const base = {
      availability: AVAIL,
      dateFrom: '2026-11-02',
      dateTo: '2026-11-02',
      timeZone: 'UTC',
      durationMinutes: 60,
    };
    expect(() => generateSlots({ ...base, timeZone: 'Mars/Olympus' })).toThrow();
    expect(() => generateSlots({ ...base, dateTo: '2026-11-01' })).toThrow();
    expect(() => generateSlots({ ...base, durationMinutes: 3 })).toThrow();
  });
});

describe('spansOverlap', () => {
  it('touching spans do not overlap', () => {
    const a = new Date('2026-11-02T09:00:00Z');
    const b = new Date('2026-11-02T10:00:00Z');
    expect(spansOverlap(a, b, b, new Date('2026-11-02T11:00:00Z'))).toBe(false);
    expect(spansOverlap(a, b, new Date('2026-11-02T09:30:00Z'), b)).toBe(true);
  });
});

describe('validateCallLink (H15)', () => {
  it('accepts http/https links and empties', () => {
    expect(validateCallLink('https://zoom.us/j/123')).toBe('https://zoom.us/j/123');
    expect(validateCallLink('https://meet.google.com/abc-defg-hij')).toBe(
      'https://meet.google.com/abc-defg-hij',
    );
    expect(validateCallLink(null)).toBeNull();
    expect(validateCallLink('')).toBeNull();
  });

  it('rejects ftp, javascript:, and bare hostnames', () => {
    for (const bad of [
      'ftp://example.com/x',
      'javascript:alert(1)',
      'zoom.us/j/123',
      'not a link',
    ]) {
      expect(() => validateCallLink(bad)).toThrow();
    }
  });
});

describe('pack balance (K11)', () => {
  it('counts down and never goes negative', () => {
    expect(packBalance(10, 0)).toBe(10);
    expect(packBalance(10, 3)).toBe(7);
    expect(packBalance(10, 12)).toBe(0);
  });

  it('reports exhausted and expired states', () => {
    const now = new Date('2026-11-03T00:00:00Z');
    expect(packStatusOf({ totalSessions: 10, usedSessions: 10, expiresAt: null }, now)).toBe(
      'exhausted',
    );
    expect(
      packStatusOf(
        { totalSessions: 10, usedSessions: 0, expiresAt: new Date('2026-11-01T00:00:00Z') },
        now,
      ),
    ).toBe('expired');
    expect(packStatusOf({ totalSessions: 10, usedSessions: 0, expiresAt: null }, now)).toBe(
      'active',
    );
  });
});

describe('custom domains (L4, pure helpers)', () => {
  it('issues tokens in the kinetic-verify-<32 hex> format', () => {
    expect(generateVerificationToken()).toMatch(/^kinetic-verify-[0-9a-f]{32}$/);
  });

  it('accepts real hostnames and rejects schemes, paths, and bare names', () => {
    expect(isValidHostname('coach.example.com')).toBe(true);
    expect(isValidHostname('https://coach.example.com')).toBe(false);
    expect(isValidHostname('coach.example.com/path')).toBe(false);
    expect(isValidHostname('localhost')).toBe(false);
    expect(isValidHostname('bad_host.example.com')).toBe(false);
  });

  it('routes only exact verified hostnames, falling back (null) otherwise', () => {
    const domains = [
      { hostname: 'coach.example.com', organizationId: 'org-1', status: 'verified' as const },
      { hostname: 'pending.example.com', organizationId: 'org-2', status: 'requested' as const },
    ];
    expect(resolveWorkspaceByHost('coach.example.com', domains)).toBe('org-1');
    expect(resolveWorkspaceByHost('https://coach.example.com:3000/', domains)).toBe('org-1');
    expect(resolveWorkspaceByHost('sub.coach.example.com', domains)).toBeNull();
    expect(resolveWorkspaceByHost('pending.example.com', domains)).toBeNull();
    expect(resolveWorkspaceByHost('other.example.com', domains)).toBeNull();
  });
});

describe('package journeys (J4/J6, pure helpers)', () => {
  it('computes the renewal reminder date', () => {
    expect(renewalReminderDate(new Date('2026-12-01T00:00:00Z'), 7).toISOString()).toBe(
      '2026-11-24T00:00:00.000Z',
    );
  });

  it('dates journey steps from the purchase day', () => {
    const steps = cleanJourneySteps(
      [
        { dayOffset: 0, title: 'Welcome', kind: 'message' },
        { dayOffset: 3, title: 'First check-in', kind: 'task' },
      ],
      '2026-11-03',
    );
    expect(steps.map((s) => s.dueLocalDate)).toEqual(['2026-11-03', '2026-11-06']);
  });
});
