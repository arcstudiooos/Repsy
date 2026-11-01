import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withSystem, type PrismaClient } from '@kinetic/db';
import { createTestDb } from '@kinetic/db/testing';
import { getMyThread, sendMessage } from '../messages/messages';
import { newClientWorld, newOrg, NOW, runAs, sessionsOf } from '../sessions/fixtures.test-helpers';
import { completeSession } from '../sessions/lifecycle';
import {
  engagementDropped,
  getEngagement,
  recordPortalVisit,
  type EngagementWeek,
} from './engagement';

let prisma: PrismaClient;
let drop: () => Promise<void>;
beforeAll(async () => {
  ({ prisma, drop } = await createTestDb());
});
afterAll(async () => {
  await drop();
});

describe('engagement signal (PRD I4)', () => {
  it('scores a week from workouts, messages and portal visits', async () => {
    const org = await newOrg(prisma);
    const w = await newClientWorld(prisma, org); // workouts 4, 6, 9 Nov; NOW is Wed 4 Nov
    const [first] = await sessionsOf(prisma, w.assignmentId);
    await runAs(prisma, w.client, (tx) =>
      completeSession(tx, w.client, first!.id, { idempotencyKey: randomUUID() }, { now: NOW }),
    );
    const client = { id: w.clientId, timezone: 'America/New_York' };
    await runAs(prisma, w.client, async (tx) => {
      await recordPortalVisit(tx, client, NOW);
      await recordPortalVisit(tx, client, NOW); // once per day
    });
    let weeks = await runAs(prisma, org.coach, (tx) =>
      getEngagement(tx, org.coach, w.clientId, { now: NOW }),
    );
    expect(weeks).toHaveLength(8);
    const current = weeks[7]!;
    // Workouts 1/1 due so far, no check-in due, no message, 1 of 3 visit days.
    expect(current.parts).toEqual({ workouts: 1, checkins: null, messages: 0, visits: 0.33 });
    expect(current.score).toBe(44);
    const thread = await runAs(prisma, w.client, (tx) => getMyThread(tx, w.client));
    await runAs(prisma, w.client, (tx) =>
      sendMessage(tx, w.client, thread.id, { body: 'Done!' }, { now: NOW }),
    );
    weeks = await runAs(prisma, w.client, (tx) =>
      getEngagement(tx, w.client, w.clientId, { now: NOW }),
    );
    expect(weeks[7]!.score).toBe(78);
    // Weeks before the client existed have no score.
    await withSystem(
      (tx) =>
        tx.client.update({
          where: { id: w.clientId },
          data: { createdAt: new Date('2026-12-01') },
        }),
      prisma,
    );
    weeks = await runAs(prisma, org.coach, (tx) =>
      getEngagement(tx, org.coach, w.clientId, { now: NOW }),
    );
    expect(weeks.every((x) => x.score === null)).toBe(true);
  });

  it('a drop is 30 or more points under the three full weeks before (averaging 50+)', () => {
    const wk = (score: number | null, i: number): EngagementWeek => ({
      weekStart: `2026-10-${String(5 + 7 * i).padStart(2, '0')}`,
      score,
      parts: { workouts: null, checkins: null, messages: 0, visits: 0 },
    });
    const series = (...s: (number | null)[]) => s.map(wk);
    expect(engagementDropped(series(80, 70, 90, 45, 10))).toEqual({
      week: '2026-10-26',
      score: 45,
      before: 80,
    });
    expect(engagementDropped(series(80, 70, 90, 55, 10))).toBeNull();
    expect(engagementDropped(series(40, 45, 40, 0, 0))).toBeNull();
    expect(engagementDropped(series(null, 70, 90, 20, 0))).toBeNull();
  });
});
