import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@kinetic/db';
import { createTestDb } from '@kinetic/db/testing';
import { reviseSetLogs } from '../logging/revise';
import { upsertSetLogs } from '../logging/upsertSetLogs';
import {
  BENCH,
  newClientWorld,
  newOrg,
  runAs,
  sessionsOf,
  type ClientWorld,
} from '../sessions/fixtures.test-helpers';
import { completeSession, skipSession, startSession } from '../sessions/lifecycle';
import {
  estimateOneRepMax,
  exerciseBestsBefore,
  getExerciseHistory,
  getPersonalRecords,
  isPersonalRecord,
} from './records';

let prisma: PrismaClient;
let drop: () => Promise<void>;

beforeAll(async () => {
  ({ prisma, drop } = await createTestDb());
});
afterAll(async () => {
  await drop();
});

/** Device timestamps an hour back, so they never trip the clock-skew guard. */
const T0 = new Date(Date.now() - 3_600_000).toISOString();

/** Starts session `index`, logs bench sets as [weightKg, reps] pairs, then completes (or skips) it. */
async function logBench(
  w: ClientWorld,
  index: number,
  sets: [number, number][],
  finish: 'complete' | 'skip' | 'none' = 'complete',
) {
  const id = (await sessionsOf(prisma, w.assignmentId))[index]!.id;
  const detail = await runAs(prisma, w.client, (tx) => startSession(tx, w.client, id));
  const bench = detail.workout.exercises[0]!.id;
  await runAs(prisma, w.client, (tx) =>
    upsertSetLogs(
      tx,
      w.client,
      id,
      sets.map(([weightKg, reps], setIndex) => ({
        workoutVersionExerciseId: bench,
        setIndex,
        reps,
        weightKg,
        clientUpdatedAt: T0,
        clientMutationId: randomUUID(),
      })),
    ),
  );
  if (finish === 'complete') {
    await runAs(prisma, w.client, (tx) =>
      completeSession(tx, w.client, id, { idempotencyKey: randomUUID() }),
    );
  } else if (finish === 'skip') {
    await runAs(prisma, w.client, (tx) =>
      skipSession(tx, w.client, id, { idempotencyKey: randomUUID() }),
    );
  }
  return { id, bench };
}

describe('estimateOneRepMax', () => {
  it('Epley, a single is its own weight, long or empty sets give nothing', () => {
    expect(estimateOneRepMax(100, 1)).toBe(100);
    expect(estimateOneRepMax(100, 5)).toBe(116.7);
    expect(estimateOneRepMax(60, 12)).toBe(84);
    expect(estimateOneRepMax(60, 13)).toBeNull();
    expect(estimateOneRepMax(0, 5)).toBeNull();
    expect(estimateOneRepMax(null, 5)).toBeNull();
    expect(estimateOneRepMax(60, 0)).toBeNull();
  });
});

describe('getPersonalRecords', () => {
  it('records across completed sessions, credited to the first session that set them', async () => {
    const w = await newClientWorld(prisma, await newOrg(prisma));
    const first = await logBench(w, 0, [
      [60, 10],
      [70, 5],
    ]);
    const second = await logBench(w, 1, [
      [80, 2],
      [70, 5],
    ]);
    const [bench] = await runAs(prisma, w.client, (tx) =>
      getPersonalRecords(tx, w.client, w.clientId),
    );
    expect(bench).toMatchObject({ exerciseId: BENCH, trackingType: 'reps_load', sessions: 2 });
    expect(bench!.lastLocalDate).toBe('2026-11-06');
    // Estimates: 60×10 → 80, 70×5 → 81.7, 80×2 → 85.3 (the best).
    expect(bench!.estimatedOneRepMax).toMatchObject({ valueKg: 85.3, weightKg: 80, reps: 2 });
    expect(bench!.heaviest).toMatchObject({ weightKg: 80, reps: 2, sessionId: second.id });
    // 5-rep max 70 kg was set first on 11-04; the equal 70×5 on 11-06 does not take it over.
    expect(bench!.repMaxes[4]).toMatchObject({ weightKg: 70, reps: 5, sessionId: first.id });
    expect(bench!.repMaxes[9]).toMatchObject({ weightKg: 60, reps: 10 });
    // 10 reps of 60 also counts as a 6-rep max when nothing heavier reached 6.
    expect(bench!.repMaxes[5]).toMatchObject({ weightKg: 60 });
    // Volume: 600 + 350 = 950 on 11-04 beats 160 + 350 = 510.
    expect(bench!.mostReps).toMatchObject({ reps: 10, sessionId: first.id });
    expect(bench!.bestVolume).toEqual({
      volumeKg: 950,
      localDate: '2026-11-04',
      sessionId: first.id,
    });
  });

  it('skipped and unfinished sessions never count', async () => {
    const w = await newClientWorld(prisma, await newOrg(prisma));
    await logBench(w, 0, [[100, 1]], 'skip');
    await logBench(w, 1, [[110, 1]], 'none');
    await logBench(w, 2, [[50, 5]]);
    const [bench] = await runAs(prisma, w.coach, (tx) =>
      getPersonalRecords(tx, w.coach, w.clientId),
    );
    expect(bench!.heaviest).toMatchObject({ weightKg: 50 });
    expect(bench!.sessions).toBe(1);
  });

  it('a coach correction that lowers a weight removes the record it set', async () => {
    const w = await newClientWorld(prisma, await newOrg(prisma));
    await logBench(w, 0, [[60, 5]]);
    const { id, bench } = await logBench(w, 1, [[200, 5]]);
    await runAs(prisma, w.coach, (tx) =>
      reviseSetLogs(tx, w.coach, id, {
        reason: 'Typo: 20 not 200',
        items: [
          {
            workoutVersionExerciseId: bench,
            setIndex: 0,
            reps: 5,
            weightKg: 20,
            clientUpdatedAt: new Date().toISOString(),
            clientMutationId: randomUUID(),
          },
        ],
      }),
    );
    const [rec] = await runAs(prisma, w.coach, (tx) => getPersonalRecords(tx, w.coach, w.clientId));
    expect(rec!.heaviest).toMatchObject({ weightKg: 60 });
  });

  it('a client reads only their own records; other orgs read as not found', async () => {
    const org = await newOrg(prisma);
    const a = await newClientWorld(prisma, org);
    const b = await newClientWorld(prisma, org);
    const other = await newClientWorld(prisma, await newOrg(prisma));
    expect(
      await runAs(prisma, a.client, (tx) => getPersonalRecords(tx, a.client, a.clientId)),
    ).toEqual([]);
    await expect(
      runAs(prisma, a.client, (tx) => getPersonalRecords(tx, a.client, b.clientId)),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      runAs(prisma, a.coach, (tx) => getPersonalRecords(tx, a.coach, other.clientId)),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      runAs(prisma, a.coach, (tx) => getPersonalRecords(tx, a.coach, 'not-a-uuid')),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('getExerciseHistory', () => {
  it('one entry per completed session, newest first', async () => {
    const w = await newClientWorld(prisma, await newOrg(prisma));
    await logBench(w, 0, [
      [60, 8],
      [60, 8],
    ]);
    await logBench(w, 1, [
      [65, 6],
      [70, 3],
    ]);
    const history = await runAs(prisma, w.client, (tx) =>
      getExerciseHistory(tx, w.client, w.clientId, BENCH),
    );
    expect(history.exercise).toMatchObject({ exerciseId: BENCH, trackingType: 'reps_load' });
    expect(history.entries.map((e) => e.localDate)).toEqual(['2026-11-06', '2026-11-04']);
    expect(history.entries[0]).toMatchObject({
      sets: 2,
      topSet: { weightKg: 70, reps: 3 },
      volumeKg: 600,
      totalReps: 9,
      estimatedOneRepMaxKg: 78,
    });
    expect(history.entries[1]).toMatchObject({ volumeKg: 960, topSet: { weightKg: 60, reps: 8 } });
  });

  it('an exercise never logged is not found', async () => {
    const w = await newClientWorld(prisma, await newOrg(prisma));
    await expect(
      runAs(prisma, w.coach, (tx) => getExerciseHistory(tx, w.coach, w.clientId, BENCH)),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('PR badges (PRD D11)', () => {
  it('bests exclude the current session; a set beating them is a PR', async () => {
    const w = await newClientWorld(prisma, await newOrg(prisma));
    await logBench(w, 0, [
      [60, 8],
      [70, 3],
    ]);
    const current = await logBench(w, 1, [[72.5, 2]], 'none');
    const bests = await runAs(prisma, w.coach, (tx) =>
      exerciseBestsBefore(tx, w.clientId, [BENCH], current.id),
    );
    expect(bests[BENCH]).toMatchObject({ heaviestKg: 70, mostReps: 8, estimatedOneRepMaxKg: 77 });
    const set = (weightKg: number | null, reps: number | null) => ({
      weightKg,
      reps,
      durationSeconds: null,
      distanceM: null,
    });
    expect(isPersonalRecord(set(72.5, 2), bests[BENCH])).toBe(true); // heavier
    expect(isPersonalRecord(set(65, 6), bests[BENCH])).toBe(true); // e1RM 78 > 77
    expect(isPersonalRecord(set(60, 5), bests[BENCH])).toBe(false);
    expect(isPersonalRecord(set(60, 5), undefined)).toBe(false); // first time: no PR noise
  });
});
