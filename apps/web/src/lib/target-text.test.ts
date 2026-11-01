import { describe, expect, it } from 'vitest';
import { extraTargets, formatPace, repsText } from './target-text';

describe('target text (PRD C7)', () => {
  it('formats ranges, pace and the extra targets', () => {
    expect(repsText({ reps: 8, repsMax: 10 })).toBe('8-10');
    expect(repsText({ reps: 8, repsMax: 8 })).toBe('8');
    expect(repsText({})).toBeNull();
    expect(formatPace(330)).toBe('5:30 /km');
    expect(extraTargets({ percent1rm: 75, rir: 2, paceSecPerKm: 300, hrZone: 2 })).toEqual([
      '75% 1RM',
      'RIR 2',
      '5:00 /km',
      'Zone 2',
    ]);
  });
});
