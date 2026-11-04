import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withSystem, type PrismaClient } from '@kinetic/db';
import { createTestDb } from '@kinetic/db/testing';
import { DomainError } from '../errors';
import { newClientWorld, newOrg, runAs, sessionsOf } from '../sessions/fixtures.test-helpers';
import {
  bucketOf,
  getAdherenceSeries,
  getClientAdherence,
  getClientConsistency,
  getDailySessionStates,
  getStreak,
  pctOf,
} from './series';

let prisma: PrismaClient;
let drop: () => Promise<void>;

beforeAll(async () => {
  ({ prisma, drop } = await createTestDb());
});
afterAll(async () => {
  await drop();
});

const setState = (id: string, state: string) =>
  withSystem(
    (tx) => tx.workoutSession.update({ where: { id }, data: { state: state as never } }),
    prisma,
  );

/** The fixture schedules Mon/Wed/Fri from 11-04 (New York), grace 24h. */
const LATER = new Date('2026-11-20T12:00:00Z');

describe('bucketOf', () => {
  it('maps states the way adherence does', () => {
    expect(bucketOf('completed', false)).toBe('completed');
    expect(bucketOf('scheduled', false)).toBe('due');
    expect(bucketOf('scheduled', true)).toBe('missed');
    expect(bucketOf('in_progress', true)).toBe('notFinished');
    expect(bucketOf('incomplete', true)).toBe('notFinished');
    expect(bucketOf('cancelled', true)).toBeNull();
    expect(pctOf(1, 3)).toBe(33.3);
    expect(pctOf(0, 0)).toBeNull();
  });
});

describe('series', () => {
  it('weekly adherence, daily states, per-client rows and consistency agree', async () => {
    const w = await newClientWorld(prisma, await newOrg(prisma));
    const [a, b, c] = await sessionsOf(prisma, w.assignmentId);
    await setState(a!.id, 'completed');
    await setState(b!.id, 'skipped');
    await setState(c!.id, 'completed');

    const weeks = await runAs(prisma, w.coach, (tx) =>
      getAdherenceSeries(tx, w.coach, { weeks: 4, now: LATER }),
    );
    expect(weeks).toHaveLength(4);
    const total = weeks.reduce((s, x) => s + x.completed, 0);
    expect(total).toBe(2);
    const wk = weeks.find((x) => x.weekStart === '2026-11-02');
    expect(wk).toMatchObject({ completed: 1, skipped: 1, eligible: 2, adherencePct: 50 });
    expect(weeks.find((x) => x.weekStart === '2026-11-09')?.completed).toBe(1);

    const days = await runAs(prisma, w.coach, (tx) =>
      getDailySessionStates(tx, w.coach, { weekStart: '2026-11-04', now: LATER }),
    );
    expect(days.map((d) => d.localDate)[0]).toBe('2026-11-02');
    expect(days.find((d) => d.localDate === '2026-11-04')?.completed).toBe(1);
    expect(days.find((d) => d.localDate === '2026-11-06')?.skipped).toBe(1);

    const rows = await runAs(prisma, w.coach, (tx) =>
      getClientAdherence(tx, w.coach, [w.clientId], { days: 28, now: LATER }),
    );
    const row = rows.get(w.clientId)!;
    expect(row.counts.completed).toBeGreaterThanOrEqual(2);
    expect(row.lastWorkout).toBe('2026-11-09');
    expect(row.week).toHaveLength(7);

    const cells = await runAs(prisma, w.coach, (tx) =>
      getClientConsistency(tx, w.coach, w.clientId, { weeks: 4, now: LATER }),
    );
    expect(cells).toHaveLength(28);
    expect(cells.find((x) => x.localDate === '2026-11-06')?.state).toBe('skipped');
  });

  it('streak counts back from the latest and stops at a non-completed session', async () => {
    const w = await newClientWorld(prisma, await newOrg(prisma));
    const [a, b, c] = await sessionsOf(prisma, w.assignmentId);
    await setState(a!.id, 'missed');
    await setState(b!.id, 'completed');
    await setState(c!.id, 'completed');
    const streak = await runAs(prisma, w.coach, (tx) =>
      getStreak(tx, w.coach, w.clientId, { now: new Date('2026-11-10T12:00:00Z') }),
    );
    expect(streak).toBe(2);
  });

  it('a client sees only their own series; org series need staff', async () => {
    const w = await newClientWorld(prisma, await newOrg(prisma));
    const other = await newClientWorld(prisma, await newOrg(prisma));
    await expect(
      runAs(prisma, w.client, (tx) => getAdherenceSeries(tx, w.client, { now: LATER })),
    ).rejects.toThrow(DomainError);
    await expect(
      runAs(prisma, w.client, (tx) => getStreak(tx, w.client, other.clientId)),
    ).rejects.toThrow(DomainError);
    expect(
      await runAs(prisma, w.client, (tx) => getStreak(tx, w.client, w.clientId, { now: LATER })),
    ).toBeGreaterThanOrEqual(0);
  });
});
