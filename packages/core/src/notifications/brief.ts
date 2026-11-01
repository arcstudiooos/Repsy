import { emailOptIns, type TenantTx } from '@kinetic/db';
import { enqueueEmail } from '../outbox';
import { fromDbDate, isoWeekOf, toDbDate } from '../sessions/read';
import { todayInZone } from '../timezone';

/** The brief goes out on Mondays from this local hour (PRD I9). */
export const BRIEF_HOUR = 7;

const addDays = (d: string, n: number) =>
  new Date(toDbDate(d).getTime() + n * 86_400_000).toISOString().slice(0, 10);
const localHour = (timeZone: string, now: Date) =>
  Number(
    new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone }).format(now),
  );

export interface WeeklyBrief {
  /** Last week (Monday). */
  weekStart: string;
  completed: number;
  /** Clients who finished every workout planned for them last week. */
  perfectWeeks: number;
  /** Clients with 2 or more workouts missed, skipped or not finished last week. */
  slipped: number;
  /** This week. */
  workoutsDue: number;
  checkinsDue: number;
  programsEnding: number;
}

/** The workspace's numbers for the brief: counts only, never names or anything a client wrote (D-007). */
export async function weeklyBriefFacts(
  tx: TenantTx,
  timezone: string,
  now: Date,
): Promise<WeeklyBrief> {
  const thisWeek = isoWeekOf(todayInZone(timezone, now)).start;
  const lastWeek = addDays(thisWeek, -7);
  const nextWeek = addDays(thisWeek, 7);
  const last = await tx.workoutSession.findMany({
    where: {
      kind: 'planned',
      state: { not: 'cancelled' },
      scheduledLocalDate: { gte: toDbDate(lastWeek), lt: toDbDate(thisWeek) },
      client: { is: { status: { in: ['active', 'invited'] } } },
    },
    select: { clientId: true, state: true },
  });
  const byClient = new Map<string, string[]>();
  for (const s of last) byClient.set(s.clientId, [...(byClient.get(s.clientId) ?? []), s.state]);
  const extras = await tx.workoutSession.count({
    where: {
      kind: 'extra',
      state: 'completed',
      scheduledLocalDate: { gte: toDbDate(lastWeek), lt: toDbDate(thisWeek) },
    },
  });
  const upcoming = await tx.workoutSession.findMany({
    where: {
      kind: 'planned',
      state: 'scheduled',
      scheduledLocalDate: { gte: toDbDate(thisWeek) },
      client: { is: { status: 'active' } },
    },
    select: { clientId: true, scheduledLocalDate: true },
  });
  const lastPlanned = new Map<string, string>();
  for (const s of upcoming) {
    const d = fromDbDate(s.scheduledLocalDate);
    if ((lastPlanned.get(s.clientId) ?? '') < d) lastPlanned.set(s.clientId, d);
  }
  const checkinsDue = await tx.checkin.count({
    where: {
      kind: 'checkin',
      submittedAt: null,
      periodLocalDate: { gte: toDbDate(thisWeek), lt: toDbDate(nextWeek) },
    },
  });
  return {
    weekStart: lastWeek,
    completed: last.filter((s) => s.state === 'completed').length + extras,
    perfectWeeks: [...byClient.values()].filter((st) => st.every((x) => x === 'completed')).length,
    slipped: [...byClient.values()].filter(
      (st) => st.filter((x) => x === 'missed' || x === 'skipped' || x === 'incomplete').length >= 2,
    ).length,
    workoutsDue: upcoming.filter((s) => fromDbDate(s.scheduledLocalDate) < nextWeek).length,
    checkinsDue,
    programsEnding: [...lastPlanned.values()].filter((d) => d < nextWeek).length,
  };
}

/**
 * Queues the Monday brief (PRD I9) for each opted-in coach in this organization, from 07:00 Monday in its time zone,
 * once per week (idempotency key), and only when there is something to say. The worker runs it hourly.
 */
export async function queueWeeklyBriefs(
  tx: TenantTx,
  orgId: string,
  now: Date,
): Promise<{ queued: number }> {
  const org = await tx.organization.findFirst({ select: { name: true, timezone: true } });
  if (!org) return { queued: 0 };
  const today = todayInZone(org.timezone, now);
  if (isoWeekOf(today).start !== today || localHour(org.timezone, now) < BRIEF_HOUR) {
    return { queued: 0 };
  }
  const coaches = await tx.membership.findMany({
    where: { role: { in: ['owner', 'coach'] }, status: 'active' },
    select: { userId: true },
  });
  let facts: WeeklyBrief | null = null;
  let queued = 0;
  for (const m of coaches) {
    if (!(await emailOptIns(tx, m.userId)).brief) continue;
    facts ??= await weeklyBriefFacts(tx, org.timezone, now);
    const { weekStart, ...counts } = facts;
    if (Object.values(counts).every((n) => n === 0)) return { queued: 0 };
    if (
      await enqueueEmail(tx, {
        kind: 'weekly_brief',
        toUserId: m.userId,
        templateKey: 'weekly_brief',
        payload: { orgName: org.name, weekStart, ...counts },
        idempotencyKey: `weekly-brief:${orgId}:${m.userId}:${today}`,
      })
    ) {
      queued += 1;
    }
  }
  return { queued };
}
