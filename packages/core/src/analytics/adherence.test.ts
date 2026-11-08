import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withSystem, type PrismaClient } from '@repsy/db';
import { createTestDb } from '@repsy/db/testing';
import { applyPause } from '../clients/pause';
import { DomainError } from '../errors';
import { updateFlag } from '../review/flags';
import { createFollowup } from '../review/flags';
import { newClientWorld, newOrg, NOW, runAs, sessionsOf } from '../sessions/fixtures.test-helpers';
import { adherence, getAnalytics, parseRange } from './adherence';

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

/** Mon/Wed/Fri from 11-04 (New York): 11-04, 11-06, 11-09; grace 24h. */
const LATER = new Date('2026-11-20T12:00:00Z');

describe('adherence', () => {
  it('window boundary: a session on the `to` date counts; outside it does not', async () => {
    const w = await newClientWorld(prisma, await newOrg(prisma));
    const [a, b, c] = await sessionsOf(prisma, w.assignmentId);
    await setState(a!.id, 'completed');
    await setState(b!.id, 'skipped');
    await setState(c!.id, 'incomplete');
    const run = (from: string, to: string) =>
      runAs(prisma, w.coach, (tx) => adherence(tx, { from, to }, LATER));
    expect(await run('2026-11-04', '2026-11-09')).toEqual({
      completed: 1,
      eligible: 3,
      skipped: 1,
      incomplete: 1,
      missed: 0,
    });
    expect((await run('2026-11-04', '2026-11-06')).eligible).toBe(2);
    expect((await run('2026-11-05', '2026-11-05')).eligible).toBe(0);
  });

  it('zero denominator before anything is due; cancelled excluded', async () => {
    const w = await newClientWorld(prisma, await newOrg(prisma));
    const [a] = await sessionsOf(prisma, w.assignmentId);
    await setState(a!.id, 'cancelled');
    const early = await runAs(prisma, w.coach, (tx) =>
      adherence(tx, { from: '2026-11-04', to: '2026-11-09' }, new Date('2026-11-05T12:00:00Z')),
    );
    expect(early.eligible).toBe(0);
  });

  it('paused time is excluded: shifted sessions are not due in the paused days', async () => {
    const w = await newClientWorld(prisma, await newOrg(prisma));
    await runAs(prisma, w.coach, (tx) =>
      applyPause(
        tx,
        w.coach,
        { clientId: w.clientId, startLocalDate: '2026-11-05', resumeLocalDate: '2026-11-19' },
        { now: NOW },
      ),
    );
    const counts = await runAs(prisma, w.coach, (tx) =>
      adherence(tx, { from: '2026-11-04', to: '2026-11-18' }, LATER),
    );
    // Only 11-04 stays in the range; the rest moved to 11-20 and later.
    expect(counts.eligible).toBe(1);
  });
});

describe('getAnalytics', () => {
  it('assigned vs finished, response rate and time to follow-up', async () => {
    const w = await newClientWorld(prisma, await newOrg(prisma));
    const [a] = await sessionsOf(prisma, w.assignmentId);
    await setState(a!.id, 'completed');
    const f = await runAs(prisma, w.coach, (tx) =>
      createFollowup(tx, w.coach, { clientId: w.clientId, title: 'Call' }),
    );
    await withSystem(
      (tx) =>
        tx.reviewFlag.update({
          where: { id: f.id },
          data: { createdAt: new Date('2026-11-06T10:00:00Z') },
        }),
      prisma,
    );
    await runAs(prisma, w.coach, (tx) =>
      updateFlag(
        tx,
        w.coach,
        f.id,
        { action: 'resolve', reason: 'Done' },
        { now: new Date('2026-11-06T16:00:00Z') },
      ),
    );
    const view = await runAs(prisma, w.coach, (tx) =>
      getAnalytics(tx, w.coach, { from: '2026-11-01', to: '2026-11-30' }, { now: LATER }),
    );
    expect(view.workouts).toEqual({ assigned: 3, finished: 1 });
    expect(view.adherence).toMatchObject({ completed: 1, eligible: 3 });
    expect(view.responseRate).toEqual({ numerator: 0, denominator: 0 });
    expect(view.timeToFollowUp).toEqual({ medianHours: 6, closed: 1 });
  });

  it('validates the range and the role', async () => {
    expect(() => parseRange({ from: '2026-11-10', to: '2026-11-01' })).toThrow(DomainError);
    expect(() => parseRange({ from: '2026-02-30', to: '2026-03-01' })).toThrow(DomainError);
    expect(() => parseRange({ from: '2025-01-01', to: '2026-11-01' })).toThrow(DomainError);
    const w = await newClientWorld(prisma, await newOrg(prisma));
    await expect(
      runAs(prisma, w.client, (tx) =>
        getAnalytics(tx, w.client, { from: '2026-11-01', to: '2026-11-30' }),
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
