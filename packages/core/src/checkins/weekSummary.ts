import type { TenantTx } from '@repsy/db';
import type { ActorContext } from '../authz/actor';
import { assertCan } from '../authz/policies';
import { DomainError } from '../errors';
import { isOnTarget, type Macros } from '../nutrition/nutrition';
import { BODY_METRICS, type BodyMetric } from '../progress/metric-catalog';
import { getPersonalRecords } from '../progress/records';
import { fromDbDate, toDbDate } from '../sessions/read';
import { isUuid } from '../uuid';

const DAY_MS = 86_400_000;
const addDays = (d: string, n: number) => fromDbDate(new Date(toDbDate(d).getTime() + n * DAY_MS));
const num = (d: { toString(): string }) => Number(d.toString());

/**
 * The week's facts attached to a check-in (PRD F8): what the platform already knows, so the client is never asked
 * for it. The week is the 7 days before the check-in's date, like the coach's activity summary.
 */
export interface CheckinWeekSummary {
  fromLocalDate: string;
  toLocalDate: string;
  workouts: { completed: number; planned: number; skipped: number; missed: number };
  /** Exercises whose best (heaviest set or estimated 1RM) was set this week. */
  personalRecords: { exerciseId: string; name: string }[];
  /** Measurements recorded this week: the latest value and its change from the last one before the week. */
  metrics: { metric: BodyMetric; value: number; change: number | null }[];
  /** Days done of days planned across active habits; null without habits. */
  habits: { done: number; expected: number } | null;
  /** Days on target of days logged; null without a target or a log. */
  nutrition: { onTarget: number; logged: number } | null;
}

export async function checkinWeekSummary(
  tx: TenantTx,
  actor: ActorContext,
  clientId: string,
  periodLocalDate: string,
): Promise<CheckinWeekSummary> {
  assertCan(actor, 'checkin:read');
  if (!isUuid(clientId)) throw new DomainError('NOT_FOUND', 'Not found.');
  if (actor.role === 'client' && actor.clientId?.toLowerCase() !== clientId.toLowerCase()) {
    throw new DomainError('NOT_FOUND', 'Not found.');
  }
  const client = await tx.client.findFirst({ where: { id: clientId }, select: { id: true } });
  if (!client) throw new DomainError('NOT_FOUND', 'Not found.');
  const from = addDays(periodLocalDate, -7);
  const to = addDays(periodLocalDate, -1);
  const inWeek = { gte: toDbDate(from), lte: toDbDate(to) };

  const sessions = await tx.workoutSession.groupBy({
    by: ['state'],
    // Planned workouts only: extra workouts (PRD D13) count toward history, not adherence.
    where: { clientId, kind: 'planned', state: { not: 'cancelled' }, scheduledLocalDate: inWeek },
    _count: { _all: true },
  });
  const n = (s: string) => sessions.find((r) => r.state === s)?._count._all ?? 0;

  const records = await getPersonalRecords(tx, actor, clientId);
  const within = (d: string | undefined) => d !== undefined && d >= from && d <= to;
  const personalRecords = records
    .filter((r) => within(r.heaviest?.localDate) || within(r.estimatedOneRepMax?.localDate))
    .map((r) => ({ exerciseId: r.exerciseId, name: r.name }));

  const metrics: CheckinWeekSummary['metrics'] = [];
  const weekEntries = await tx.metricEntry.findMany({
    where: { clientId, measuredOn: inWeek },
    orderBy: { measuredOn: 'desc' },
    select: { metric: true, value: true },
  });
  for (const def of BODY_METRICS) {
    const latest = weekEntries.find((e) => e.metric === def.key);
    if (!latest) continue;
    const before = await tx.metricEntry.findFirst({
      where: { clientId, metric: def.key, measuredOn: { lt: toDbDate(from) } },
      orderBy: { measuredOn: 'desc' },
      select: { value: true },
    });
    const value = num(latest.value);
    metrics.push({
      metric: def.key,
      value,
      change: before ? Math.round((value - num(before.value)) * 1000) / 1000 : null,
    });
  }

  const habitRows = await tx.habit.findMany({
    where: {
      clientId,
      status: 'active',
      isTask: false,
      startDate: { lte: toDbDate(to) },
      OR: [{ endDate: null }, { endDate: { gte: toDbDate(from) } }],
    },
    select: { id: true, daysPerWeek: true, targetCount: true },
  });
  let habits: CheckinWeekSummary['habits'] = null;
  if (habitRows.length) {
    let done = 0;
    for (const h of habitRows) {
      done += Math.min(
        h.daysPerWeek ?? 7,
        await tx.habitLog.count({
          where: { habitId: h.id, localDate: inWeek, value: { gte: h.targetCount ?? 1 } },
        }),
      );
    }
    habits = { done, expected: habitRows.reduce((s, h) => s + (h.daysPerWeek ?? 7), 0) };
  }

  let nutrition: CheckinWeekSummary['nutrition'] = null;
  const target = await tx.nutritionTarget.findFirst({
    where: { clientId, effectiveFrom: { lte: toDbDate(to) } },
    orderBy: { effectiveFrom: 'desc' },
    select: { calories: true, proteinG: true, carbsG: true, fatG: true },
  });
  const logs = await tx.nutritionLog.findMany({
    where: { clientId, localDate: inWeek },
    select: { calories: true, proteinG: true, carbsG: true, fatG: true },
  });
  if (target && logs.length) {
    nutrition = {
      onTarget: logs.filter((l) => isOnTarget(target as Macros, l as Macros) === true).length,
      logged: logs.length,
    };
  }

  return {
    fromLocalDate: from,
    toLocalDate: to,
    workouts: {
      completed: n('completed'),
      planned: sessions.reduce((s, r) => s + r._count._all, 0),
      skipped: n('skipped'),
      missed: n('missed'),
    },
    personalRecords,
    metrics,
    habits,
    nutrition,
  };
}
