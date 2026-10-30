import { describe, expect, it } from 'vitest';
import type { ProgramDetail } from '@kinetic/core';
import type { Units } from '@kinetic/core/units';
import { toEditorValues, toWeekInputs } from './editorSchema';

const program = (loadKg: number): ProgramDetail => ({
  id: 'p',
  title: 'P',
  kind: 'template',
  versionNo: 1,
  versionId: 'v',
  daysPerWeek: 1,
  weekCount: 1,
  weeks: [
    {
      days: [
        {
          title: 'A',
          notes: '',
          exercises: [
            {
              exerciseId: 'e0000000-0000-4000-8000-000000000001',
              exerciseName: 'Bench',
              trackingType: 'reps_load',
              note: null,
              sets: [{ reps: 5, loadKg }],
            },
          ],
        },
      ],
    },
  ],
});

const load = (v: ReturnType<typeof toEditorValues>) => v.weeks[0]!.days[0]!.exercises[0]!.sets[0]!;
const saved = (v: ReturnType<typeof toEditorValues>, units: Units) =>
  toWeekInputs(v, units)[0]!.days[0]!.exercises[0]!.sets[0]!.loadKg;

describe('load round trip through the editor', () => {
  it('lb: untouched load saves back the exact stored kg', () => {
    const v = toEditorValues(program(61.235), 'lb');
    expect(load(v).loadKg).toBe(135);
    expect(saved(v, 'lb')).toBe(61.235);
  });

  it('lb: an edited value converts to 3dp kg', () => {
    const v = toEditorValues(program(61.235), 'lb');
    load(v).loadKg = 225;
    expect(saved(v, 'lb')).toBe(102.058);
  });

  it('lb: retyping the same displayed value keeps the exact kg', () => {
    const v = toEditorValues(program(61.235), 'lb');
    load(v).loadKg = Number('135');
    expect(saved(v, 'lb')).toBe(61.235);
  });

  it('lb: repeated load/save cycles do not drift', () => {
    const first = toEditorValues(program(61.235), 'lb');
    let payload = toWeekInputs(first, 'lb');
    for (let i = 0; i < 5; i++) {
      const again = toEditorValues(
        {
          ...program(0),
          weeks: payload.map((w) => ({
            days: w.days.map((d) => ({
              title: d.title,
              notes: d.notes ?? '',
              exercises: d.exercises.map((e) => ({
                exerciseId: e.exerciseId,
                exerciseName: 'Bench',
                trackingType: 'reps_load' as const,
                note: e.note ?? null,
                sets: e.sets,
              })),
            })),
          })),
        },
        'lb',
      );
      const next = toWeekInputs(again, 'lb');
      expect(next).toEqual(payload);
      payload = next;
    }
    expect(payload[0]!.days[0]!.exercises[0]!.sets[0]!.loadKg).toBe(61.235);
  });

  it('kg: untouched 3dp load is not rounded to the display decimal', () => {
    const v = toEditorValues(program(61.235), 'kg');
    expect(load(v).loadKg).toBe(61.2);
    expect(saved(v, 'kg')).toBe(61.235);
  });

  it('kg: edited and retyped values', () => {
    const v = toEditorValues(program(61.235), 'kg');
    load(v).loadKg = 62.5;
    expect(saved(v, 'kg')).toBe(62.5);
    load(v).loadKg = 61.2;
    expect(saved(v, 'kg')).toBe(61.235);
  });
});
