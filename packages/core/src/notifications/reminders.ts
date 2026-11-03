import { emailOptIns, type TenantTx } from '@kinetic/db';
import { clientsInPauseNow } from '../clients/pause';
import { enqueueEmail } from '../outbox';
import { enqueuePush } from './push';
import { toDbDate } from '../sessions/read';
import { todayInZone } from '../timezone';

/**
 * Client reminder emails (PRD H13, F9), each an opt-in preference: workout day from 07:00, check-in due tonight from
 * 18:00 when it hasn't been sent, and a habit nudge from 19:00 when something is left to tick. Never in quiet hours
 * (21:00-07:00 local), at most three a day, and none while the client is paused or archived. One of each kind per local
 * day (idempotency keys), so the hourly worker can run it any number of times. No workout, check-in or habit content
 * in the email: a count and a link.
 */
export const REMINDER_HOURS = { workout: 7, checkin: 18, habit: 19 } as const;
export const QUIET_FROM = 21;
export const QUIET_UNTIL = 7;
export const REMINDERS_PER_DAY = 3;
/** A booked session is reminded from 24 hours before it starts. */
export const BOOKING_REMINDER_MS = 24 * 3_600_000;
export type ReminderKind = keyof typeof REMINDER_HOURS;

const localHour = (timeZone: string, now: Date) =>
  Number(
    new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone }).format(now),
  );

const keyOf = (kind: ReminderKind, clientId: string, day: string) =>
  `reminder:${clientId}:${day}:${kind}`;

export async function queueClientReminders(tx: TenantTx, now: Date): Promise<{ queued: number }> {
  const inPause = await clientsInPauseNow(tx, now);
  const clients = await tx.client.findMany({
    where: {
      status: 'active',
      userId: { not: null },
      ...(inPause.size > 0 ? { id: { notIn: [...inPause] } } : {}),
    },
    select: { id: true, userId: true, timezone: true },
  });
  let queued = 0;
  for (const c of clients) {
    const userId = c.userId as string;
    // Preference rows are self-only under RLS: the worker reads the opt-ins through app_email_opt_ins.
    const opt = await emailOptIns(tx, userId);
    if (!opt.workout && !opt.checkin && !opt.habit) continue;
    const hour = localHour(c.timezone, now);
    if (hour >= QUIET_FROM || hour < QUIET_UNTIL) continue;
    const day = todayInZone(c.timezone, now);
    let sentToday = await tx.outboxEmail.count({
      where: { idempotencyKey: { startsWith: `reminder:${c.id}:${day}:` } },
    });

    const due: { kind: ReminderKind; payload: Record<string, number> }[] = [];
    if (opt.workout && hour >= REMINDER_HOURS.workout) {
      const workouts = await tx.workoutSession.count({
        where: {
          clientId: c.id,
          kind: 'planned',
          state: 'scheduled',
          scheduledLocalDate: toDbDate(day),
        },
      });
      if (workouts > 0) due.push({ kind: 'workout', payload: { workouts } });
    }
    if (opt.checkin && hour >= REMINDER_HOURS.checkin) {
      const open = await tx.checkin.count({
        where: {
          clientId: c.id,
          kind: 'checkin',
          periodLocalDate: toDbDate(day),
          submittedAt: null,
          dueAt: { gt: now },
        },
      });
      if (open > 0) due.push({ kind: 'checkin', payload: {} });
    }
    if (opt.habit && hour >= REMINDER_HOURS.habit) {
      const habits = await tx.habit.findMany({
        where: {
          clientId: c.id,
          status: 'active',
          isTask: false,
          startDate: { lte: toDbDate(day) },
          OR: [{ endDate: null }, { endDate: { gte: toDbDate(day) } }],
        },
        select: {
          targetCount: true,
          logs: { where: { localDate: toDbDate(day) }, select: { value: true } },
        },
      });
      const left = habits.filter((h) => (h.logs[0]?.value ?? 0) < (h.targetCount ?? 1)).length;
      if (left > 0) due.push({ kind: 'habit', payload: { habits: left } });
    }

    for (const r of due) {
      if (sentToday >= REMINDERS_PER_DAY) break;
      const made = await enqueueEmail(tx, {
        kind: `${r.kind}_reminder`,
        toUserId: userId,
        templateKey: `${r.kind}_reminder`,
        payload: r.payload,
        idempotencyKey: keyOf(r.kind, c.id, day),
      });
      if (made) {
        queued += 1;
        sentToday += 1;
        // PRD H11: the same reminder on the client's devices with notifications on.
        await enqueuePush(tx, {
          toUserId: userId,
          kind: `${r.kind}_reminder`,
          idempotencyKey: keyOf(r.kind, c.id, day),
        });
      }
    }

    // PRD K10 (D-013 #11): a booked session within the next 24 hours, under the workout opt-in, the quiet hours and
    // the daily cap. Each booking is reminded once (it counts as that day's reminder when it goes).
    if (opt.workout) {
      const soon = await tx.booking.findMany({
        where: {
          clientId: c.id,
          status: 'booked',
          reminderSentAt: null,
          startsAt: { gt: now, lte: new Date(now.getTime() + BOOKING_REMINDER_MS) },
        },
        orderBy: { startsAt: 'asc' },
        select: { id: true },
      });
      for (const b of soon) {
        if (sentToday >= REMINDERS_PER_DAY) break;
        const key = `reminder:${c.id}:${day}:booking:${b.id}`;
        const made = await enqueueEmail(tx, {
          kind: 'booking_reminder',
          toUserId: userId,
          templateKey: 'booking_reminder',
          payload: { bookingId: b.id },
          idempotencyKey: key,
        });
        await tx.booking.updateMany({ where: { id: b.id }, data: { reminderSentAt: now } });
        if (made) {
          queued += 1;
          sentToday += 1;
          await enqueuePush(tx, {
            toUserId: userId,
            kind: 'booking_reminder',
            idempotencyKey: key,
          });
        }
      }
    }
  }
  return { queued };
}
