import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@kinetic/db';
import { createTestDb } from '@kinetic/db/testing';
import { upsertSetLogs } from '../logging/upsertSetLogs';
import { newClientWorld, newOrg, NOW, runAs, sessionsOf } from '../sessions/fixtures.test-helpers';
import { completeSession, startSession } from '../sessions/lifecycle';
import { getTrainingLoad } from './trainingLoad';

let prisma: PrismaClient;
let drop: () => Promise<void>;
beforeAll(async () => {
  ({ prisma, drop } = await createTestDb());
});
afterAll(async () => {
  await drop();
});

const T0 = new Date(NOW.getTime() - 3_600_000).toISOString();

describe('training load trends (PRD E8)', () => {
  it('counts sessions, sets, volume, average RPE and sets by muscle per week', async () => {
    const org = await newOrg(prisma);
    const w = await newClientWorld(prisma, org);
    const [first, second] = await sessionsOf(prisma, w.assignmentId);
    const detail = await runAs(prisma, w.client, (tx) =>
      startSession(tx, w.client, first!.id, { now: NOW }),
    );
    const wve = detail.workout.exercises[0]!.id;
    await runAs(prisma, w.client, (tx) =>
      upsertSetLogs(
        tx,
        w.client,
        first!.id,
        [
          { reps: 5, weightKg: 100, rpe: 8 },
          { reps: 5, weightKg: 100, rpe: 9 },
          { reps: null, weightKg: null, rpe: null },
        ].map((v, setIndex) => ({
          workoutVersionExerciseId: wve,
          setIndex,
          ...v,
          clientUpdatedAt: T0,
          clientMutationId: randomUUID(),
        })),
        { now: NOW },
      ),
    );
    await runAs(prisma, w.client, (tx) =>
      completeSession(tx, w.client, first!.id, { idempotencyKey: randomUUID() }, { now: NOW }),
    );
    // Started but not finished: never counts.
    await runAs(prisma, w.client, (tx) => startSession(tx, w.client, second!.id, { now: NOW }));

    const load = await runAs(prisma, org.coach, (tx) =>
      getTrainingLoad(tx, org.coach, w.clientId, { now: NOW }),
    );
    expect(load.weeks).toHaveLength(8);
    expect(load.weeks.slice(0, 7).every((x) => x.sessions === 0 && x.sets === 0)).toBe(true);
    const week = load.weeks[7]!;
    expect(week).toMatchObject({
      weekStart: '2026-11-02',
      sessions: 1,
      sets: 2,
      volumeKg: 1000,
      avgRpe: 8.5,
    });
    expect(Object.values(week.setsByMuscle)).toEqual([2]);
    expect(load.muscles).toHaveLength(1);

    // The client reads their own; another client's is not found.
    const own = await runAs(prisma, w.client, (tx) =>
      getTrainingLoad(tx, w.client, w.clientId, { now: NOW }),
    );
    expect(own.weeks[7]!.sets).toBe(2);
    const other = await newClientWorld(prisma, org);
    await expect(
      runAs(prisma, other.client, (tx) => getTrainingLoad(tx, other.client, w.clientId)),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
