import { appendAudit, Prisma, type TenantTx } from '@kinetic/db';
import type { ActorContext } from '../authz/actor';
import { assertCan } from '../authz/policies';
import { clientsInPauseNow } from '../clients/pause';
import { DomainError } from '../errors';
import { enqueueEmail } from '../outbox';
import { localDayBounds, localTimeOn } from '../schedule/scheduleSlots';
import { fromDbDate, toDbDate } from '../sessions/read';
import { todayInZone } from '../timezone';
import { isUuid } from '../uuid';
import {
  parseAnswers,
  parseQuestions,
  readQuestions,
  SEEDED_QUESTIONS,
  SEEDED_TITLE,
  TITLE_MAX,
  type CheckinAnswers,
  type CheckinQuestion,
} from './questions';

const DAY_MS = 86_400_000;
/** D-010 #3: issued at 06:00 client-local on the weekday. */
export const ISSUE_HOUR = 6;
/** Ruling 2: no second check-in within this many days of the last one (a weekday change applies next period). */
const MIN_GAP_DAYS = 6;
const DRAFT_MAX_BYTES = 64 * 1024;
const LIST_MAX = 52;

const notFound = () => new DomainError('NOT_FOUND', 'Not found.');
const invalid = (field: string, message: string) =>
  new DomainError('VALIDATION', 'Some fields are invalid.', { [field]: [message] });

const addDays = (localDate: string, days: number): string =>
  fromDbDate(new Date(toDbDate(localDate).getTime() + days * DAY_MS));
const isoWeekday = (localDate: string): number => toDbDate(localDate).getUTCDay() || 7;

export interface CheckinTemplateView {
  id: string;
  title: string;
  questions: CheckinQuestion[];
  isSeeded: boolean;
  updatedAt: string;
}

export type CheckinStatus = 'open' | 'overdue' | 'submitted';

export interface CheckinView {
  id: string;
  clientId: string;
  title: string;
  periodLocalDate: string;
  issuedAt: string;
  dueAt: string;
  submittedAt: string | null;
  status: CheckinStatus;
  questions: CheckinQuestion[];
  /** Submitted answers (null until submitted). */
  answers: CheckinAnswers | null;
  /** The client's saved draft. Only ever returned to the client themselves. */
  draft: CheckinAnswers | null;
}

/** Activity in the 7 days before a check-in's period date, shown beside it to the coach (S4-1). */
export interface WeekActivity {
  fromLocalDate: string;
  toLocalDate: string;
  completed: number;
  skipped: number;
  missed: number;
  total: number;
}

interface CheckinRow {
  id: string;
  clientId: string;
  periodLocalDate: Date;
  issuedAt: Date;
  dueAt: Date;
  submittedAt: Date | null;
  questionsJson: Prisma.JsonValue;
  answersJson: Prisma.JsonValue | null;
  draftJson: Prisma.JsonValue | null;
  template: { title: string };
}

const CHECKIN_SELECT = {
  id: true,
  clientId: true,
  periodLocalDate: true,
  issuedAt: true,
  dueAt: true,
  submittedAt: true,
  questionsJson: true,
  answersJson: true,
  draftJson: true,
  template: { select: { title: true } },
} as const;

function toView(row: CheckinRow, actor: ActorContext, now: Date): CheckinView {
  const questions = readQuestions(row.questionsJson);
  const answers = (json: Prisma.JsonValue | null) =>
    json === null ? null : parseAnswers(questions, json, { strict: false });
  return {
    id: row.id,
    clientId: row.clientId,
    title: row.template.title,
    periodLocalDate: fromDbDate(row.periodLocalDate),
    issuedAt: row.issuedAt.toISOString(),
    dueAt: row.dueAt.toISOString(),
    submittedAt: row.submittedAt?.toISOString() ?? null,
    status: row.submittedAt ? 'submitted' : now > row.dueAt ? 'overdue' : 'open',
    questions,
    answers: row.submittedAt ? answers(row.answersJson) : null,
    // A draft is the client's own unfinished work: coaches never see it.
    draft: actor.role === 'client' && !row.submittedAt ? answers(row.draftJson) : null,
  };
}

function toTemplateView(row: {
  id: string;
  title: string;
  questionsJson: Prisma.JsonValue;
  isSeeded: boolean;
  updatedAt: Date;
}): CheckinTemplateView {
  return {
    id: row.id,
    title: row.title,
    questions: readQuestions(row.questionsJson),
    isSeeded: row.isSeeded,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** The organization's template (Ruling 1), created from the seeded questions on first use. */
async function ensureTemplate(tx: TenantTx) {
  const existing = await tx.checkinTemplate.findFirst({});
  if (existing) return existing;
  await tx.checkinTemplate.createMany({
    data: [
      {
        title: SEEDED_TITLE,
        questionsJson: SEEDED_QUESTIONS as unknown as Prisma.InputJsonValue,
        isSeeded: true,
      } as Prisma.CheckinTemplateCreateManyInput,
    ],
    // The unique organization_id makes a concurrent first read create one row.
    skipDuplicates: true,
  });
  return tx.checkinTemplate.findFirstOrThrow({});
}

export async function getCheckinTemplate(
  tx: TenantTx,
  actor: ActorContext,
): Promise<CheckinTemplateView> {
  assertCan(actor, 'checkin:manage');
  return toTemplateView(await ensureTemplate(tx));
}

/** Edits the template. Already-issued check-ins keep the questions they were issued with. */
export async function updateCheckinTemplate(
  tx: TenantTx,
  actor: ActorContext,
  input: { title?: unknown; questions?: unknown },
  opts: { requestId?: string } = {},
): Promise<CheckinTemplateView> {
  assertCan(actor, 'checkin:manage');
  const data: { title?: string; questionsJson?: Prisma.InputJsonValue; isSeeded?: boolean } = {};
  if (input.title !== undefined) {
    const title = typeof input.title === 'string' ? input.title.trim() : '';
    if (title.length < 1 || title.length > TITLE_MAX) {
      throw invalid('title', `Use 1-${TITLE_MAX} characters.`);
    }
    data.title = title;
  }
  if (input.questions !== undefined) {
    data.questionsJson = parseQuestions(input.questions) as unknown as Prisma.InputJsonValue;
  }
  const template = await ensureTemplate(tx);
  if (Object.keys(data).length === 0) return toTemplateView(template);
  const row = await tx.checkinTemplate.update({
    where: { id: template.id },
    data: { ...data, isSeeded: false },
  });
  await appendAudit(tx, {
    orgId: actor.orgId,
    actorId: actor.userId,
    objectType: 'checkin_template',
    objectId: row.id,
    action: 'checkin_template.updated',
    requestId: opts.requestId,
  });
  return toTemplateView(row);
}

/** Sets (1-7, ISO) or clears (null) the weekday a client's check-in is issued on. Applies from the next period. */
export async function setCheckinWeekday(
  tx: TenantTx,
  actor: ActorContext,
  clientId: string,
  weekday: unknown,
  opts: { requestId?: string } = {},
): Promise<{ checkinWeekday: number | null }> {
  assertCan(actor, 'client:update');
  if (!isUuid(clientId)) throw notFound();
  if (
    weekday !== null &&
    !(Number.isInteger(weekday) && (weekday as number) >= 1 && (weekday as number) <= 7)
  ) {
    throw invalid('checkinWeekday', 'Pick a day of the week.');
  }
  const template = await ensureTemplate(tx);
  const res = await tx.client.updateMany({
    where: { id: clientId },
    data: {
      checkinWeekday: weekday as number | null,
      checkinTemplateId: weekday === null ? null : template.id,
    },
  });
  if (res.count === 0) throw notFound();
  await appendAudit(tx, {
    orgId: actor.orgId,
    actorId: actor.userId,
    objectType: 'client',
    objectId: clientId,
    action: 'client.checkin_schedule_updated',
    metadata: weekday === null ? { cleared: true } : { checkinWeekday: weekday as number },
    requestId: opts.requestId,
  });
  return { checkinWeekday: weekday as number | null };
}

/** A client actor sees their own check-ins; a coach names the client. Unknown or other clients are 404. */
function scopeFor(actor: ActorContext, clientId?: string): { clientId: string } {
  if (actor.role === 'client') {
    if (!actor.clientId) throw notFound();
    return { clientId: actor.clientId };
  }
  if (!clientId || !isUuid(clientId)) throw notFound();
  return { clientId };
}

export async function listCheckins(
  tx: TenantTx,
  actor: ActorContext,
  query: { clientId?: string } = {},
  opts: { now?: Date } = {},
): Promise<CheckinView[]> {
  assertCan(actor, 'checkin:read');
  const scope = scopeFor(actor, query.clientId);
  if (
    actor.role !== 'client' &&
    !(await tx.client.findFirst({ where: { id: scope.clientId }, select: { id: true } }))
  ) {
    throw notFound();
  }
  const rows = await tx.checkin.findMany({
    where: scope,
    orderBy: { periodLocalDate: 'desc' },
    take: LIST_MAX,
    select: CHECKIN_SELECT,
  });
  const now = opts.now ?? new Date();
  return rows.map((r) => toView(r, actor, now));
}

async function findCheckin(tx: TenantTx, actor: ActorContext, id: string) {
  if (!isUuid(id)) throw notFound();
  const where = actor.role === 'client' ? { id, ...scopeFor(actor) } : { id };
  const row = await tx.checkin.findFirst({ where, select: CHECKIN_SELECT });
  if (!row) throw notFound();
  return row;
}

export async function getCheckin(
  tx: TenantTx,
  actor: ActorContext,
  id: string,
  opts: { now?: Date } = {},
): Promise<CheckinView> {
  assertCan(actor, 'checkin:read');
  return toView(await findCheckin(tx, actor, id), actor, opts.now ?? new Date());
}

/** The client's autosaved, unvalidated-by-requiredness draft. Refused once submitted. */
export async function saveCheckinDraft(
  tx: TenantTx,
  actor: ActorContext,
  id: string,
  draft: unknown,
): Promise<{ savedAt: string }> {
  assertCan(actor, 'checkin:submit');
  const row = await findCheckin(tx, actor, id);
  if (row.submittedAt) throw new DomainError('CONFLICT', 'This check-in was already submitted.');
  const answers = parseAnswers(readQuestions(row.questionsJson), draft, { strict: false });
  if (JSON.stringify(answers).length > DRAFT_MAX_BYTES)
    throw invalid('draft', 'The draft is too large.');
  const now = new Date();
  // Only while unsubmitted: a save racing the submit loses with a 409, never a constraint 500 (PR #2 review B M-5).
  const saved = await tx.checkin.updateMany({
    where: { id: row.id, submittedAt: null },
    data: { draftJson: answers as Prisma.InputJsonValue, draftUpdatedAt: now },
  });
  if (saved.count === 0) throw new DomainError('CONFLICT', 'This check-in was already submitted.');
  return { savedAt: now.toISOString() };
}

export type CheckinSubmittedHook = (
  tx: TenantTx,
  checkin: { id: string; clientId: string },
  now: Date,
) => Promise<void>;

/**
 * Submits the client's answers (S4-1). Idempotent on `idempotencyKey` (Ruling 3): the same key returns the stored
 * submission, another key after submission is a CONFLICT. `onSubmitted` runs in the same transaction (the review
 * rules use it, D-005).
 */
export async function submitCheckin(
  tx: TenantTx,
  actor: ActorContext,
  id: string,
  input: { answers?: unknown; idempotencyKey?: unknown },
  opts: { now?: Date; requestId?: string; onSubmitted?: CheckinSubmittedHook } = {},
): Promise<CheckinView> {
  assertCan(actor, 'checkin:submit');
  const key = input.idempotencyKey;
  if (typeof key !== 'string' || key.length < 8 || key.length > 200) {
    throw invalid('idempotencyKey', 'Missing idempotency key.');
  }
  const now = opts.now ?? new Date();
  const found = await findCheckin(tx, actor, id);
  // Row lock: two submits of one check-in never interleave.
  await tx.checkin.updateMany({ where: { id: found.id }, data: { updatedAt: now } });
  const current = await tx.checkin.findFirstOrThrow({
    where: { id: found.id },
    select: { ...CHECKIN_SELECT, submitIdempotencyKey: true },
  });
  if (current.submittedAt) {
    if (current.submitIdempotencyKey === key) return toView(current, actor, now);
    throw new DomainError('CONFLICT', 'This check-in was already submitted.');
  }
  const answers = parseAnswers(readQuestions(current.questionsJson), input.answers, {
    strict: true,
  });
  const row = await tx.checkin.update({
    where: { id: current.id },
    data: {
      answersJson: answers as Prisma.InputJsonValue,
      submittedAt: now,
      submitIdempotencyKey: key,
      draftJson: Prisma.DbNull,
    },
    select: CHECKIN_SELECT,
  });
  await appendAudit(tx, {
    orgId: actor.orgId,
    actorId: actor.userId,
    objectType: 'checkin',
    objectId: row.id,
    action: 'checkin.submitted',
    // Content-free: wellbeing answers never reach the audit log.
    metadata: { answered: Object.keys(answers).length },
    requestId: opts.requestId,
  });
  await opts.onSubmitted?.(tx, { id: row.id, clientId: row.clientId }, now);
  return toView(row, actor, now);
}

/** Session counts in the 7 days before `periodLocalDate` (cancelled excluded). */
export async function weekActivityBefore(
  tx: TenantTx,
  actor: ActorContext,
  clientId: string,
  periodLocalDate: string,
): Promise<WeekActivity> {
  assertCan(actor, 'client:read');
  const from = addDays(periodLocalDate, -7);
  const to = addDays(periodLocalDate, -1);
  const rows = await tx.workoutSession.groupBy({
    by: ['state'],
    where: {
      clientId,
      state: { not: 'cancelled' },
      scheduledLocalDate: { gte: toDbDate(from), lte: toDbDate(to) },
    },
    _count: { _all: true },
  });
  const n = (state: string) => rows.find((r) => r.state === state)?._count._all ?? 0;
  return {
    fromLocalDate: from,
    toLocalDate: to,
    completed: n('completed'),
    skipped: n('skipped'),
    missed: n('missed'),
    total: rows.reduce((sum, r) => sum + r._count._all, 0),
  };
}

/**
 * Issues today's check-ins in this organization (worker, Ruling 2): clients not in a pause today, with a check-in weekday equal to
 * today's weekday in their zone, at or after 06:00 local, and no check-in in the previous 6 days. Idempotent on
 * `(clientId, periodLocalDate)`; each new check-in enqueues its "check-in ready" email in the same transaction.
 */
export async function issueDueCheckins(tx: TenantTx, now: Date): Promise<{ issued: number }> {
  // None while a pause covers the day (D-010 #3); a pause booked for later doesn't stop them early (B-I2).
  const inPause = await clientsInPauseNow(tx, now);
  const clients = await tx.client.findMany({
    where: {
      status: { in: ['active', 'paused'] },
      checkinWeekday: { not: null },
      userId: { not: null },
      ...(inPause.size > 0 ? { id: { notIn: [...inPause] } } : {}),
    },
    select: {
      id: true,
      userId: true,
      timezone: true,
      checkinWeekday: true,
      checkinTemplateId: true,
      coach: { select: { name: true } },
    },
  });
  if (clients.length === 0) return { issued: 0 };
  const template = await ensureTemplate(tx);
  let issued = 0;
  for (const c of clients) {
    const today = todayInZone(c.timezone, now);
    if (isoWeekday(today) !== c.checkinWeekday) continue;
    const issuedAt = localTimeOn(today, ISSUE_HOUR, 0, c.timezone);
    if (now < issuedAt) continue;
    const recent = await tx.checkin.findFirst({
      where: {
        clientId: c.id,
        periodLocalDate: { gte: toDbDate(addDays(today, -MIN_GAP_DAYS)), lte: toDbDate(today) },
      },
      select: { id: true },
    });
    if (recent) continue;
    const created = await tx.checkin.createManyAndReturn({
      data: [
        {
          clientId: c.id,
          templateId: c.checkinTemplateId ?? template.id,
          periodLocalDate: toDbDate(today),
          questionsJson: template.questionsJson as Prisma.InputJsonValue,
          issuedAt,
          dueAt: localDayBounds(today, c.timezone).dueAtUtc,
        } as Prisma.CheckinCreateManyInput,
      ],
      skipDuplicates: true,
      select: { id: true },
    });
    const row = created[0];
    if (!row) continue;
    issued += 1;
    await enqueueEmail(tx, {
      kind: 'checkin_ready',
      toUserId: c.userId as string,
      templateKey: 'checkin_ready',
      // RLS hides users outside the organization; a coach is always a member, but never fail an issue on it.
      payload: {
        coachName: (c.coach as { name: string } | null)?.name ?? 'Your coach',
        checkinId: row.id,
      },
      idempotencyKey: `checkin-ready:${row.id}`,
    });
  }
  return { issued };
}
