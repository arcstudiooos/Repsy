import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withSystem, type PrismaClient } from '@kinetic/db';
import { createTestDb } from '@kinetic/db/testing';
import { commitProgramVersion, type WeekInput } from '../programs/commit';
import {
  BENCH,
  grid,
  newClientWorld,
  newOrg,
  NOW,
  runAs,
  sessionsOf,
  type ClientWorld,
} from '../sessions/fixtures.test-helpers';
import { listSessions } from '../sessions/read';

let prisma: PrismaClient;
let drop: () => Promise<void>;

beforeAll(async () => {
  ({ prisma, drop } = await createTestDb());
});
afterAll(async () => {
  await drop();
});

/** A 2-day client program on Mon/Thu from Monday 2026-11-09 (New York); `weeks` defaults to 4. */
const world = async (weeks = 4) =>
  newClientWorld(prisma, await newOrg(prisma), {
    weeks: grid(weeks, 2),
    weekdays: [1, 4],
    startLocalDate: '2026-11-09',
  });

/** Commits `weeks` to the client copy on top of its current version. */
async function commitCopy(w: ClientWorld, weeks: WeekInput[], now = NOW) {
  const current = await withSystem(
    (tx) =>
      tx.program.findUniqueOrThrow({
        where: { id: w.clientProgramId },
        select: { currentVersion: { select: { versionNo: true } } },
      }),
    prisma,
  );
  return runAs(prisma, w.coach, (tx) =>
    commitProgramVersion(
      tx,
      w.coach,
      {
        programId: w.clientProgramId,
        expectedVersionNo: current.currentVersion?.versionNo ?? null,
        weeks,
      },
      { now },
    ),
  );
}

const setState = (id: string, data: Record<string, unknown>) =>
  withSystem((tx) => tx.workoutSession.update({ where: { id }, data }), prisma);

const keyed = async (w: ClientWorld) => {
  const rows = await sessionsOf(prisma, w.assignmentId);
  return new Map(rows.map((s) => [`W${s.slotWeekIndex + 1}D${s.slotDayIndex + 1}`, s]));
};
const localDate = (d: Date) => d.toISOString().slice(0, 10);

describe('reconcileSessions (through client-copy commits)', () => {
  it('remove week 3 → only unstarted W3 sessions cancelled; completed W1 untouched', async () => {
    // Slots are positional, so "remove week 3" of a 3-week block drops slot keys W3D1/W3D2.
    const w = await world(3);
    const before = await keyed(w);
    await setState(before.get('W1D1')!.id, { state: 'completed', completedAt: NOW });
    await setState(before.get('W1D2')!.id, { state: 'completed', completedAt: NOW });
    await setState(before.get('W3D1')!.id, { state: 'completed', completedAt: NOW });

    await commitCopy(w, grid(2, 2));
    const after = await keyed(w);
    expect(after.get('W3D2')!.state).toBe('cancelled');
    expect(after.get('W3D1')!.state).toBe('completed');
    for (const key of ['W1D1', 'W1D2', 'W2D1', 'W2D2', 'W3D1']) {
      const { state, scheduledAt, dueAt, scheduledLocalDate, workoutVersionId } = before.get(key)!;
      const now = after.get(key)!;
      if (key !== 'W1D1' && key !== 'W1D2' && key !== 'W3D1') expect(now.state).toBe(state);
      expect(now).toMatchObject({ scheduledAt, dueAt, scheduledLocalDate, workoutVersionId });
    }
    expect(after.size).toBe(6);
  });

  it('in_progress W2D1 keeps its locked version after a commit that changes W2D1', async () => {
    const w = await world();
    const before = await keyed(w);
    const w2d1 = before.get('W2D1')!;
    const slot = await withSystem(
      (tx) =>
        tx.program.findUniqueOrThrow({
          where: { id: w.clientProgramId },
          select: {
            currentVersion: {
              select: { slots: { where: { weekIndex: 1, dayIndex: 0 } } },
            },
          },
        }),
      prisma,
    );
    const locked = slot.currentVersion!.slots[0]!.workoutVersionId;
    await setState(w2d1.id, { state: 'in_progress', workoutVersionId: locked, startedAt: NOW });

    const changed = grid(4, 2);
    changed[1]!.days[0] = {
      title: 'Changed',
      exercises: [{ exerciseId: BENCH, sets: [{ reps: 3, loadKg: 100 }] }],
    };
    await commitCopy(w, changed);
    expect((await keyed(w)).get('W2D1')).toMatchObject({
      state: 'in_progress',
      workoutVersionId: locked,
      scheduledAt: w2d1.scheduledAt,
    });

    // Removing every week after the first cancels only the scheduled ones.
    await commitCopy(w, grid(1, 2));
    const after = await keyed(w);
    expect(after.get('W2D1')).toMatchObject({
      state: 'in_progress',
      workoutVersionId: locked,
      scheduledAt: w2d1.scheduledAt,
      dueAt: w2d1.dueAt,
    });
    for (const key of ['W2D2', 'W3D1', 'W3D2', 'W4D1', 'W4D2']) {
      expect(after.get(key)!.state).toBe('cancelled');
    }
    expect(after.get('W1D1')!.state).toBe('scheduled');
  });

  it('add week 5 → two sessions after the last session, on Mon/Thu, 23:59 local due', async () => {
    const w = await world();
    const res = await commitCopy(w, grid(5, 2));
    expect(res.versionNo).toBe(2);
    const after = await keyed(w);
    expect(after.size).toBe(10);
    // The last session is W4D2 on Thursday 2026-12-03.
    expect(localDate(after.get('W4D2')!.scheduledLocalDate)).toBe('2026-12-03');
    const w5d1 = after.get('W5D1')!;
    const w5d2 = after.get('W5D2')!;
    expect(localDate(w5d1.scheduledLocalDate)).toBe('2026-12-07');
    expect(localDate(w5d2.scheduledLocalDate)).toBe('2026-12-10');
    expect(w5d1).toMatchObject({ state: 'scheduled', workoutVersionId: null, pauseOffsetDays: 0 });
    // New York is UTC-5 in December: 00:00 local = 05:00Z, 23:59 local = 04:59Z next day.
    expect(w5d1.scheduledAt.toISOString()).toBe('2026-12-07T05:00:00.000Z');
    expect(w5d1.dueAt.toISOString()).toBe('2026-12-08T04:59:00.000Z');
    expect(w5d2.dueAt.toISOString()).toBe('2026-12-11T04:59:00.000Z');
  });

  it('remove week 4 then re-add it → the cancelled rows are revived, not duplicated', async () => {
    const w = await world();
    const before = await keyed(w);
    await commitCopy(w, grid(3, 2));
    const removed = await keyed(w);
    expect(removed.get('W4D1')!.state).toBe('cancelled');
    expect(removed.get('W4D2')!.state).toBe('cancelled');

    await commitCopy(w, grid(4, 2));
    const after = await keyed(w);
    expect(after.size).toBe(8);
    for (const key of ['W4D1', 'W4D2']) {
      expect(after.get(key)!.id).toBe(before.get(key)!.id);
      expect(after.get(key)).toMatchObject({
        state: 'scheduled',
        workoutVersionId: null,
        pauseOffsetDays: 0,
      });
    }
    // Dated after the latest non-cancelled session (W3D2, Thursday 2026-11-26).
    expect(localDate(after.get('W4D1')!.scheduledLocalDate)).toBe('2026-11-30');
    expect(localDate(after.get('W4D2')!.scheduledLocalDate)).toBe('2026-12-03');
  });

  it('added slots never dated before today', async () => {
    const w = await world();
    // Sunday 2026-12-20, 10:00 in New York: the last session (2026-12-03) is long past.
    const later = new Date('2026-12-20T15:00:00Z');
    await commitCopy(w, grid(5, 2), later);
    const after = await keyed(w);
    expect(localDate(after.get('W5D1')!.scheduledLocalDate)).toBe('2026-12-21');
    expect(localDate(after.get('W5D2')!.scheduledLocalDate)).toBe('2026-12-24');
  });

  it('unstarted session whose slot was removed is cancelled', async () => {
    const w = await world();
    const before = await keyed(w);
    await commitCopy(w, grid(3, 2));
    const after = await keyed(w);
    expect(after.get('W4D1')!.state).toBe('cancelled');
    // It no longer surfaces as an upcoming session pointing at a slot that does not exist.
    const upcoming = await runAs(prisma, w.client, (tx) =>
      listSessions(tx, w.client, { scope: 'upcoming' }, { now: NOW }),
    );
    const ids = upcoming.items.map((s) => s.id);
    expect(ids).not.toContain(before.get('W4D1')!.id);
    expect(ids).not.toContain(before.get('W4D2')!.id);
    expect(ids).toHaveLength(6);
  });
});
