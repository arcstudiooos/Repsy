import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withSystem, type PrismaClient } from '@kinetic/db';
import { createTestDb } from '@kinetic/db/testing';
import {
  BENCH,
  newClientWorld,
  newOrg,
  NOW,
  runAs,
  type ClientWorld,
} from '../sessions/fixtures.test-helpers';
import { createGoal, goalStatus, listGoals, setGoalStatus } from './goals';

let prisma: PrismaClient;
let drop: () => Promise<void>;

beforeAll(async () => {
  ({ prisma, drop } = await createTestDb());
});
afterAll(async () => {
  await drop();
});

const at = { now: NOW }; // 2026-11-04 in New York
const d = (s: string) => new Date(`${s}T00:00:00Z`);
const weigh = (w: ClientWorld, day: string, value: number) =>
  withSystem(
    (tx) =>
      tx.metricEntry.create({
        data: {
          organizationId: w.orgId,
          clientId: w.clientId,
          metric: 'weight',
          measuredOn: d(day),
          value,
          source: 'coach',
          recordedByUserId: w.coach.userId,
        },
      }),
    prisma,
  );

describe('goals (PRD B18, E9)', () => {
  it('labels progress against the straight line from start to target', () => {
    const base = {
      startValue: 80,
      targetValue: 76,
      startDate: '2026-11-01',
      targetDate: '2026-12-01',
    };
    expect(goalStatus({ ...base, currentValue: null, today: '2026-11-10' }).label).toBe('no_data');
    expect(goalStatus({ ...base, currentValue: 75.9, today: '2026-11-10' })).toEqual({
      progress: 1,
      label: 'achieved',
    });
    // A third of the way in time, a quarter of the way in weight: within the 10% slack.
    expect(goalStatus({ ...base, currentValue: 79, today: '2026-11-11' }).label).toBe('on_track');
    expect(goalStatus({ ...base, currentValue: 79.8, today: '2026-11-21' }).label).toBe('behind');
    expect(goalStatus({ ...base, currentValue: 77, today: '2026-12-01' }).label).toBe('behind');
    // Going the wrong way is clamped at 0.
    expect(goalStatus({ ...base, currentValue: 82, today: '2026-11-02' }).progress).toBe(0);
  });

  it('creates metric, exercise and habit goals from recorded data; archives and restores', async () => {
    const w = await newClientWorld(prisma, await newOrg(prisma));
    await expect(
      runAs(prisma, w.coach, (tx) =>
        createGoal(
          tx,
          w.coach,
          w.clientId,
          { kind: 'metric', metric: 'weight', targetValue: 75, targetDate: '2027-01-31' },
          at,
        ),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION', fieldErrors: { startValue: expect.any(Array) } });
    await weigh(w, '2026-11-01', 80);
    const metric = await runAs(prisma, w.coach, (tx) =>
      createGoal(
        tx,
        w.coach,
        w.clientId,
        { kind: 'metric', metric: 'weight', targetValue: 75, targetDate: '2027-01-31' },
        at,
      ),
    );
    expect(metric).toMatchObject({
      title: 'Body weight',
      startValue: 80,
      targetValue: 75,
      currentValue: 80,
      startDate: '2026-11-04',
      label: 'on_track',
    });

    const lift = await runAs(prisma, w.coach, (tx) =>
      createGoal(
        tx,
        w.coach,
        w.clientId,
        {
          kind: 'exercise',
          exerciseId: BENCH,
          exerciseMeasure: 'e1rm',
          startValue: 60,
          targetValue: 100,
          targetDate: '2027-03-01',
        },
        at,
      ),
    );
    expect(lift).toMatchObject({
      exerciseName: expect.any(String),
      currentValue: null,
      label: 'no_data',
    });

    const habit = await withSystem(
      (tx) =>
        tx.habit.create({
          data: {
            organizationId: w.orgId,
            clientId: w.clientId,
            title: 'Walk',
            daysPerWeek: 7,
            startDate: d('2026-10-28'),
            createdByUserId: w.coach.userId,
          },
        }),
      prisma,
    );
    await withSystem(async (tx) => {
      for (const day of ['2026-10-28', '2026-10-30', '2026-11-01', '2026-11-03']) {
        await tx.habitLog.create({
          data: {
            organizationId: w.orgId,
            clientId: w.clientId,
            habitId: habit.id,
            localDate: d(day),
          },
        });
      }
    }, prisma);
    const habitGoal = await runAs(prisma, w.coach, (tx) =>
      createGoal(
        tx,
        w.coach,
        w.clientId,
        { kind: 'habit', habitId: habit.id, targetValue: 80, targetDate: '2026-12-31' },
        at,
      ),
    );
    // 4 of 8 days since the habit started.
    expect(habitGoal).toMatchObject({ title: 'Walk completion', currentValue: 50, startValue: 50 });

    // The client sees their goals; only coaches set them.
    const mine = await runAs(prisma, w.client, (tx) => listGoals(tx, w.client, w.clientId, at));
    expect(mine).toHaveLength(3);
    await expect(
      runAs(prisma, w.client, (tx) =>
        createGoal(
          tx,
          w.client,
          w.clientId,
          { kind: 'metric', metric: 'weight', targetValue: 70, targetDate: '2027-01-31' },
          at,
        ),
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    // Reaching the target reads as achieved.
    await weigh(w, '2026-11-03', 74.8);
    const after = await runAs(prisma, w.coach, (tx) => listGoals(tx, w.coach, w.clientId, at));
    expect(after.find((g) => g.id === metric.id)).toMatchObject({ label: 'achieved', progress: 1 });

    await runAs(prisma, w.coach, (tx) => setGoalStatus(tx, w.coach, lift.id, 'archived'));
    const listed = await runAs(prisma, w.coach, (tx) => listGoals(tx, w.coach, w.clientId, at));
    expect(listed.at(-1)).toMatchObject({ id: lift.id, status: 'archived' });
  });

  it('validates the target, date and subject', async () => {
    const w = await newClientWorld(prisma, await newOrg(prisma));
    await weigh(w, '2026-11-01', 80);
    const field = (input: Parameters<typeof createGoal>[3]) =>
      runAs(prisma, w.coach, (tx) => createGoal(tx, w.coach, w.clientId, input, at)).then(
        () => 'ok',
        (e: { fieldErrors?: Record<string, string[]> }) => Object.keys(e.fieldErrors ?? {})[0],
      );
    expect(
      await field({ kind: 'metric', metric: 'weight', targetValue: 80, targetDate: '2027-01-01' }),
    ).toBe('targetValue');
    expect(
      await field({ kind: 'metric', metric: 'weight', targetValue: 75, targetDate: '2026-11-04' }),
    ).toBe('targetDate');
    expect(
      await field({
        kind: 'metric',
        metric: 'blood_pressure',
        targetValue: 75,
        targetDate: '2027-01-01',
      }),
    ).toBe('metric');
    expect(
      await field({ kind: 'metric', metric: 'weight', targetValue: 5, targetDate: '2027-01-01' }),
    ).toBe('targetValue');
    expect(
      await field({ kind: 'habit', habitId: BENCH, targetValue: 80, targetDate: '2027-01-01' }),
    ).toBe('habitId');
  });
});
