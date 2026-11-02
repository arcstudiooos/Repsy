import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type PrismaClient } from '@kinetic/db';
import { createTestDb } from '@kinetic/db/testing';
import { createHabit, logHabit } from '../habits/habits';
import { saveGroup, setGroupMembers } from '../groups/groups';
import { upsertSetLogs } from '../logging/upsertSetLogs';
import { completeSession, startSession } from '../sessions/lifecycle';
import { newClientWorld, newOrg, NOW, runAs, sessionsOf } from '../sessions/fixtures.test-helpers';
import {
  getChallenge,
  joinChallenge,
  leaveChallenge,
  listChallenges,
  saveChallenge,
} from './challenges';

let prisma: PrismaClient;
let drop: () => Promise<void>;
beforeAll(async () => {
  ({ prisma, drop } = await createTestDb());
});
afterAll(async () => {
  await drop();
});

describe('challenges and leaderboards (PRD H9)', () => {
  it('scores workouts, volume and habit days; the leaderboard shows only those who opted in', async () => {
    const org = await newOrg(prisma);
    const a = await newClientWorld(prisma, org);
    const b = await newClientWorld(prisma, { orgId: org.orgId, coach: org.coach });
    await expect(
      runAs(prisma, org.coach, (tx) =>
        saveChallenge(tx, org.coach, {
          title: 'Bad',
          metric: 'weight',
          startLocalDate: '2026-11-01',
          endLocalDate: '2026-11-30',
        }),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    const make = (title: string, metric: string) =>
      runAs(prisma, org.coach, (tx) =>
        saveChallenge(tx, org.coach, {
          title,
          metric,
          startLocalDate: '2026-11-01',
          endLocalDate: '2026-11-30',
        }),
      );
    const workouts = await make('November workouts', 'workouts');
    const volume = await make('Volume month', 'volume');
    const habits = await make('Habit streak', 'habit_days');

    for (const c of [workouts, volume, habits]) {
      await runAs(prisma, a.client, (tx) =>
        joinChallenge(tx, a.client, c.id, { onLeaderboard: true }, NOW),
      );
      await runAs(prisma, b.client, (tx) =>
        joinChallenge(tx, b.client, c.id, { onLeaderboard: false }, NOW),
      );
    }

    // A completes a workout with 50 kg x 5; B ticks a habit.
    const [s] = await sessionsOf(prisma, a.assignmentId);
    const detail = await runAs(prisma, a.client, (tx) =>
      startSession(tx, a.client, s!.id, { now: NOW }),
    );
    await runAs(prisma, a.client, (tx) =>
      upsertSetLogs(
        tx,
        a.client,
        s!.id,
        [
          {
            workoutVersionExerciseId: detail.workout.exercises[0]!.id,
            setIndex: 0,
            reps: 5,
            weightKg: 50,
            clientUpdatedAt: NOW.toISOString(),
            clientMutationId: crypto.randomUUID(),
          },
        ],
        { now: NOW },
      ),
    );
    await runAs(prisma, a.client, (tx) =>
      completeSession(tx, a.client, s!.id, { idempotencyKey: crypto.randomUUID() }, { now: NOW }),
    );
    const habit = await runAs(prisma, org.coach, (tx) =>
      createHabit(
        tx,
        org.coach,
        b.clientId,
        { title: 'Walk', startDate: '2026-11-04' },
        { now: NOW },
      ),
    );
    await runAs(prisma, b.client, (tx) => logHabit(tx, b.client, habit.id, {}, { now: NOW }));

    const coachView = await runAs(prisma, org.coach, (tx) =>
      getChallenge(tx, org.coach, workouts.id, NOW),
    );
    expect(coachView).toMatchObject({ status: 'live', participants: 2, isCoach: true });
    expect(coachView.leaderboard.map((e) => [e.score, e.rank, e.onLeaderboard])).toEqual([
      [1, 1, true],
      [0, null, false],
    ]);
    const asB = await runAs(prisma, b.client, (tx) => getChallenge(tx, b.client, workouts.id, NOW));
    expect(asB.leaderboard.map((e) => [e.name, e.score, e.rank, e.me])).toEqual([
      ['Client', 1, 1, false],
      ['Client', 0, null, true],
    ]);
    expect(
      (await runAs(prisma, org.coach, (tx) => getChallenge(tx, org.coach, volume.id, NOW)))
        .leaderboard[0]!.score,
    ).toBe(250);
    expect(
      (
        await runAs(prisma, org.coach, (tx) => getChallenge(tx, org.coach, habits.id, NOW))
      ).leaderboard.map((e) => e.score),
    ).toEqual([1, 0]);

    // A hides from the leaderboard: B now sees only themselves.
    await runAs(prisma, a.client, (tx) =>
      joinChallenge(tx, a.client, workouts.id, { onLeaderboard: false }, NOW),
    );
    expect(
      (
        await runAs(prisma, b.client, (tx) => getChallenge(tx, b.client, workouts.id, NOW))
      ).leaderboard.map((e) => e.me),
    ).toEqual([true]);
    await runAs(prisma, b.client, (tx) => leaveChallenge(tx, b.client, workouts.id));
    expect(
      (await runAs(prisma, b.client, (tx) => listChallenges(tx, b.client, NOW))).find(
        (c) => c.id === workouts.id,
      ),
    ).toMatchObject({ joined: false, participants: 1 });
  });

  it('limits a group challenge to its members and closes joining when it ends', async () => {
    const org = await newOrg(prisma);
    const a = await newClientWorld(prisma, org);
    const b = await newClientWorld(prisma, { orgId: org.orgId, coach: org.coach });
    const g = await runAs(prisma, org.coach, (tx) => saveGroup(tx, org.coach, { name: 'Team' }));
    await runAs(prisma, org.coach, (tx) => setGroupMembers(tx, org.coach, g.id, [a.clientId]));
    const c = await runAs(prisma, org.coach, (tx) =>
      saveChallenge(tx, org.coach, {
        title: 'Team challenge',
        metric: 'workouts',
        startLocalDate: '2026-10-01',
        endLocalDate: '2026-10-31',
        groupId: g.id,
      }),
    );
    expect(await runAs(prisma, a.client, (tx) => listChallenges(tx, a.client, NOW))).toMatchObject([
      { title: 'Team challenge', status: 'ended', groupName: 'Team' },
    ]);
    expect(await runAs(prisma, b.client, (tx) => listChallenges(tx, b.client, NOW))).toEqual([]);
    await expect(
      runAs(prisma, b.client, (tx) => getChallenge(tx, b.client, c.id, NOW)),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      runAs(prisma, a.client, (tx) => joinChallenge(tx, a.client, c.id, {}, NOW)),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});
