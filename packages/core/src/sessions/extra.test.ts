import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withSystem, type PrismaClient } from '@kinetic/db';
import { createTestDb } from '@kinetic/db/testing';
import { adherence } from '../analytics/adherence';
import { upsertSetLogs } from '../logging/upsertSetLogs';
import { commitProgramVersion } from '../programs/commit';
import { createProgram } from '../programs/read';
import { getPersonalRecords } from '../progress/records';
import {
  listSharedWorkouts,
  searchExtraExercises,
  setProgramShared,
  startExtraWorkout,
} from './extra';
import { BENCH, newClientWorld, newOrg, NOW, PRESS, runAs } from './fixtures.test-helpers';
import { completeSession } from './lifecycle';
import { getPortalHome, listSessions } from './read';
import { getSessionDetail } from './detail';

let prisma: PrismaClient;
let drop: () => Promise<void>;

beforeAll(async () => {
  ({ prisma, drop } = await createTestDb());
});
afterAll(async () => {
  await drop();
});

const code = (p: Promise<unknown>) =>
  p.then(
    () => 'ok',
    (e: { code?: string }) => e.code ?? 'other',
  );

describe('extra workouts (PRD D13)', () => {
  it('a client logs a blank extra workout: in history and records, never in adherence', async () => {
    const org = await newOrg(prisma);
    const w = await newClientWorld(prisma, org);
    const range = { from: '2026-11-01', to: '2026-11-30' };
    const before = await runAs(prisma, org.coach, (tx) => adherence(tx, range, NOW));
    const homeBefore = await runAs(prisma, w.client, (tx) =>
      getPortalHome(tx, w.client, { now: NOW }),
    );

    expect(
      await runAs(prisma, w.client, (tx) => searchExtraExercises(tx, w.client, 'bench press')),
    ).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: BENCH, name: 'Barbell Bench Press' })]),
    );
    const { sessionId } = await runAs(prisma, w.client, (tx) =>
      startExtraWorkout(
        tx,
        w.client,
        { exerciseIds: [BENCH, PRESS], title: 'Hotel gym' },
        { now: NOW },
      ),
    );
    // One open at a time.
    expect(
      await code(
        runAs(prisma, w.client, (tx) =>
          startExtraWorkout(tx, w.client, { exerciseIds: [BENCH] }, { now: NOW }),
        ),
      ),
    ).toBe('CONFLICT');

    const detail = await runAs(prisma, w.client, (tx) =>
      getSessionDetail(tx, w.client, sessionId, { now: NOW }),
    );
    expect(detail.session).toMatchObject({
      state: 'in_progress',
      extra: true,
      title: 'Hotel gym',
      scheduledLocalDate: '2026-11-04',
    });
    expect(detail.workout.exercises.map((e) => [e.exerciseId, e.sets.length])).toEqual([
      [BENCH, 3],
      [PRESS, 3],
    ]);
    const wve = detail.workout.exercises[0]!.id;
    await runAs(prisma, w.client, (tx) =>
      upsertSetLogs(
        tx,
        w.client,
        sessionId,
        [
          {
            workoutVersionExerciseId: wve,
            setIndex: 0,
            reps: 5,
            weightKg: 120,
            clientUpdatedAt: NOW.toISOString(),
            clientMutationId: crypto.randomUUID(),
          },
        ],
        { now: NOW },
      ),
    );
    await runAs(prisma, w.client, (tx) =>
      completeSession(
        tx,
        w.client,
        sessionId,
        { idempotencyKey: crypto.randomUUID() },
        { now: NOW },
      ),
    );

    const past = await runAs(prisma, w.client, (tx) =>
      listSessions(tx, w.client, { scope: 'past' }),
    );
    expect(past.items.find((s) => s.id === sessionId)).toMatchObject({
      state: 'completed',
      extra: true,
    });
    const records = await runAs(prisma, org.coach, (tx) =>
      getPersonalRecords(tx, org.coach, w.clientId),
    );
    expect(records.find((r) => r.exerciseId === BENCH)?.heaviest).toMatchObject({
      localDate: '2026-11-04',
    });

    expect(await runAs(prisma, org.coach, (tx) => adherence(tx, range, NOW))).toEqual(before);
    const homeAfter = await runAs(prisma, w.client, (tx) =>
      getPortalHome(tx, w.client, { now: NOW }),
    );
    expect(homeAfter.week).toEqual(homeBefore.week);
    // Coaches don't start extra workouts for clients.
    expect(
      await code(
        runAs(prisma, org.coach, (tx) =>
          startExtraWorkout(tx, org.coach, { exerciseIds: [BENCH] }),
        ),
      ),
    ).toBe('FORBIDDEN');
  });

  it('starts a workout the coach shares, and only a shared one', async () => {
    const org = await newOrg(prisma);
    const w = await newClientWorld(prisma, org);
    const template = await runAs(prisma, org.coach, (tx) =>
      createProgram(tx, org.coach, { title: 'Travel' }),
    );
    await runAs(prisma, org.coach, (tx) =>
      commitProgramVersion(tx, org.coach, {
        programId: template.id,
        expectedVersionNo: null,
        weeks: [
          {
            days: [{ title: 'Hotel A', exercises: [{ exerciseId: PRESS, sets: [{ reps: 12 }] }] }],
          },
        ],
      }),
    );
    expect(await runAs(prisma, w.client, (tx) => listSharedWorkouts(tx, w.client))).toEqual([]);
    // A client copy can't be shared.
    expect(
      await code(
        runAs(prisma, org.coach, (tx) => setProgramShared(tx, org.coach, w.clientProgramId, true)),
      ),
    ).toBe('VALIDATION');
    await runAs(prisma, org.coach, (tx) => setProgramShared(tx, org.coach, template.id, true));
    const shared = await runAs(prisma, w.client, (tx) => listSharedWorkouts(tx, w.client));
    expect(shared).toEqual([
      expect.objectContaining({
        title: 'Hotel A',
        programTitle: 'Travel',
        exercises: ['Incline Dumbbell Press'],
      }),
    ]);

    // A workout version from the client's own (unshared) program is refused.
    const ownSlot = await withSystem(
      (tx) =>
        tx.programSlot.findFirstOrThrow({
          where: { programVersion: { programId: w.clientProgramId } },
          select: { workoutVersionId: true },
        }),
      prisma,
    );
    expect(
      await code(
        runAs(prisma, w.client, (tx) =>
          startExtraWorkout(
            tx,
            w.client,
            { workoutVersionId: ownSlot.workoutVersionId },
            { now: NOW },
          ),
        ),
      ),
    ).toBe('NOT_FOUND');

    const { sessionId } = await runAs(prisma, w.client, (tx) =>
      startExtraWorkout(
        tx,
        w.client,
        { workoutVersionId: shared[0]!.workoutVersionId },
        { now: NOW },
      ),
    );
    const detail = await runAs(prisma, w.client, (tx) =>
      getSessionDetail(tx, w.client, sessionId, { now: NOW }),
    );
    expect(detail.session).toMatchObject({ extra: true, title: 'Hotel A' });

    await runAs(prisma, org.coach, (tx) => setProgramShared(tx, org.coach, template.id, false));
    expect(await runAs(prisma, w.client, (tx) => listSharedWorkouts(tx, w.client))).toEqual([]);
  });

  it('enforces the planned/extra shape in the database', async () => {
    const org = await newOrg(prisma);
    const w = await newClientWorld(prisma, org);
    await expect(
      withSystem(
        (tx) =>
          tx.workoutSession.updateMany({
            where: { assignmentId: w.assignmentId },
            data: { kind: 'extra' },
          }),
        prisma,
      ),
    ).rejects.toThrow(/workout_sessions_kind_check/);
  });
});
