import { appendAudit, type TenantTx } from '@repsy/db';
import type { ActorContext } from '../authz/actor';
import { assertCan } from '../authz/policies';
import { DomainError } from '../errors';
import { isBodyMetric, metricDef, type BodyMetric } from '../progress/metric-catalog';
import { exerciseBestsBefore } from '../progress/records';
import { fromDbDate, toDbDate } from '../sessions/read';
import { todayInZone } from '../timezone';
import { isUuid } from '../uuid';

export const GOAL_KINDS = ['metric', 'exercise', 'habit'] as const;
export type GoalKind = (typeof GOAL_KINDS)[number];
export const EXERCISE_MEASURES = ['e1rm', 'heaviest'] as const;
export type ExerciseMeasure = (typeof EXERCISE_MEASURES)[number];
export const GOAL_TITLE_MAX = 120;
export const ACTIVE_GOALS_MAX = 10;
/** A habit goal is the completion rate over this many days. */
export const HABIT_WINDOW_DAYS = 28;
/** On track while progress is within this share of where the straight line from start to target is today. */
export const ON_TRACK_SLACK = 0.1;

export type GoalLabel = 'achieved' | 'on_track' | 'behind' | 'no_data';

export interface GoalView {
  id: string;
  kind: GoalKind;
  title: string;
  metric: BodyMetric | null;
  exerciseId: string | null;
  exerciseName: string | null;
  exerciseMeasure: ExerciseMeasure | null;
  habitId: string | null;
  habitTitle: string | null;
  /** Canonical units: kg (metric mass and exercise), cm, %, bpm, steps; habit goals are a completion %. */
  startValue: number;
  targetValue: number;
  currentValue: number | null;
  startDate: string;
  targetDate: string;
  status: 'active' | 'archived';
  /** 0-1 of the way from start to target (clamped); null without a current value. */
  progress: number | null;
  label: GoalLabel;
}

const notFound = () => new DomainError('NOT_FOUND', 'Not found.');
const invalid = (field: string, message: string) =>
  new DomainError('VALIDATION', 'Some fields are invalid.', { [field]: [message] });
const DAY_MS = 86_400_000;
const NIL_SESSION = '00000000-0000-0000-0000-000000000000';
const num = (d: { toString(): string }) => Number(d.toString());
const days = (a: string, b: string) =>
  Math.round((toDbDate(b).getTime() - toDbDate(a).getTime()) / DAY_MS);
const round = (v: number) => Math.round(v * 1000) / 1000;

async function resolveClient(tx: TenantTx, actor: ActorContext, clientId: string) {
  if (!isUuid(clientId)) throw notFound();
  if (actor.role === 'client' && actor.clientId?.toLowerCase() !== clientId.toLowerCase()) {
    throw notFound();
  }
  const client = await tx.client.findFirst({
    where: { id: clientId },
    select: { id: true, timezone: true },
  });
  if (!client) throw notFound();
  return client;
}

/** The pure part of E9: how far along a goal is and whether it is on track today. */
export function goalStatus(g: {
  startValue: number;
  targetValue: number;
  currentValue: number | null;
  startDate: string;
  targetDate: string;
  today: string;
}): { progress: number | null; label: GoalLabel } {
  if (g.currentValue === null) return { progress: null, label: 'no_data' };
  const span = g.targetValue - g.startValue;
  const reached = span >= 0 ? g.currentValue >= g.targetValue : g.currentValue <= g.targetValue;
  if (reached) return { progress: 1, label: 'achieved' };
  const raw = span === 0 ? 0 : (g.currentValue - g.startValue) / span;
  const progress = Math.max(0, Math.min(1, raw));
  if (g.today >= g.targetDate) return { progress, label: 'behind' };
  const elapsed =
    Math.max(0, days(g.startDate, g.today)) / Math.max(1, days(g.startDate, g.targetDate));
  return { progress, label: raw >= elapsed - ON_TRACK_SLACK ? 'on_track' : 'behind' };
}

/** A habit's completion % over the last 28 days (capped at 100), or null before it has run a full day. */
async function habitCompletion(
  tx: TenantTx,
  habitId: string,
  today: string,
): Promise<number | null> {
  const habit = await tx.habit.findFirst({
    where: { id: habitId },
    select: { startDate: true, daysPerWeek: true, targetCount: true },
  });
  if (!habit) return null;
  const from = fromDbDate(
    new Date(
      Math.max(
        toDbDate(today).getTime() - (HABIT_WINDOW_DAYS - 1) * DAY_MS,
        habit.startDate.getTime(),
      ),
    ),
  );
  const span = days(from, today) + 1;
  if (span < 1) return null;
  const done = await tx.habitLog.count({
    where: {
      habitId,
      localDate: { gte: toDbDate(from), lte: toDbDate(today) },
      value: { gte: habit.targetCount ?? 1 },
    },
  });
  const expected = ((habit.daysPerWeek ?? 7) * span) / 7;
  return expected > 0 ? round(Math.min(100, (done / expected) * 100)) : null;
}

async function currentValue(
  tx: TenantTx,
  clientId: string,
  g: {
    kind: GoalKind;
    metric: BodyMetric | null;
    exerciseId: string | null;
    exerciseMeasure: string | null;
    habitId: string | null;
  },
  today: string,
): Promise<number | null> {
  if (g.kind === 'metric' && g.metric) {
    const latest = await tx.metricEntry.findFirst({
      where: { clientId, metric: g.metric },
      orderBy: { measuredOn: 'desc' },
      select: { value: true },
    });
    return latest ? num(latest.value) : null;
  }
  if (g.kind === 'exercise' && g.exerciseId) {
    const best = (await exerciseBestsBefore(tx, clientId, [g.exerciseId], NIL_SESSION))[
      g.exerciseId
    ];
    if (!best) return null;
    return g.exerciseMeasure === 'heaviest' ? best.heaviestKg : best.estimatedOneRepMaxKg;
  }
  if (g.kind === 'habit' && g.habitId) return habitCompletion(tx, g.habitId, today);
  return null;
}

/** A client's goals with their progress (PRD B18, E9): active first, then archived; newest first within each. */
export async function listGoals(
  tx: TenantTx,
  actor: ActorContext,
  clientId: string,
  opts: { now?: Date } = {},
): Promise<GoalView[]> {
  assertCan(actor, 'metric:read');
  const client = await resolveClient(tx, actor, clientId);
  const today = todayInZone(client.timezone, opts.now ?? new Date());
  const rows = await tx.goal.findMany({
    where: { clientId: client.id },
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    include: {
      exercise: { select: { name: true } },
      habit: { select: { title: true } },
    },
  });
  const out: GoalView[] = [];
  for (const r of rows) {
    const current = await currentValue(tx, client.id, r, today);
    const startDate = fromDbDate(r.startDate);
    const targetDate = fromDbDate(r.targetDate);
    const startValue = num(r.startValue);
    const targetValue = num(r.targetValue);
    const s = goalStatus({
      startValue,
      targetValue,
      currentValue: current,
      startDate,
      targetDate,
      today,
    });
    out.push({
      id: r.id,
      kind: r.kind,
      title: r.title,
      metric: r.metric,
      exerciseId: r.exerciseId,
      exerciseName: r.exercise?.name ?? null,
      exerciseMeasure: (r.exerciseMeasure as ExerciseMeasure | null) ?? null,
      habitId: r.habitId,
      habitTitle: r.habit?.title ?? null,
      startValue,
      targetValue,
      currentValue: current,
      startDate,
      targetDate,
      status: r.status,
      ...s,
    });
  }
  return out;
}

export interface CreateGoalInput {
  kind?: unknown;
  title?: unknown;
  metric?: unknown;
  exerciseId?: unknown;
  exerciseMeasure?: unknown;
  habitId?: unknown;
  /** Canonical units. */
  targetValue?: unknown;
  /** Optional: defaults to the current value; required when there is none yet. */
  startValue?: unknown;
  targetDate?: unknown;
}

/** Sets a goal for a client (coach). Values are canonical units; the start is today's value unless given. */
export async function createGoal(
  tx: TenantTx,
  actor: ActorContext,
  clientId: string,
  input: CreateGoalInput,
  opts: { now?: Date; requestId?: string } = {},
): Promise<GoalView> {
  assertCan(actor, 'client:update');
  const client = await resolveClient(tx, actor, clientId);
  const today = todayInZone(client.timezone, opts.now ?? new Date());
  if (!GOAL_KINDS.includes(input.kind as GoalKind))
    throw invalid('kind', 'Pick what the goal tracks.');
  const kind = input.kind as GoalKind;
  const target = Number(input.targetValue);
  if (typeof input.targetValue !== 'number' || !Number.isFinite(target)) {
    throw invalid('targetValue', 'Enter a target.');
  }
  const date = input.targetDate;
  if (
    typeof date !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    fromDbDate(toDbDate(date)) !== date
  ) {
    throw invalid('targetDate', 'Use YYYY-MM-DD.');
  }
  if (date <= today) throw invalid('targetDate', 'Pick a date after today.');
  if (days(today, date) > 3 * 366) throw invalid('targetDate', 'Pick a date within three years.');
  if (
    (await tx.goal.count({ where: { clientId: client.id, status: 'active' } })) >= ACTIVE_GOALS_MAX
  ) {
    throw invalid(
      'kind',
      `A client can have at most ${ACTIVE_GOALS_MAX} active goals. Archive one first.`,
    );
  }

  let subject: {
    metric: BodyMetric | null;
    exerciseId: string | null;
    exerciseMeasure: ExerciseMeasure | null;
    habitId: string | null;
  } = { metric: null, exerciseId: null, exerciseMeasure: null, habitId: null };
  let defaultTitle = '';
  if (kind === 'metric') {
    if (!isBodyMetric(input.metric)) throw invalid('metric', 'Pick a measurement.');
    const def = metricDef(input.metric);
    if (target < def.min || target > def.max) {
      throw invalid('targetValue', `Use a value from ${def.min} to ${def.max}.`);
    }
    subject = { ...subject, metric: input.metric };
    defaultTitle = def.label;
  } else if (kind === 'exercise') {
    if (!isUuid(input.exerciseId)) throw invalid('exerciseId', 'Pick an exercise.');
    const ex = await tx.exercise.findFirst({
      where: { id: input.exerciseId },
      select: { id: true, name: true, trackingType: true },
    });
    if (!ex) throw invalid('exerciseId', 'Pick an exercise.');
    if (ex.trackingType !== 'reps_load') {
      throw invalid('exerciseId', 'Pick an exercise tracked by reps and load.');
    }
    if (!EXERCISE_MEASURES.includes(input.exerciseMeasure as ExerciseMeasure)) {
      throw invalid('exerciseMeasure', 'Pick estimated 1RM or heaviest.');
    }
    if (target <= 0 || target > 2000) throw invalid('targetValue', 'Use a load from 0 to 2000 kg.');
    subject = {
      ...subject,
      exerciseId: ex.id,
      exerciseMeasure: input.exerciseMeasure as ExerciseMeasure,
    };
    defaultTitle = `${ex.name} ${input.exerciseMeasure === 'e1rm' ? 'estimated 1RM' : 'heaviest set'}`;
  } else {
    if (!isUuid(input.habitId)) throw invalid('habitId', 'Pick a habit.');
    const habit = await tx.habit.findFirst({
      where: { id: input.habitId, clientId: client.id, isTask: false },
      select: { id: true, title: true },
    });
    if (!habit) throw invalid('habitId', 'Pick one of this client’s habits.');
    if (target <= 0 || target > 100)
      throw invalid('targetValue', 'Use a completion rate from 1 to 100%.');
    subject = { ...subject, habitId: habit.id };
    defaultTitle = `${habit.title} completion`;
  }

  const now = await currentValue(tx, client.id, { kind, ...subject }, today);
  let start: number;
  if (input.startValue !== undefined && input.startValue !== null) {
    if (typeof input.startValue !== 'number' || !Number.isFinite(input.startValue)) {
      throw invalid('startValue', 'Enter a starting value.');
    }
    start = input.startValue;
  } else if (now !== null) {
    start = now;
  } else if (kind === 'habit') {
    start = 0;
  } else {
    throw invalid('startValue', 'Nothing is recorded yet. Enter a starting value.');
  }
  if (round(start) === round(target))
    throw invalid('targetValue', 'Pick a target different from the start.');

  const rawTitle = typeof input.title === 'string' ? input.title.trim() : '';
  const title = (rawTitle || defaultTitle).slice(0, GOAL_TITLE_MAX);
  const row = await tx.goal.create({
    data: {
      clientId: client.id,
      kind,
      title,
      ...subject,
      startValue: round(start),
      targetValue: round(target),
      startDate: toDbDate(today),
      targetDate: toDbDate(date),
      createdByUserId: actor.userId,
    },
  } as Parameters<typeof tx.goal.create>[0]);
  await appendAudit(tx, {
    orgId: actor.orgId,
    actorId: actor.userId,
    objectType: 'goal',
    objectId: row.id,
    action: 'goal.created',
    metadata: { clientId: client.id, kind },
    requestId: opts.requestId,
  });
  return (await listGoals(tx, actor, client.id, opts)).find((g) => g.id === row.id)!;
}

/** Archive or restore a goal (coach). */
export async function setGoalStatus(
  tx: TenantTx,
  actor: ActorContext,
  goalId: string,
  status: unknown,
  opts: { requestId?: string } = {},
): Promise<{ id: string; status: 'active' | 'archived' }> {
  assertCan(actor, 'client:update');
  if (!isUuid(goalId)) throw notFound();
  if (status !== 'active' && status !== 'archived')
    throw invalid('status', 'Use active or archived.');
  const goal = await tx.goal.findFirst({
    where: { id: goalId },
    select: { id: true, clientId: true },
  });
  if (!goal) throw notFound();
  if (
    status === 'active' &&
    (await tx.goal.count({ where: { clientId: goal.clientId, status: 'active' } })) >=
      ACTIVE_GOALS_MAX
  ) {
    throw invalid('status', `A client can have at most ${ACTIVE_GOALS_MAX} active goals.`);
  }
  await tx.goal.update({ where: { id: goal.id }, data: { status } });
  await appendAudit(tx, {
    orgId: actor.orgId,
    actorId: actor.userId,
    objectType: 'goal',
    objectId: goal.id,
    action: status === 'archived' ? 'goal.archived' : 'goal.restored',
    requestId: opts.requestId,
  });
  return { id: goal.id, status };
}
