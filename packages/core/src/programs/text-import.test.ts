import { describe, expect, it } from 'vitest';
import { parseProgram, parseProgramText, parsePrescription } from './text-import';

describe('program text import (PRD C14)', () => {
  it('reads sets, reps, loads, RPE, time and distance', () => {
    expect(parsePrescription('3x8 @ 60kg RPE 8', 'kg')).toEqual(
      Array(3).fill({ reps: 8, loadKg: 60, rpe: 8 }),
    );
    expect(parsePrescription('5 x 5 at 225 lb', 'kg')?.[0]).toEqual({ reps: 5, loadKg: 102.058 });
    expect(parsePrescription('3x8 @ 135', 'lb')?.[0]).toEqual({ reps: 8, loadKg: 61.235 });
    expect(parsePrescription('4 x 8-10', 'kg')).toEqual(Array(4).fill({ reps: 8, repsMax: 10 }));
    expect(parsePrescription('3x45s', 'kg')?.[0]).toEqual({ durationSec: 45 });
    expect(parsePrescription('2x1.5min', 'kg')?.[0]).toEqual({ durationSec: 90 });
    expect(parsePrescription('1x5km', 'kg')?.[0]).toEqual({ distanceM: 5000 });
    expect(parsePrescription('6x400m', 'kg')?.[0]).toEqual({ distanceM: 400 });
    expect(parsePrescription('heavy', 'kg')).toBeNull();
    expect(parsePrescription('30x5', 'kg')).toBeNull();
  });

  it('groups lines under weeks and days, and reports unreadable lines', () => {
    const p = parseProgramText(
      [
        'Week 1',
        'Day 1: Upper',
        '1. Bench press 3x8 @ 60kg',
        '- Pull-up: 3x6',
        'Monday - Legs',
        'Back squat 5x5 @ 100kg',
        'Lunges for a while',
        '',
        'Week 2',
        'Conditioning:',
        'Run 1x5km',
      ].join('\n'),
    );
    expect(p.errors).toEqual([]);
    expect(p.weeks).toHaveLength(2);
    expect(p.weeks[0]!.days.map((d) => d.title)).toEqual(['Day 1: Upper', 'Monday: Legs']);
    expect(p.weeks[0]!.days[0]!.lines.map((l) => [l.name, l.sets.length])).toEqual([
      ['Bench press', 3],
      ['Pull-up', 3],
    ]);
    expect(p.weeks[0]!.days[1]!.lines[1]).toMatchObject({
      line: 7,
      name: 'Lunges for a while',
      error: 'Add sets and reps, like 3x8.',
    });
    expect(p.weeks[1]!.days[0]).toMatchObject({ title: 'Conditioning' });
  });

  it('puts headingless lines in Day 1 and flags an empty paste', () => {
    expect(parseProgramText('Squat 3x5').weeks[0]!.days[0]!.title).toBe('Day 1');
    expect(parseProgramText('just words').errors).toEqual([]);
    expect(parseProgramText('\n\n').errors[0]).toMatch(/No exercises found/);
  });

  it('reads a spreadsheet paste with a header row', () => {
    const p = parseProgram(
      [
        'Week\tDay\tExercise\tSets\tReps\tWeight (lb)\tRPE\tNotes',
        '1\tA\tBench press\t3\t8\t135\t8\tPause first rep',
        '1\tA\tRow\t3\t10\t\t\t',
        '1\tB\tSquat\t\t5\t225\t\t',
        '2\tA\tBench press\t3\t6\t145\t\t',
      ].join('\n'),
    );
    expect(p.weeks).toHaveLength(2);
    const a = p.weeks[0]!.days[0]!;
    expect(a.title).toBe('A');
    expect(a.lines[0]).toMatchObject({ name: 'Bench press', note: 'Pause first rep' });
    expect(a.lines[0]!.sets[0]).toEqual({ reps: 8, loadKg: 61.235, rpe: 8 });
    expect(a.lines[1]!.sets[0]).toEqual({ reps: 10 });
    expect(p.weeks[0]!.days[1]!.lines[0]).toMatchObject({ line: 4, error: 'Sets must be 1-20.' });
  });
});
