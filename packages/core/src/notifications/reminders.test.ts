import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withSystem, withTenant, type PrismaClient } from '@kinetic/db';
import { createTestDb } from '@kinetic/db/testing';
import { createHabit } from '../habits/habits';
import { newClientWorld, newOrg, runAs } from '../sessions/fixtures.test-helpers';
import { queueClientReminders } from './reminders';

let prisma: PrismaClient;
let drop: () => Promise<void>;
beforeAll(async () => {
  ({ prisma, drop } = await createTestDb());
});
afterAll(async () => {
  await drop();
});

const kinds = (orgId: string) =>
  withSystem(
    async (tx) =>
      (
        await tx.outboxEmail.findMany({
          where: { organizationId: orgId, kind: { endsWith: '_reminder' } },
          orderBy: { createdAt: 'asc' },
          select: { kind: true, payloadJson: true },
        })
      ).map((e) => e.kind),
    prisma,
  );

describe('client reminders (PRD H13, F9)', () => {
  it('sends each opted-in reminder once a day from its hour, never in quiet hours or while paused', async () => {
    const org = await newOrg(prisma); // New York; the program has a workout on Wed 4 Nov 2026.
    const w = await newClientWorld(prisma, org);
    // As the worker runs it: a tenant transaction with no user (preference rows are self-only).
    const run = (iso: string) =>
      withTenant(org.orgId, (tx) => queueClientReminders(tx, new Date(iso)), prisma);
    // Not opted in: nothing.
    expect(await run('2026-11-04T12:30:00Z')).toEqual({ queued: 0 });
    await withSystem(async (tx) => {
      await tx.notificationPreference.upsert({
        where: { userId: w.userId },
        create: {
          userId: w.userId,
          workoutReminderOptIn: true,
          checkinReminderOptIn: true,
          habitReminderOptIn: true,
        },
        update: {
          workoutReminderOptIn: true,
          checkinReminderOptIn: true,
          habitReminderOptIn: true,
        },
      });
      const template = await tx.checkinTemplate.create({
        data: { organizationId: org.orgId, title: 'Weekly', questionsJson: [] },
      });
      await tx.checkin.create({
        data: {
          organizationId: org.orgId,
          clientId: w.clientId,
          templateId: template.id,
          periodLocalDate: new Date('2026-11-04T00:00:00Z'),
          questionsJson: [],
          issuedAt: new Date('2026-11-04T13:00:00Z'),
          dueAt: new Date('2026-11-05T04:59:00Z'),
        },
      });
    }, prisma);
    await runAs(prisma, org.coach, (tx) =>
      createHabit(tx, org.coach, w.clientId, { title: 'Walk', startDate: '2026-11-04' }),
    );

    // 06:30 in New York: quiet hours.
    expect(await run('2026-11-04T11:30:00Z')).toEqual({ queued: 0 });
    // 07:30: the workout reminder, once.
    expect(await run('2026-11-04T12:30:00Z')).toEqual({ queued: 1 });
    expect(await run('2026-11-04T13:30:00Z')).toEqual({ queued: 0 });
    // 19:30: the check-in and the habit nudge; 21:30 is quiet again.
    expect(await run('2026-11-05T00:30:00Z')).toEqual({ queued: 2 });
    expect(await run('2026-11-05T02:30:00Z')).toEqual({ queued: 0 });
    expect(await kinds(org.orgId)).toEqual([
      'workout_reminder',
      'checkin_reminder',
      'habit_reminder',
    ]);

    // Paused: nothing the next day (Thursday's habit is still due).
    await withSystem(
      (tx) =>
        tx.clientPause.create({
          data: {
            organizationId: org.orgId,
            clientId: w.clientId,
            startLocalDate: new Date('2026-11-05T00:00:00Z'),
            resumeLocalDate: new Date('2026-11-12T00:00:00Z'),
            createdBy: org.coach.userId,
          },
        }),
      prisma,
    );
    expect(await run('2026-11-06T00:30:00Z')).toEqual({ queued: 0 });
  });
});
