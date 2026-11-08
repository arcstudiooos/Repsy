import { appendAudit, type TenantTx } from '@repsy/db';
import type { ActorContext } from '../authz/actor';
import { assertCan } from '../authz/policies';
import { DomainError } from '../errors';
import { fromDbDate, isoWeekOf, toDbDate } from '../sessions/read';
import { todayInZone } from '../timezone';
import { isUuid } from '../uuid';

const DAY_MS = 86_400_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** Days of history returned per habit: 12 weeks for the coach heat map. */
export const HABIT_HISTORY_DAYS = 84;
/** How many days back a client may tick (today and the two days before). */
export const HABIT_BACKFILL_DAYS = 2;
/** Window for the completion rate. */
export const HABIT_COMPLETION_DAYS = 28;
export const HABIT_TITLE_MAX = 120;
export const HABIT_UNIT_MAX = 20;
export const HABIT_MAX_ACTIVE = 30;

export interface HabitView {
  id: string;
  title: string;
  isTask: boolean;
  /** Habits: days a week (7 = daily). Null for tasks. */
  daysPerWeek: number | null;
  targetCount: number | null;
  unit: string | null;
  startDate: string;
  endDate: string | null;
  dueDate: string | null;
  status: 'active' | 'archived';
  /** Client-local date → amount logged, for the last 84 days (tasks: any date). */
  logs: Record<string, number>;
  /** Whether today's tick meets the target (tasks: whether the task is done). */
  doneToday: boolean;
  /** Habits: done days in the current ISO week. */
  doneThisWeek: number;
  /** Habits: consecutive done days (daily) or weeks that met their target (N a week). */
  streak: number;
  /** Habits: done of expected days in the last 28 days (within its dates), null before anything is expected. */
  completion: { done: number; expected: number } | null;
  /** Tasks: done at all. */
  done: boolean;
}

export interface HabitsView {
  todayLocalDate: string;
  habits: HabitView[];
  tasks: HabitView[];
}

export interface CreateHabitInput {
  title?: unknown;
  isTask?: unknown;
  daysPerWeek?: unknown;
  targetCount?: unknown;
  unit?: unknown;
  startDate?: unknown;
  endDate?: unknown;
  dueDate?: unknown;
}

const notFound = () => new DomainError('NOT_FOUND', 'Not found.');
const invalid = (field: string, message: string) =>
  new DomainError('VALIDATION', 'Some fields are invalid.', { [field]: [message] });

const addDays = (d: string, n: number) => fromDbDate(new Date(toDbDate(d).getTime() + n * DAY_MS));
const isDate = (v: unknown): v is string =>
  typeof v === 'string' && DATE.test(v) && fromDbDate(toDbDate(v)) === v;

const todayFor = (timezone: string, now: Date) => {
  try {
    return todayInZone(timezone, now);
  } catch {
    return todayInZone('UTC', now);
  }
};

/** A client reaches only their own record; a coach any client in the organization (RLS hides others). */
async function resolveClient(tx: TenantTx, actor: ActorContext, clientId: string) {
  if (!isUuid(clientId)) throw notFound();
  if (actor.role === 'client' && actor.clientId?.toLowerCase() !== clientId.toLowerCase()) {
    throw notFound();
  }
  const client = await tx.client.findFirst({
    where: { id: clientId },
    select: { id: true, organizationId: true, timezone: true, status: true },
  });
  if (!client) throw notFound();
  return client;
}

async function resolveHabit(tx: TenantTx, actor: ActorContext, habitId: string) {
  if (!isUuid(habitId)) throw notFound();
  const habit = await tx.habit.findFirst({
    where: {
      id: habitId,
      ...(actor.role === 'client' ? { clientId: actor.clientId ?? '' } : {}),
    },
    include: { client: { select: { timezone: true } } },
  });
  if (!habit) throw notFound();
  return habit;
}

type HabitRow = {
  id: string;
  title: string;
  isTask: boolean;
  daysPerWeek: number | null;
  targetCount: number | null;
  unit: string | null;
  startDate: Date;
  endDate: Date | null;
  dueDate: Date | null;
  status: 'active' | 'archived';
};

/** Builds the view of one habit from its logs (date → amount) and the client's today. */
export function summarizeHabit(
  row: HabitRow,
  logs: Record<string, number>,
  today: string,
): HabitView {
  const start = fromDbDate(row.startDate);
  const end = row.endDate ? fromDbDate(row.endDate) : null;
  const target = row.targetCount ?? 1;
  const isDone = (d: string) => (logs[d] ?? 0) >= target;
  const base = {
    id: row.id,
    title: row.title,
    isTask: row.isTask,
    daysPerWeek: row.daysPerWeek,
    targetCount: row.targetCount,
    unit: row.unit,
    startDate: start,
    endDate: end,
    dueDate: row.dueDate ? fromDbDate(row.dueDate) : null,
    status: row.status,
    logs,
  };
  if (row.isTask) {
    const done = Object.keys(logs).length > 0;
    return {
      ...base,
      doneToday: done,
      doneThisWeek: 0,
      streak: 0,
      completion: null,
      done,
    };
  }
  const perWeek = row.daysPerWeek ?? 7;
  const last = end && end < today ? end : today;
  const week = isoWeekOf(today);
  let doneThisWeek = 0;
  for (let d = week.start; d <= week.end && d <= today; d = addDays(d, 1)) {
    if (isDone(d)) doneThisWeek += 1;
  }

  let streak = 0;
  if (perWeek === 7) {
    // Today not ticked yet doesn't break the streak: count back from yesterday.
    let d = isDone(last) ? last : addDays(last, -1);
    while (d >= start && isDone(d)) {
      streak += 1;
      d = addDays(d, -1);
    }
  } else {
    // Weeks that met the target; the current week counts once it has, otherwise it doesn't break the streak.
    let ws = isoWeekOf(last).start;
    const doneIn = (from: string) => {
      let n = 0;
      for (let i = 0; i < 7; i++) if (isDone(addDays(from, i))) n += 1;
      return n;
    };
    if (doneIn(ws) < perWeek) ws = addDays(ws, -7);
    while (addDays(ws, 6) >= start && doneIn(ws) >= perWeek) {
      streak += 1;
      ws = addDays(ws, -7);
    }
  }

  const windowStart = addDays(last, -(HABIT_COMPLETION_DAYS - 1));
  const from = windowStart > start ? windowStart : start;
  let activeDays = 0;
  let done = 0;
  for (let d = from; d <= last; d = addDays(d, 1)) {
    activeDays += 1;
    if (isDone(d)) done += 1;
  }
  const expected = Math.round((activeDays * perWeek) / 7);
  return {
    ...base,
    doneToday: isDone(today),
    doneThisWeek,
    streak,
    completion: expected > 0 ? { done: Math.min(done, expected), expected } : null,
    done: false,
  };
}

/** The client's habits and tasks with their recent logs (PRD G1-G3). Archived ones only on request. */
export async function listHabits(
  tx: TenantTx,
  actor: ActorContext,
  clientId: string,
  opts: { now?: Date; includeArchived?: boolean } = {},
): Promise<HabitsView> {
  assertCan(actor, 'habit:read');
  const client = await resolveClient(tx, actor, clientId);
  const today = todayFor(client.timezone, opts.now ?? new Date());
  const rows = await tx.habit.findMany({
    where: { clientId: client.id, ...(opts.includeArchived ? {} : { status: 'active' }) },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  const since = addDays(today, -(HABIT_HISTORY_DAYS - 1));
  const logs = rows.length
    ? await tx.habitLog.findMany({
        where: {
          habitId: { in: rows.map((r) => r.id) },
          OR: [{ localDate: { gte: toDbDate(since) } }, { habit: { is: { isTask: true } } }],
        },
        select: { habitId: true, localDate: true, value: true },
      })
    : [];
  const byHabit = new Map<string, Record<string, number>>();
  for (const l of logs) {
    const m = byHabit.get(l.habitId) ?? {};
    m[fromDbDate(l.localDate)] = l.value;
    byHabit.set(l.habitId, m);
  }
  const views = rows.map((r) => summarizeHabit(r, byHabit.get(r.id) ?? {}, today));
  return {
    todayLocalDate: today,
    habits: views.filter((v) => !v.isTask),
    tasks: views.filter((v) => v.isTask),
  };
}

const optionalInt = (field: string, v: unknown, min: number, max: number): number | null => {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
    throw invalid(field, `Use a whole number from ${min} to ${max}.`);
  }
  return v;
};

/** A coach assigns a habit or a one-off task to a client (PRD G1, G3). */
export async function createHabit(
  tx: TenantTx,
  actor: ActorContext,
  clientId: string,
  input: CreateHabitInput,
  opts: { now?: Date; requestId?: string } = {},
): Promise<HabitView> {
  assertCan(actor, 'habit:manage');
  const client = await resolveClient(tx, actor, clientId);
  if (client.status === 'archived') {
    throw new DomainError('CONFLICT', 'This client is archived.');
  }
  const today = todayFor(client.timezone, opts.now ?? new Date());
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  if (title.length < 1 || title.length > HABIT_TITLE_MAX) {
    throw invalid('title', `Use 1-${HABIT_TITLE_MAX} characters.`);
  }
  const isTask = input.isTask === true;
  const startDate = input.startDate === undefined ? today : input.startDate;
  if (!isDate(startDate)) throw invalid('startDate', 'Use YYYY-MM-DD.');
  let daysPerWeek: number | null = null;
  let endDate: string | null = null;
  let dueDate: string | null = null;
  let targetCount: number | null = null;
  let unit: string | null = null;
  if (isTask) {
    if (!isDate(input.dueDate)) throw invalid('dueDate', 'Pick a due date.');
    if (input.dueDate < startDate) throw invalid('dueDate', 'Pick a day on or after the start.');
    dueDate = input.dueDate;
  } else {
    daysPerWeek = optionalInt('daysPerWeek', input.daysPerWeek ?? 7, 1, 7) as number;
    if (input.endDate !== undefined && input.endDate !== null && input.endDate !== '') {
      if (!isDate(input.endDate)) throw invalid('endDate', 'Use YYYY-MM-DD.');
      if (input.endDate < startDate) throw invalid('endDate', 'Pick a day on or after the start.');
      endDate = input.endDate;
    }
    targetCount = optionalInt('targetCount', input.targetCount, 1, 100_000);
    if (typeof input.unit === 'string' && input.unit.trim()) {
      unit = input.unit.trim();
      if (unit.length > HABIT_UNIT_MAX)
        throw invalid('unit', `Use at most ${HABIT_UNIT_MAX} characters.`);
    }
  }
  const active = await tx.habit.count({ where: { clientId: client.id, status: 'active' } });
  if (active >= HABIT_MAX_ACTIVE) {
    throw invalid(
      'title',
      `A client can have at most ${HABIT_MAX_ACTIVE} active habits and tasks.`,
    );
  }
  const row = await tx.habit.create({
    data: {
      organizationId: client.organizationId,
      clientId: client.id,
      title,
      isTask,
      daysPerWeek,
      targetCount,
      unit,
      startDate: toDbDate(startDate),
      endDate: endDate ? toDbDate(endDate) : null,
      dueDate: dueDate ? toDbDate(dueDate) : null,
      createdByUserId: actor.userId,
    },
  });
  await appendAudit(tx, {
    orgId: actor.orgId,
    actorId: actor.userId,
    objectType: 'habit',
    objectId: row.id,
    action: 'habit.created',
    requestId: opts.requestId,
  });
  return summarizeHabit(row, {}, today);
}

/** Archives or restores a habit or task (coach). Its logs stay. */
export async function setHabitStatus(
  tx: TenantTx,
  actor: ActorContext,
  habitId: string,
  status: 'active' | 'archived',
  opts: { requestId?: string } = {},
): Promise<{ id: string; status: 'active' | 'archived' }> {
  assertCan(actor, 'habit:manage');
  const habit = await resolveHabit(tx, actor, habitId);
  if (habit.status !== status) {
    await tx.habit.update({ where: { id: habit.id }, data: { status } });
    await appendAudit(tx, {
      orgId: actor.orgId,
      actorId: actor.userId,
      objectType: 'habit',
      objectId: habit.id,
      action: status === 'archived' ? 'habit.archived' : 'habit.restored',
      requestId: opts.requestId,
    });
  }
  return { id: habit.id, status };
}

/**
 * Ticks a habit for a client-local day, or marks a task done (PRD G1, G3). Habits accept today and the two days
 * before, within the habit's dates; a value sets the amount (habits with a target). Ticking again sets the amount
 * again (idempotent). `done: false` removes the tick.
 */
export async function logHabit(
  tx: TenantTx,
  actor: ActorContext,
  habitId: string,
  input: { localDate?: unknown; value?: unknown; done?: unknown },
  opts: { now?: Date } = {},
): Promise<HabitView> {
  assertCan(actor, 'habit:log');
  const habit = await resolveHabit(tx, actor, habitId);
  if (habit.status !== 'active') throw new DomainError('CONFLICT', 'This habit is archived.');
  const today = todayFor(habit.client.timezone, opts.now ?? new Date());
  const localDate = input.localDate === undefined ? today : input.localDate;
  if (!isDate(localDate)) throw invalid('localDate', 'Use YYYY-MM-DD.');
  const start = fromDbDate(habit.startDate);
  if (localDate > today) throw invalid('localDate', 'You can only tick today or earlier.');
  if (!habit.isTask) {
    if (localDate < addDays(today, -HABIT_BACKFILL_DAYS)) {
      throw invalid('localDate', 'You can tick today and the two days before.');
    }
    if (localDate < start || (habit.endDate && localDate > fromDbDate(habit.endDate))) {
      throw invalid('localDate', 'That day is outside this habit’s dates.');
    }
  }
  const remove = input.done === false;
  if (remove) {
    await tx.habitLog.deleteMany({
      where: habit.isTask
        ? { habitId: habit.id }
        : { habitId: habit.id, localDate: toDbDate(localDate) },
    });
  } else {
    const value =
      input.value === undefined || input.value === null
        ? (habit.targetCount ?? 1)
        : (optionalInt('value', input.value, 1, 100_000) as number);
    // A task is done once: re-ticking it on another day keeps the first completion.
    const existingTask = habit.isTask
      ? await tx.habitLog.findFirst({ where: { habitId: habit.id }, select: { id: true } })
      : null;
    if (!existingTask) {
      await tx.habitLog.upsert({
        where: { habitId_localDate: { habitId: habit.id, localDate: toDbDate(localDate) } },
        create: {
          organizationId: habit.organizationId,
          clientId: habit.clientId,
          habitId: habit.id,
          localDate: toDbDate(localDate),
          value,
        },
        update: { value },
      });
    }
  }
  const view = await listHabits(tx, actor, habit.clientId, {
    now: opts.now,
    includeArchived: true,
  });
  return [...view.habits, ...view.tasks].find((h) => h.id === habit.id) as HabitView;
}
