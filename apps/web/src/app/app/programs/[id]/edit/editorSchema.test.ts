import { describe, expect, it } from 'vitest';
import type { ProgramDetail } from '@kinetic/core';
import type { Units } from '@kinetic/core/units';
import { fromDraftPayload, toDraftPayload, toEditorValues, toWeekInputs } from './editorSchema';

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

describe('draft payload (autosave, S3-1)', () => {
  it('stores loads in kg and restores them in display units; an untouched load keeps its exact kg', () => {
    const values = toEditorValues(program(100), 'lb');
    const payload = toDraftPayload(values, 'lb');
    const set = (payload.weeks[0] as { days: { exercises: { sets: unknown[] }[] }[] }).days[0]!
      .exercises[0]!.sets[0];
    expect(set).toEqual({ reps: 5, loadKg: 100 });
    const restored = fromDraftPayload(JSON.parse(JSON.stringify(payload)), 'P', 'lb');
    expect(restored).not.toBeNull();
    expect(load(restored!)).toEqual({ reps: 5, loadKg: 220.5, exactKg: 100 });
    expect(saved(restored!, 'lb')).toBe(100);
    // The same values restored in kg show the stored kg.
    expect(load(fromDraftPayload(payload, 'P', 'kg')!).loadKg).toBe(100);
  });

  it('keeps invalid in-progress state (an empty field, a day without exercises)', () => {
    const values = toEditorValues(program(60), 'kg');
    values.weeks[0]!.days[0]!.exercises[0]!.sets[0] = { reps: undefined, loadKg: Number.NaN };
    values.weeks[0]!.days.push({ title: '', notes: '', exercises: [] });
    const restored = fromDraftPayload(
      JSON.parse(JSON.stringify(toDraftPayload(values, 'kg'))),
      'P',
      'kg',
    );
    expect(restored?.weeks[0]!.days).toHaveLength(2);
    expect(load(restored!)).toEqual({});
    expect(restored?.weeks[0]!.days[1]).toEqual({ title: '', notes: '', exercises: [] });
  });

  it('a draft without a title uses the fallback; a malformed draft is ignored', () => {
    const payload = toDraftPayload(toEditorValues(program(60), 'kg'), 'kg');
    expect(fromDraftPayload({ weeks: payload.weeks }, 'Fallback', 'kg')?.title).toBe('Fallback');
    expect(fromDraftPayload({ title: 'X', weeks: [{ days: 'nope' }] }, 'P', 'kg')).toBeNull();
    expect(fromDraftPayload({ title: 'X', weeks: [] }, 'P', 'kg')).toBeNull();
  });
});
