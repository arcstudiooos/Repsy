import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@kinetic/db';
import { createTestDb } from '@kinetic/db/testing';
import { recordMedia } from '../media/media';
import { BENCH, newOrg, runAs } from '../sessions/fixtures.test-helpers';
import { setExerciseDemo } from './demo';
import { createExercise } from './exercises';
import { demoUrlOf, parseExerciseMedia } from './media';

let prisma: PrismaClient;
let drop: () => Promise<void>;
beforeAll(async () => {
  ({ prisma, drop } = await createTestDb());
});
afterAll(async () => {
  await drop();
});

describe('exercise demo uploads (PRD C2)', () => {
  it('attaches, replaces (erasing the old file) and removes an uploaded demo', async () => {
    const { coach: actor } = await newOrg(prisma);
    await runAs(prisma, actor, async (tx) => {
      const ex = await createExercise(tx, actor, {
        name: 'Band pull-apart',
        equipment: 'Band',
        muscleGroup: 'Back',
        movementType: 'Pull',
        trackingType: 'reps_load',
      });
      const upload = () =>
        recordMedia(tx, actor, {
          purpose: 'exercise_demo',
          clientId: null,
          contentType: 'video/mp4',
          bytes: 10,
          key: `k-${Math.random()}`,
        });
      const a = await upload();
      expect((await setExerciseDemo(tx, actor, ex.id, a.id)).demoMediaId).toBe(a.id);
      const b = await upload();
      await setExerciseDemo(tx, actor, ex.id, b.id);
      const old = await tx.mediaFile.findFirst({ where: { id: a.id } });
      expect(old?.erasedAt).not.toBeNull();
      await expect(setExerciseDemo(tx, actor, ex.id, a.id)).rejects.toMatchObject({
        code: 'VALIDATION',
      });
      await setExerciseDemo(tx, actor, ex.id, null);
      const row = await tx.exercise.findFirst({ where: { id: ex.id } });
      expect(row?.demoMediaId).toBeNull();
    });
  });

  it('refuses catalog exercises', async () => {
    const { coach: actor } = await newOrg(prisma);
    await runAs(prisma, actor, async (tx) => {
      await expect(setExerciseDemo(tx, actor, BENCH, null)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });
  });

  it('plays uploaded demos inline', () => {
    const id = '0b6f1c2e-7a4d-4d3a-9a37-2f0e7f3f6a11';
    expect(demoUrlOf({ mediaUrl: 'https://youtu.be/x', demoMediaId: id })).toBe(
      `/api/v1/media/${id}`,
    );
    expect(parseExerciseMedia(`/api/v1/media/${id}`)).toEqual({
      kind: 'video',
      src: `/api/v1/media/${id}`,
    });
    expect(parseExerciseMedia('/elsewhere')).toBeNull();
  });
});
