import type { TenantTx } from '@kinetic/db';
import type { ActorContext } from '../authz/actor';
import { assertCan } from '../authz/policies';
import { DomainError } from '../errors';
import { toDbDate } from '../sessions/read';

const HOUR_MS = 3_600_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** The longest range the analytics page accepts. */
export const MAX_RANGE_DAYS = 366;

export interface DateRange {
  /** Inclusive local dates (YYYY-MM-DD), compared with each item's stored local date. */
  from: string;
  to: string;
}

export interface Ratio {
  numerator: number;
  denominator: number;
}

export interface AdherenceCounts {
  completed: number;
  /** Sessions whose due window (due + grace) ended, excluding cancelled ones (D-008 clar. 1). */
  eligible: number;
  skipped: number;
  incomplete: number;
  missed: number;
}

export interface AnalyticsView {
  range: DateRange;
  /** "Assigned vs finished": scheduled (not cancelled) vs completed + skipped. */
  workouts: { assigned: number; finished: number };
  adherence: AdherenceCounts;
  /** Check-ins sent ÷ check-ins whose due window ended. */
  responseRate: Ratio;
  /** Check-ins in the range still waiting for the client. */
  dueCheckins: number;
  /** Median hours from a flag opening to a coach closing it (automatic resolutions excluded). */
  timeToFollowUp: { medianHours: number | null; closed: number };
}

const invalid = (field: string, message: string) =>
  new DomainError('VALIDATION', 'Some fields are invalid.', { [field]: [message] });

export function parseRange(input: { from?: unknown; to?: unknown }): DateRange {
  const check = (field: 'from' | 'to') => {
    const v = input[field];
    if (typeof v !== 'string' || !DATE.test(v) || toDbDate(v).toISOString().slice(0, 10) !== v) {
      throw invalid(field, 'Use YYYY-MM-DD.');
    }
    return v;
  };
  const from = check('from');
  const to = check('to');
  if (to < from) throw invalid('to', 'Pick an end date on or after the start.');
  const days = (toDbDate(to).getTime() - toDbDate(from).getTime()) / (24 * HOUR_MS);
  if (days > MAX_RANGE_DAYS) throw invalid('to', `Use at most ${MAX_RANGE_DAYS} days.`);
  return { from, to };
}

/** The organization's grace period in ms (D-008 #5; default 24h). */
export const graceMs = async (tx: TenantTx) =>
  ((await tx.organization.findFirst({ select: { graceHours: true } }))?.graceHours ?? 24) * HOUR_MS;

export const emptyAdherence = (): AdherenceCounts => ({
  completed: 0,
  eligible: 0,
  skipped: 0,
  incomplete: 0,
  missed: 0,
});

/**
 * Adds `n` eligible sessions in `state` to `counts`. A session still `scheduled` or `in_progress` past its window
 * (the sweep has not run yet) counts as missed or incomplete. Cancelled sessions never reach here.
 */
export function addToAdherence(counts: AdherenceCounts, state: string, n: number): void {
  counts.eligible += n;
  if (state === 'completed') counts.completed += n;
  else if (state === 'skipped') counts.skipped += n;
  else if (state === 'incomplete' || state === 'in_progress') counts.incomplete += n;
  else if (state === 'missed' || state === 'scheduled') counts.missed += n;
}

/**
 * Adherence for the organization (S5-1, D-008 clar. 1): completed ÷ eligible sessions scheduled in `range`.
 * Eligible = not cancelled and past `dueAt + graceHours`. Paused time never counts: a pause moves its sessions out
 * of the paused days (D-003), so they are not due there. Skipped, incomplete and missed stay in the denominator and
 * are reported separately.
 */
export async function adherence(
  tx: TenantTx,
  range: DateRange,
  now: Date = new Date(),
): Promise<AdherenceCounts> {
  const cutoff = new Date(now.getTime() - (await graceMs(tx)));
  const rows = await tx.workoutSession.groupBy({
    by: ['state'],
    where: {
      state: { not: 'cancelled' },
      scheduledLocalDate: { gte: toDbDate(range.from), lte: toDbDate(range.to) },
      dueAt: { lt: cutoff },
    },
    _count: { _all: true },
  });
  const counts = emptyAdherence();
  for (const r of rows) addToAdherence(counts, r.state, r._count._all);
  return counts;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}

/** The coach analytics page (S5-1): counts only, each with its numerator, denominator and period. */
export async function getAnalytics(
  tx: TenantTx,
  actor: ActorContext,
  input: { from?: unknown; to?: unknown },
  opts: { now?: Date } = {},
): Promise<AnalyticsView> {
  assertCan(actor, 'analytics:read');
  const range = parseRange(input);
  const now = opts.now ?? new Date();
  const grace = await graceMs(tx);
  const inRange = { gte: toDbDate(range.from), lte: toDbDate(range.to) };

  const assigned = await tx.workoutSession.count({
    where: { state: { not: 'cancelled' }, scheduledLocalDate: inRange },
  });
  const finished = await tx.workoutSession.count({
    where: { state: { in: ['completed', 'skipped'] }, scheduledLocalDate: inRange },
  });

  const ended = new Date(now.getTime() - grace);
  const dueCheckinsEnded = await tx.checkin.count({
    where: { periodLocalDate: inRange, dueAt: { lt: ended } },
  });
  const sentOfEnded = await tx.checkin.count({
    where: { periodLocalDate: inRange, dueAt: { lt: ended }, submittedAt: { not: null } },
  });
  const dueCheckins = await tx.checkin.count({
    where: { periodLocalDate: inRange, submittedAt: null },
  });

  const closed = await tx.reviewFlag.findMany({
    where: {
      state: { in: ['resolved', 'dismissed'] },
      resolvedBy: { not: null },
      resolvedAt: {
        gte: toDbDate(range.from),
        lt: new Date(toDbDate(range.to).getTime() + 24 * HOUR_MS),
      },
    },
    select: { createdAt: true, resolvedAt: true },
  });
  const hours = closed.map(
    (f) => ((f.resolvedAt as Date).getTime() - f.createdAt.getTime()) / HOUR_MS,
  );

  return {
    range,
    workouts: { assigned, finished },
    adherence: await adherence(tx, range, now),
    responseRate: { numerator: sentOfEnded, denominator: dueCheckinsEnded },
    dueCheckins,
    timeToFollowUp: {
      medianHours: (() => {
        const m = median(hours);
        return m === null ? null : Math.round(m * 10) / 10;
      })(),
      closed: hours.length,
    },
  };
}
