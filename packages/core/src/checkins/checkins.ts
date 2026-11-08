import { recordMetric } from '../progress/metrics';
import { emitClientEvent } from '../automations/events';
import { metricDef, metricFromCanonical } from '../progress/metric-catalog';
import { appendAudit, Prisma, type TenantTx } from '@repsy/db';
import { graceMs } from '../analytics/adherence';
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
  type ContextField,
} from './questions';

const DAY_MS = 86_400_000;
/** D-010 #3: issued at 06:00 client-local on the weekday. */
export const ISSUE_HOUR = 6;
/** Ruling 2: no second check-in within this many days of the last one (a weekday change applies next period). */
/** PRD F4: how often a client's check-in comes, in weeks. */
export const CHECKIN_EVERY_WEEKS = [1, 2, 4] as const;
const DRAFT_MAX_BYTES = 64 * 1024;
const LIST_MAX = 52;

const notFound = () => new DomainError('NOT_FOUND', 'Not found.');
const invalid = (field: string, message: string) =>
  new DomainError('VALIDATION', 'Some fields are invalid.', { [field]: [message] });

const addDays = (localDate: string, days: number): string =>
  fromDbDate(new Date(toDbDate(localDate).getTime() + days * DAY_MS));
const isoWeekday = (localDate: string): number => toDbDate(localDate).getUTCDay() || 7;

/** PRD F2: recurring check-in, one-off form, or intake form (PRD B12). */
export const TEMPLATE_KINDS = ['checkin', 'form', 'intake'] as const;
export type TemplateKind = (typeof TEMPLATE_KINDS)[number];

export interface CheckinTemplateView {
  id: string;
  title: string;
  questions: CheckinQuestion[];
  isSeeded: boolean;
  updatedAt: string;
  kind: TemplateKind;
  /** The workspace's default recurring check-in (every client without their own template gets it). */
  isDefault: boolean;
  archived: boolean;
}

/** Days a one-off or intake form stays open after it is sent. */
export const FORM_DAYS = 7;

export type CheckinStatus = 'open' | 'overdue' | 'submitted';

export interface CheckinView {
  id: string;
  clientId: string;
  title: string;
  /** PRD F2. */
  kind: TemplateKind;
  periodLocalDate: string;
  issuedAt: string;
  dueAt: string;
  submittedAt: string | null;
  /** When a coach marked it reviewed (PRD F14); shown to the client too. */
  reviewedAt: string | null;
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
  reviewedAt: Date | null;
  questionsJson: Prisma.JsonValue;
  answersJson: Prisma.JsonValue | null;
  draftJson: Prisma.JsonValue | null;
  kind: string;
  template: { title: string };
}

const CHECKIN_SELECT = {
  id: true,
  clientId: true,
  periodLocalDate: true,
  issuedAt: true,
  dueAt: true,
  submittedAt: true,
  reviewedAt: true,
  questionsJson: true,
  answersJson: true,
  draftJson: true,
  kind: true,
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
    kind: asKind(row.kind),
    periodLocalDate: fromDbDate(row.periodLocalDate),
    issuedAt: row.issuedAt.toISOString(),
    dueAt: row.dueAt.toISOString(),
    submittedAt: row.submittedAt?.toISOString() ?? null,
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    status: row.submittedAt ? 'submitted' : now > row.dueAt ? 'overdue' : 'open',
    questions,
    answers: row.submittedAt ? answers(row.answersJson) : null,
    // A draft is the client's own unfinished work: coaches never see it.
    draft: actor.role === 'client' && !row.submittedAt ? answers(row.draftJson) : null,
  };
}

const asKind = (k: string): TemplateKind =>
  (TEMPLATE_KINDS as readonly string[]).includes(k) ? (k as TemplateKind) : 'checkin';

function toTemplateView(row: {
  id: string;
  title: string;
  questionsJson: Prisma.JsonValue;
  isSeeded: boolean;
  updatedAt: Date;
  kind: string;
  isDefault: boolean;
  archivedAt: Date | null;
}): CheckinTemplateView {
  return {
    id: row.id,
    title: row.title,
    questions: readQuestions(row.questionsJson),
    isSeeded: row.isSeeded,
    updatedAt: row.updatedAt.toISOString(),
    kind: asKind(row.kind),
    isDefault: row.isDefault,
    archived: row.archivedAt !== null,
  };
}

/** The organization's default check-in template (Ruling 1), created from the seeded questions on first use. */
async function ensureTemplate(tx: TenantTx) {
  const existing = await tx.checkinTemplate.findFirst({ where: { isDefault: true } });
  if (existing) return existing;
  await tx.checkinTemplate.createMany({
    data: [
      {
        title: SEEDED_TITLE,
        questionsJson: SEEDED_QUESTIONS as unknown as Prisma.InputJsonValue,
        isSeeded: true,
        isDefault: true,
        kind: 'checkin',
      } as Prisma.CheckinTemplateCreateManyInput,
    ],
    // The partial unique index on the default makes a concurrent first read create one row.
    skipDuplicates: true,
  });
  return tx.checkinTemplate.findFirstOrThrow({ where: { isDefault: true } });
}

const cleanTitle = (title: unknown): string => {
  const t = typeof title === 'string' ? title.trim() : '';
  if (t.length < 1 || t.length > TITLE_MAX)
    throw invalid('title', `Use 1-${TITLE_MAX} characters.`);
  return t;
};

/** PRD F2: every template (the default first, then by title); archived ones only on request. */
export async function listCheckinTemplates(
  tx: TenantTx,
  actor: ActorContext,
  opts: { includeArchived?: boolean } = {},
): Promise<CheckinTemplateView[]> {
  assertCan(actor, 'checkin:manage');
  await ensureTemplate(tx);
  const rows = await tx.checkinTemplate.findMany({
    where: opts.includeArchived ? {} : { archivedAt: null },
    orderBy: [{ isDefault: 'desc' }, { title: 'asc' }, { id: 'asc' }],
  });
  return rows.map(toTemplateView);
}

export async function getCheckinTemplateById(
  tx: TenantTx,
  actor: ActorContext,
  id: unknown,
): Promise<CheckinTemplateView> {
  assertCan(actor, 'checkin:manage');
  if (!isUuid(id)) throw notFound();
  const row = await tx.checkinTemplate.findFirst({ where: { id } });
  if (!row) throw notFound();
  return toTemplateView(row);
}

/** PRD F2: a new template of any kind. */
export async function createCheckinTemplate(
  tx: TenantTx,
  actor: ActorContext,
  input: { title?: unknown; kind?: unknown; questions?: unknown },
  opts: { requestId?: string } = {},
): Promise<CheckinTemplateView> {
  assertCan(actor, 'checkin:manage');
  if (!(TEMPLATE_KINDS as readonly unknown[]).includes(input.kind)) {
    throw invalid('kind', 'Pick check-in, form or intake.');
  }
  const kind = input.kind as TemplateKind;
  const row = await tx.checkinTemplate.create({
    data: {
      title: cleanTitle(input.title),
      kind,
      questionsJson: parseQuestions(input.questions, kind) as unknown as Prisma.InputJsonValue,
      isSeeded: false,
    },
  } as Parameters<typeof tx.checkinTemplate.create>[0]);
  await appendAudit(tx, {
    orgId: actor.orgId,
    actorId: actor.userId,
    objectType: 'checkin_template',
    objectId: row.id,
    action: 'checkin_template.created',
    metadata: { kind },
    requestId: opts.requestId,
  });
  return toTemplateView(row);
}

/** Edits any template; issued check-ins and forms keep the questions they were sent with. */
export async function updateCheckinTemplateById(
  tx: TenantTx,
  actor: ActorContext,
  id: unknown,
  input: { title?: unknown; questions?: unknown; archived?: unknown },
  opts: { requestId?: string } = {},
): Promise<CheckinTemplateView> {
  assertCan(actor, 'checkin:manage');
  if (!isUuid(id)) throw notFound();
  const current = await tx.checkinTemplate.findFirst({ where: { id } });
  if (!current) throw notFound();
  const data: Prisma.CheckinTemplateUpdateInput = {};
  if (input.title !== undefined) data.title = cleanTitle(input.title);
  if (input.questions !== undefined) {
    data.questionsJson = parseQuestions(
      input.questions,
      asKind(current.kind),
    ) as unknown as Prisma.InputJsonValue;
  }
  if (input.archived !== undefined) {
    if (typeof input.archived !== 'boolean') throw invalid('archived', 'Use true or false.');
    if (input.archived && current.isDefault) {
      throw invalid('archived', 'The default check-in can be edited but not archived.');
    }
    data.archivedAt = input.archived ? new Date() : null;
  }
  if (Object.keys(data).length === 0) return toTemplateView(current);
  const row = await tx.checkinTemplate.update({
    where: { id: current.id },
    data: { ...data, isSeeded: false },
  });
  if (input.archived === true) {
    // Clients on an archived recurring template fall back to the default.
    await tx.client.updateMany({
      where: { checkinTemplateId: current.id },
      data: { checkinTemplateId: null },
    });
  }
  await appendAudit(tx, {
    orgId: actor.orgId,
    actorId: actor.userId,
    objectType: 'checkin_template',
    objectId: row.id,
    action: input.archived === true ? 'checkin_template.archived' : 'checkin_template.updated',
    requestId: opts.requestId,
  });
  return toTemplateView(row);
}

/**
 * PRD F2, B12: sends a one-off form (or an intake form) to a client: open for FORM_DAYS days from now, in their own
 * list next to their check-ins. Clients who have joined get an email; an intake sent with an invite waits for them.
 */
export async function sendForm(
  tx: TenantTx,
  actor: ActorContext,
  clientId: unknown,
  templateId: unknown,
  opts: { now?: Date; requestId?: string } = {},
): Promise<CheckinView> {
  assertCan(actor, 'checkin:manage');
  if (!isUuid(clientId) || !isUuid(templateId)) throw notFound();
  const now = opts.now ?? new Date();
  const client = await tx.client.findFirst({
    where: { id: clientId },
    select: {
      id: true,
      userId: true,
      status: true,
      timezone: true,
      coach: { select: { name: true } },
    },
  });
  if (!client) throw notFound();
  if (client.status === 'archived') throw new DomainError('CONFLICT', 'This client is archived.');
  const template = await tx.checkinTemplate.findFirst({
    where: { id: templateId, archivedAt: null, kind: { in: ['form', 'intake'] } },
  });
  if (!template) throw invalid('templateId', 'Pick a form.');
  const today = todayInZone(client.timezone, now);
  const row = await tx.checkin.create({
    data: {
      clientId: client.id,
      templateId: template.id,
      kind: template.kind,
      periodLocalDate: toDbDate(today),
      questionsJson: template.questionsJson as Prisma.InputJsonValue,
      issuedAt: now,
      dueAt: localDayBounds(addDays(today, FORM_DAYS), client.timezone).dueAtUtc,
    },
    select: CHECKIN_SELECT,
  } as unknown as Parameters<typeof tx.checkin.create>[0]);
  const created = row as unknown as CheckinRow;
  if (client.userId) {
    await enqueueEmail(tx, {
      kind: 'form_ready',
      toUserId: client.userId,
      templateKey: 'form_ready',
      payload: {
        coachName: (client.coach as { name: string } | null)?.name ?? 'Your coach',
        checkinId: created.id,
      },
      idempotencyKey: `form-ready:${created.id}`,
    });
  }
  await appendAudit(tx, {
    orgId: actor.orgId,
    actorId: actor.userId,
    objectType: 'checkin',
    objectId: created.id,
    action: 'form.sent',
    metadata: { clientId: client.id, kind: template.kind },
    requestId: opts.requestId,
  });
  return toView(created, actor, now);
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

/**
 * Sets (1-7, ISO) or clears (null) the weekday a client's check-in is issued on, and how often (PRD F4: every 1, 2 or
 * 4 weeks; left as it is when not given). Applies from the next period.
 */
export async function setCheckinWeekday(
  tx: TenantTx,
  actor: ActorContext,
  clientId: string,
  weekday: unknown,
  opts: { requestId?: string; everyWeeks?: unknown; templateId?: unknown } = {},
): Promise<{ checkinWeekday: number | null; checkinEveryWeeks: number }> {
  assertCan(actor, 'client:update');
  if (!isUuid(clientId)) throw notFound();
  if (
    weekday !== null &&
    !(Number.isInteger(weekday) && (weekday as number) >= 1 && (weekday as number) <= 7)
  ) {
    throw invalid('checkinWeekday', 'Pick a day of the week.');
  }
  const every = opts.everyWeeks;
  if (every !== undefined && !(CHECKIN_EVERY_WEEKS as readonly unknown[]).includes(every)) {
    throw invalid('checkinEveryWeeks', 'Pick every week, every 2 weeks or every 4 weeks.');
  }
  let template = await ensureTemplate(tx);
  // PRD F2: the client's own recurring template (null or left out: the default).
  if (opts.templateId !== undefined && opts.templateId !== null) {
    const own = isUuid(opts.templateId)
      ? await tx.checkinTemplate.findFirst({
          where: { id: opts.templateId, kind: 'checkin', archivedAt: null },
        })
      : null;
    if (!own) throw invalid('checkinTemplateId', 'Pick a check-in template.');
    template = own;
  }
  const res = await tx.client.updateMany({
    where: { id: clientId },
    data: {
      checkinWeekday: weekday as number | null,
      checkinTemplateId: weekday === null ? null : template.id,
      ...(every !== undefined ? { checkinEveryWeeks: every as number } : {}),
    },
  });
  if (res.count === 0) throw notFound();
  await appendAudit(tx, {
    orgId: actor.orgId,
    actorId: actor.userId,
    objectType: 'client',
    objectId: clientId,
    action: 'client.checkin_schedule_updated',
    metadata:
      weekday === null
        ? { cleared: true }
        : {
            checkinWeekday: weekday as number,
            ...(every !== undefined ? { checkinEveryWeeks: every as number } : {}),
          },
    requestId: opts.requestId,
  });
  const after = await tx.client.findFirst({
    where: { id: clientId },
    select: { checkinEveryWeeks: true },
  });
  return {
    checkinWeekday: weekday as number | null,
    checkinEveryWeeks: after?.checkinEveryWeeks ?? 1,
  };
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
  await recordMetricAnswers(tx, actor, row, answers, now);
  if (row.kind === 'intake') await fillContextFromIntake(tx, row, answers);
  // PRD J2: automations triggered by an intake or a weekly check-in.
  if (row.kind === 'intake' || row.kind === 'checkin') {
    await emitClientEvent(
      tx,
      row.clientId,
      row.kind === 'intake' ? 'intake_submitted' : 'checkin_submitted',
      {
        checkinId: row.id,
      },
    );
  }
  await opts.onSubmitted?.(tx, { id: row.id, clientId: row.clientId }, now);
  return toView(row, actor, now);
}

/**
 * PRD F3: metric answers become body measurements (E1) on the check-in's date, as if the client logged them; a value
 * the measurement itself refuses is skipped (the answer stays on the check-in).
 */
async function recordMetricAnswers(
  tx: TenantTx,
  actor: ActorContext,
  row: { clientId: string; periodLocalDate: Date; questionsJson: unknown },
  answers: CheckinAnswers,
  now: Date,
): Promise<void> {
  const metricQs = readQuestions(row.questionsJson).filter(
    (q) => q.type === 'metric' && q.metric && typeof answers[q.id] === 'number',
  );
  if (metricQs.length === 0) return;
  const client = await tx.client.findFirst({
    where: { id: row.clientId },
    select: { preferredUnits: true },
  });
  const units = client?.preferredUnits ?? 'kg';
  for (const q of metricQs) {
    const def = metricDef(q.metric!);
    try {
      await recordMetric(
        tx,
        actor,
        row.clientId,
        {
          metric: def.key,
          measuredOn: fromDbDate(row.periodLocalDate),
          value: metricFromCanonical(def.kind, answers[q.id] as number, units),
        },
        { now },
      );
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
    }
  }
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
      kind: 'planned',
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
      checkinEveryWeeks: true,
      checkinTemplateId: true,
      coach: { select: { name: true } },
    },
  });
  if (clients.length === 0) return { issued: 0 };
  const template = await ensureTemplate(tx);
  // PRD F2: each client's own recurring template, unless it was archived.
  const own = new Map(
    (
      await tx.checkinTemplate.findMany({
        where: {
          id: {
            in: [
              ...new Set(
                clients.flatMap((c) => (c.checkinTemplateId ? [c.checkinTemplateId] : [])),
              ),
            ],
          },
          kind: 'checkin',
          archivedAt: null,
        },
      })
    ).map((t) => [t.id, t]),
  );
  let issued = 0;
  for (const c of clients) {
    const today = todayInZone(c.timezone, now);
    if (isoWeekday(today) !== c.checkinWeekday) continue;
    const issuedAt = localTimeOn(today, ISSUE_HOUR, 0, c.timezone);
    if (now < issuedAt) continue;
    const recent = await tx.checkin.findFirst({
      where: {
        clientId: c.id,
        kind: 'checkin',
        // A day short of the interval, so a weekday change never issues two in one period (PRD F4).
        periodLocalDate: {
          gte: toDbDate(addDays(today, -(7 * c.checkinEveryWeeks - 1))),
          lte: toDbDate(today),
        },
      },
      select: { id: true },
    });
    if (recent) continue;
    const created = await tx.checkin.createManyAndReturn({
      data: [
        {
          clientId: c.id,
          templateId: (c.checkinTemplateId && own.get(c.checkinTemplateId)?.id) || template.id,
          periodLocalDate: toDbDate(today),
          questionsJson: ((c.checkinTemplateId && own.get(c.checkinTemplateId)) || template)
            .questionsJson as Prisma.InputJsonValue,
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

/**
 * Marks a submitted check-in reviewed (PRD F14) and resolves its open "New check-in sent" flag as the coach's own
 * follow-up. Repeating is a no-op. A check-in not yet submitted is a CONFLICT.
 */
export async function markCheckinReviewed(
  tx: TenantTx,
  actor: ActorContext,
  id: string,
  opts: { now?: Date; requestId?: string } = {},
): Promise<CheckinView> {
  assertCan(actor, 'review:update');
  const now = opts.now ?? new Date();
  const row = await findCheckin(tx, actor, id);
  if (!row.submittedAt) {
    throw new DomainError('CONFLICT', 'This check-in has not been sent yet.');
  }
  if (!row.reviewedAt) {
    await tx.checkin.update({
      where: { id: row.id },
      data: { reviewedAt: now, reviewedByUserId: actor.userId },
    });
    await tx.reviewFlag.updateMany({
      where: { ruleKey: 'checkin_new', sourceId: row.id, state: { in: ['open', 'snoozed'] } },
      data: {
        state: 'resolved',
        resolvedAt: now,
        resolvedBy: actor.userId,
        resolutionReason: 'Check-in reviewed',
        snoozedUntil: null,
      },
    });
    await appendAudit(tx, {
      orgId: actor.orgId,
      actorId: actor.userId,
      objectType: 'checkin',
      objectId: row.id,
      action: 'checkin.reviewed',
      requestId: opts.requestId,
    });
  }
  return toView(await findCheckin(tx, actor, row.id), actor, now);
}

/**
 * Consecutive check-ins sent on time, counting back from the newest (PRD F13). On time = sent before due + grace. A
 * check-in still within its window and not yet sent neither counts nor breaks the streak; a late or missing one ends
 * it. A client reads their own; a coach any client in the organization.
 */
export async function checkinStreak(
  tx: TenantTx,
  actor: ActorContext,
  query: { clientId?: string } = {},
  opts: { now?: Date } = {},
): Promise<number> {
  assertCan(actor, 'checkin:read');
  const scope = scopeFor(actor, query.clientId);
  const now = opts.now ?? new Date();
  const grace = await graceMs(tx);
  const rows = await tx.checkin.findMany({
    // One-off and intake forms (PRD F2) don't make or break a streak.
    where: { ...scope, kind: 'checkin' },
    orderBy: { periodLocalDate: 'desc' },
    take: LIST_MAX,
    select: { dueAt: true, submittedAt: true },
  });
  let streak = 0;
  for (const r of rows) {
    const windowEnd = r.dueAt.getTime() + grace;
    if (r.submittedAt === null) {
      if (now.getTime() <= windowEnd) continue;
      break;
    }
    if (r.submittedAt.getTime() > windowEnd) break;
    streak += 1;
  }
  return streak;
}

export interface CheckinAwaitingReview {
  id: string;
  clientId: string;
  clientName: string;
  periodLocalDate: string;
  submittedAt: string;
}

/**
 * Sent check-ins no coach has marked reviewed yet (PRD I8), oldest sent first, across the organization. Archived
 * clients are left out. `total` counts them all; `items` holds at most `limit`.
 */
export async function listCheckinsAwaitingReview(
  tx: TenantTx,
  actor: ActorContext,
  opts: { limit?: number } = {},
): Promise<{ total: number; items: CheckinAwaitingReview[] }> {
  assertCan(actor, 'review:read');
  const where = {
    submittedAt: { not: null },
    reviewedAt: null,
    client: { is: { status: { not: 'archived' as const } } },
  };
  const [total, rows] = await Promise.all([
    tx.checkin.count({ where }),
    tx.checkin.findMany({
      where,
      orderBy: [{ submittedAt: 'asc' }, { id: 'asc' }],
      take: Math.min(Math.max(opts.limit ?? 10, 1), 50),
      select: {
        id: true,
        clientId: true,
        periodLocalDate: true,
        submittedAt: true,
        client: { select: { name: true } },
      },
    }),
  ]);
  return {
    total,
    items: rows.map((r) => ({
      id: r.id,
      clientId: r.clientId,
      clientName: r.client.name,
      periodLocalDate: fromDbDate(r.periodLocalDate),
      submittedAt: (r.submittedAt as Date).toISOString(),
    })),
  };
}

const CONTEXT_MAX: Record<ContextField, number> = {
  goals: 2000,
  motivation: 1000,
  scheduleNotes: 1000,
  equipmentNotes: 1000,
  preferences: 1000,
};

/**
 * PRD B12: an intake answer to a question tied to a context field fills it on the client's context card (appended
 * after anything the coach already wrote, within the field's limit).
 */
async function fillContextFromIntake(
  tx: TenantTx,
  row: { clientId: string; questionsJson: unknown },
  answers: CheckinAnswers,
): Promise<void> {
  const mapped = readQuestions(row.questionsJson).filter(
    (q) => q.contextField && typeof answers[q.id] === 'string',
  );
  if (mapped.length === 0) return;
  const client = await tx.client.findFirst({
    where: { id: row.clientId },
    select: {
      goals: true,
      motivation: true,
      scheduleNotes: true,
      equipmentNotes: true,
      preferences: true,
    },
  });
  if (!client) return;
  const data: Partial<Record<ContextField, string>> = {};
  for (const q of mapped) {
    const field = q.contextField!;
    const before = data[field] ?? client[field] ?? '';
    const add = String(answers[q.id]);
    data[field] = (before ? `${before}\n\n${add}` : add).slice(0, CONTEXT_MAX[field]);
  }
  await tx.client.update({ where: { id: row.clientId }, data });
}
