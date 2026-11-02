import { describe, expect, it } from 'vitest';
import { describeRule, progressSets, validRule } from './progression';

describe('progression rules (PRD C12)', () => {
  it('adds load per week, capping the target RPE', () => {
    const base = [
      { reps: 5, loadKg: 100 },
      { reps: 5, loadKg: 100 },
    ];
    expect(progressSets(base, { kind: 'load', step: 2.5, rpeMax: 8 }, 3)).toEqual([
      { reps: 5, loadKg: 107.5, rpe: 8 },
      { reps: 5, loadKg: 107.5, rpe: 8 },
    ]);
  });

  it('double progression: reps to the top, then load and back down', () => {
    const rule = { kind: 'reps', step: 1, maxReps: 12, loadStep: 2.5 } as const;
    const week = (n: number) => progressSets([{ reps: 10, loadKg: 40 }], rule, n)[0];
    expect([1, 2, 3, 4].map(week)).toEqual([
      { reps: 11, loadKg: 40 },
      { reps: 12, loadKg: 40 },
      { reps: 10, loadKg: 42.5 },
      { reps: 11, loadKg: 42.5 },
    ]);
  });

  it('describes and validates rules', () => {
    expect(describeRule({ kind: 'load', step: 2.5, rpeMax: 8 }, 'kg')).toBe(
      '+2.5 kg per week while RPE is 8 or less',
    );
    expect(validRule({ kind: 'load', step: 0 })).toBe('Enter a step above 0.');
    expect(validRule({ kind: 'reps', step: 1, maxReps: 12, loadStep: 2.5 })).toBeNull();
  });
});
