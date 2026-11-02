import { appendAudit, type TenantTx } from '@kinetic/db';
import type { ActorContext } from '../authz/actor';
import { assertCan } from '../authz/policies';
import { DomainError } from '../errors';
import { eraseMedia, ownMedia } from '../media/media';
import { fromDbDate, toDbDate } from '../sessions/read';
import { todayInZone } from '../timezone';
import { isUuid } from '../uuid';

/**
 * PRD E5: assessment photos and retests. A coach defines what to photograph (posture, a mobility position), which
 * guide lines help line it up, and how often to retest. A client assigned it is asked for the photo on the start
 * date and again every N weeks after the last one; the coach compares the first and the latest.
 */
export const GUIDES = ['posture_grid', 'plumb_line', 'none'] as const;
export type Guide = (typeof GUIDES)[number];
export const ASSESSMENTS_MAX = 50;

export interface AssessmentView {
  id: string;
  title: string;
  instructions: string;
  guide: Guide;
  everyWeeks: number;
  assigned: number;
}

export interface AssessmentPhotoView {
  id: string;
  mediaId: string;
  takenOn: string;
}

export interface ClientAssessmentView {
  id: string;
  assessmentId: string;
  title: string;
  instructions: string;
  guide: Guide;
  everyWeeks: number;
  startLocalDate: string;
  /** Null when a one-off assessment has been done. */
  dueOn: string | null;
  due: boolean;
  /** Newest first. */
  photos: AssessmentPhotoView[];
}

const notFound = () => new DomainError('NOT_FOUND', 'Not found.');
const invalid = (field: string, message: string) =>
  new DomainError('VALIDATION', 'Some fields are invalid.', { [field]: [message] });
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const addDays = (d: string, n: number) =>
  new Date(toDbDate(d).getTime() + n * 86_400_000).toISOString().slice(0, 10);

/** When the next photo is due: the start date, then every N weeks after the latest photo (none for one-offs). */
export function nextDue(start: string, latest: string | null, everyWeeks: number): string | null {
  if (latest === null) return start;
  if (everyWeeks === 0) return null;
  return addDays(latest, everyWeeks * 7);
}

function clean(input: Record<string, unknown>) {
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  if (title.length < 1 || title.length > 120) throw invalid('title', 'Use 1-120 characters.');
  const instructions = typeof input.instructions === 'string' ? input.instructions.trim() : '';
  if (instructions.length > 2000) throw invalid('instructions', 'Use at most 2000 characters.');
  const guide = input.guide ?? 'posture_grid';
  if (!(GUIDES as readonly unknown[]).includes(guide)) throw invalid('guide', 'Pick a guide.');
  const everyWeeks = Number(input.everyWeeks ?? 4);
  if (!Number.isInteger(everyWeeks) || everyWeeks < 0 || everyWeeks > 52) {
    throw invalid('everyWeeks', 'Use 0 (once) to 52 weeks.');
  }
  return { title, instructions, guide: guide as Guide, everyWeeks };
}

export async function listAssessments(
  tx: TenantTx,
  actor: ActorContext,
): Promise<AssessmentView[]> {
  assertCan(actor, 'client:read');
  const rows = await tx.assessment.findMany({
    where: { archivedAt: null },
    orderBy: [{ title: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      title: true,
      instructions: true,
      guide: true,
      everyWeeks: true,
      _count: { select: { assigned: { where: { endedAt: null } } } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    instructions: r.instructions,
    guide: r.guide as Guide,
    everyWeeks: r.everyWeeks,
    assigned: r._count.assigned,
  }));
}

/** Creates an assessment, or updates one when `input.id` is set. */
export async function saveAssessment(
  tx: TenantTx,
  actor: ActorContext,
  input: Record<string, unknown>,
  opts: { requestId?: string } = {},
): Promise<{ id: string }> {
  assertCan(actor, 'client:update');
  const data = clean(input);
  let id: string;
  if (input.id !== undefined) {
    if (!isUuid(input.id)) throw notFound();
    const { count } = await tx.assessment.updateMany({
      where: { id: input.id, archivedAt: null },
      data,
    });
    if (count === 0) throw notFound();
    id = input.id;
  } else {
    if ((await tx.assessment.count({ where: { archivedAt: null } })) >= ASSESSMENTS_MAX) {
      throw invalid('title', `A workspace can have at most ${ASSESSMENTS_MAX} assessments.`);
    }
    const row = await tx.assessment.create({
      data: { ...data, createdBy: actor.userId },
      select: { id: true },
    } as Parameters<typeof tx.assessment.create>[0]);
    id = (row as { id: string }).id;
  }
  await appendAudit(tx, {
    orgId: actor.orgId,
    actorId: actor.userId,
    objectType: 'assessment',
    objectId: id,
    action: input.id === undefined ? 'assessment.created' : 'assessment.updated',
    requestId: opts.requestId,
  });
  return { id };
}

/** Archives an assessment: clients stop being asked; photos already taken stay. */
export async function archiveAssessment(
  tx: TenantTx,
  actor: ActorContext,
  id: string,
  opts: { requestId?: string; now?: Date } = {},
): Promise<void> {
  assertCan(actor, 'client:update');
  if (!isUuid(id)) throw notFound();
  const now = opts.now ?? new Date();
  const { count } = await tx.assessment.updateMany({
    where: { id, archivedAt: null },
    data: { archivedAt: now },
  });
  if (count === 0) throw notFound();
  await tx.clientAssessment.updateMany({
    where: { assessmentId: id, endedAt: null },
    data: { endedAt: now },
  });
  await appendAudit(tx, {
    orgId: actor.orgId,
    actorId: actor.userId,
    objectType: 'assessment',
    objectId: id,
    action: 'assessment.archived',
    requestId: opts.requestId,
  });
}

/** Asks a client for an assessment, from today (their zone). Already assigned: nothing changes. */
export async function assignAssessment(
  tx: TenantTx,
  actor: ActorContext,
  input: { clientId?: unknown; assessmentId?: unknown },
  opts: { requestId?: string; now?: Date } = {},
): Promise<{ id: string; created: boolean }> {
  assertCan(actor, 'client:update');
  if (!isUuid(input.assessmentId)) throw invalid('assessmentId', 'Pick an assessment.');
  if (!isUuid(input.clientId)) throw notFound();
  const assessment = await tx.assessment.findFirst({
    where: { id: input.assessmentId, archivedAt: null },
    select: { id: true },
  });
  if (!assessment) throw invalid('assessmentId', 'That assessment no longer exists.');
  const client = await tx.client.findFirst({
    where: { id: input.clientId, status: { in: ['active', 'invited'] } },
    select: { id: true, timezone: true },
  });
  if (!client) throw notFound();
  const open = await tx.clientAssessment.findFirst({
    where: { assessmentId: assessment.id, clientId: client.id, endedAt: null },
    select: { id: true },
  });
  if (open) return { id: open.id, created: false };
  const row = await tx.clientAssessment.create({
    data: {
      assessmentId: assessment.id,
      clientId: client.id,
      startLocalDate: toDbDate(todayInZone(client.timezone, opts.now ?? new Date())),
    },
    select: { id: true },
  } as Parameters<typeof tx.clientAssessment.create>[0]);
  const id = (row as { id: string }).id;
  await appendAudit(tx, {
    orgId: actor.orgId,
    actorId: actor.userId,
    objectType: 'client',
    objectId: client.id,
    action: 'assessment.assigned',
    metadata: { assessmentId: assessment.id },
    requestId: opts.requestId,
  });
  return { id, created: true };
}

/** Stops asking the client; their photos stay. */
export async function endClientAssessment(
  tx: TenantTx,
  actor: ActorContext,
  id: string,
  opts: { requestId?: string; now?: Date } = {},
): Promise<void> {
  assertCan(actor, 'client:update');
  if (!isUuid(id)) throw notFound();
  const row = await tx.clientAssessment.findFirst({
    where: { id, endedAt: null },
    select: { id: true, clientId: true },
  });
  if (!row) throw notFound();
  await tx.clientAssessment.update({
    where: { id: row.id },
    data: { endedAt: opts.now ?? new Date() },
  });
  await appendAudit(tx, {
    orgId: actor.orgId,
    actorId: actor.userId,
    objectType: 'client',
    objectId: row.clientId,
    action: 'assessment.ended',
    metadata: { clientAssessmentId: row.id },
    requestId: opts.requestId,
  });
}

/** A client's open assessments with their photos; `clientId` is ignored for a client (their own). */
export async function clientAssessments(
  tx: TenantTx,
  actor: ActorContext,
  clientId?: unknown,
  now: Date = new Date(),
): Promise<ClientAssessmentView[]> {
  assertCan(actor, 'metric:read');
  const id = actor.role === 'client' ? actor.clientId : clientId;
  if (!isUuid(id)) throw notFound();
  const client = await tx.client.findFirst({ where: { id }, select: { id: true, timezone: true } });
  if (!client) throw notFound();
  const today = todayInZone(client.timezone, now);
  const rows = await tx.clientAssessment.findMany({
    where: { clientId: client.id, endedAt: null, assessment: { archivedAt: null } },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      startLocalDate: true,
      assessment: {
        select: { id: true, title: true, instructions: true, guide: true, everyWeeks: true },
      },
      photos: {
        where: { media: { is: { erasedAt: null } } },
        orderBy: [{ takenOn: 'desc' }, { createdAt: 'desc' }],
        take: 60,
        select: { id: true, mediaId: true, takenOn: true },
      },
    },
  });
  return rows.map((r) => {
    const start = fromDbDate(r.startLocalDate);
    const photos = r.photos.map((p) => ({
      id: p.id,
      mediaId: p.mediaId,
      takenOn: fromDbDate(p.takenOn),
    }));
    const dueOn = nextDue(start, photos[0]?.takenOn ?? null, r.assessment.everyWeeks);
    return {
      id: r.id,
      assessmentId: r.assessment.id,
      title: r.assessment.title,
      instructions: r.assessment.instructions,
      guide: r.assessment.guide as Guide,
      everyWeeks: r.assessment.everyWeeks,
      startLocalDate: start,
      dueOn,
      due: dueOn !== null && dueOn <= today,
      photos,
    };
  });
}

/** Records an uploaded photo against an open assessment (the client, or a coach for them). */
export async function addAssessmentPhoto(
  tx: TenantTx,
  actor: ActorContext,
  input: { clientAssessmentId?: unknown; mediaId?: unknown; takenOn?: unknown },
  opts: { now?: Date; requestId?: string } = {},
): Promise<AssessmentPhotoView> {
  assertCan(actor, 'metric:write');
  if (!isUuid(input.clientAssessmentId)) throw notFound();
  const ca = await tx.clientAssessment.findFirst({
    where: {
      id: input.clientAssessmentId,
      endedAt: null,
      ...(actor.role === 'client' ? { clientId: actor.clientId ?? '' } : {}),
    },
    select: { id: true, clientId: true, client: { select: { timezone: true } } },
  });
  if (!ca) throw notFound();
  const today = todayInZone(ca.client.timezone, opts.now ?? new Date());
  const takenOn = typeof input.takenOn === 'string' && input.takenOn ? input.takenOn : today;
  if (!DATE.test(takenOn) || fromDbDate(toDbDate(takenOn)) !== takenOn) {
    throw invalid('takenOn', 'Use YYYY-MM-DD.');
  }
  if (takenOn > today) throw invalid('takenOn', 'Pick today or an earlier day.');
  const mediaId = await ownMedia(tx, actor, input.mediaId, 'progress_photo', ca.clientId);
  if (await tx.progressPhoto.count({ where: { mediaId } })) {
    throw invalid('mediaId', 'Upload the file first.');
  }
  const row = await tx.assessmentPhoto.create({
    data: { clientAssessmentId: ca.id, mediaId, takenOn: toDbDate(takenOn) },
    select: { id: true },
  } as Parameters<typeof tx.assessmentPhoto.create>[0]);
  const id = (row as { id: string }).id;
  // Content-free audit, as for progress photos.
  await appendAudit(tx, {
    orgId: actor.orgId,
    actorId: actor.userId,
    objectType: 'assessment_photo',
    objectId: id,
    action: 'assessment_photo.added',
    metadata: { clientId: ca.clientId },
    requestId: opts.requestId,
  });
  return { id, mediaId, takenOn };
}

/** The client or a coach removes an assessment photo; the file is erased with it. */
export async function deleteAssessmentPhoto(
  tx: TenantTx,
  actor: ActorContext,
  id: unknown,
  opts: { requestId?: string } = {},
): Promise<void> {
  assertCan(actor, 'metric:write');
  if (!isUuid(id)) throw notFound();
  const row = await tx.assessmentPhoto.findFirst({
    where: {
      id,
      ...(actor.role === 'client'
        ? { clientAssessment: { is: { clientId: actor.clientId ?? '' } } }
        : {}),
    },
    select: { id: true, mediaId: true, clientAssessment: { select: { clientId: true } } },
  });
  if (!row) throw notFound();
  await tx.assessmentPhoto.delete({ where: { id: row.id } });
  await eraseMedia(tx, [row.mediaId]);
  await appendAudit(tx, {
    orgId: actor.orgId,
    actorId: actor.userId,
    objectType: 'assessment_photo',
    objectId: row.id,
    action: 'assessment_photo.deleted',
    metadata: { clientId: row.clientAssessment.clientId },
    requestId: opts.requestId,
  });
}
