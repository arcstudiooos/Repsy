import type { TenantTx } from '@repsy/db';
import type { ActorContext } from '../authz/actor';
import { assertCan } from '../authz/policies';
import { checkinStreak } from '../checkins/checkins';
import { DomainError } from '../errors';
import { fromDbDate, toDbDate } from '../sessions/read';
import { todayInZone } from '../timezone';
import { toDisplay, type Units } from '../units';
import { isUuid } from '../uuid';

/** Placeholders a saved reply can use (PRD F7), each filled from data already recorded. */
export const REPLY_PLACEHOLDERS = [
  'first_name',
  'workouts_done',
  'workouts_planned',
  'weight',
  'streak',
  'next_workout',
] as const;
export type ReplyPlaceholder = (typeof REPLY_PLACEHOLDERS)[number];

const DAY_MS = 86_400_000;

/**
 * The values for a client's reply placeholders (PRD F7), formatted for the coach's units: this week's workouts done
 * and planned (Monday to today), the latest body weight, the on-time check-in streak and the next workout's date.
 * A value with no data is left out, so its placeholder stays visible for the coach to fill in by hand.
 */
export async function replyFacts(
  tx: TenantTx,
  actor: ActorContext,
  clientId: string,
  units: Units,
  opts: { now?: Date } = {},
): Promise<Partial<Record<ReplyPlaceholder, string>>> {
  assertCan(actor, 'client:read');
  if (!isUuid(clientId)) throw new DomainError('NOT_FOUND', 'Not found.');
  const client = await tx.client.findFirst({
    where: { id: clientId },
    select: { id: true, name: true, timezone: true },
  });
  if (!client) throw new DomainError('NOT_FOUND', 'Not found.');
  const today = todayInZone(client.timezone, opts.now ?? new Date());
  const dow = toDbDate(today).getUTCDay();
  const monday = fromDbDate(new Date(toDbDate(today).getTime() - ((dow + 6) % 7) * DAY_MS));
  const sunday = fromDbDate(new Date(toDbDate(monday).getTime() + 6 * DAY_MS));
  const out: Partial<Record<ReplyPlaceholder, string>> = {
    first_name: client.name.trim().split(/\s+/)[0] || client.name,
  };
  const week = await tx.workoutSession.groupBy({
    by: ['state'],
    where: {
      clientId,
      kind: 'planned',
      state: { not: 'cancelled' },
      scheduledLocalDate: { gte: toDbDate(monday), lte: toDbDate(sunday) },
    },
    _count: { _all: true },
  });
  const planned = week.reduce((s, r) => s + r._count._all, 0);
  if (planned > 0) {
    out.workouts_planned = String(planned);
    out.workouts_done = String(week.find((r) => r.state === 'completed')?._count._all ?? 0);
  }
  const weight = await tx.metricEntry.findFirst({
    where: { clientId, metric: 'weight' },
    orderBy: { measuredOn: 'desc' },
    select: { value: true },
  });
  if (weight) out.weight = `${toDisplay(Number(weight.value.toString()), units)} ${units}`;
  const streak = await checkinStreak(tx, actor, { clientId });
  if (streak > 0) out.streak = String(streak);
  const next = await tx.workoutSession.findFirst({
    where: { clientId, state: 'scheduled', scheduledLocalDate: { gte: toDbDate(today) } },
    orderBy: { scheduledLocalDate: 'asc' },
    select: { scheduledLocalDate: true },
  });
  if (next) {
    out.next_workout = new Intl.DateTimeFormat('en-GB', {
      weekday: 'long',
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    }).format(next.scheduledLocalDate);
  }
  return out;
}

export { fillPlaceholders } from './fill';
