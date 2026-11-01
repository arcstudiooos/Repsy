import { describe, expect, it } from 'vitest';
import { setTargetSchema, targetSchema } from './targets';

const ok = (v: unknown) => targetSchema.safeParse(v).success;

describe('targetSchema', () => {
  it('accepts a normal set list', () => {
    expect(ok([{ reps: 8, loadKg: 60, rpe: 8.5, restSec: 90, tempo: '31X1' }])).toBe(true);
  });

  it('rpe bounds and half-point step', () => {
    expect(ok([{ reps: 5, rpe: 10 }])).toBe(true);
    expect(ok([{ reps: 5, rpe: 1 }])).toBe(true);
    expect(ok([{ reps: 5, rpe: 10.5 }])).toBe(false);
    expect(ok([{ reps: 5, rpe: 0.5 }])).toBe(false);
    expect(ok([{ reps: 5, rpe: 7.3 }])).toBe(false);
  });

  it('loadKg bounds and 3 decimals', () => {
    expect(ok([{ reps: 5, loadKg: 2000 }])).toBe(true);
    expect(ok([{ reps: 5, loadKg: 2000.001 }])).toBe(false);
    expect(ok([{ reps: 5, loadKg: 1.234 }])).toBe(true);
    expect(ok([{ reps: 5, loadKg: 1.2345 }])).toBe(false);
    expect(ok([{ reps: 5, loadKg: -1 }])).toBe(false);
  });

  it('tempo is four characters of 0-9 or X', () => {
    expect(ok([{ reps: 5, tempo: '31X1' }])).toBe(true);
    expect(ok([{ reps: 5, tempo: '31x1' }])).toBe(false);
    expect(ok([{ reps: 5, tempo: '311' }])).toBe(false);
  });

  it('reps, rest, duration and distance bounds', () => {
    expect(ok([{ reps: 1000 }])).toBe(true);
    expect(ok([{ reps: 1001 }])).toBe(false);
    expect(ok([{ reps: 1.5 }])).toBe(false);
    expect(ok([{ reps: 5, restSec: 3601 }])).toBe(false);
    expect(ok([{ durationSec: 0 }])).toBe(false);
    expect(ok([{ durationSec: 86400 }])).toBe(true);
    expect(ok([{ distanceM: 100000 }])).toBe(true);
    expect(ok([{ distanceM: 100001 }])).toBe(false);
  });

  it('1 to 20 sets; unknown keys rejected', () => {
    expect(ok([])).toBe(false);
    expect(ok(Array.from({ length: 20 }, () => ({ reps: 5 })))).toBe(true);
    expect(ok(Array.from({ length: 21 }, () => ({ reps: 5 })))).toBe(false);
    expect(ok([{ reps: 5, organizationId: 'x' }])).toBe(false);
  });
});

describe('targetSchema normalization', () => {
  it('rounds loadKg and distanceM to 3 decimals so float noise equals the clean value', () => {
    const parsed = targetSchema.parse([
      { reps: 5, loadKg: 0.30000000000000004, distanceM: 1.0000000000000002 },
    ]);
    expect(parsed).toEqual([{ reps: 5, loadKg: 0.3, distanceM: 1 }]);
    expect(JSON.stringify(parsed)).toBe(
      JSON.stringify(targetSchema.parse([{ reps: 5, loadKg: 0.3, distanceM: 1 }])),
    );
  });
});

describe('full set targets (PRD C7)', () => {
  it('accepts ranges, RIR, %1RM, pace and heart-rate zone; checks the range', () => {
    expect(
      setTargetSchema.safeParse({ reps: 8, repsMax: 10, rir: 2, percent1rm: 72.5 }).success,
    ).toBe(true);
    expect(
      setTargetSchema.safeParse({ durationSec: 1200, paceSecPerKm: 330, hrZone: 2 }).success,
    ).toBe(true);
    const bad = setTargetSchema.safeParse({ reps: 10, repsMax: 8 });
    expect(bad.success).toBe(false);
    expect(setTargetSchema.safeParse({ hrZone: 6 }).success).toBe(false);
    expect(setTargetSchema.safeParse({ percent1rm: 72.25 }).success).toBe(false);
  });
});
