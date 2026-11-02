import { appendAudit, type TenantTx } from '@kinetic/db';
import type { ActorContext } from '../authz/actor';
import { DomainError } from '../errors';
import { fromDbDate, toDbDate } from '../sessions/read';
import { todayInZone } from '../timezone';
import { isUuid } from '../uuid';
import { eraseMedia, ownMedia } from './media';

/** PRD E3: front, side and back photos on a day; private to the client and their coaches. */
export const POSES = ['front', 'side', 'back'] as const;
export type Pose = (typeof POSES)[number];

export interface ProgressPhotoView {
  id: string;
  mediaId: string;
  pose: Pose;
  takenOn: string;
}

const notFound = () => new DomainError('NOT_FOUND', 'Not found.');
const invalid = (field: string, message: string) =>
  new DomainError('VALIDATION', 'Some fields are invalid.', { [field]: [message] });
const DATE = /^\d{4}-\d{2}-\d{2}$/;

async function clientFor(tx: TenantTx, actor: ActorContext, clientId: unknown) {
  const id = actor.role === 'client' ? actor.clientId : clientId;
  if (!isUuid(id)) throw notFound();
  const client = await tx.client.findFirst({ where: { id }, select: { id: true, timezone: true } });
  if (!client) throw notFound();
  return client;
}

export async function addProgressPhoto(
  tx: TenantTx,
  actor: ActorContext,
  input: { clientId?: unknown; mediaId?: unknown; pose?: unknown; takenOn?: unknown },
  opts: { now?: Date; requestId?: string } = {},
): Promise<ProgressPhotoView> {
  const client = await clientFor(tx, actor, input.clientId);
  if (!(POSES as readonly unknown[]).includes(input.pose)) {
    throw invalid('pose', 'Pick front, side or back.');
  }
  const today = todayInZone(client.timezone, opts.now ?? new Date());
  const takenOn = typeof input.takenOn === 'string' && input.takenOn ? input.takenOn : today;
  if (!DATE.test(takenOn) || fromDbDate(toDbDate(takenOn)) !== takenOn) {
    throw invalid('takenOn', 'Use YYYY-MM-DD.');
  }
  if (takenOn > today) throw invalid('takenOn', 'Pick today or an earlier day.');
  const mediaId = await ownMedia(tx, actor, input.mediaId, 'progress_photo', client.id);
  // PRD E5: a file already used as an assessment photo can't be a progress photo too.
  if (await tx.assessmentPhoto.count({ where: { mediaId } })) {
    throw invalid('mediaId', 'Upload the file first.');
  }
  const row = await tx.progressPhoto.create({
    data: { clientId: client.id, mediaId, pose: input.pose as string, takenOn: toDbDate(takenOn) },
  } as Parameters<typeof tx.progressPhoto.create>[0]);
  // Content-free audit: never the photo, only that one was added.
  await appendAudit(tx, {
    orgId: actor.orgId,
    actorId: actor.userId,
    objectType: 'progress_photo',
    objectId: row.id,
    action: 'progress_photo.added',
    metadata: { clientId: client.id },
    requestId: opts.requestId,
  });
  return { id: row.id, mediaId, pose: input.pose as Pose, takenOn };
}

/** Newest day first, then front, side, back. */
export async function listProgressPhotos(
  tx: TenantTx,
  actor: ActorContext,
  clientId?: unknown,
): Promise<ProgressPhotoView[]> {
  const client = await clientFor(tx, actor, clientId);
  const rows = await tx.progressPhoto.findMany({
    where: { clientId: client.id, media: { is: { erasedAt: null } } },
    orderBy: [{ takenOn: 'desc' }, { createdAt: 'desc' }],
    take: 300,
    select: { id: true, mediaId: true, pose: true, takenOn: true },
  });
  return rows
    .map((r) => ({
      id: r.id,
      mediaId: r.mediaId,
      pose: r.pose as Pose,
      takenOn: fromDbDate(r.takenOn),
    }))
    .sort((a, b) =>
      a.takenOn === b.takenOn
        ? POSES.indexOf(a.pose) - POSES.indexOf(b.pose)
        : a.takenOn < b.takenOn
          ? 1
          : -1,
    );
}

/** The client or a coach removes a photo; the file is erased with it. */
export async function deleteProgressPhoto(
  tx: TenantTx,
  actor: ActorContext,
  id: unknown,
  opts: { requestId?: string } = {},
): Promise<void> {
  if (!isUuid(id)) throw notFound();
  const row = await tx.progressPhoto.findFirst({
    where: { id, ...(actor.role === 'client' ? { clientId: actor.clientId ?? '' } : {}) },
    select: { id: true, mediaId: true, clientId: true },
  });
  if (!row) throw notFound();
  await tx.progressPhoto.delete({ where: { id: row.id } });
  await eraseMedia(tx, [row.mediaId]);
  await appendAudit(tx, {
    orgId: actor.orgId,
    actorId: actor.userId,
    objectType: 'progress_photo',
    objectId: row.id,
    action: 'progress_photo.deleted',
    metadata: { clientId: row.clientId },
    requestId: opts.requestId,
  });
}
