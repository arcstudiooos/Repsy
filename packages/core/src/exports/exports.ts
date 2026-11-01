import { appendAudit, Prisma, type TenantTx } from '@kinetic/db';
import type { ActorContext } from '../authz/actor';
import { assertCan } from '../authz/policies';
import { readQuestions } from '../checkins/questions';
import { DomainError } from '../errors';
import { fromDbDate } from '../sessions/read';
import { isUuid } from '../uuid';
import { toCsv, type CsvValue } from './csv';
import { canonicalUnit, metricDef } from '../progress/metric-catalog';
import { getProgram } from '../programs/read';

const DAY_MS = 86_400_000;
/** Downloads are offered for this long after an export is built. */
export const EXPORT_AVAILABLE_DAYS = 7;
/** A running job not finished in this time is retried (the worker died). */
export const EXPORT_LEASE_MS = 10 * 60_000;
export const EXPORT_MAX_ATTEMPTS = 3;

const notFound = () => new DomainError('NOT_FOUND', 'Not found.');

export type ExportScope = 'client_self' | 'org';
export type ExportStatus = 'queued' | 'running' | 'done' | 'failed';

export interface ExportFile {
  name: string;
  key: string;
  rows: number;
}

export interface ExportView {
  id: string;
  scope: ExportScope;
  status: ExportStatus;
  createdAt: string;
  completedAt: string | null;
  expiresAt: string | null;
  /** Offered only while the export is done and not expired. */
  files: { name: string; rows: number }[];
}

/** The structural slice of `@kinetic/storage` the build needs (core imports no storage SDK). */
export interface ExportStorage {
  put(key: string, body: string, contentType: string): Promise<void>;
  deleteMany(keys: string[]): Promise<void>;
}

type JobRow = {
  id: string;
  scope: ExportScope;
  status: ExportStatus;
  createdAt: Date;
  completedAt: Date | null;
  expiresAt: Date | null;
  filesJson: Prisma.JsonValue | null;
};

const filesOf = (json: Prisma.JsonValue | null): ExportFile[] =>
  Array.isArray(json) ? (json as unknown as ExportFile[]) : [];

function toView(row: JobRow, now: Date): ExportView {
  const live = row.status === 'done' && (!row.expiresAt || row.expiresAt > now);
  return {
    id: row.id,
    scope: row.scope,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    files: live ? filesOf(row.filesJson).map((f) => ({ name: f.name, rows: f.rows })) : [],
  };
}

const JOB_SELECT = {
  id: true,
  scope: true,
  status: true,
  createdAt: true,
  completedAt: true,
  expiresAt: true,
  filesJson: true,
} as const;

/**
 * Requests an export (S5-2, Ruling 3): an owner exports the organization, a client their own data. Idempotent per
 * (requester, idempotencyKey). The worker builds it; nothing is written here but the job row and an audit entry.
 */
export async function requestExport(
  tx: TenantTx,
  actor: ActorContext,
  input: { scope?: unknown; idempotencyKey?: unknown },
  opts: { now?: Date; requestId?: string } = {},
): Promise<ExportView> {
  const scope = input.scope;
  if (scope !== 'org' && scope !== 'client_self') {
    throw new DomainError('VALIDATION', 'Some fields are invalid.', { scope: ['Unknown scope.'] });
  }
  assertCan(actor, scope === 'org' ? 'export:org' : 'export:self');
  const key = input.idempotencyKey;
  if (typeof key !== 'string' || !isUuid(key)) {
    throw new DomainError('VALIDATION', 'Some fields are invalid.', {
      idempotencyKey: ['Invalid.'],
    });
  }
  if (scope === 'client_self' && !actor.clientId) throw notFound();
  // One build at a time per requester and scope (PR #2 review C M-11): a new key while one is queued or running gets
  // that one back instead of queuing another full build. A replay of a key still returns its own job.
  const replay = await tx.exportJob.findFirst({
    where: { requestedBy: actor.userId, idempotencyKey: key },
    select: JOB_SELECT,
  });
  if (replay) return toView(replay, opts.now ?? new Date());
  const inFlight = await tx.exportJob.findFirst({
    where: { requestedBy: actor.userId, scope, status: { in: ['queued', 'running'] } },
    orderBy: { createdAt: 'desc' },
    select: JOB_SELECT,
  });
  if (inFlight) return toView(inFlight, opts.now ?? new Date());
  const { count } = await tx.exportJob.createMany({
    data: [
      {
        requestedBy: actor.userId,
        clientId: scope === 'client_self' ? actor.clientId : null,
        scope,
        idempotencyKey: key,
      } as Prisma.ExportJobCreateManyInput,
    ],
    skipDuplicates: true,
  });
  const row = await tx.exportJob.findFirstOrThrow({
    where: { requestedBy: actor.userId, idempotencyKey: key },
    select: JOB_SELECT,
  });
  if (count === 1) {
    await appendAudit(tx, {
      orgId: actor.orgId,
      actorId: actor.userId,
      objectType: 'export_job',
      objectId: row.id,
      action: 'export.requested',
      metadata: { scope },
      requestId: opts.requestId,
    });
  }
  return toView(row, opts.now ?? new Date());
}

/** The acting user's own exports, newest first. */
export async function listMyExports(
  tx: TenantTx,
  actor: ActorContext,
  opts: { now?: Date } = {},
): Promise<ExportView[]> {
  const rows = await tx.exportJob.findMany({
    where: { requestedBy: actor.userId },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: JOB_SELECT,
  });
  return rows.map((r) => toView(r, opts.now ?? new Date()));
}

/**
 * A file of the acting user's own, finished, unexpired export (re-checked on every download, S5-2). Another user's
 * job is FORBIDDEN even inside the organization; an expired one is FORBIDDEN too.
 */
export async function exportFileFor(
  tx: TenantTx,
  actor: ActorContext,
  jobId: string,
  name: string,
  opts: { now?: Date } = {},
): Promise<ExportFile> {
  if (!isUuid(jobId)) throw notFound();
  const job = await tx.exportJob.findFirst({
    where: { id: jobId },
    select: {
      requestedBy: true,
      scope: true,
      clientId: true,
      status: true,
      expiresAt: true,
      filesJson: true,
    },
  });
  if (!job) throw notFound();
  if (job.requestedBy !== actor.userId) {
    throw new DomainError(
      'FORBIDDEN',
      'Only the person who requested this export can download it.',
    );
  }
  // The requester must still hold the role the export needs (PR #2 review C M-1): an owner demoted since, or a
  // client whose membership no longer points at this client, can't download it.
  assertCan(actor, job.scope === 'org' ? 'export:org' : 'export:self');
  if (job.scope === 'client_self' && job.clientId !== actor.clientId) throw notFound();
  if (job.status !== 'done' || (job.expiresAt && job.expiresAt <= (opts.now ?? new Date()))) {
    throw new DomainError('FORBIDDEN', 'This export is no longer available.');
  }
  const file = filesOf(job.filesJson).find((f) => f.name === name);
  if (!file) throw notFound();
  return file;
}

// --- building (worker) -----------------------------------------------------------------------------------------

type Rows = CsvValue[][];

async function sessionRows(
  tx: TenantTx,
  clientId?: string,
): Promise<{ sessions: Rows; sets: Rows }> {
  const sessions = await tx.workoutSession.findMany({
    where: { ...(clientId ? { clientId } : {}), state: { not: 'cancelled' } },
    orderBy: [{ clientId: 'asc' }, { scheduledLocalDate: 'asc' }],
    select: {
      id: true,
      clientId: true,
      scheduledLocalDate: true,
      state: true,
      startedAt: true,
      completedAt: true,
      loggedByUserId: true,
      comment: true,
      kind: true,
      workoutVersion: { select: { title: true } },
      setLogs: {
        orderBy: [{ workoutVersionExerciseId: 'asc' }, { setIndex: 'asc' }],
        select: {
          setIndex: true,
          reps: true,
          weightKg: true,
          rpe: true,
          durationSeconds: true,
          distanceM: true,
          clientUpdatedAt: true,
          workoutVersionExercise: { select: { exercise: { select: { name: true } } } },
        },
      },
    },
  });
  const num = (d: { toString(): string } | null) => (d === null ? null : Number(d.toString()));
  return {
    sessions: sessions.map((s) => [
      s.id,
      s.clientId,
      fromDbDate(s.scheduledLocalDate),
      s.state,
      s.workoutVersion?.title ?? '',
      s.startedAt?.toISOString(),
      s.completedAt?.toISOString(),
      s.loggedByUserId !== null,
      s.comment,
      s.kind,
    ]),
    sets: sessions.flatMap((s) =>
      s.setLogs.map((l) => [
        s.id,
        s.clientId,
        l.workoutVersionExercise.exercise.name,
        l.setIndex + 1,
        l.reps,
        num(l.weightKg),
        num(l.rpe),
        l.durationSeconds,
        num(l.distanceM),
        l.clientUpdatedAt.toISOString(),
      ]),
    ),
  };
}

async function checkinRows(tx: TenantTx, clientId?: string): Promise<Rows> {
  const checkins = await tx.checkin.findMany({
    where: { ...(clientId ? { clientId } : {}), submittedAt: { not: null } },
    orderBy: [{ clientId: 'asc' }, { periodLocalDate: 'asc' }],
    select: {
      id: true,
      clientId: true,
      periodLocalDate: true,
      submittedAt: true,
      questionsJson: true,
      answersJson: true,
    },
  });
  return checkins.flatMap((c) => {
    const answers = (c.answersJson ?? {}) as Record<string, CsvValue>;
    return readQuestions(c.questionsJson).map((q) => [
      c.id,
      c.clientId,
      fromDbDate(c.periodLocalDate),
      c.submittedAt?.toISOString(),
      q.label,
      answers[q.id] ?? null,
    ]);
  });
}

async function metricRows(tx: TenantTx, clientId?: string): Promise<Rows> {
  const entries = await tx.metricEntry.findMany({
    where: clientId ? { clientId } : {},
    orderBy: [{ clientId: 'asc' }, { metric: 'asc' }, { measuredOn: 'asc' }],
    select: {
      clientId: true,
      metric: true,
      measuredOn: true,
      value: true,
      source: true,
      updatedAt: true,
    },
  });
  return entries.map((e) => [
    e.clientId,
    e.metric,
    fromDbDate(e.measuredOn),
    Number(e.value.toString()),
    canonicalUnit(metricDef(e.metric).kind),
    e.source,
    e.updatedAt.toISOString(),
  ]);
}

async function habitRows(tx: TenantTx, clientId?: string): Promise<Rows> {
  const logs = await tx.habitLog.findMany({
    where: clientId ? { clientId } : {},
    orderBy: [{ clientId: 'asc' }, { localDate: 'asc' }],
    select: {
      clientId: true,
      localDate: true,
      value: true,
      habit: { select: { title: true, isTask: true, targetCount: true, unit: true } },
    },
  });
  return logs.map((l) => [
    l.clientId,
    l.habit.title,
    l.habit.isTask ? 'task' : 'habit',
    fromDbDate(l.localDate),
    l.value,
    l.habit.targetCount,
    l.habit.unit,
  ]);
}

async function nutritionRows(tx: TenantTx, clientId?: string): Promise<Rows> {
  const logs = await tx.nutritionLog.findMany({
    where: clientId ? { clientId } : {},
    orderBy: [{ clientId: 'asc' }, { localDate: 'asc' }],
    select: {
      clientId: true,
      localDate: true,
      calories: true,
      proteinG: true,
      carbsG: true,
      fatG: true,
    },
  });
  return logs.map((l) => [
    l.clientId,
    fromDbDate(l.localDate),
    l.calories,
    l.proteinG,
    l.carbsG,
    l.fatG,
  ]);
}

const NUTRITION_HEADER = ['client_id', 'local_date', 'calories', 'protein_g', 'carbs_g', 'fat_g'];

async function swapRows(tx: TenantTx, clientId?: string): Promise<Rows> {
  const rows = await tx.sessionExerciseSwap.findMany({
    where: clientId ? { session: { is: { clientId } } } : {},
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: {
      sessionId: true,
      reason: true,
      createdAt: true,
      session: { select: { clientId: true } },
      exercise: { select: { name: true } },
      workoutVersionExercise: { select: { exercise: { select: { name: true } } } },
    },
  });
  return rows.map((r) => [
    r.session.clientId,
    r.sessionId,
    r.workoutVersionExercise.exercise.name,
    r.exercise.name,
    r.reason,
    r.createdAt.toISOString(),
  ]);
}

async function goalRows(tx: TenantTx, clientId?: string): Promise<Rows> {
  const rows = await tx.goal.findMany({
    where: clientId ? { clientId } : {},
    orderBy: [{ clientId: 'asc' }, { createdAt: 'asc' }],
    select: {
      clientId: true,
      title: true,
      kind: true,
      startValue: true,
      targetValue: true,
      startDate: true,
      targetDate: true,
      status: true,
    },
  });
  return rows.map((g) => [
    g.clientId,
    g.title,
    g.kind,
    g.startValue.toString(),
    g.targetValue.toString(),
    fromDbDate(g.startDate),
    fromDbDate(g.targetDate),
    g.status,
  ]);
}

const GOAL_HEADER = [
  'client_id',
  'title',
  'kind',
  'start_value',
  'target_value',
  'start_date',
  'target_date',
  'status',
];

async function noteRows(tx: TenantTx, clientId?: string): Promise<Rows> {
  const rows = await tx.sessionNote.findMany({
    where: clientId ? { session: { is: { clientId } } } : {},
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: {
      sessionId: true,
      setIndex: true,
      body: true,
      authorRole: true,
      createdAt: true,
      session: { select: { clientId: true } },
      workoutVersionExercise: { select: { exercise: { select: { name: true } } } },
    },
  });
  return rows.map((n) => [
    n.session.clientId,
    n.sessionId,
    n.workoutVersionExercise.exercise.name,
    n.setIndex === null ? null : n.setIndex + 1,
    n.authorRole,
    n.body,
    n.createdAt.toISOString(),
  ]);
}

const NOTE_HEADER = ['client_id', 'session_id', 'exercise', 'set', 'author', 'note', 'created_at'];

const SWAP_HEADER = [
  'client_id',
  'session_id',
  'planned_exercise',
  'done_instead',
  'reason',
  'created_at',
];

const HABIT_HEADER = ['client_id', 'habit', 'kind', 'local_date', 'value', 'target', 'unit'];

const METRIC_HEADER = [
  'client_id',
  'metric',
  'measured_on',
  'value',
  'unit',
  'recorded_by',
  'updated_at',
];

const SESSION_HEADER = [
  'session_id',
  'client_id',
  'scheduled_local_date',
  'state',
  'workout',
  'started_at',
  'completed_at',
  'logged_by_coach',
  'comment',
  'kind',
];
const SET_HEADER = [
  'session_id',
  'client_id',
  'exercise',
  'set_number',
  'reps',
  'weight_kg',
  'rpe',
  'duration_seconds',
  'distance_m',
  'updated_at',
];
const CHECKIN_HEADER = [
  'checkin_id',
  'client_id',
  'period_local_date',
  'submitted_at',
  'question',
  'answer',
];

/**
 * The CSVs of one export (Ruling 3). Organization: clients, sessions, set logs, check-ins, body metrics, habits. Client:
 * their profile, sessions, set logs, check-ins, body metrics, habits and their own conversation. Internal notes are never exported to a client.
 */
/** The stored and downloaded type of an export file, by its extension. */
export const contentTypeOf = (name: string) =>
  name.endsWith('.json') ? 'application/json; charset=utf-8' : 'text/csv; charset=utf-8';

/** Version of the documented JSON export formats (docs/exports.md, PRD M3). */
export const PORTABLE_FORMAT_VERSION = 1;

/**
 * Every program (templates and client copies) at its current version, as JSON (PRD M3). Each program's `weeks`
 * has the shape `POST /api/v1/programs/import` takes, so it re-imports into Kinetic; exercise names come alongside
 * ids so another tool can map them.
 */
async function programsJson(
  tx: TenantTx,
  requestedBy: string,
): Promise<{ json: string; rows: number }> {
  const org = await tx.organization.findFirst({ select: { id: true } });
  const actor: ActorContext = {
    userId: requestedBy,
    orgId: org?.id ?? '',
    role: 'owner',
    isPlatformAdmin: false,
  };
  const rows = await tx.program.findMany({
    orderBy: [{ kind: 'asc' }, { createdAt: 'asc' }],
    select: { id: true, clientId: true, status: true, createdAt: true },
  });
  const programs = [];
  for (const r of rows) {
    const p = await getProgram(tx, actor, r.id);
    programs.push({
      id: p.id,
      title: p.title,
      kind: p.kind,
      clientId: r.clientId,
      status: r.status,
      versionNo: p.versionNo,
      createdAt: r.createdAt.toISOString(),
      weeks: p.weeks.map((w) => ({
        days: w.days.map((d) => ({
          title: d.title,
          ...(d.notes ? { notes: d.notes } : {}),
          exercises: d.exercises.map((e) => ({
            exerciseId: e.exerciseId,
            exerciseName: e.exerciseName,
            trackingType: e.trackingType,
            ...(e.note ? { note: e.note } : {}),
            ...(e.section !== 'main' ? { section: e.section } : {}),
            sets: e.sets,
          })),
        })),
      })),
    });
  }
  return {
    json: JSON.stringify(
      { format: 'kinetic-programs', version: PORTABLE_FORMAT_VERSION, programs },
      null,
      2,
    ),
    rows: programs.length,
  };
}

/** The workspace's own (custom) exercises as JSON (PRD M3); catalog exercises are the same everywhere. */
async function exercisesJson(tx: TenantTx): Promise<{ json: string; rows: number }> {
  const rows = await tx.exercise.findMany({
    where: { organizationId: { not: null } },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      name: true,
      equipment: true,
      muscleGroup: true,
      movementType: true,
      trackingType: true,
      instructions: true,
      mediaUrl: true,
      secondaryMuscles: true,
      unilateral: true,
      difficulty: true,
      cues: true,
    },
  });
  return {
    json: JSON.stringify(
      { format: 'kinetic-exercises', version: PORTABLE_FORMAT_VERSION, exercises: rows },
      null,
      2,
    ),
    rows: rows.length,
  };
}

export async function buildExportFiles(
  tx: TenantTx,
  job: { scope: ExportScope; clientId: string | null; requestedBy: string },
): Promise<{ name: string; csv: string; rows: number }[]> {
  const file = (name: string, header: string[], rows: Rows) => ({
    name,
    csv: toCsv(header, rows),
    rows: rows.length,
  });
  if (job.scope === 'org') {
    const clients = await tx.client.findMany({
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        name: true,
        email: true,
        status: true,
        timezone: true,
        preferredUnits: true,
        startDate: true,
        createdAt: true,
      },
    });
    const { sessions, sets } = await sessionRows(tx);
    const programs = await programsJson(tx, job.requestedBy);
    const exercises = await exercisesJson(tx);
    return [
      { name: 'programs.json', csv: programs.json, rows: programs.rows },
      { name: 'exercises.json', csv: exercises.json, rows: exercises.rows },
      file(
        'clients.csv',
        [
          'client_id',
          'name',
          'email',
          'status',
          'timezone',
          'preferred_units',
          'start_date',
          'created_at',
        ],
        clients.map((c) => [
          c.id,
          c.name,
          c.email,
          c.status,
          c.timezone,
          c.preferredUnits,
          c.startDate ? fromDbDate(c.startDate) : null,
          c.createdAt.toISOString(),
        ]),
      ),
      file('sessions.csv', SESSION_HEADER, sessions),
      file('set_logs.csv', SET_HEADER, sets),
      file('checkins.csv', CHECKIN_HEADER, await checkinRows(tx)),
      file('metrics.csv', METRIC_HEADER, await metricRows(tx)),
      file('habits.csv', HABIT_HEADER, await habitRows(tx)),
      file('nutrition.csv', NUTRITION_HEADER, await nutritionRows(tx)),
      file('exercise_swaps.csv', SWAP_HEADER, await swapRows(tx)),
      file('goals.csv', GOAL_HEADER, await goalRows(tx)),
      file('workout_notes.csv', NOTE_HEADER, await noteRows(tx)),
    ];
  }
  const clientId = job.clientId as string;
  const client = await tx.client.findFirstOrThrow({
    where: { id: clientId },
    select: {
      name: true,
      email: true,
      timezone: true,
      preferredUnits: true,
      startDate: true,
      goals: true,
    },
  });
  const { sessions, sets } = await sessionRows(tx, clientId);
  const thread = await tx.conversationThread.findFirst({
    where: { clientId },
    select: { id: true },
  });
  const messages = thread
    ? await tx.message.findMany({
        where: { threadId: thread.id },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { senderUserId: true, body: true, createdAt: true, readAt: true },
      })
    : [];
  return [
    file(
      'profile.csv',
      ['name', 'email', 'timezone', 'preferred_units', 'start_date', 'goals'],
      [
        [
          client.name,
          client.email,
          client.timezone,
          client.preferredUnits,
          client.startDate ? fromDbDate(client.startDate) : null,
          client.goals,
        ],
      ],
    ),
    file('sessions.csv', SESSION_HEADER, sessions),
    file('set_logs.csv', SET_HEADER, sets),
    file('checkins.csv', CHECKIN_HEADER, await checkinRows(tx, clientId)),
    file('metrics.csv', METRIC_HEADER, await metricRows(tx, clientId)),
    file('habits.csv', HABIT_HEADER, await habitRows(tx, clientId)),
    file('nutrition.csv', NUTRITION_HEADER, await nutritionRows(tx, clientId)),
    file('exercise_swaps.csv', SWAP_HEADER, await swapRows(tx, clientId)),
    file('goals.csv', GOAL_HEADER, await goalRows(tx, clientId)),
    file('workout_notes.csv', NOTE_HEADER, await noteRows(tx, clientId)),
    file(
      'messages.csv',
      ['sent_at', 'from', 'body', 'read_at'],
      messages.map((m) => [
        m.createdAt.toISOString(),
        m.senderUserId === job.requestedBy ? 'you' : 'coach',
        m.body,
        m.readAt?.toISOString(),
      ]),
    ),
  ];
}

export interface ClaimedExport {
  id: string;
  scope: ExportScope;
  clientId: string | null;
  requestedBy: string;
  attempts: number;
  /** This claim's lease: `done` is recorded only while it still holds. */
  claimedAt: Date | null;
}

/** Runs `fn` in a tenant transaction of the export's organization (the worker passes `withTenant`). */
export type ExportTxRunner = <T>(
  fn: (tx: TenantTx) => Promise<T>,
  opts?: { timeout?: number },
) => Promise<T>;

/** The read transaction's timeout: an organization export reads every session, set log and check-in (C-I3). */
export const EXPORT_BUILD_TIMEOUT_MS = 120_000;

/**
 * Claims a queued export (or a running one whose lease ran out). The worker commits this on its own, so the attempt
 * count survives a build that fails in the database.
 */
export async function claimExport(
  tx: TenantTx,
  jobId: string,
  now: Date,
): Promise<ClaimedExport | null> {
  const claimed = await tx.exportJob.updateMany({
    where: {
      id: jobId,
      OR: [
        { status: 'queued' },
        { status: 'running', claimedAt: { lt: new Date(now.getTime() - EXPORT_LEASE_MS) } },
      ],
    },
    data: { status: 'running', claimedAt: now, attempts: { increment: 1 } },
  });
  if (claimed.count === 0) return null;
  return tx.exportJob.findFirstOrThrow({
    where: { id: jobId },
    select: {
      id: true,
      scope: true,
      clientId: true,
      requestedBy: true,
      attempts: true,
      claimedAt: true,
    },
  });
}

/**
 * Builds a claimed export in three steps (PR #2 review C-I3), so neither a large organization nor a slow storage
 * endpoint runs into a transaction timeout: the CSVs are read in one read transaction (with a generous timeout),
 * written to storage outside any transaction, then the file list is recorded with `done` in a short transaction. On
 * failure the objects already written are removed and the error is rethrown (the worker then calls `failExport`), so a
 * partial export is never offered. Returns false, after removing the files, when the claim no longer holds (an
 * erasure sent the job back to the queue, or another worker took over its expired lease).
 */
export async function completeExport(
  run: ExportTxRunner,
  orgId: string,
  job: ClaimedExport,
  storage: ExportStorage,
  now: Date,
): Promise<boolean> {
  const files = await run((tx) => buildExportFiles(tx, job), {
    timeout: EXPORT_BUILD_TIMEOUT_MS,
  });
  // One prefix per attempt: a build that lost its claim removes only its own files, never a newer attempt's.
  const prefix = `exports/${orgId}/${job.id}/a${job.attempts}`;
  const written: string[] = [];
  try {
    const recorded: ExportFile[] = [];
    for (const f of files) {
      const key = `${prefix}/${f.name}`;
      await storage.put(key, f.csv, contentTypeOf(f.name));
      written.push(key);
      recorded.push({ name: f.name, key, rows: f.rows });
    }
    const held = await run(async (tx) => {
      const done = await tx.exportJob.updateMany({
        where: { id: job.id, status: 'running', claimedAt: job.claimedAt },
        data: {
          status: 'done',
          objectKey: prefix,
          filesJson: recorded as unknown as Prisma.InputJsonValue,
          completedAt: now,
          expiresAt: new Date(now.getTime() + EXPORT_AVAILABLE_DAYS * DAY_MS),
          errorCode: null,
        },
      });
      if (done.count === 0) return false;
      await appendAudit(tx, {
        orgId,
        actorId: null,
        objectType: 'export_job',
        objectId: job.id,
        action: 'export.built',
        metadata: { files: recorded.length },
      });
      return true;
    });
    if (!held) await storage.deleteMany(written).catch(() => undefined);
    return held;
  } catch (error) {
    await storage.deleteMany(written).catch(() => undefined);
    throw error;
  }
}

/** The storage keys an export's file list records (for the purge sweep). */
export function exportFileKeys(filesJson: Prisma.JsonValue | null): string[] {
  return filesOf(filesJson).flatMap((f) => (typeof f.key === 'string' ? [f.key] : []));
}

/** After a failed build: back to `queued` for a retry, or `failed` after the last attempt. */
export async function failExport(tx: TenantTx, job: ClaimedExport): Promise<'retry' | 'failed'> {
  const last = job.attempts >= EXPORT_MAX_ATTEMPTS;
  await tx.exportJob.updateMany({
    where: { id: job.id, status: 'running' },
    data: { status: last ? 'failed' : 'queued', errorCode: 'BUILD_FAILED', claimedAt: null },
  });
  return last ? 'failed' : 'retry';
}
