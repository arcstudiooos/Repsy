import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withSystem, type PrismaClient } from '@repsy/db';
import { createTestDb } from '@repsy/db/testing';
import { applyPause } from '../clients/pause';
import { newClientWorld, newOrg, NOW, runAs, sessionsOf } from '../sessions/fixtures.test-helpers';
import { clientCompliance } from './compliance';

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

// newClientWorld schedules Mon/Wed/Fri from 2026-11-04 in New York: 11-04, 11-06 and 11-09. Grace is 24h.

describe('clientCompliance', () => {
  it('counts each rolling window by the analytics rules', async () => {
    const w = await newClientWorld(prisma, await newOrg(prisma));
    const [a, b] = await sessionsOf(prisma, w.assignmentId);
    await setState(a!.id, 'completed');
    await setState(b!.id, 'skipped');
    // The third session stays `scheduled` past its window: the sweep has not run, so it counts as missed.
    const now = new Date('2026-11-12T12:00:00Z'); // 11-12 in New York
    const map = await runAs(prisma, w.coach, (tx) =>
      clientCompliance(tx, w.coach, [w.clientId], { now }),
    );
    const c = map.get(w.clientId)!;
    // 7 days = 11-06..11-12: the skipped 11-06 and the missed 11-09.
    expect(c[7]).toEqual({ completed: 0, eligible: 2, skipped: 1, incomplete: 0, missed: 1 });
    expect(c[30]).toEqual({ completed: 1, eligible: 3, skipped: 1, incomplete: 0, missed: 1 });
    expect(c[90]).toEqual(c[30]);
  });

  it('window boundary: today minus 6 is in the 7-day window, today minus 7 is not', async () => {
    const w = await newClientWorld(prisma, await newOrg(prisma));
    const now = new Date('2026-11-15T17:00:00Z'); // 11-15 in New York; 7 days = 11-09..11-15
    const map = await runAs(prisma, w.coach, (tx) =>
      clientCompliance(tx, w.coach, [w.clientId], { now }),
    );
    expect(map.get(w.clientId)![7].eligible).toBe(1);
    expect(map.get(w.clientId)![30].eligible).toBe(3);
  });

  it('a session is not counted until its grace period ends', async () => {
    const w = await newClientWorld(prisma, await newOrg(prisma));
    // 11-09 is due 23:59 New York (11-10 04:59Z); with 24h grace it is not eligible at 11-10 12:00Z.
    const map = await runAs(prisma, w.coach, (tx) =>
      clientCompliance(tx, w.coach, [w.clientId], { now: new Date('2026-11-10T12:00:00Z') }),
    );
    expect(map.get(w.clientId)![7].eligible).toBe(2);
  });

  it('excludes cancelled sessions and paused time', async () => {
    const w = await newClientWorld(prisma, await newOrg(prisma));
    const [a] = await sessionsOf(prisma, w.assignmentId);
    await setState(a!.id, 'cancelled');
    await runAs(prisma, w.coach, (tx) =>
      applyPause(
        tx,
        w.coach,
        { clientId: w.clientId, startLocalDate: '2026-11-05', resumeLocalDate: '2026-11-19' },
        { now: NOW },
      ),
    );
    // On 11-18 the remaining sessions have moved to 11-20 and later, and the cancelled one never counts.
    const map = await runAs(prisma, w.coach, (tx) =>
      clientCompliance(tx, w.coach, [w.clientId], { now: new Date('2026-11-18T17:00:00Z') }),
    );
    expect(map.get(w.clientId)![90].eligible).toBe(0);
  });

  it('a client with nothing due gets zero counts, not a missing entry', async () => {
    const w = await newClientWorld(prisma, await newOrg(prisma));
    const map = await runAs(prisma, w.coach, (tx) =>
      clientCompliance(tx, w.coach, [w.clientId], { now: NOW }),
    );
    expect(map.get(w.clientId)![7]).toEqual({
      completed: 0,
      eligible: 0,
      skipped: 0,
      incomplete: 0,
      missed: 0,
    });
  });

  it('a time zone Intl cannot use skips only that client', async () => {
    const org = await newOrg(prisma);
    const good = await newClientWorld(prisma, org);
    const bad = await newClientWorld(prisma, org);
    await withSystem(
      (tx) => tx.client.update({ where: { id: bad.clientId }, data: { timezone: 'Not/AZone' } }),
      prisma,
    );
    const map = await runAs(prisma, org.coach, (tx) =>
      clientCompliance(tx, org.coach, [good.clientId, bad.clientId], { now: NOW }),
    );
    expect(map.has(good.clientId)).toBe(true);
    expect(map.has(bad.clientId)).toBe(false);
  });

  it('never reads another organization and refuses clients as actors', async () => {
    const mine = await newClientWorld(prisma, await newOrg(prisma));
    const theirs = await newClientWorld(prisma, await newOrg(prisma));
    const now = new Date('2026-11-12T12:00:00Z');
    const map = await runAs(prisma, mine.coach, (tx) =>
      clientCompliance(tx, mine.coach, [mine.clientId, theirs.clientId], { now }),
    );
    expect(map.has(mine.clientId)).toBe(true);
    expect(map.has(theirs.clientId)).toBe(false);
    expect(
      await runAs(prisma, mine.coach, (tx) => clientCompliance(tx, mine.coach, [], { now })),
    ).toEqual(new Map());
    await expect(
      runAs(prisma, mine.client, (tx) =>
        clientCompliance(tx, mine.client, [mine.clientId], { now }),
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
