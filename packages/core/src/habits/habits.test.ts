import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@kinetic/db';
import { createTestDb } from '@kinetic/db/testing';
import { newClientWorld, newOrg, runAs } from '../sessions/fixtures.test-helpers';
import { createHabit, listHabits, logHabit, setHabitStatus, summarizeHabit } from './habits';

let prisma: PrismaClient;
let drop: () => Promise<void>;

beforeAll(async () => {
  ({ prisma, drop } = await createTestDb());
});
afterAll(async () => {
  await drop();
});

/** Thursday 2026-11-12 in New York. */
const NOW = new Date('2026-11-12T17:00:00Z');
const row = (over: Partial<Parameters<typeof summarizeHabit>[0]> = {}) => ({
  id: 'h',
  title: 'Walk',
  isTask: false,
  daysPerWeek: 7,
  targetCount: null,
  unit: null,
  startDate: new Date('2026-10-01T00:00:00Z'),
  endDate: null,
  dueDate: null,
  status: 'active' as const,
  ...over,
});
const days = (...d: string[]) => Object.fromEntries(d.map((x) => [x, 1]));

describe('summarizeHabit', () => {
  it('daily streak counts back from yesterday until today is ticked', () => {
    const logs = days('2026-11-09', '2026-11-10', '2026-11-11');
    expect(summarizeHabit(row(), logs, '2026-11-12').streak).toBe(3);
    expect(summarizeHabit(row(), { ...logs, '2026-11-12': 1 }, '2026-11-12')).toMatchObject({
      streak: 4,
      doneToday: true,
      doneThisWeek: 4,
    });
    expect(summarizeHabit(row(), days('2026-11-10', '2026-11-11'), '2026-11-13').streak).toBe(0);
  });

  it('weekly target: weeks that met it, the current week not breaking the streak', () => {
    const h = row({ daysPerWeek: 3 });
    // Weeks of Oct 26 and Nov 2 met 3 days; the week of Nov 9 has 1 so far.
    const logs = days(
      '2026-10-26',
      '2026-10-28',
      '2026-10-30',
      '2026-11-02',
      '2026-11-03',
      '2026-11-05',
      '2026-11-10',
    );
    expect(summarizeHabit(h, logs, '2026-11-12')).toMatchObject({ streak: 2, doneThisWeek: 1 });
  });

  it('targets: a day counts only when the amount reaches the target', () => {
    const h = row({ targetCount: 8, unit: 'glasses' });
    const v = summarizeHabit(h, { '2026-11-12': 5, '2026-11-11': 8 }, '2026-11-12');
    expect(v).toMatchObject({ doneToday: false, streak: 1 });
  });

  it('completion uses the last 28 days within the habit dates', () => {
    const h = row({ startDate: new Date('2026-11-06T00:00:00Z'), daysPerWeek: 7 });
    const v = summarizeHabit(h, days('2026-11-06', '2026-11-07', '2026-11-12'), '2026-11-12');
    expect(v.completion).toEqual({ done: 3, expected: 7 });
    expect(
      summarizeHabit(row({ startDate: new Date('2026-11-13T00:00:00Z') }), {}, '2026-11-12')
        .completion,
    ).toBeNull();
  });
});

describe('habits in the database', () => {
  it('coach assigns, client ticks today and the two days before; a repeat tick is idempotent', async () => {
    const w = await newClientWorld(prisma, await newOrg(prisma));
    const habit = await runAs(prisma, w.coach, (tx) =>
      createHabit(
        tx,
        w.coach,
        w.clientId,
        { title: 'Walk 8k steps', startDate: '2026-11-01' },
        { now: NOW },
      ),
    );
    expect(habit).toMatchObject({ daysPerWeek: 7, isTask: false, streak: 0 });
    for (const d of ['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-12']) {
      await runAs(prisma, w.client, (tx) =>
        logHabit(tx, w.client, habit.id, { localDate: d }, { now: NOW }),
      );
    }
    const view = await runAs(prisma, w.client, (tx) =>
      listHabits(tx, w.client, w.clientId, { now: NOW }),
    );
    expect(view.habits[0]).toMatchObject({ streak: 3, doneToday: true });
    expect(Object.keys(view.habits[0]!.logs)).toHaveLength(3);
    // Too far back, in the future, or before the start.
    for (const d of ['2026-11-09', '2026-11-13']) {
      await expect(
        runAs(prisma, w.client, (tx) =>
          logHabit(tx, w.client, habit.id, { localDate: d }, { now: NOW }),
        ),
      ).rejects.toMatchObject({ code: 'VALIDATION' });
    }
    // Untick.
    const off = await runAs(prisma, w.client, (tx) =>
      logHabit(tx, w.client, habit.id, { localDate: '2026-11-12', done: false }, { now: NOW }),
    );
    expect(off.doneToday).toBe(false);
  });

  it('tasks are done once; archiving hides them; clients cannot manage', async () => {
    const w = await newClientWorld(prisma, await newOrg(prisma));
    const task = await runAs(prisma, w.coach, (tx) =>
      createHabit(
        tx,
        w.coach,
        w.clientId,
        { title: 'Send a photo of your home gym', isTask: true, dueDate: '2026-11-20' },
        { now: NOW },
      ),
    );
    const done = await runAs(prisma, w.client, (tx) =>
      logHabit(tx, w.client, task.id, {}, { now: NOW }),
    );
    expect(done).toMatchObject({ done: true, isTask: true });
    await runAs(prisma, w.coach, (tx) => setHabitStatus(tx, w.coach, task.id, 'archived'));
    const view = await runAs(prisma, w.client, (tx) =>
      listHabits(tx, w.client, w.clientId, { now: NOW }),
    );
    expect(view.tasks).toEqual([]);
    await expect(
      runAs(prisma, w.client, (tx) => createHabit(tx, w.client, w.clientId, { title: 'x' })),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      runAs(prisma, w.client, (tx) => logHabit(tx, w.client, task.id, {}, { now: NOW })),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('validates input and scopes access', async () => {
    const org = await newOrg(prisma);
    const a = await newClientWorld(prisma, org);
    const b = await newClientWorld(prisma, org);
    const other = await newClientWorld(prisma, await newOrg(prisma));
    const bad = (input: Record<string, unknown>) =>
      runAs(prisma, a.coach, (tx) =>
        createHabit(tx, a.coach, a.clientId, input, { now: NOW }),
      ).then(
        () => 'ok',
        (e: { fieldErrors?: Record<string, string[]> }) => Object.keys(e.fieldErrors ?? {})[0],
      );
    expect(await bad({ title: '' })).toBe('title');
    expect(await bad({ title: 'x', daysPerWeek: 8 })).toBe('daysPerWeek');
    expect(await bad({ title: 'x', isTask: true })).toBe('dueDate');
    expect(await bad({ title: 'x', startDate: '2026-11-10', endDate: '2026-11-01' })).toBe(
      'endDate',
    );
    expect(await bad({ title: 'x', targetCount: 0 })).toBe('targetCount');
    const habit = await runAs(prisma, a.coach, (tx) =>
      createHabit(tx, a.coach, b.clientId, { title: 'B only' }, { now: NOW }),
    );
    await expect(
      runAs(prisma, a.client, (tx) => logHabit(tx, a.client, habit.id, {}, { now: NOW })),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      runAs(prisma, other.coach, (tx) => listHabits(tx, other.coach, a.clientId)),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
