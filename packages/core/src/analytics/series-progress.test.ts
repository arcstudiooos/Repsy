import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withSystem, type PrismaClient } from '@repsy/db';
import { createTestDb } from '@repsy/db/testing';
import { issueDueCheckins, setCheckinWeekday, submitCheckin } from '../checkins/checkins';
import { upsertSetLogs } from '../logging/upsertSetLogs';
import {
  NOW,
  newClientWorld,
  newOrg,
  runAs,
  sessionsOf,
  type ClientWorld,
} from '../sessions/fixtures.test-helpers';
import { completeSession, startSession } from '../sessions/lifecycle';
import { getCheckinSeries, getExerciseProgress, getWeeklyVolume } from './series';

let prisma: PrismaClient;
let drop: () => Promise<void>;

beforeAll(async () => {
  ({ prisma, drop } = await createTestDb());
});
afterAll(async () => {
  await drop();
});

const T0 = new Date(Date.now() - 3_600_000).toISOString();

async function logFirstExercise(w: ClientWorld, index: number, weightKg: number, reps: number) {
  const id = (await sessionsOf(prisma, w.assignmentId))[index]!.id;
  const detail = await runAs(prisma, w.client, (tx) => startSession(tx, w.client, id));
  const ex = detail.workout.exercises[0]!;
  await runAs(prisma, w.client, (tx) =>
    upsertSetLogs(tx, w.client, id, [
      {
        workoutVersionExerciseId: ex.id,
        setIndex: 0,
        reps,
        weightKg,
        clientUpdatedAt: T0,
        clientMutationId: randomUUID(),
      },
    ]),
  );
  await runAs(prisma, w.client, (tx) =>
    completeSession(tx, w.client, id, { idempotencyKey: randomUUID() }),
  );
  return ex.exerciseId;
}

describe('getExerciseProgress and getWeeklyVolume', () => {
  it('points oldest first with a PR flag on each new best estimated 1RM; volume matches', async () => {
    const w = await newClientWorld(prisma, await newOrg(prisma));
    const exerciseId = await logFirstExercise(w, 0, 60, 5);
    await logFirstExercise(w, 1, 55, 5);
    await logFirstExercise(w, 2, 70, 5);
    const { points } = await runAs(prisma, w.coach, (tx) =>
      getExerciseProgress(tx, w.coach, w.clientId, exerciseId),
    );
    expect(points.map((p) => p.topSetKg)).toEqual([60, 55, 70]);
    expect(points.map((p) => p.isPersonalRecord)).toEqual([true, false, true]);
    expect(points[0]!.volumeKg).toBe(300);

    const weeks = await runAs(prisma, w.coach, (tx) =>
      getWeeklyVolume(tx, w.coach, w.clientId, { now: new Date('2026-11-20T12:00:00Z') }),
    );
    const total = weeks.reduce((s, x) => s + x.volumeKg, 0);
    expect(total).toBe(300 + 275 + 350);
  });
});

describe('getCheckinSeries', () => {
  it('returns 1-5 answers per submitted check-in, oldest first, scale questions only', async () => {
    const w = await newClientWorld(prisma, await newOrg(prisma));
    await runAs(prisma, w.coach, (tx) => setCheckinWeekday(tx, w.coach, w.clientId, 3));
    await runAs(prisma, w.coach, (tx) => issueDueCheckins(tx, NOW));
    const [c] = await withSystem(
      (tx) => tx.checkin.findMany({ where: { clientId: w.clientId } }),
      prisma,
    );
    await runAs(prisma, w.client, (tx) =>
      submitCheckin(
        tx,
        w.client,
        c!.id,
        { answers: { energy: 4, sleep: 2, notes: 'ok' }, idempotencyKey: 'key-series01' },
        { now: NOW },
      ),
    );
    const s = await runAs(prisma, w.coach, (tx) => getCheckinSeries(tx, w.coach, w.clientId));
    expect(s.questions.map((q) => q.id)).toEqual(expect.arrayContaining(['energy', 'sleep']));
    expect(s.questions.find((q) => q.id === 'notes')).toBeUndefined();
    expect(s.points).toHaveLength(1);
    expect(s.points[0]!.values).toMatchObject({ energy: 4, sleep: 2 });
  });
});
