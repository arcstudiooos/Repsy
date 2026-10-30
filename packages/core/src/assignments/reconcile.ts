import type { TenantTx } from '@kinetic/db';
import { DomainError } from '../errors';
import { localDayBounds } from '../schedule/scheduleSlots';
import { fromDbDate, toDbDate } from '../sessions/read';
import { todayInZone } from '../timezone';

const DAY_MS = 86_400_000;

type SlotKey = { weekIndex: number; dayIndex: number };

const keyOf = (s: SlotKey) => `${s.weekIndex}:${s.dayIndex}`;

/** ISO weekday (Mon=1..Sun=7) of a YYYY-MM-DD date. */
const isoWeekday = (localDate: string): number => toDbDate(localDate).getUTCDay() || 7;

const addDays = (localDate: string, days: number): string =>
  fromDbDate(new Date(toDbDate(localDate).getTime() + days * DAY_MS));

/**
 * Brings an assignment's sessions in line with a structural change of its client program (S3-2, Rulings 2-3).
 * Slot keys `(weekIndex, dayIndex)` only in `fromVersionId` are removed: their still-`scheduled` sessions dated today
 * or later (assignment zone) are cancelled and nothing else changes (in progress, completed and skipped sessions are history). Slot keys only in
 * `toVersionId` are added, in slot order, on the assignment's weekdays after its latest non-cancelled session and
 * never before today in the assignment's zone. A cancelled row for an added slot is revived (the unique
 * `(assignment, week, day)` index allows one row per slot); otherwise a session is created. Both count as created.
 * Callers hold the program row lock (commitProgramVersion), so reconciles of one assignment never interleave.
 */
export async function reconcileSessions(
  tx: TenantTx,
  assignmentId: string,
  fromVersionId: string,
  toVersionId: string,
  opts: { now?: Date } = {},
): Promise<{ cancelled: number; created: number }> {
  const assignment = await tx.programAssignment.findFirst({
    where: { id: assignmentId },
    select: { id: true, clientId: true, weekdays: true, timezone: true },
  });
  if (!assignment) throw new DomainError('NOT_FOUND', 'Not found.');

  const slotsOf = (programVersionId: string) =>
    tx.programSlot.findMany({
      where: { programVersionId },
      orderBy: [{ weekIndex: 'asc' }, { dayIndex: 'asc' }],
      select: { weekIndex: true, dayIndex: true },
    });
  const from = await slotsOf(fromVersionId);
  const to = await slotsOf(toVersionId);
  const fromKeys = new Set(from.map(keyOf));
  const toKeys = new Set(to.map(keyOf));
  const removed = from.filter((s) => !toKeys.has(keyOf(s)));
  const added = to.filter((s) => !fromKeys.has(keyOf(s)));

  const today = todayInZone(assignment.timezone, opts.now ?? new Date());

  let cancelled = 0;
  if (removed.length > 0) {
    const res = await tx.workoutSession.updateMany({
      where: {
        assignmentId: assignment.id,
        state: 'scheduled',
        // A past-due session that was never logged is about to become missed history: it stays (like assignProgram).
        scheduledLocalDate: { gte: toDbDate(today) },
        OR: removed.map((s) => ({ slotWeekIndex: s.weekIndex, slotDayIndex: s.dayIndex })),
      },
      data: { state: 'cancelled' },
    });
    cancelled = res.count;
  }
  if (added.length === 0) return { cancelled, created: 0 };

  // Removals above run first, so a week removed and replaced in one commit is not dated after its own old sessions.
  const latest = await tx.workoutSession.findFirst({
    where: { assignmentId: assignment.id, state: { not: 'cancelled' } },
    orderBy: { scheduledLocalDate: 'desc' },
    select: { scheduledLocalDate: true },
  });
  const afterLatest = latest ? addDays(fromDbDate(latest.scheduledLocalDate), 1) : today;
  let cursor = afterLatest > today ? afterLatest : today;
  const weekdays = new Set(assignment.weekdays);
  if (weekdays.size === 0) throw new DomainError('CONFLICT', 'This assignment has no weekdays.');

  const existing = await tx.workoutSession.findMany({
    where: {
      assignmentId: assignment.id,
      OR: added.map((s) => ({ slotWeekIndex: s.weekIndex, slotDayIndex: s.dayIndex })),
    },
    select: { id: true, slotWeekIndex: true, slotDayIndex: true, state: true },
  });
  const bySlot = new Map(
    existing.map((s) => [keyOf({ weekIndex: s.slotWeekIndex, dayIndex: s.slotDayIndex }), s]),
  );

  let created = 0;
  for (const slot of added) {
    const row = bySlot.get(keyOf(slot));
    // A slot that was removed earlier while its session was already started keeps that session as it is.
    if (row && row.state !== 'cancelled') continue;

    while (!weekdays.has(isoWeekday(cursor))) cursor = addDays(cursor, 1);
    const { scheduledAtUtc, dueAtUtc } = localDayBounds(cursor, assignment.timezone);
    const dates = {
      scheduledLocalDate: toDbDate(cursor),
      scheduledAt: scheduledAtUtc,
      dueAt: dueAtUtc,
    };
    if (row) {
      // Only ever-unstarted rows are cancelled, so workoutVersionId is still null and stays null.
      await tx.workoutSession.updateMany({
        where: { id: row.id, state: 'cancelled' },
        data: { state: 'scheduled', pauseOffsetDays: 0, ...dates },
      });
    } else {
      // Scalar FKs only: the tenant extension injects scalar organizationId.
      await tx.workoutSession.create({
        data: {
          assignmentId: assignment.id,
          clientId: assignment.clientId,
          slotWeekIndex: slot.weekIndex,
          slotDayIndex: slot.dayIndex,
          ...dates,
        },
      } as Parameters<typeof tx.workoutSession.create>[0]);
    }
    created += 1;
    cursor = addDays(cursor, 1);
  }
  return { cancelled, created };
}
