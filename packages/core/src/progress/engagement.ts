import type { TenantTx } from '@repsy/db';
import type { ActorContext } from '../authz/actor';
import { fromDbDate, isoWeekOf, toDbDate } from '../sessions/read';
import { todayInZone } from '../timezone';
import { resolveClientId } from './records';

/**
 * PRD I4: one engagement score per client per ISO week (0-100), from four equal parts: planned workouts completed,
 * check-ins sent, messaging the coach, and days the portal was opened (3 days counts as full). A part with nothing to
 * measure that week (no workouts planned, no check-in due) is left out rather than counted as zero. Shown as a trend;
 * a drop raises "Needs review" through the opt-in `engagement_drop` rule, never "At risk".
 */
export const ENGAGEMENT_WEEKS = 8;
const VISIT_DAYS_FOR_FULL = 3;
/** A full week this many points under the three before it (which averaged at least 50) is a drop. */
export const ENGAGEMENT_DROP_POINTS = 30;

export interface EngagementWeek {
  weekStart: string;
  /** Null before the client existed, or when nothing could be measured. */
  score: number | null;
  parts: { workouts: number | null; checkins: number | null; messages: number; visits: number };
}

const addDays = (d: string, n: number) =>
  new Date(toDbDate(d).getTime() + n * 86_400_000).toISOString().slice(0, 10);

/** Records today's portal visit (idempotent per local day). */
export async function recordPortalVisit(
  tx: TenantTx,
  client: { id: string; timezone: string },
  now: Date = new Date(),
): Promise<void> {
  await tx.portalVisit.createMany({
    data: [
      { clientId: client.id, localDate: toDbDate(todayInZone(client.timezone, now)) },
    ] as never,
    skipDuplicates: true,
  });
}

/** Engagement for the last `weeks` ISO weeks, oldest first, the current (partial) week last. */
export async function weeklyEngagement(
  tx: TenantTx,
  clientId: string,
  opts: { now?: Date; weeks?: number } = {},
): Promise<EngagementWeek[]> {
  const client = await tx.client.findFirstOrThrow({
    where: { id: clientId },
    select: { timezone: true, createdAt: true, userId: true },
  });
  const count = opts.weeks ?? ENGAGEMENT_WEEKS;
  const now = opts.now ?? new Date();
  const thisWeek = isoWeekOf(todayInZone(client.timezone, now)).start;
  const starts = Array.from({ length: count }, (_, i) => addDays(thisWeek, -7 * (count - 1 - i)));
  const from = toDbDate(starts[0]!);
  const until = toDbDate(addDays(thisWeek, 7));
  const created = isoWeekOf(todayInZone(client.timezone, client.createdAt)).start;

  const sessions = await tx.workoutSession.findMany({
    where: {
      clientId,
      kind: 'planned',
      state: { not: 'cancelled' },
      scheduledLocalDate: { gte: from, lt: until },
    },
    select: { scheduledLocalDate: true, state: true },
  });
  const checkins = await tx.checkin.findMany({
    where: { clientId, kind: 'checkin', periodLocalDate: { gte: from, lt: until } },
    select: { periodLocalDate: true, submittedAt: true },
  });
  const messages = client.userId
    ? await tx.message.findMany({
        where: {
          senderUserId: client.userId,
          thread: { is: { clientId } },
          createdAt: {
            gte: new Date(from.getTime() - 86_400_000),
            lt: new Date(until.getTime() + 86_400_000),
          },
        },
        select: { createdAt: true },
      })
    : [];
  const visits = await tx.portalVisit.findMany({
    where: { clientId, localDate: { gte: from, lt: until } },
    select: { localDate: true },
  });
  const weekOf = (d: Date) => isoWeekOf(fromDbDate(d)).start;
  const localWeekOf = (at: Date) => isoWeekOf(todayInZone(client.timezone, at)).start;

  return starts.map((w) => {
    const planned = sessions.filter((s) => weekOf(s.scheduledLocalDate) === w);
    const today = todayInZone(client.timezone, now);
    // In the current week only what is already due counts.
    const due = planned.filter((s) => w !== thisWeek || fromDbDate(s.scheduledLocalDate) <= today);
    const issued = checkins.filter((c) => weekOf(c.periodLocalDate) === w);
    const parts = {
      workouts: due.length ? due.filter((s) => s.state === 'completed').length / due.length : null,
      checkins: issued.length ? issued.filter((c) => c.submittedAt).length / issued.length : null,
      messages: messages.some((m) => localWeekOf(m.createdAt) === w) ? 1 : 0,
      visits: Math.min(
        1,
        visits.filter((v) => weekOf(v.localDate) === w).length / VISIT_DAYS_FOR_FULL,
      ),
    };
    const measured = [parts.workouts, parts.checkins, parts.messages, parts.visits].filter(
      (p): p is number => p !== null,
    );
    const score =
      w < created || measured.length === 0
        ? null
        : Math.round((100 * measured.reduce((a, b) => a + b, 0)) / measured.length);
    const round = (n: number | null) => (n === null ? null : Math.round(n * 100) / 100);
    return {
      weekStart: w,
      score,
      parts: {
        workouts: round(parts.workouts),
        checkins: round(parts.checkins),
        messages: parts.messages,
        visits: Math.round(parts.visits * 100) / 100,
      },
    };
  });
}

/** The coach's (or the client's own) view of the trend. */
export async function getEngagement(
  tx: TenantTx,
  actor: ActorContext,
  clientId: string,
  opts: { now?: Date } = {},
): Promise<EngagementWeek[]> {
  const id = await resolveClientId(tx, actor, clientId);
  return weeklyEngagement(tx, id, opts);
}

/** The last full week dropped `ENGAGEMENT_DROP_POINTS` or more below the three before it (averaging 50+). */
export function engagementDropped(
  weeks: EngagementWeek[],
): { week: string; score: number; before: number } | null {
  const full = weeks.slice(0, -1);
  const last = full[full.length - 1];
  const prior = full.slice(-4, -1).map((w) => w.score);
  if (!last || last.score === null || prior.length < 3 || prior.some((s) => s === null))
    return null;
  const before = Math.round((prior as number[]).reduce((a, b) => a + b, 0) / 3);
  return before >= 50 && last.score <= before - ENGAGEMENT_DROP_POINTS
    ? { week: last.weekStart, score: last.score, before }
    : null;
}
