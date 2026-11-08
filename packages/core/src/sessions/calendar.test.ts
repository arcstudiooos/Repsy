import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withSystem, type PrismaClient } from '@repsy/db';
import { createTestDb } from '@repsy/db/testing';
import { getClientCalendar, rescheduleSession } from './calendar';
import { grid, newClientWorld, newOrg, NOW, runAs, sessionsOf } from './fixtures.test-helpers';

let prisma: PrismaClient;
let drop: () => Promise<void>;

beforeAll(async () => {
  ({ prisma, drop } = await createTestDb());
});
afterAll(async () => {
  await drop();
});

const at = { now: NOW }; // 2026-11-04 08:00 in New York

describe('client calendar (PRD C16)', () => {
  it('lists the month over whole weeks, for the coach and the client', async () => {
    const org = await newOrg(prisma);
    const w = await newClientWorld(prisma, org, { weeks: grid(2, 3) });
    const cal = await runAs(prisma, org.coach, (tx) =>
      getClientCalendar(tx, org.coach, { clientId: w.clientId, month: '2026-11' }, at),
    );
    expect(cal).toMatchObject({
      month: '2026-11',
      gridStart: '2026-10-26',
      gridEnd: '2026-12-06',
      todayLocalDate: '2026-11-04',
      pause: null,
    });
    expect(cal.workouts.map((x) => x.date)).toEqual([
      '2026-11-04',
      '2026-11-06',
      '2026-11-09',
      '2026-11-11',
      '2026-11-13',
      '2026-11-16',
    ]);
    expect(cal.workouts.every((x) => x.movable && x.title.length > 0)).toBe(true);
    // A check-in due 23:59 Friday in New York (04:59 UTC Saturday) sits on Friday.
    await withSystem(async (tx) => {
      const t = await tx.checkinTemplate.create({
        data: { organizationId: org.orgId, title: 'Weekly', questionsJson: [] },
      });
      await tx.checkin.create({
        data: {
          organizationId: org.orgId,
          clientId: w.clientId,
          templateId: t.id,
          periodLocalDate: new Date('2026-11-06T00:00:00Z'),
          questionsJson: [],
          issuedAt: new Date('2026-11-06T11:00:00Z'),
          dueAt: new Date('2026-11-07T04:59:00Z'),
          submittedAt: new Date('2026-11-06T20:00:00Z'),
          answersJson: {},
          submitIdempotencyKey: 'cal-test',
        },
      });
    }, prisma);
    const withCheckin = await runAs(prisma, org.coach, (tx) =>
      getClientCalendar(tx, org.coach, { clientId: w.clientId, month: '2026-11' }, at),
    );
    expect(withCheckin.checkins).toEqual([
      { id: expect.any(String), date: '2026-11-06', status: 'sent' },
    ]);
    const own = await runAs(prisma, w.client, (tx) =>
      getClientCalendar(tx, w.client, { clientId: 'ignored', month: '2026-11' }, at),
    );
    expect(own.workouts).toHaveLength(6);
    // Clients see their plan but cannot move it.
    expect(own.workouts.some((x) => x.movable)).toBe(false);
    await expect(
      runAs(prisma, org.coach, (tx) =>
        getClientCalendar(tx, org.coach, { clientId: w.clientId, month: '2026-13' }, at),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('moves one workout, or it and every later one, and refuses the past, started work and pauses', async () => {
    const org = await newOrg(prisma);
    const w = await newClientWorld(prisma, org, { weeks: grid(2, 3) });
    const sessions = await withSystem(
      (tx) =>
        tx.workoutSession.findMany({
          where: { assignmentId: w.assignmentId },
          orderBy: { scheduledLocalDate: 'asc' },
        }),
      prisma,
    );
    const [first, second] = sessions;
    const one = await runAs(prisma, org.coach, (tx) =>
      rescheduleSession(tx, org.coach, second!.id, { toLocalDate: '2026-11-07' }, at),
    );
    expect(one).toEqual({ moved: 1, deltaDays: 1 });
    const moved = await withSystem(
      (tx) => tx.workoutSession.findUniqueOrThrow({ where: { id: second!.id } }),
      prisma,
    );
    expect(moved.scheduledLocalDate.toISOString().slice(0, 10)).toBe('2026-11-07');
    // 23:59 in New York (EST after 1 Nov) is 04:59 UTC the next day.
    expect(moved.dueAt.toISOString()).toBe('2026-11-08T04:59:00.000Z');

    const series = await runAs(prisma, org.coach, (tx) =>
      rescheduleSession(
        tx,
        org.coach,
        first!.id,
        { toLocalDate: '2026-11-11', shiftLater: true },
        at,
      ),
    );
    expect(series).toEqual({ moved: 6, deltaDays: 7 });
    const after = (await sessionsOf(prisma, w.assignmentId)).map((s) =>
      s.scheduledLocalDate.toISOString().slice(0, 10),
    );
    expect([...after].sort()).toEqual([
      '2026-11-11',
      '2026-11-14',
      '2026-11-16',
      '2026-11-18',
      '2026-11-20',
      '2026-11-23',
    ]);

    await expect(
      runAs(prisma, org.coach, (tx) =>
        rescheduleSession(tx, org.coach, first!.id, { toLocalDate: '2026-11-03' }, at),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(
      runAs(prisma, w.client, (tx) =>
        rescheduleSession(tx, w.client, first!.id, { toLocalDate: '2026-11-20' }, at),
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    await withSystem(
      (tx) =>
        tx.workoutSession.update({ where: { id: first!.id }, data: { state: 'in_progress' } }),
      prisma,
    );
    await expect(
      runAs(prisma, org.coach, (tx) =>
        rescheduleSession(tx, org.coach, first!.id, { toLocalDate: '2026-11-20' }, at),
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    await withSystem(
      (tx) =>
        tx.clientPause.create({
          data: {
            organizationId: org.orgId,
            clientId: w.clientId,
            startLocalDate: new Date('2026-12-01T00:00:00Z'),
            resumeLocalDate: new Date('2026-12-08T00:00:00Z'),
            createdBy: org.coach.userId,
          },
        }),
      prisma,
    );
    await expect(
      runAs(prisma, org.coach, (tx) =>
        rescheduleSession(tx, org.coach, second!.id, { toLocalDate: '2026-11-25' }, at),
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    const paused = await runAs(prisma, org.coach, (tx) =>
      getClientCalendar(tx, org.coach, { clientId: w.clientId, month: '2026-11' }, at),
    );
    expect(paused.pause).toEqual({ startLocalDate: '2026-12-01', resumeLocalDate: '2026-12-08' });
    expect(paused.workouts.some((x) => x.movable)).toBe(false);
  });

  it('clients move a workout within its week when the coach allows it; the coach gets a review item (PRD D14)', async () => {
    const org = await newOrg(prisma);
    const w = await newClientWorld(prisma, org, { weeks: grid(2, 3) });
    const sessions = await withSystem(
      (tx) =>
        tx.workoutSession.findMany({
          where: { assignmentId: w.assignmentId },
          orderBy: { scheduledLocalDate: 'asc' },
        }),
      prisma,
    );
    const friday = sessions[1]!; // 2026-11-06
    const move = (to: string, shiftLater?: boolean) =>
      runAs(prisma, w.client, (tx) =>
        rescheduleSession(tx, w.client, friday.id, { toLocalDate: to, shiftLater }, at),
      );
    await expect(move('2026-11-07')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await withSystem(
      (tx) =>
        tx.organization.update({
          where: { id: org.orgId },
          data: { clientsCanMoveWorkouts: true },
        }),
      prisma,
    );
    const cal = await runAs(prisma, w.client, (tx) =>
      getClientCalendar(tx, w.client, { month: '2026-11' }, at),
    );
    expect(cal.moveLimit).toBe('week');
    expect(cal.workouts.filter((x) => x.movable).length).toBeGreaterThan(0);
    // Next week, or several at once, is the coach's call.
    await expect(move('2026-11-09')).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(move('2026-11-07', true)).rejects.toMatchObject({ code: 'VALIDATION' });
    expect(await move('2026-11-08')).toEqual({ moved: 1, deltaDays: 2 });
    const flags = await withSystem(
      (tx) => tx.reviewFlag.findMany({ where: { clientId: w.clientId, ruleKey: 'workout_moved' } }),
      prisma,
    );
    expect(flags).toHaveLength(1);
    expect(flags[0]!.evidenceJson).toMatchObject({ dates: ['2026-11-06', '2026-11-08'] });
    // Another client's workout is out of reach.
    const other = await newClientWorld(prisma, org);
    await expect(
      runAs(prisma, other.client, (tx) =>
        rescheduleSession(tx, other.client, friday.id, { toLocalDate: '2026-11-07' }, at),
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
