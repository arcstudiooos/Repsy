import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@repsy/db';
import { createTestDb } from '@repsy/db/testing';
import { getSessionDetail } from './detail';
import {
  commitClientCopyVersion,
  newClientWorld,
  newOrg,
  NOW,
  runAs,
  sessionsOf,
} from './fixtures.test-helpers';
import { offlineStartedAt, startSession } from './lifecycle';
import { getPortalHome } from './read';

let prisma: PrismaClient;
let drop: () => Promise<void>;
beforeAll(async () => {
  ({ prisma, drop } = await createTestDb());
});
afterAll(async () => {
  await drop();
});

describe('offline start (PRD D4, D-011 #3)', () => {
  it('accepts a start queued with the version the device showed, at the tapped time', async () => {
    const org = await newOrg(prisma);
    const w = await newClientWorld(prisma, org);
    const [session] = await sessionsOf(prisma, w.assignmentId);
    const cached = await runAs(prisma, w.client, (tx) =>
      getSessionDetail(tx, w.client, session!.id, { now: NOW }),
    );
    const tapped = new Date(NOW.getTime() - 40 * 60_000).toISOString();
    const started = await runAs(prisma, w.client, (tx) =>
      startSession(tx, w.client, session!.id, {
        now: NOW,
        expectedWorkoutVersionId: cached.workout.workoutVersionId,
        startedAt: tapped,
      }),
    );
    expect(started.session.state).toBe('in_progress');
    expect(started.session.startedAt).toBe(tapped);
    // Replayed by the outbox: the same answer.
    const again = await runAs(prisma, w.client, (tx) =>
      startSession(tx, w.client, session!.id, {
        now: NOW,
        expectedWorkoutVersionId: cached.workout.workoutVersionId,
      }),
    );
    expect(again.session.startedAt).toBe(tapped);
  });

  it('refuses it when the coach changed the workout after the device kept it', async () => {
    const org = await newOrg(prisma);
    const w = await newClientWorld(prisma, org);
    const [session] = await sessionsOf(prisma, w.assignmentId);
    const cached = await runAs(prisma, w.client, (tx) =>
      getSessionDetail(tx, w.client, session!.id, { now: NOW }),
    );
    await commitClientCopyVersion(prisma, w, 'Changed');
    await expect(
      runAs(prisma, w.client, (tx) =>
        startSession(tx, w.client, session!.id, {
          now: NOW,
          expectedWorkoutVersionId: cached.workout.workoutVersionId,
        }),
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    const still = await runAs(prisma, w.client, (tx) =>
      getSessionDetail(tx, w.client, session!.id, { now: NOW }),
    );
    expect(still.session.state).toBe('scheduled');
  });

  it('lists the next 7 days of workouts for the device to keep', async () => {
    const org = await newOrg(prisma);
    const w = await newClientWorld(prisma, org);
    const sessions = await sessionsOf(prisma, w.assignmentId);
    const home = await runAs(prisma, w.client, (tx) => getPortalHome(tx, w.client, { now: NOW }));
    const inWeek = sessions
      .filter((s) => {
        const d = s.scheduledLocalDate.toISOString().slice(0, 10);
        return d >= '2026-11-04' && d < '2026-11-11';
      })
      .map((s) => s.id);
    expect(inWeek.length).toBeGreaterThan(0);
    expect(new Set(home.upcomingSessionIds)).toEqual(new Set(inWeek));
  });

  it('believes an offline start time only within the last 7 days', () => {
    const now = new Date('2026-11-04T13:00:00Z');
    expect(offlineStartedAt(undefined, now)).toEqual(now);
    expect(offlineStartedAt('2026-11-04T12:00:00Z', now).toISOString()).toBe(
      '2026-11-04T12:00:00.000Z',
    );
    expect(offlineStartedAt('2026-11-05T12:00:00Z', now)).toEqual(now);
    expect(offlineStartedAt('2026-10-01T12:00:00Z', now)).toEqual(now);
  });
});
