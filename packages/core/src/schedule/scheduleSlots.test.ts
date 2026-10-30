import { describe, expect, it } from 'vitest';
import { localDayBounds, ScheduleInputError, scheduleSlots } from './scheduleSlots';
import type { IsoWeekday, SlotKey } from './types';

const days = (weeks: number, perWeek: number): SlotKey[] =>
  Array.from({ length: weeks * perWeek }, (_, i) => ({
    weekIndex: Math.floor(i / perWeek),
    dayIndex: i % perWeek,
  }));

describe('scheduleSlots', () => {
  it('fills Mon/Wed/Fri from a Wednesday start', () => {
    const out = scheduleSlots({
      slots: days(2, 3),
      weekdays: [1, 3, 5],
      startLocalDate: '2026-11-04',
      timeZone: 'UTC',
    });
    expect(out.slice(0, 4).map((s) => s.localDate)).toEqual([
      '2026-11-04',
      '2026-11-06',
      '2026-11-09',
      '2026-11-11',
    ]);
    expect(out[0]!.slot).toEqual({ weekIndex: 0, dayIndex: 0 });
    expect(out[3]!.slot).toEqual({ weekIndex: 1, dayIndex: 0 });
  });

  it('sorts slots and weekdays', () => {
    const out = scheduleSlots({
      slots: [...days(1, 3)].reverse(),
      weekdays: [5, 1, 3],
      startLocalDate: '2026-11-04',
      timeZone: 'UTC',
    });
    expect(out.map((s) => s.localDate)).toEqual(['2026-11-04', '2026-11-06', '2026-11-09']);
  });

  it('start on a non-selected weekday rolls forward', () => {
    const out = scheduleSlots({
      slots: days(1, 2),
      weekdays: [1, 5],
      startLocalDate: '2026-11-04', // Wednesday
      timeZone: 'UTC',
    });
    expect(out.map((s) => s.localDate)).toEqual(['2026-11-06', '2026-11-09']);
  });

  it('DST end in America/New_York', () => {
    const out = scheduleSlots({
      slots: days(2, 1),
      weekdays: [7],
      startLocalDate: '2026-10-25',
      timeZone: 'America/New_York',
    });
    expect(out[0]!.localDate).toBe('2026-10-25');
    expect(out[0]!.dueAtUtc.toISOString()).toBe('2026-10-26T03:59:00.000Z');
    expect(out[1]!.localDate).toBe('2026-11-01');
    expect(out[1]!.dueAtUtc.toISOString()).toBe('2026-11-02T04:59:00.000Z');
    expect(out[1]!.scheduledAtUtc.toISOString()).toBe('2026-11-01T04:00:00.000Z');
  });

  it('DST start in Europe/London', () => {
    const out = scheduleSlots({
      slots: days(2, 1),
      weekdays: [7],
      startLocalDate: '2027-03-21',
      timeZone: 'Europe/London',
    });
    expect(out[1]!.localDate).toBe('2027-03-28');
    expect(out[1]!.dueAtUtc.toISOString()).toBe('2027-03-28T22:59:00.000Z');
    expect(out[1]!.scheduledAtUtc.toISOString()).toBe('2027-03-28T00:00:00.000Z');
  });

  it('weekday count mismatch -> ScheduleInputError', () => {
    expect(() =>
      scheduleSlots({
        slots: days(1, 3),
        weekdays: [1, 3],
        startLocalDate: '2026-11-04',
        timeZone: 'UTC',
      }),
    ).toThrow(ScheduleInputError);
  });

  it('duplicate weekdays -> ScheduleInputError', () => {
    expect(() =>
      scheduleSlots({
        slots: days(1, 2),
        weekdays: [1, 1],
        startLocalDate: '2026-11-04',
        timeZone: 'UTC',
      }),
    ).toThrow(ScheduleInputError);
  });

  it('an alias zone (Asia/Kolkata) schedules like its canonical id', () => {
    const run = (timeZone: string) =>
      scheduleSlots({ slots: days(1, 1), weekdays: [3], startLocalDate: '2026-11-04', timeZone });
    expect(run('Asia/Kolkata')).toEqual(run('Asia/Calcutta'));
    expect(run('Asia/Kolkata')[0]!.scheduledAtUtc.toISOString()).toBe('2026-11-03T18:30:00.000Z');
  });

  it.each(['+05:30', 'Not/AZone', ''])('non-IANA zone %j -> ScheduleInputError', (timeZone) => {
    expect(() =>
      scheduleSlots({ slots: days(1, 1), weekdays: [1], startLocalDate: '2026-11-04', timeZone }),
    ).toThrow(ScheduleInputError);
  });

  it('invalid timezone -> ScheduleInputError', () => {
    expect(() =>
      scheduleSlots({
        slots: days(1, 1),
        weekdays: [1],
        startLocalDate: '2026-11-04',
        timeZone: 'Mars/Olympus',
      }),
    ).toThrow(ScheduleInputError);
  });

  it.each(['2026-13-01', '2026-02-30', '11/04/2026', '2026-1-4', ''])(
    'invalid start date %j -> ScheduleInputError',
    (startLocalDate) => {
      expect(() =>
        scheduleSlots({ slots: days(1, 1), weekdays: [1], startLocalDate, timeZone: 'UTC' }),
      ).toThrow(ScheduleInputError);
    },
  );

  it('rejects out-of-range weekdays and ragged weeks', () => {
    expect(() =>
      scheduleSlots({
        slots: days(1, 1),
        weekdays: [8 as IsoWeekday],
        startLocalDate: '2026-11-04',
        timeZone: 'UTC',
      }),
    ).toThrow(ScheduleInputError);
    expect(() =>
      scheduleSlots({
        slots: [
          { weekIndex: 0, dayIndex: 0 },
          { weekIndex: 0, dayIndex: 1 },
          { weekIndex: 1, dayIndex: 0 },
        ],
        weekdays: [1, 3],
        startLocalDate: '2026-11-04',
        timeZone: 'UTC',
      }),
    ).toThrow(ScheduleInputError);
  });

  it('returns [] for no slots with no weekdays', () => {
    expect(
      scheduleSlots({ slots: [], weekdays: [], startLocalDate: '2026-11-04', timeZone: 'UTC' }),
    ).toEqual([]);
  });

  it('DST gap: skipped midnight resolves to the transition instant (America/Santiago)', () => {
    const out = scheduleSlots({
      slots: days(1, 1),
      weekdays: [7],
      startLocalDate: '2026-09-06',
      timeZone: 'America/Santiago',
    });
    expect(out[0]!.localDate).toBe('2026-09-06');
    expect(out[0]!.scheduledAtUtc.toISOString()).toBe('2026-09-06T04:00:00.000Z');
    expect(out[0]!.dueAtUtc.toISOString()).toBe('2026-09-07T02:59:00.000Z');
  });

  it('DST fold: repeated midnight resolves to the first occurrence (America/Havana)', () => {
    const out = scheduleSlots({
      slots: days(1, 1),
      weekdays: [7],
      startLocalDate: '2026-11-01',
      timeZone: 'America/Havana',
    });
    expect(out[0]!.scheduledAtUtc.toISOString()).toBe('2026-11-01T04:00:00.000Z');
    expect(out[0]!.dueAtUtc.toISOString()).toBe('2026-11-02T04:59:00.000Z');
  });

  it('DST start in America/New_York', () => {
    const out = scheduleSlots({
      slots: days(1, 1),
      weekdays: [7],
      startLocalDate: '2027-03-14',
      timeZone: 'America/New_York',
    });
    expect(out[0]!.scheduledAtUtc.toISOString()).toBe('2027-03-14T05:00:00.000Z');
    expect(out[0]!.dueAtUtc.toISOString()).toBe('2027-03-15T03:59:00.000Z');
  });

  it.each([
    ['negative week', [{ weekIndex: -1, dayIndex: 0 }]],
    ['negative day', [{ weekIndex: 0, dayIndex: -1 }]],
    ['fractional week', [{ weekIndex: 0.5, dayIndex: 0 }]],
    ['fractional day', [{ weekIndex: 0, dayIndex: 1.5 }]],
    [
      'duplicate key',
      [
        { weekIndex: 0, dayIndex: 0 },
        { weekIndex: 0, dayIndex: 0 },
      ],
    ],
  ])('bad slot keys (%s) -> ScheduleInputError', (_n, slots) => {
    expect(() =>
      scheduleSlots({
        slots,
        weekdays: slots.map((_, i) => i + 1) as IsoWeekday[],
        startLocalDate: '2026-11-04',
        timeZone: 'UTC',
      }),
    ).toThrow(ScheduleInputError);
  });
});

describe('localDayBounds', () => {
  it('localDayBounds across the America/New_York fall-back day 2026-11-01', () => {
    const b = localDayBounds('2026-11-01', 'America/New_York');
    // 00:00 is still EDT (UTC-4); 23:59 is EST (UTC-5) after the 02:00 fall-back.
    expect(b.scheduledAtUtc.toISOString()).toBe('2026-11-01T04:00:00.000Z');
    expect(b.dueAtUtc.toISOString()).toBe('2026-11-02T04:59:00.000Z');
    // Same values scheduleSlots produces for that day.
    const [slot] = scheduleSlots({
      slots: [{ weekIndex: 0, dayIndex: 0 }],
      weekdays: [7],
      startLocalDate: '2026-11-01',
      timeZone: 'America/New_York',
    });
    expect({ scheduledAtUtc: slot!.scheduledAtUtc, dueAtUtc: slot!.dueAtUtc }).toEqual(b);
  });

  it('rejects a bad date or zone', () => {
    expect(() => localDayBounds('2026-02-30', 'UTC')).toThrow(
      'localDate is not a real calendar date',
    );
    expect(() => localDayBounds('11/01/2026', 'UTC')).toThrow('localDate must be YYYY-MM-DD');
    expect(() => localDayBounds('2026-02-30', 'UTC')).toThrow(ScheduleInputError);
    expect(() => localDayBounds('2026-11-01', 'Mars/Base')).toThrow(ScheduleInputError);
  });
});
