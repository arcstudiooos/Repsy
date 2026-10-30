import { describe, expect, it } from 'vitest';
import { draftFromValues, EMPTY_DRAFT, fieldsFor, valuesFromDraft } from './set-entry';

describe('set entry', () => {
  it('135 lb → weightKg 61.235 → displays 135 (Review Focus #5)', () => {
    const r = valuesFromDraft({ ...EMPTY_DRAFT, reps: '5', weight: '135' }, 'reps_load', 'lb');
    expect(r).toEqual({
      ok: true,
      values: { reps: 5, weightKg: 61.235, rpe: null, durationSeconds: null, distanceM: null },
    });
    expect(draftFromValues({ weightKg: 61.235 }, 'lb').weight).toBe('135');
    expect(draftFromValues({ weightKg: 61.235 }, 'kg').weight).toBe('61.2');
  });

  it('empty strings become null; a comma decimal is accepted', () => {
    const r = valuesFromDraft({ ...EMPTY_DRAFT, weight: '62,5' }, 'reps_load', 'kg');
    expect(r).toMatchObject({ ok: true, values: { reps: null, weightKg: 62.5, rpe: null } });
  });

  it('fields follow the tracking type; hidden fields are never sent', () => {
    expect(fieldsFor('reps_load')).toEqual(['reps', 'weight', 'rpe']);
    expect(fieldsFor('duration')).toEqual(['durationSeconds']);
    expect(fieldsFor('distance')).toEqual(['distanceM']);
    const r = valuesFromDraft(
      { ...EMPTY_DRAFT, reps: '5', durationSeconds: '45' },
      'duration',
      'kg',
    );
    expect(r).toMatchObject({ ok: true, values: { reps: null, durationSeconds: 45 } });
  });

  it('rejects out-of-range or malformed input with the field', () => {
    expect(valuesFromDraft({ ...EMPTY_DRAFT, reps: '1001' }, 'reps_load', 'kg')).toMatchObject({
      ok: false,
      field: 'reps',
    });
    expect(valuesFromDraft({ ...EMPTY_DRAFT, rpe: '11' }, 'reps_load', 'kg')).toMatchObject({
      ok: false,
      field: 'rpe',
    });
    expect(valuesFromDraft({ ...EMPTY_DRAFT, weight: 'abc' }, 'reps_load', 'kg')).toMatchObject({
      ok: false,
      field: 'weight',
    });
    expect(valuesFromDraft({ ...EMPTY_DRAFT, weight: '4500' }, 'reps_load', 'lb')).toMatchObject({
      ok: false,
      field: 'weight',
    });
  });
});
