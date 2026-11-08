import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@repsy/db';
import { createTestDb } from '@repsy/db/testing';
import { newOrg, runAs } from '../sessions/fixtures.test-helpers';
import { createExercise } from './exercises';

let prisma: PrismaClient;
let drop: () => Promise<void>;

beforeAll(async () => {
  ({ prisma, drop } = await createTestDb());
});
afterAll(async () => {
  await drop();
});

const base = {
  name: 'Bulgarian split squat',
  equipment: 'Dumbbell',
  muscleGroup: 'Legs',
  movementType: 'Squat',
  trackingType: 'reps_load' as const,
};

describe('richer exercise attributes (PRD C3)', () => {
  it('stores secondary muscles, unilateral, difficulty and cleaned cues', async () => {
    const org = await newOrg(prisma);
    const ex = await runAs(prisma, org.coach, (tx) =>
      createExercise(tx, org.coach, {
        ...base,
        secondaryMuscles: [' Glutes ', 'Glutes', 'Adductors'],
        unilateral: true,
        difficulty: 'intermediate',
        cues: ['Front shin vertical', '', '  Drive through the front heel  '],
      }),
    );
    expect(ex).toMatchObject({
      secondaryMuscles: ['Glutes', 'Adductors'],
      unilateral: true,
      difficulty: 'intermediate',
      cues: ['Front shin vertical', 'Drive through the front heel'],
    });
  });

  it('defaults to none and validates', async () => {
    const org = await newOrg(prisma);
    const plain = await runAs(prisma, org.coach, (tx) =>
      createExercise(tx, org.coach, { ...base, name: 'Plain' }),
    );
    expect(plain).toMatchObject({
      secondaryMuscles: [],
      unilateral: false,
      difficulty: null,
      cues: [],
    });
    const field = (input: Partial<Parameters<typeof createExercise>[2]>) =>
      runAs(prisma, org.coach, (tx) =>
        createExercise(tx, org.coach, { ...base, name: `X${Math.random()}`, ...input }),
      ).then(
        () => 'ok',
        (e: { fieldErrors?: Record<string, string[]> }) => Object.keys(e.fieldErrors ?? {})[0],
      );
    expect(await field({ difficulty: 'expert' })).toBe('difficulty');
    expect(await field({ cues: Array.from({ length: 7 }, (_, i) => `cue ${i}`) })).toBe('cues');
    expect(await field({ cues: ['x'.repeat(121)] })).toBe('cues');
    expect(await field({ secondaryMuscles: ['a', 'b', 'c', 'd', 'e', 'f'] })).toBe(
      'secondaryMuscles',
    );
  });
});
