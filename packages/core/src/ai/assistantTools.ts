import type { TenantTx } from '@kinetic/db';
import type { ActorContext } from '../authz/actor';
import { assertCan, can } from '../authz/policies';

/**
 * PRD I15: the AI assistant's tools. Every tool is READ-ONLY and runs inside the caller's tenant
 * transaction, so row-level security limits it to the coach's own workspace, and each tool checks the
 * same policy as the matching screen. Nothing here writes, sends or schedules anything.
 *
 * Core stays provider-neutral: the web app maps `ASSISTANT_TOOLS` to the AI provider's tool format.
 */

export interface AssistantToolDef {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required: string[];
    additionalProperties: false;
  };
}

const str = (description: string) => ({ type: 'string', description });
const int = (description: string) => ({ type: 'integer', description });

export const ASSISTANT_TOOLS: AssistantToolDef[] = [
  {
    name: 'list_clients',
    description:
      'Lists clients in the workspace with status, start date, current program and when they last completed a workout. Use it to find a client id by name, or to answer roster questions.',
    input_schema: {
      type: 'object',
      properties: {
        search: str('Part of a client name or email. Empty string for everyone.'),
        status: {
          type: 'string',
          enum: ['any', 'invited', 'active', 'paused', 'archived'],
          description: 'Filter by status. "any" for all.',
        },
      },
      required: ['search', 'status'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_client',
    description:
      "Full profile of one client: intake details, goals, active program, the last 20 workouts with sets, the last 5 check-ins with answers, latest body metrics, habits and the coach's private notes.",
    input_schema: {
      type: 'object',
      properties: { clientId: str('The client id from list_clients.') },
      required: ['clientId'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_programs',
    description:
      'Lists programs and templates with their type, status, client (for client programs) and how many clients are on each.',
    input_schema: {
      type: 'object',
      properties: { search: str('Part of a program title. Empty string for all.') },
      required: ['search'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_program',
    description: 'One program in detail: every week, day, exercise and prescribed sets.',
    input_schema: {
      type: 'object',
      properties: { programId: str('The program id from list_programs.') },
      required: ['programId'],
      additionalProperties: false,
    },
  },
  {
    name: 'workout_activity',
    description:
      'Workouts across all clients in a date range: completed, missed and skipped counts per client, for adherence questions.',
    input_schema: {
      type: 'object',
      properties: {
        days: int('How many days back from today, 1 to 90.'),
      },
      required: ['days'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_checkins',
    description:
      'Check-ins across clients: which are submitted and waiting for review, which are overdue, and which were reviewed, in the last N days.',
    input_schema: {
      type: 'object',
      properties: {
        days: int('How many days back from today, 1 to 90.'),
        state: {
          type: 'string',
          enum: ['any', 'awaiting_review', 'overdue', 'reviewed'],
          description: 'Filter by state.',
        },
      },
      required: ['days', 'state'],
      additionalProperties: false,
    },
  },
  {
    name: 'recent_messages',
    description: 'The latest messages between the coach team and one client, newest last.',
    input_schema: {
      type: 'object',
      properties: {
        clientId: str('The client id.'),
        limit: int('How many messages, 1 to 50.'),
      },
      required: ['clientId', 'limit'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_bookings',
    description: 'Booked sessions (calls, check-in calls, in-person) in a date range, with client and status.',
    input_schema: {
      type: 'object',
      properties: {
        fromDate: str('Start date, YYYY-MM-DD.'),
        toDate: str('End date, YYYY-MM-DD (inclusive).'),
      },
      required: ['fromDate', 'toDate'],
      additionalProperties: false,
    },
  },
  {
    name: 'business_summary',
    description:
      'Business numbers: active subscriptions, revenue and refunds in the last N days, failed payments, and leads by status.',
    input_schema: {
      type: 'object',
      properties: { days: int('How many days back from today, 1 to 365.') },
      required: ['days'],
      additionalProperties: false,
    },
  },
];

export const ASSISTANT_TOOL_NAMES = ASSISTANT_TOOLS.map((t) => t.name);

type Input = Record<string, unknown>;

const DAY_MS = 86_400_000;
const clamp = (n: unknown, lo: number, hi: number, fallback: number) => {
  const v = typeof n === 'number' && Number.isFinite(n) ? Math.trunc(n) : fallback;
  return Math.min(hi, Math.max(lo, v));
};
const text = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const isoDay = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const money = (minor: number, currency: string) => `${(minor / 100).toFixed(2)} ${currency}`;
const daysAgo = (days: number) => new Date(Date.now() - days * DAY_MS);
const parseDay = (v: unknown): Date | null => {
  const s = text(v, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
};

class ToolInputError extends Error {}

async function listClientsTool(tx: TenantTx, actor: ActorContext, input: Input) {
  assertCan(actor, 'client:read');
  const search = text(input.search, 100);
  const status = text(input.status, 20);
  const clients = await tx.client.findMany({
    where: {
      organizationId: actor.orgId,
      ...(status && status !== 'any'
        ? { status: status as 'invited' | 'active' | 'paused' | 'archived' }
        : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { email: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    },
    orderBy: { name: 'asc' },
    take: 200,
    select: {
      id: true,
      name: true,
      status: true,
      lifecycleStage: true,
      startDate: true,
      assignments: {
        where: { status: 'active' },
        select: { program: { select: { title: true } } },
        take: 1,
      },
      workoutSessions: {
        where: { state: 'completed' },
        orderBy: { completedAt: 'desc' },
        select: { completedAt: true },
        take: 1,
      },
    },
  });
  return {
    count: clients.length,
    clients: clients.map((c) => ({
      id: c.id,
      name: c.name,
      status: c.status,
      stage: c.lifecycleStage,
      startDate: isoDay(c.startDate),
      currentProgram: c.assignments[0]?.program.title ?? null,
      lastWorkoutCompleted: isoDay(c.workoutSessions[0]?.completedAt),
    })),
  };
}

async function getClientTool(tx: TenantTx, actor: ActorContext, input: Input) {
  assertCan(actor, 'client:read');
  const clientId = text(input.clientId, 64);
  const client = await tx.client.findFirst({
    where: { id: clientId, organizationId: actor.orgId },
    select: {
      id: true,
      name: true,
      status: true,
      lifecycleStage: true,
      startDate: true,
      goals: true,
      motivation: true,
      scheduleNotes: true,
      equipmentNotes: true,
      trainingLocation: true,
      preferences: true,
      timezone: true,
      preferredUnits: true,
      checkinWeekday: true,
      checkinEveryWeeks: true,
      createdAt: true,
    },
  });
  if (!client) throw new ToolInputError('No client with that id in this workspace.');

  const [goals, assignments, sessions, checkins, metrics, habits, notes] = await Promise.all([
    tx.goal.findMany({
      where: { clientId },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        title: true,
        kind: true,
        status: true,
        startValue: true,
        targetValue: true,
        targetDate: true,
      },
    }),
    tx.programAssignment.findMany({
      where: { clientId },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: {
        status: true,
        startLocalDate: true,
        endedAt: true,
        program: { select: { id: true, title: true } },
      },
    }),
    tx.workoutSession.findMany({
      where: { clientId, scheduledAt: { lte: new Date() } },
      orderBy: { scheduledAt: 'desc' },
      take: 20,
      select: {
        scheduledLocalDate: true,
        state: true,
        completedAt: true,
        comment: true,
        readinessScore: true,
        setLogs: {
          orderBy: [{ workoutVersionExerciseId: 'asc' }, { setIndex: 'asc' }],
          select: {
            setIndex: true,
            reps: true,
            weightKg: true,
            rpe: true,
            durationSeconds: true,
            distanceM: true,
            workoutVersionExercise: { select: { exercise: { select: { name: true } } } },
          },
        },
      },
    }),
    tx.checkin.findMany({
      where: { clientId, submittedAt: { not: null } },
      orderBy: { submittedAt: 'desc' },
      take: 5,
      select: {
        periodLocalDate: true,
        submittedAt: true,
        reviewedAt: true,
        questionsJson: true,
        answersJson: true,
      },
    }),
    tx.metricEntry.findMany({
      where: { clientId },
      orderBy: { measuredOn: 'desc' },
      take: 40,
      select: { metric: true, measuredOn: true, value: true },
    }),
    tx.habit.findMany({
      where: { clientId, status: 'active' },
      take: 20,
      select: {
        title: true,
        isTask: true,
        daysPerWeek: true,
        targetCount: true,
        unit: true,
        logs: {
          where: { localDate: { gte: daysAgo(14) } },
          select: { localDate: true, value: true },
        },
      },
    }),
    can(actor, 'note:read')
      ? tx.internalNote.findMany({
          where: { clientId },
          orderBy: { createdAt: 'desc' },
          take: 10,
          select: { body: true, createdAt: true, pinnedAt: true },
        })
      : Promise.resolve([]),
  ]);

  return {
    profile: {
      ...client,
      startDate: isoDay(client.startDate),
      createdAt: isoDay(client.createdAt),
    },
    goals: goals.map((g) => ({
      ...g,
      startValue: num(g.startValue),
      targetValue: num(g.targetValue),
      targetDate: isoDay(g.targetDate),
    })),
    programs: assignments.map((a) => ({
      programId: a.program.id,
      title: a.program.title,
      status: a.status,
      started: isoDay(a.startLocalDate),
      ended: isoDay(a.endedAt),
    })),
    recentWorkouts: sessions.map((s) => ({
      date: isoDay(s.scheduledLocalDate),
      state: s.state,
      completedAt: s.completedAt?.toISOString() ?? null,
      clientComment: s.comment,
      readiness: s.readinessScore,
      sets: s.setLogs.map((l) => ({
        exercise: l.workoutVersionExercise.exercise.name,
        set: l.setIndex + 1,
        reps: l.reps,
        kg: num(l.weightKg),
        rpe: num(l.rpe),
        seconds: l.durationSeconds,
        metres: num(l.distanceM),
      })),
    })),
    recentCheckins: checkins.map((c) => ({
      period: isoDay(c.periodLocalDate),
      submitted: isoDay(c.submittedAt),
      reviewed: isoDay(c.reviewedAt),
      questions: c.questionsJson,
      answers: c.answersJson,
    })),
    metrics: metrics.map((m) => ({
      metric: m.metric,
      date: isoDay(m.measuredOn),
      value: num(m.value),
    })),
    habits: habits.map((h) => ({
      title: h.title,
      isTask: h.isTask,
      daysPerWeek: h.daysPerWeek,
      target: h.targetCount,
      unit: h.unit,
      last14Days: h.logs.map((l) => ({ date: isoDay(l.localDate), value: l.value })),
    })),
    coachNotes: notes.map((n) => ({
      body: n.body,
      date: isoDay(n.createdAt),
      pinned: n.pinnedAt !== null,
    })),
  };
}

async function listProgramsTool(tx: TenantTx, actor: ActorContext, input: Input) {
  assertCan(actor, 'program:read');
  const search = text(input.search, 100);
  const programs = await tx.program.findMany({
    where: {
      organizationId: actor.orgId,
      ...(search ? { title: { contains: search, mode: 'insensitive' } } : {}),
    },
    orderBy: { updatedAt: 'desc' },
    take: 100,
    select: {
      id: true,
      title: true,
      kind: true,
      status: true,
      updatedAt: true,
      client: { select: { name: true } },
      _count: { select: { assignments: { where: { status: 'active' } } } },
    },
  });
  return programs.map((p) => ({
    id: p.id,
    title: p.title,
    kind: p.kind,
    status: p.status,
    client: p.client?.name ?? null,
    activeClients: p._count.assignments,
    updated: isoDay(p.updatedAt),
  }));
}

async function getProgramTool(tx: TenantTx, actor: ActorContext, input: Input) {
  assertCan(actor, 'program:read');
  const programId = text(input.programId, 64);
  const program = await tx.program.findFirst({
    where: { id: programId, organizationId: actor.orgId },
    select: { id: true, title: true, kind: true, status: true, currentVersionId: true },
  });
  if (!program) throw new ToolInputError('No program with that id in this workspace.');
  if (!program.currentVersionId) return { ...program, weeks: [] };
  const slots = await tx.programSlot.findMany({
    where: { programVersionId: program.currentVersionId },
    orderBy: [{ weekIndex: 'asc' }, { dayIndex: 'asc' }],
    select: {
      weekIndex: true,
      dayIndex: true,
      workoutVersion: {
        select: {
          title: true,
          exercises: {
            orderBy: { position: 'asc' },
            select: {
              exercise: { select: { name: true } },
              targetJson: true,
              note: true,
            },
          },
        },
      },
    },
  });
  return {
    id: program.id,
    title: program.title,
    kind: program.kind,
    status: program.status,
    days: slots.map((s) => ({
      week: s.weekIndex + 1,
      day: s.dayIndex + 1,
      workout: s.workoutVersion?.title ?? null,
      exercises: (s.workoutVersion?.exercises ?? []).map((e) => ({
        name: e.exercise.name,
        prescription: e.targetJson,
        note: e.note,
      })),
    })),
  };
}

async function workoutActivityTool(tx: TenantTx, actor: ActorContext, input: Input) {
  assertCan(actor, 'session:read');
  const days = clamp(input.days, 1, 90, 7);
  const groups = await tx.workoutSession.groupBy({
    by: ['clientId', 'state'],
    where: { organizationId: actor.orgId, scheduledAt: { gte: daysAgo(days), lte: new Date() } },
    _count: { _all: true },
  });
  const clients = await tx.client.findMany({
    where: { id: { in: [...new Set(groups.map((g) => g.clientId))] } },
    select: { id: true, name: true },
  });
  const names = new Map(clients.map((c) => [c.id, c.name]));
  const byClient = new Map<string, Record<string, number>>();
  for (const g of groups) {
    const row = byClient.get(g.clientId) ?? {};
    row[g.state] = g._count._all;
    byClient.set(g.clientId, row);
  }
  return {
    periodDays: days,
    clients: [...byClient.entries()].map(([id, counts]) => ({
      clientId: id,
      name: names.get(id) ?? 'Unknown',
      ...counts,
    })),
  };
}

async function listCheckinsTool(tx: TenantTx, actor: ActorContext, input: Input) {
  assertCan(actor, 'checkin:read');
  const days = clamp(input.days, 1, 90, 14);
  const state = text(input.state, 20) || 'any';
  const now = new Date();
  const where = {
    organizationId: actor.orgId,
    dueAt: { gte: daysAgo(days) },
    ...(state === 'awaiting_review' ? { submittedAt: { not: null }, reviewedAt: null } : {}),
    ...(state === 'overdue' ? { submittedAt: null, dueAt: { gte: daysAgo(days), lt: now } } : {}),
    ...(state === 'reviewed' ? { reviewedAt: { not: null } } : {}),
  };
  const rows = await tx.checkin.findMany({
    where,
    orderBy: { dueAt: 'desc' },
    take: 200,
    select: {
      id: true,
      dueAt: true,
      submittedAt: true,
      reviewedAt: true,
      client: { select: { id: true, name: true } },
    },
  });
  return rows.map((r) => ({
    checkinId: r.id,
    clientId: r.client.id,
    client: r.client.name,
    due: isoDay(r.dueAt),
    submitted: isoDay(r.submittedAt),
    reviewed: isoDay(r.reviewedAt),
    state: r.reviewedAt
      ? 'reviewed'
      : r.submittedAt
        ? 'awaiting_review'
        : r.dueAt < now
          ? 'overdue'
          : 'open',
  }));
}

async function recentMessagesTool(tx: TenantTx, actor: ActorContext, input: Input) {
  assertCan(actor, 'message:read');
  const clientId = text(input.clientId, 64);
  const limit = clamp(input.limit, 1, 50, 20);
  const client = await tx.client.findFirst({
    where: { id: clientId, organizationId: actor.orgId },
    select: { name: true, userId: true },
  });
  if (!client) throw new ToolInputError('No client with that id in this workspace.');
  const messages = await tx.message.findMany({
    where: { thread: { clientId } },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: { body: true, createdAt: true, senderUserId: true },
  });
  return messages.reverse().map((m) => ({
    from: m.senderUserId === client.userId ? client.name : 'Coach team',
    at: m.createdAt.toISOString(),
    body: m.body,
  }));
}

async function listBookingsTool(tx: TenantTx, actor: ActorContext, input: Input) {
  assertCan(actor, 'scheduling:read');
  const from = parseDay(input.fromDate);
  const to = parseDay(input.toDate);
  if (!from || !to) throw new ToolInputError('Dates must be YYYY-MM-DD.');
  const rows = await tx.booking.findMany({
    where: {
      organizationId: actor.orgId,
      startsAt: { gte: from, lt: new Date(to.getTime() + DAY_MS) },
    },
    orderBy: { startsAt: 'asc' },
    take: 200,
    select: {
      startsAt: true,
      endsAt: true,
      status: true,
      sessionType: { select: { name: true, kind: true } },
      client: { select: { name: true } },
    },
  });
  return rows.map((b) => ({
    startsAt: b.startsAt.toISOString(),
    endsAt: b.endsAt.toISOString(),
    status: b.status,
    type: b.sessionType.name,
    kind: b.sessionType.kind,
    client: b.client.name,
  }));
}

async function businessSummaryTool(tx: TenantTx, actor: ActorContext, input: Input) {
  assertCan(actor, 'billing:manage');
  const days = clamp(input.days, 1, 365, 30);
  const since = daysAgo(days);
  const [subs, payments, leads] = await Promise.all([
    tx.subscription.groupBy({
      by: ['status', 'currency'],
      where: { organizationId: actor.orgId },
      _count: { _all: true },
      _sum: { amountMinor: true },
    }),
    tx.payment.findMany({
      where: { organizationId: actor.orgId, createdAt: { gte: since } },
      select: { status: true, amountMinor: true, refundedMinor: true, currency: true },
    }),
    tx.lead.groupBy({
      by: ['status'],
      where: { organizationId: actor.orgId },
      _count: { _all: true },
    }),
  ]);
  const revenue = new Map<string, { paid: number; refunded: number; failed: number }>();
  for (const p of payments) {
    const r = revenue.get(p.currency) ?? { paid: 0, refunded: 0, failed: 0 };
    if (p.status === 'succeeded' || p.status === 'paid' || p.status === 'refunded') {
      r.paid += p.amountMinor;
      r.refunded += p.refundedMinor;
    }
    if (p.status === 'failed') r.failed += 1;
    revenue.set(p.currency, r);
  }
  return {
    periodDays: days,
    subscriptions: subs.map((s) => ({
      status: s.status,
      count: s._count._all,
      totalPerPeriod: money(s._sum.amountMinor ?? 0, s.currency),
    })),
    revenue: [...revenue.entries()].map(([currency, r]) => ({
      currency,
      collected: money(r.paid, currency),
      refunded: money(r.refunded, currency),
      afterRefunds: money(r.paid - r.refunded, currency),
      failedPayments: r.failed,
    })),
    leads: leads.map((l) => ({ status: l.status, count: l._count._all })),
  };
}

const HANDLERS: Record<string, (tx: TenantTx, actor: ActorContext, input: Input) => Promise<unknown>> = {
  list_clients: listClientsTool,
  get_client: getClientTool,
  list_programs: listProgramsTool,
  get_program: getProgramTool,
  workout_activity: workoutActivityTool,
  list_checkins: listCheckinsTool,
  recent_messages: recentMessagesTool,
  list_bookings: listBookingsTool,
  business_summary: businessSummaryTool,
};

export interface AssistantToolResult {
  ok: boolean;
  /** JSON text handed back to the model. */
  content: string;
}

/**
 * Runs one assistant tool inside a tenant transaction. Bad input, unknown tools and permission
 * failures come back as `ok: false` with a short reason, so the model can recover instead of the
 * whole chat failing.
 */
export async function runAssistantTool(
  tx: TenantTx,
  actor: ActorContext,
  name: string,
  input: unknown,
): Promise<AssistantToolResult> {
  const handler = HANDLERS[name];
  if (!handler) return { ok: false, content: `Unknown tool "${name}".` };
  const args = input && typeof input === 'object' ? (input as Input) : {};
  try {
    const result = await handler(tx, actor, args);
    return { ok: true, content: JSON.stringify(result) };
  } catch (err) {
    if (err instanceof ToolInputError) return { ok: false, content: err.message };
    if (err instanceof Error && 'code' in err && (err as { code: unknown }).code === 'FORBIDDEN') {
      return { ok: false, content: 'Your role cannot see this information.' };
    }
    throw err;
  }
}
