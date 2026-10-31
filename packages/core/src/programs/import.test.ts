import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@kinetic/db';
import { createTestDb } from '@kinetic/db/testing';
import { BENCH, newOrg, runAs } from '../sessions/fixtures.test-helpers';
import { createProgramFromImport, matchExercises, nameScore } from './import';
import { getProgram } from './read';

let prisma: PrismaClient;
let drop: () => Promise<void>;

beforeAll(async () => {
  ({ prisma, drop } = await createTestDb());
});
afterAll(async () => {
  await drop();
});

describe('program import (PRD C14)', () => {
  it('scores names', () => {
    expect(nameScore('Bench Press', 'bench press')).toBe(1);
    expect(nameScore('bench', 'Barbell Bench Press')).toBe(0.8);
    expect(nameScore('DB rows', 'Dumbbell Row')).toBeGreaterThan(0);
    expect(nameScore('Zumba', 'Back Squat')).toBe(0);
  });

  it('matches names to the library and creates a template from the reviewed weeks', async () => {
    const org = await newOrg(prisma);
    const [bench, nothing] = await runAs(prisma, org.coach, (tx) =>
      matchExercises(tx, org.coach, ['barbell bench press', 'Zzz unknown', 'barbell bench press']),
    );
    expect(bench).toMatchObject({ name: 'barbell bench press', exerciseId: BENCH });
    expect(nothing).toMatchObject({ exerciseId: null, candidates: [] });

    const { id } = await runAs(prisma, org.coach, (tx) =>
      createProgramFromImport(tx, org.coach, {
        title: 'Imported block',
        weeks: [
          {
            days: [
              {
                title: 'Day 1: Upper',
                exercises: [{ exerciseId: BENCH, sets: [{ reps: 8, loadKg: 60 }] }],
              },
            ],
          },
        ],
      }),
    );
    const program = await runAs(prisma, org.coach, (tx) => getProgram(tx, org.coach, id));
    expect(program).toMatchObject({ title: 'Imported block' });
    await expect(
      runAs(prisma, org.coach, (tx) =>
        createProgramFromImport(tx, org.coach, { title: 'Empty', weeks: [] }),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });
});
