import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withSystem, type PrismaClient } from '@repsy/db';
import { createTestDb } from '@repsy/db/testing';
import { newClientWorld, newOrg, NOW, runAs, sessionsOf } from '../sessions/fixtures.test-helpers';
import { completeSession } from '../sessions/lifecycle';
import { queueWeeklyBriefs, weeklyBriefFacts } from './brief';

let prisma: PrismaClient;
let drop: () => Promise<void>;
beforeAll(async () => {
  ({ prisma, drop } = await createTestDb());
});
afterAll(async () => {
  await drop();
});

const MONDAY = new Date('2026-11-09T13:00:00Z'); // 08:00 in New York

describe('weekly coach brief (PRD I9)', () => {
  it('counts last week’s wins and this week’s due work, and goes out once on Monday', async () => {
    const org = await newOrg(prisma);
    const w = await newClientWorld(prisma, org); // workouts 4, 6 and 9 Nov
    const [a, b] = await sessionsOf(prisma, w.assignmentId);
    for (const s of [a, b]) {
      await runAs(prisma, w.client, (tx) =>
        completeSession(tx, w.client, s!.id, { idempotencyKey: randomUUID() }, { now: NOW }),
      );
    }
    const facts = await runAs(prisma, org.coach, (tx) =>
      weeklyBriefFacts(tx, 'America/New_York', MONDAY),
    );
    expect(facts).toEqual({
      weekStart: '2026-11-02',
      completed: 2,
      perfectWeeks: 1,
      slipped: 0,
      workoutsDue: 1,
      checkinsDue: 0,
      programsEnding: 1,
    });

    const queue = (now: Date) =>
      runAs(prisma, org.coach, (tx) => queueWeeklyBriefs(tx, org.orgId, now));
    // Not opted in: nothing.
    expect(await queue(MONDAY)).toEqual({ queued: 0 });
    await withSystem(
      (tx) =>
        tx.notificationPreference.upsert({
          where: { userId: org.coach.userId },
          create: { userId: org.coach.userId, weeklyBriefOptIn: true },
          update: { weeklyBriefOptIn: true },
        }),
      prisma,
    );
    expect(await queue(new Date('2026-11-09T11:00:00Z'))).toEqual({ queued: 0 }); // 06:00 local
    expect(await queue(MONDAY)).toEqual({ queued: 1 });
    expect(await queue(new Date('2026-11-09T20:00:00Z'))).toEqual({ queued: 0 });
    expect(await queue(new Date('2026-11-10T13:00:00Z'))).toEqual({ queued: 0 }); // Tuesday
    const [email] = await withSystem(
      (tx) =>
        tx.outboxEmail.findMany({ where: { kind: 'weekly_brief', toUserId: org.coach.userId } }),
      prisma,
    );
    expect(email!.payloadJson).toMatchObject({ completed: 2, perfectWeeks: 1, workoutsDue: 1 });
    expect(JSON.stringify(email!.payloadJson)).not.toContain('Client');
  });
});
