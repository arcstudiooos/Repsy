import { appendAudit, Prisma, type TenantTx } from '@kinetic/db';
import type { ActorContext } from '../authz/actor';
import { assertCan } from '../authz/policies';
import { readQuestions } from '../checkins/questions';
import { DomainError } from '../errors';
import { fromDbDate } from '../sessions/read';
import { isUuid } from '../uuid';
import { toCsv, type CsvValue } from './csv';

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
    select: { requestedBy: true, status: true, expiresAt: true, filesJson: true },
  });
  if (!job) throw notFound();
  if (job.requestedBy !== actor.userId) {
    throw new DomainError(
      'FORBIDDEN',
      'Only the person who requested this export can download it.',
    );
  }
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
 * The CSVs of one export (Ruling 3). Organization: clients, sessions, set logs, check-ins. Client: their profile,
 * sessions, set logs, check-ins and their own conversation. Internal notes are never exported to a client.
 */
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
    return [
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
}

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
    select: { id: true, scope: true, clientId: true, requestedBy: true, attempts: true },
  });
}

/**
 * Builds a claimed export: every CSV goes to storage first, then the file list is recorded with `done`. On failure
 * the objects already written are removed and the error is rethrown (the worker then calls `failExport`), so a
 * partial export is never offered.
 */
export async function completeExport(
  tx: TenantTx,
  orgId: string,
  job: ClaimedExport,
  storage: ExportStorage,
  now: Date,
): Promise<void> {
  const prefix = `exports/${orgId}/${job.id}`;
  const written: string[] = [];
  try {
    const files = await buildExportFiles(tx, job);
    const recorded: ExportFile[] = [];
    for (const f of files) {
      const key = `${prefix}/${f.name}`;
      await storage.put(key, f.csv, 'text/csv; charset=utf-8');
      written.push(key);
      recorded.push({ name: f.name, key, rows: f.rows });
    }
    await tx.exportJob.update({
      where: { id: job.id },
      data: {
        status: 'done',
        objectKey: prefix,
        filesJson: recorded as unknown as Prisma.InputJsonValue,
        completedAt: now,
        expiresAt: new Date(now.getTime() + EXPORT_AVAILABLE_DAYS * DAY_MS),
        errorCode: null,
      },
    });
    await appendAudit(tx, {
      orgId,
      actorId: null,
      objectType: 'export_job',
      objectId: job.id,
      action: 'export.built',
      metadata: { files: recorded.length },
    });
  } catch (error) {
    await storage.deleteMany(written).catch(() => undefined);
    throw error;
  }
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
