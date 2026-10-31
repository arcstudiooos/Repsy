import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@kinetic/db';
import { createTestDb } from '@kinetic/db/testing';
import { listAlternatives, setAlternatives } from '../exercises/alternatives';
import { upsertSetLogs } from '../logging/upsertSetLogs';
import { getExerciseHistory, getPersonalRecords } from '../progress/records';
import { getSessionDetail } from './detail';
import {
  BENCH,
  newClientWorld,
  newOrg,
  PRESS,
  runAs,
  sessionsOf,
  type ClientWorld,
} from './fixtures.test-helpers';
import { completeSession, startSession } from './lifecycle';
import { swapExercise, undoSwap } from './swaps';

let prisma: PrismaClient;
let drop: () => Promise<void>;

beforeAll(async () => {
  ({ prisma, drop } = await createTestDb());
});
afterAll(async () => {
  await drop();
});

const PLANK = 'e0000000-0000-4000-8000-000000000065'; // a duration exercise in the catalog

async function started(w: ClientWorld, index: number) {
  const id = (await sessionsOf(prisma, w.assignmentId))[index]!.id;
  const detail = await runAs(prisma, w.client, (tx) => startSession(tx, w.client, id));
  return { id, bench: detail.workout.exercises[0]!.id };
}

const logSet = (w: ClientWorld, sessionId: string, wveId: string, weightKg: number, reps: number) =>
  runAs(prisma, w.client, (tx) =>
    upsertSetLogs(tx, w.client, sessionId, [
      {
        workoutVersionExerciseId: wveId,
        setIndex: 0,
        reps,
        weightKg,
        clientUpdatedAt: new Date(Date.now() - 3_600_000).toISOString(),
        clientMutationId: randomUUID(),
      },
    ]),
  );

describe('exercise alternatives and swaps (PRD C4, D8)', () => {
  it('coach sets alternatives: same tracking type, no self, at most 5, replaced in order', async () => {
    const org = await newOrg(prisma);
    expect(
      await runAs(prisma, org.coach, (tx) => setAlternatives(tx, org.coach, BENCH, [PRESS])),
    ).toMatchObject([{ exerciseId: PRESS }]);
    expect(
      await runAs(prisma, org.coach, (tx) => listAlternatives(tx, org.coach, BENCH)),
    ).toHaveLength(1);
    const code = (p: Promise<unknown>) =>
      p.then(
        () => 'ok',
        (e: { code?: string }) => e.code,
      );
    expect(
      await code(runAs(prisma, org.coach, (tx) => setAlternatives(tx, org.coach, BENCH, [BENCH]))),
    ).toBe('VALIDATION');
    expect(
      await code(
        runAs(prisma, org.coach, (tx) => setAlternatives(tx, org.coach, BENCH, [PRESS, PRESS])),
      ),
    ).toBe('VALIDATION');
    const plankExists = await runAs(prisma, org.coach, (tx) =>
      tx.exercise.findFirst({ where: { trackingType: 'duration' }, select: { id: true } }),
    );
    expect(
      await code(
        runAs(prisma, org.coach, (tx) =>
          setAlternatives(tx, org.coach, BENCH, [plankExists?.id ?? PLANK]),
        ),
      ),
    ).toBe('VALIDATION');
    expect(
      await runAs(prisma, org.coach, (tx) => setAlternatives(tx, org.coach, BENCH, [])),
    ).toEqual([]);
  });

  it('client swaps before logging; records, history and PR bests credit the exercise done', async () => {
    const w = await newClientWorld(prisma, await newOrg(prisma));
    await runAs(prisma, w.coach, (tx) => setAlternatives(tx, w.coach, BENCH, [PRESS]));

    // Session 1: bench as planned, 60 kg x 5.
    const s1 = await started(w, 0);
    await logSet(w, s1.id, s1.bench, 60, 5);
    // Swapping a logged exercise is refused.
    await expect(
      runAs(prisma, w.client, (tx) =>
        swapExercise(tx, w.client, s1.id, {
          workoutVersionExerciseId: s1.bench,
          exerciseId: PRESS,
          reason: 'equipment_busy',
        }),
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    await runAs(prisma, w.client, (tx) =>
      completeSession(tx, w.client, s1.id, { idempotencyKey: randomUUID() }),
    );

    // Session 2: bench swapped for the press (not an alternative of anything else), 40 kg x 10.
    const s2 = await started(w, 1);
    await expect(
      runAs(prisma, w.client, (tx) =>
        swapExercise(tx, w.client, s2.id, {
          workoutVersionExerciseId: s2.bench,
          exerciseId: PRESS,
          reason: 'sore',
        }),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    const swap = await runAs(prisma, w.client, (tx) =>
      swapExercise(tx, w.client, s2.id, {
        workoutVersionExerciseId: s2.bench,
        exerciseId: PRESS,
        reason: 'equipment_busy',
      }),
    );
    expect(swap).toMatchObject({ exerciseId: PRESS, reason: 'equipment_busy' });
    const detail = await runAs(prisma, w.coach, (tx) => getSessionDetail(tx, w.coach, s2.id));
    expect(detail.swaps?.[s2.bench]).toMatchObject({ exerciseId: PRESS });
    expect(detail.alternatives?.[BENCH]).toMatchObject([{ exerciseId: PRESS }]);
    // Undo and redo are fine before anything is logged.
    await runAs(prisma, w.client, (tx) => undoSwap(tx, w.client, s2.id, s2.bench));
    await runAs(prisma, w.client, (tx) =>
      swapExercise(tx, w.client, s2.id, {
        workoutVersionExerciseId: s2.bench,
        exerciseId: PRESS,
        reason: 'equipment_busy',
      }),
    );
    await logSet(w, s2.id, s2.bench, 40, 10);
    await runAs(prisma, w.client, (tx) =>
      completeSession(tx, w.client, s2.id, { idempotencyKey: randomUUID() }),
    );

    const records = await runAs(prisma, w.coach, (tx) =>
      getPersonalRecords(tx, w.coach, w.clientId),
    );
    const bench = records.find((r) => r.exerciseId === BENCH);
    const press = records.find((r) => r.exerciseId === PRESS);
    expect(bench?.heaviest).toMatchObject({ weightKg: 60, reps: 5 });
    expect(press?.heaviest).toMatchObject({ weightKg: 40, reps: 10 });
    const benchHistory = await runAs(prisma, w.coach, (tx) =>
      getExerciseHistory(tx, w.coach, w.clientId, BENCH),
    );
    expect(benchHistory.entries).toHaveLength(1);
    const pressHistory = await runAs(prisma, w.coach, (tx) =>
      getExerciseHistory(tx, w.coach, w.clientId, PRESS),
    );
    expect(pressHistory.entries.map((e) => e.topSet)).toEqual([{ weightKg: 40, reps: 10 }]);

    // In the next session, "last time" for the bench is session 1, not the swapped session.
    const s3 = await started(w, 2);
    const next = await runAs(prisma, w.client, (tx) => getSessionDetail(tx, w.client, s3.id));
    expect(next.previous[BENCH]?.sets[0]).toMatchObject({ weightKg: 60, reps: 5 });
    expect(next.bests?.[BENCH]?.heaviestKg).toBe(60);
  });
});
