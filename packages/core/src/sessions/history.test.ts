import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@kinetic/db';
import { createTestDb } from '@kinetic/db/testing';
import { DomainError } from '../errors';
import { upsertSetLogs } from '../logging/upsertSetLogs';
import {
  BENCH,
  newClientWorld,
  newOrg,
  PRESS,
  runAs,
  sessionsOf,
  type ClientWorld,
} from './fixtures.test-helpers';
import { getClientHistory, getExercisePerformance } from './history';
import { completeSession, startSession } from './lifecycle';

let prisma: PrismaClient;
let drop: () => Promise<void>;

const codeOf = (p: Promise<unknown>) =>
  p.then(
    () => 'ok',
    (e: unknown) => (e instanceof DomainError ? e.code : `other:${String(e)}`),
  );

/** Device timestamps an hour back, so they never trip the clock-skew guard. */
const T0 = new Date(Date.now() - 3_600_000).toISOString();

/** Starts session `index`, logs bench sets with `reps`, and completes it. */
async function completeWith(w: ClientWorld, index: number, reps: number[]) {
  const id = (await sessionsOf(prisma, w.assignmentId))[index]!.id;
  const detail = await runAs(prisma, w.client, (tx) => startSession(tx, w.client, id));
  const bench = detail.workout.exercises[0]!.id;
  await runAs(prisma, w.client, (tx) =>
    upsertSetLogs(
      tx,
      w.client,
      id,
      reps.map((r, setIndex) => ({
        workoutVersionExerciseId: bench,
        setIndex,
        reps: r,
        weightKg: 60,
        clientUpdatedAt: T0,
        clientMutationId: randomUUID(),
      })),
    ),
  );
  await runAs(prisma, w.client, (tx) =>
    completeSession(tx, w.client, id, { idempotencyKey: randomUUID() }),
  );
  return id;
}

beforeAll(async () => {
  ({ prisma, drop } = await createTestDb());
});
afterAll(async () => {
  await drop();
});

describe('client history', () => {
  it('last completed session sets per exercise', async () => {
    const w = await newClientWorld(prisma, await newOrg(prisma));
    await completeWith(w, 0, [5, 5]);
    const second = await completeWith(w, 1, [7, 6]);

    const history = await runAs(prisma, w.coach, (tx) =>
      getClientHistory(tx, w.coach, w.clientId, [BENCH, PRESS]),
    );
    expect(Object.keys(history)).toEqual([BENCH]);
    expect(history[BENCH]).toEqual({
      localDate: '2026-11-06',
      sets: [
        { setIndex: 0, reps: 7, weightKg: 60, rpe: null, durationSeconds: null, distanceM: null },
        { setIndex: 1, reps: 6, weightKg: 60, rpe: null, durationSeconds: null, distanceM: null },
      ],
    });

    // Excluding the latest session falls back to the one before it.
    const earlier = await runAs(prisma, w.coach, (tx) =>
      getExercisePerformance(tx, w.clientId, [BENCH], { excludeSessionId: second }),
    );
    expect(earlier[BENCH]?.localDate).toBe('2026-11-04');
    expect(earlier[BENCH]?.sets.map((s) => s.reps)).toEqual([5, 5]);
  });

  it("another org's client → NOT_FOUND; a client actor → FORBIDDEN; bad input → NOT_FOUND / VALIDATION", async () => {
    const w = await newClientWorld(prisma, await newOrg(prisma));
    const other = await newOrg(prisma);
    expect(
      await codeOf(
        runAs(prisma, other.coach, (tx) => getClientHistory(tx, other.coach, w.clientId, [BENCH])),
      ),
    ).toBe('NOT_FOUND');
    expect(
      await codeOf(
        runAs(prisma, w.client, (tx) => getClientHistory(tx, w.client, w.clientId, [BENCH])),
      ),
    ).toBe('FORBIDDEN');
    expect(
      await codeOf(
        runAs(prisma, w.coach, (tx) => getClientHistory(tx, w.coach, 'not-a-uuid', [BENCH])),
      ),
    ).toBe('NOT_FOUND');
    const tooMany = Array.from({ length: 31 }, () => randomUUID());
    expect(
      await codeOf(
        runAs(prisma, w.coach, (tx) => getClientHistory(tx, w.coach, w.clientId, tooMany)),
      ),
    ).toBe('VALIDATION');
    expect(
      await codeOf(
        runAs(prisma, w.coach, (tx) => getClientHistory(tx, w.coach, w.clientId, ['nope'])),
      ),
    ).toBe('VALIDATION');
    expect(
      await runAs(prisma, w.coach, (tx) => getClientHistory(tx, w.coach, w.clientId, [])),
    ).toEqual({});
  });
});
