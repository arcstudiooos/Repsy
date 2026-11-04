/**
 * Series for charts (Docs/ui-redesign-plan.md §5, D-014). Read-only and tenant-scoped like every other query;
 * every series uses the same session rules as `adherence` (D-008 clar. 1): planned sessions only, cancelled ones
 * excluded, and a session counts once its due window (due + grace) has ended. A session still `scheduled` past its
 * window counts as missed, still `in_progress` as not finished (the sweep may not have run yet).
 */
import type { TenantTx } from '@kinetic/db';
import type { ActorContext } from '../authz/actor';
import { assertCan } from '../authz/policies';
import { getExerciseHistory, resolveClientId } from '../progress/records';
import { getTrainingLoad } from '../progress/trainingLoad';
import { fromDbDate, isoWeekOf, toDbDate } from '../sessions/read';
import { todayInZone } from '../timezone';
import { graceMs } from './adherence';

const DAY_MS = 86_400_000;

export const addDays = (localDate: string, n: number): string =>
  fromDbDate(new Date(toDbDate(localDate).getTime() + n * DAY_MS));

/** Chart buckets for a session state (plan §2.1 chart palette names). */
export type StateBucket = 'completed' | 'skipped' | 'notFinished' | 'missed' | 'due';

/** Where one session lands: past its window it is final; before, it is still "due". */
export function bucketOf(state: string, windowEnded: boolean): StateBucket | null {
  if (state === 'cancelled') return null;
  if (state === 'completed') return 'completed';
  if (state === 'skipped') return 'skipped';
  if (state === 'incomplete') return 'notFinished';
  if (state === 'missed') return 'missed';
  if (!windowEnded) return 'due';
  return state === 'in_progress' ? 'notFinished' : 'missed';
}

export interface StateCounts {
  completed: number;
  skipped: number;
  notFinished: number;
  missed: number;
  /** Not yet past the due window. Not part of `eligible`. */
  due: number;
  /** completed + skipped + notFinished + missed: the adherence denominator. */
  eligible: number;
}

export const emptyStateCounts = (): StateCounts => ({
  completed: 0,
  skipped: 0,
  notFinished: 0,
  missed: 0,
  due: 0,
  eligible: 0,
});

function add(c: StateCounts, b: StateBucket, n = 1) {
  c[b] += n;
  if (b !== 'due') c.eligible += n;
}

async function orgToday(tx: TenantTx, now: Date): Promise<{ today: string; zone: string }> {
  const zone = (await tx.organization.findFirst({ select: { timezone: true } }))?.timezone ?? 'UTC';
  try {
    return { today: todayInZone(zone, now), zone };
  } catch {
    return { today: todayInZone('UTC', now), zone: 'UTC' };
  }
}

/** Ratio as a 0-100 number, or null when nothing was eligible. */
export const pctOf = (num: number, den: number): number | null =>
  den > 0 ? Math.round((num / den) * 1000) / 10 : null;

export interface AdherenceWeek extends StateCounts {
  /** Monday, YYYY-MM-DD. */
  weekStart: string;
  /** completed ÷ eligible, 0-100, or null when nothing was eligible. */
  adherencePct: number | null;
}

/**
 * Weekly adherence for the organization, oldest first, ending with the current week (org time zone). Optionally
 * limited to some coaches' clients (PRD A12 scope).
 */
export async function getAdherenceSeries(
  tx: TenantTx,
  actor: ActorContext,
  opts: { weeks?: number; now?: Date; coachUserIds?: string[] } = {},
): Promise<AdherenceWeek[]> {
  assertCan(actor, 'analytics:read');
  const weeks = Math.min(Math.max(opts.weeks ?? 8, 1), 52);
  const now = opts.now ?? new Date();
  const { today } = await orgToday(tx, now);
  const lastStart = isoWeekOf(today).start;
  const firstStart = addDays(lastStart, -7 * (weeks - 1));
  const cutoff = new Date(now.getTime() - (await graceMs(tx)));
  const rows = await tx.workoutSession.findMany({
    where: {
      kind: 'planned',
      state: { not: 'cancelled' },
      scheduledLocalDate: { gte: toDbDate(firstStart), lte: toDbDate(addDays(lastStart, 6)) },
      ...(opts.coachUserIds ? { client: { coachUserId: { in: opts.coachUserIds } } } : {}),
    },
    select: { state: true, scheduledLocalDate: true, dueAt: true },
  });
  const out: AdherenceWeek[] = Array.from({ length: weeks }, (_, i) => ({
    weekStart: addDays(firstStart, i * 7),
    ...emptyStateCounts(),
    adherencePct: null,
  }));
  for (const r of rows) {
    const d = fromDbDate(r.scheduledLocalDate);
    const i = Math.floor((toDbDate(d).getTime() - toDbDate(firstStart).getTime()) / (7 * DAY_MS));
    const w = out[i];
    const b = bucketOf(r.state, r.dueAt < cutoff);
    if (w && b) add(w, b);
  }
  for (const w of out) w.adherencePct = pctOf(w.completed, w.eligible);
  return out;
}

export interface DayStates extends StateCounts {
  localDate: string;
  isToday: boolean;
}

/** Sessions per day of one week (Monday to Sunday, org time zone) by state, for the dashboard "This week" chart. */
export async function getDailySessionStates(
  tx: TenantTx,
  actor: ActorContext,
  opts: { weekStart?: string; now?: Date; coachUserIds?: string[] } = {},
): Promise<DayStates[]> {
  assertCan(actor, 'analytics:read');
  const now = opts.now ?? new Date();
  const { today } = await orgToday(tx, now);
  const start = opts.weekStart ? isoWeekOf(opts.weekStart).start : isoWeekOf(today).start;
  const cutoff = new Date(now.getTime() - (await graceMs(tx)));
  const rows = await tx.workoutSession.findMany({
    where: {
      kind: 'planned',
      state: { not: 'cancelled' },
      scheduledLocalDate: { gte: toDbDate(start), lte: toDbDate(addDays(start, 6)) },
      ...(opts.coachUserIds ? { client: { coachUserId: { in: opts.coachUserIds } } } : {}),
    },
    select: { state: true, scheduledLocalDate: true, dueAt: true },
  });
  const days: DayStates[] = Array.from({ length: 7 }, (_, i) => {
    const localDate = addDays(start, i);
    return { localDate, isToday: localDate === today, ...emptyStateCounts() };
  });
  for (const r of rows) {
    const d = days.find((x) => x.localDate === fromDbDate(r.scheduledLocalDate));
    const b = bucketOf(r.state, r.dueAt < cutoff);
    if (d && b) add(d, b);
  }
  return days;
}

export interface ClientAdherenceRow {
  clientId: string;
  counts: StateCounts;
  adherencePct: number | null;
  /** Local date of the last completed workout. */
  lastWorkout: string | null;
  /** Local date of the next scheduled workout, today or later. */
  nextWorkout: string | null;
  /** The last 7 days (oldest first) in the client's time zone, worst state per day; null = nothing scheduled. */
  week: Array<{ localDate: string; state: StateBucket | null }>;
}

const WORST: StateBucket[] = ['missed', 'notFinished', 'skipped', 'due', 'completed'];
const worse = (a: StateBucket | null, b: StateBucket): StateBucket =>
  a === null || WORST.indexOf(b) < WORST.indexOf(a) ? b : a;

/**
 * Per-client adherence for the last `days` days (client time zone), plus last/next workout and the last 7 days, for
 * the client list, the dashboard client pulse and the analytics table.
 */
export async function getClientAdherence(
  tx: TenantTx,
  actor: ActorContext,
  clientIds: readonly string[],
  opts: { days?: number; now?: Date } = {},
): Promise<Map<string, ClientAdherenceRow>> {
  assertCan(actor, 'client:read');
  const result = new Map<string, ClientAdherenceRow>();
  if (clientIds.length === 0) return result;
  const now = opts.now ?? new Date();
  const span = Math.min(Math.max(opts.days ?? 28, 7), 366);
  const clients = await tx.client.findMany({
    where: { id: { in: [...clientIds] } },
    select: { id: true, timezone: true },
  });
  const todays = new Map<string, string>();
  for (const c of clients) {
    try {
      todays.set(c.id, todayInZone(c.timezone, now));
    } catch {
      todays.set(c.id, todayInZone('UTC', now));
    }
  }
  if (todays.size === 0) return result;
  const sorted = [...todays.values()].sort();
  const earliest = addDays(sorted[0]!, -(span - 1));
  const cutoff = new Date(now.getTime() - (await graceMs(tx)));
  const ids = [...todays.keys()];
  const past = await tx.workoutSession.findMany({
    where: {
      clientId: { in: ids },
      kind: 'planned',
      state: { not: 'cancelled' },
      scheduledLocalDate: { gte: toDbDate(earliest), lte: toDbDate(sorted.at(-1)!) },
    },
    select: { clientId: true, state: true, scheduledLocalDate: true, dueAt: true },
  });
  const lastDone = await tx.workoutSession.groupBy({
    by: ['clientId'],
    where: { clientId: { in: ids }, state: 'completed' },
    _max: { scheduledLocalDate: true },
  });
  const next = await tx.workoutSession.groupBy({
    by: ['clientId'],
    where: {
      clientId: { in: ids },
      kind: 'planned',
      state: { in: ['scheduled', 'in_progress'] },
      scheduledLocalDate: { gte: toDbDate(sorted[0]!) },
    },
    _min: { scheduledLocalDate: true },
  });
  for (const [id, today] of todays) {
    result.set(id, {
      clientId: id,
      counts: emptyStateCounts(),
      adherencePct: null,
      lastWorkout: null,
      nextWorkout: null,
      week: Array.from({ length: 7 }, (_, i) => ({
        localDate: addDays(today, i - 6),
        state: null,
      })),
    });
  }
  for (const s of past) {
    const row = result.get(s.clientId);
    const today = todays.get(s.clientId);
    if (!row || !today) continue;
    const d = fromDbDate(s.scheduledLocalDate);
    if (d > today || d < addDays(today, -(span - 1))) continue;
    const b = bucketOf(s.state, s.dueAt < cutoff);
    if (!b) continue;
    add(row.counts, b);
    const day = row.week.find((x) => x.localDate === d);
    if (day) day.state = worse(day.state, b);
  }
  for (const l of lastDone) {
    const row = result.get(l.clientId);
    if (row && l._max.scheduledLocalDate) row.lastWorkout = fromDbDate(l._max.scheduledLocalDate);
  }
  for (const n of next) {
    const row = result.get(n.clientId);
    const today = todays.get(n.clientId);
    const d = n._min.scheduledLocalDate ? fromDbDate(n._min.scheduledLocalDate) : null;
    if (row && d && today && d >= today) row.nextWorkout = d;
  }
  for (const row of result.values())
    row.adherencePct = pctOf(row.counts.completed, row.counts.eligible);
  return result;
}

/**
 * One cell per day for the last `weeks` full weeks (Monday start, client time zone), oldest first, with the worst
 * state of that day's scheduled sessions (null = nothing scheduled). For the consistency heatmap.
 */
export async function getClientConsistency(
  tx: TenantTx,
  actor: ActorContext,
  clientId: string,
  opts: { weeks?: number; now?: Date } = {},
): Promise<Array<{ localDate: string; state: StateBucket | null }>> {
  const id = await resolveClientId(tx, actor, clientId);
  const weeks = Math.min(Math.max(opts.weeks ?? 12, 1), 52);
  const now = opts.now ?? new Date();
  const c = await tx.client.findFirst({ where: { id }, select: { timezone: true } });
  let today: string;
  try {
    today = todayInZone(c?.timezone ?? 'UTC', now);
  } catch {
    today = todayInZone('UTC', now);
  }
  const start = addDays(isoWeekOf(today).start, -7 * (weeks - 1));
  const cutoff = new Date(now.getTime() - (await graceMs(tx)));
  const rows = await tx.workoutSession.findMany({
    where: {
      clientId: id,
      kind: 'planned',
      state: { not: 'cancelled' },
      scheduledLocalDate: { gte: toDbDate(start), lte: toDbDate(addDays(start, weeks * 7 - 1)) },
    },
    select: { state: true, scheduledLocalDate: true, dueAt: true },
  });
  const cells = Array.from({ length: weeks * 7 }, (_, i) => ({
    localDate: addDays(start, i),
    state: null as StateBucket | null,
  }));
  for (const r of rows) {
    const cell = cells.find((x) => x.localDate === fromDbDate(r.scheduledLocalDate));
    const b = bucketOf(r.state, r.dueAt < cutoff);
    if (cell && b) cell.state = worse(cell.state, b);
  }
  return cells;
}

export interface ExerciseProgressPoint {
  localDate: string;
  sessionId: string;
  topSetKg: number | null;
  topSetReps: number | null;
  estimatedOneRepMaxKg: number | null;
  volumeKg: number;
  /** The estimated 1RM beat every earlier session's. */
  isPersonalRecord: boolean;
}

/** Per completed session for one exercise, oldest first, with a PR flag (a new best estimated 1RM). */
export async function getExerciseProgress(
  tx: TenantTx,
  actor: ActorContext,
  clientId: string,
  exerciseId: string,
): Promise<{ name: string; points: ExerciseProgressPoint[] }> {
  const { exercise, entries } = await getExerciseHistory(tx, actor, clientId, exerciseId);
  const sorted = [...entries].sort((a, b) =>
    a.localDate === b.localDate
      ? a.sessionId.localeCompare(b.sessionId)
      : a.localDate.localeCompare(b.localDate),
  );
  let best = 0;
  const points = sorted.map((e) => {
    const est = e.estimatedOneRepMaxKg;
    const pr = est !== null && est > best;
    if (pr) best = est;
    return {
      localDate: e.localDate,
      sessionId: e.sessionId,
      topSetKg: e.topSet?.weightKg ?? null,
      topSetReps: e.topSet?.reps ?? null,
      estimatedOneRepMaxKg: est,
      volumeKg: e.volumeKg,
      isPersonalRecord: pr,
    };
  });
  return { name: exercise.name, points };
}

/** Weekly training volume (load × reps, kg), oldest first; the same numbers as the training-load card. */
export async function getWeeklyVolume(
  tx: TenantTx,
  actor: ActorContext,
  clientId: string,
  opts: { weeks?: number; now?: Date } = {},
): Promise<Array<{ weekStart: string; volumeKg: number; sessions: number; sets: number }>> {
  const load = await getTrainingLoad(tx, actor, clientId, opts);
  return load.weeks.map((w) => ({
    weekStart: w.weekStart,
    volumeKg: w.volumeKg,
    sessions: w.sessions,
    sets: w.sets,
  }));
}

export interface CheckinSeries {
  questions: Array<{ id: string; label: string }>;
  /** Oldest first. A missing answer is null. */
  points: Array<{ periodLocalDate: string; values: Record<string, number | null> }>;
}

/**
 * 1–5 answers from submitted check-ins, oldest first, for the wellbeing trend (D-014: in-app only; never sent to
 * analytics). Only scale questions are included; `questionIds` narrows them.
 */
export async function getCheckinSeries(
  tx: TenantTx,
  actor: ActorContext,
  clientId: string,
  opts: { questionIds?: string[]; limit?: number } = {},
): Promise<CheckinSeries> {
  assertCan(actor, 'checkin:read');
  const id = await resolveClientId(tx, actor, clientId);
  const rows = await tx.checkin.findMany({
    where: { clientId: id, kind: 'checkin', submittedAt: { not: null } },
    orderBy: { periodLocalDate: 'desc' },
    take: Math.min(Math.max(opts.limit ?? 12, 1), 52),
    select: { periodLocalDate: true, questionsJson: true, answersJson: true },
  });
  rows.reverse();
  const labels = new Map<string, string>();
  for (const r of rows) {
    const qs = Array.isArray(r.questionsJson) ? r.questionsJson : [];
    for (const q of qs as Array<{ id?: unknown; type?: unknown; label?: unknown }>) {
      if (q && q.type === 'scale_1_5' && typeof q.id === 'string' && typeof q.label === 'string') {
        if (!opts.questionIds || opts.questionIds.includes(q.id)) labels.set(q.id, q.label);
      }
    }
  }
  const questions = [...labels].map(([qid, label]) => ({ id: qid, label }));
  const points = rows.map((r) => {
    const answers = (r.answersJson ?? {}) as Record<string, unknown>;
    const values: Record<string, number | null> = {};
    for (const q of questions) {
      const v = answers[q.id];
      values[q.id] = typeof v === 'number' && v >= 1 && v <= 5 ? v : null;
    }
    return { periodLocalDate: fromDbDate(r.periodLocalDate), values };
  });
  return { questions, points };
}

/**
 * Consecutive completed scheduled sessions, counting back from the most recent one whose due window ended (or which
 * is already completed). Skipped, not finished and missed end the streak; cancelled ones are ignored.
 */
export async function getStreak(
  tx: TenantTx,
  actor: ActorContext,
  clientId: string,
  opts: { now?: Date } = {},
): Promise<number> {
  const id = await resolveClientId(tx, actor, clientId);
  const now = opts.now ?? new Date();
  const cutoff = new Date(now.getTime() - (await graceMs(tx)));
  const rows = await tx.workoutSession.findMany({
    where: {
      clientId: id,
      kind: 'planned',
      state: { not: 'cancelled' },
      OR: [{ state: 'completed' }, { dueAt: { lt: cutoff } }],
    },
    orderBy: [{ scheduledLocalDate: 'desc' }, { dueAt: 'desc' }],
    take: 200,
    select: { state: true },
  });
  let n = 0;
  for (const r of rows) {
    if (r.state !== 'completed') break;
    n += 1;
  }
  return n;
}
