import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withSystem, type PrismaClient } from '@repsy/db';
import { createTestDb } from '@repsy/db/testing';
import { upsertSetLogs } from '../logging/upsertSetLogs';
import { newClientWorld, newOrg, runAs, sessionsOf } from '../sessions/fixtures.test-helpers';
import { completeSession, startSession } from '../sessions/lifecycle';
import { checkinWeekSummary } from './weekSummary';

let prisma: PrismaClient;
let drop: () => Promise<void>;

beforeAll(async () => {
  ({ prisma, drop } = await createTestDb());
});
afterAll(async () => {
  await drop();
});

const d = (s: string) => new Date(`${s}T00:00:00Z`);

describe('check-in week summary (PRD F8)', () => {
  it('collects workouts, PRs, measurements, habits and nutrition for the 7 days before', async () => {
    const w = await newClientWorld(prisma, await newOrg(prisma)); // sessions 4, 6 and 9 Nov
    const [first] = await sessionsOf(prisma, w.assignmentId);
    const detail = await runAs(prisma, w.client, (tx) => startSession(tx, w.client, first!.id));
    await runAs(prisma, w.client, (tx) =>
      upsertSetLogs(tx, w.client, first!.id, [
        {
          workoutVersionExerciseId: detail.workout.exercises[0]!.id,
          setIndex: 0,
          reps: 5,
          weightKg: 70,
          clientUpdatedAt: new Date(Date.now() - 3_600_000).toISOString(),
          clientMutationId: randomUUID(),
        },
      ]),
    );
    await runAs(prisma, w.client, (tx) =>
      completeSession(tx, w.client, first!.id, { idempotencyKey: randomUUID() }),
    );
    await withSystem(async (tx) => {
      const base = { organizationId: w.orgId, clientId: w.clientId };
      for (const [day, value] of [
        ['2026-10-30', 80],
        ['2026-11-05', 79.4],
        ['2026-11-08', 79],
      ] as const) {
        await tx.metricEntry.create({
          data: {
            ...base,
            metric: 'weight',
            measuredOn: d(day),
            value,
            source: 'client',
            recordedByUserId: w.userId,
          },
        });
      }
      const h = await tx.habit.create({
        data: {
          ...base,
          title: 'Walk',
          daysPerWeek: 5,
          startDate: d('2026-10-01'),
          createdByUserId: w.coach.userId,
        },
      });
      for (const day of ['2026-11-04', '2026-11-05', '2026-11-07']) {
        await tx.habitLog.create({ data: { ...base, habitId: h.id, localDate: d(day) } });
      }
      await tx.nutritionTarget.create({
        data: {
          ...base,
          effectiveFrom: d('2026-11-01'),
          calories: 2000,
          setByUserId: w.coach.userId,
        },
      });
      await tx.nutritionLog.create({
        data: { ...base, localDate: d('2026-11-05'), calories: 2100 },
      });
      await tx.nutritionLog.create({
        data: { ...base, localDate: d('2026-11-06'), calories: 2600 },
      });
    }, prisma);

    const summary = await runAs(prisma, w.client, (tx) =>
      checkinWeekSummary(tx, w.client, w.clientId, '2026-11-11'),
    );
    expect(summary).toMatchObject({
      fromLocalDate: '2026-11-04',
      toLocalDate: '2026-11-10',
      workouts: { completed: 1, planned: 3 },
      metrics: [{ metric: 'weight', value: 79, change: -1 }],
      habits: { done: 3, expected: 5 },
      nutrition: { onTarget: 1, logged: 2 },
    });
    expect(summary.personalRecords).toHaveLength(1);

    // Another client's summary is not reachable.
    const other = await newClientWorld(prisma, await newOrg(prisma));
    await expect(
      runAs(prisma, other.client, (tx) =>
        checkinWeekSummary(tx, other.client, w.clientId, '2026-11-11'),
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
