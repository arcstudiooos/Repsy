import { describe, expect, it } from 'vitest';
import type { ProgramDetail } from '@kinetic/core';
import type { Units } from '@kinetic/core/units';
import {
  buildEditorSchema,
  fromDraftPayload,
  mapServerWeekErrors,
  maxDisplayLoad,
  programExercises,
  replaceExerciseEverywhere,
  scaleWeekLoads,
  toDraftPayload,
  toEditorValues,
  toWeekInputs,
} from './editorSchema';

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
              section: 'main',
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
                section: e.section ?? 'main',
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

describe('server week errors (S3-6)', () => {
  it('mapServerWeekErrors maps a set path to its field', () => {
    const mapped = mapServerWeekErrors([
      '1.days.0.exercises.2.sets.3.tempo: Use four characters, each 0-9 or X.',
      '0.days.1.exercises.0.sets.1: reps is required.',
      '0.days.2.exercises.0.sets.0: durationSec is required.',
      '0.days.0.title: Too small: expected string to have >=1 characters',
      '0.days.0.exercises.1.note: Too big: expected string to have <=500 characters',
      '2.days.1.notes: Too big',
      'Every week must have the same number of training days.',
      'A client program keeps 3 training days per week, one per scheduled weekday.',
      '0.days.0.exercises.0.exerciseId: Invalid UUID',
    ]);
    expect(mapped.fields).toEqual([
      {
        path: 'weeks.1.days.0.exercises.2.sets.3.tempo',
        message: 'Use four characters, each 0-9 or X.',
      },
      { path: 'weeks.0.days.1.exercises.0.sets.1.reps', message: 'Enter reps.' },
      { path: 'weeks.0.days.2.exercises.0.sets.0.durationSec', message: 'Enter a duration.' },
      {
        path: 'weeks.0.days.0.title',
        message: 'Too small: expected string to have >=1 characters',
      },
      {
        path: 'weeks.0.days.0.exercises.1.note',
        message: 'Too big: expected string to have <=500 characters',
      },
      { path: 'weeks.2.days.1.notes', message: 'Too big' },
    ]);
    expect(mapped.other).toEqual([
      'Every week must have the same number of training days.',
      'A client program keeps 3 training days per week, one per scheduled weekday.',
      '0.days.0.exercises.0.exerciseId: Invalid UUID',
    ]);
  });
});

describe('load input bounds', () => {
  const loadIssue = (units: Units, loadKg: number) => {
    const values = toEditorValues(program(60), units);
    load(values).loadKg = loadKg;
    const r = buildEditorSchema(units).safeParse(values);
    return r.success ? null : r.error.issues[0]?.message;
  };

  it('lb max floors', () => {
    // 2000 kg is 4409.2 lb: ceil (4410 lb = 2000.36 kg) would pass here and fail on the server.
    expect(maxDisplayLoad('lb')).toBe(4409);
    expect(maxDisplayLoad('kg')).toBe(2000);
    expect(loadIssue('lb', 4409)).toBeNull();
    expect(loadIssue('lb', 4410)).toBe('Use 4409 or less.');
    expect(loadIssue('kg', 2000)).toBeNull();
  });

  it('tempo uses the server pattern; blank is allowed', () => {
    const tempoIssue = (tempo: string) => {
      const values = toEditorValues(program(60), 'kg');
      load(values).tempo = tempo;
      const r = buildEditorSchema('kg').safeParse(values);
      return r.success ? null : r.error.issues[0]?.message;
    };
    expect(tempoIssue('')).toBeNull();
    expect(tempoIssue('31X1')).toBeNull();
    expect(tempoIssue('31x')).toBe('Use four characters, each 0-9 or X.');
    expect(tempoIssue('3-1-1')).toBe('Use four characters, each 0-9 or X.');
  });
});

describe('fast editing (PRD C11)', () => {
  const BENCH = 'e0000000-0000-4000-8000-000000000001';
  const values = () => {
    const v = toEditorValues(program(100), 'kg');
    v.weeks.push(structuredClone(v.weeks[0]!));
    return v;
  };

  it('lists each exercise once with its uses', () => {
    expect(programExercises(values())).toEqual([
      { exerciseId: BENCH, exerciseName: 'Bench', trackingType: 'reps_load', uses: 2 },
    ]);
  });

  it('replaces an exercise everywhere, keeping sets when the tracking type matches', () => {
    const v = values();
    const same = replaceExerciseEverywhere(v, BENCH, {
      exerciseId: 'x',
      exerciseName: 'DB Bench',
      trackingType: 'reps_load',
    });
    expect(same.replaced).toBe(2);
    expect(same.weeks[1]!.days[0]!.exercises[0]).toMatchObject({
      exerciseId: 'x',
      exerciseName: 'DB Bench',
      sets: v.weeks[1]!.days[0]!.exercises[0]!.sets,
    });
    const other = replaceExerciseEverywhere(v, BENCH, {
      exerciseId: 'y',
      exerciseName: 'Plank',
      trackingType: 'duration',
    });
    expect(other.weeks[0]!.days[0]!.exercises[0]!.sets).toEqual([{ durationSec: 30 }]);
    // The input is never mutated.
    expect(v.weeks[0]!.days[0]!.exercises[0]!.exerciseId).toBe(BENCH);
  });

  it('scales a week of loads, rounding to the unit step and clamping', () => {
    const days = values().weeks[0]!.days;
    const up = scaleWeekLoads(days, 5, 'kg');
    expect(up.changed).toBe(1);
    expect(up.days[0]!.exercises[0]!.sets[0]).toEqual({ reps: 5, loadKg: 105 });
    expect(scaleWeekLoads(days, -2.6, 'kg').days[0]!.exercises[0]!.sets[0]!.loadKg).toBe(97.5);
    expect(scaleWeekLoads(days, 0, 'kg').changed).toBe(0);
    expect(scaleWeekLoads(days, -100, 'kg').days[0]!.exercises[0]!.sets[0]!.loadKg).toBe(0);
    const lb = toEditorValues(program(100), 'lb').weeks[0]!.days;
    expect(scaleWeekLoads(lb, 10, 'lb').days[0]!.exercises[0]!.sets[0]!.loadKg).toBe(243);
  });
});
