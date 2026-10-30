import { describe, expect, it } from 'vitest';
import { ScheduleInputError, scheduleSlots } from './scheduleSlots';
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
});
