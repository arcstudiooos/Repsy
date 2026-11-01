import { randomUUID } from 'node:crypto';
import { isCoachRole } from '../authz/actor';
import { appendAudit, withSystem, type PrismaClient, type TenantTx } from '@kinetic/db';
import type { ActorContext } from '../authz/actor';
import { DomainError } from '../errors';
import { isUuid } from '../uuid';
import { isImage, MAX_BYTES, sniffType, stripMetadata, type MediaType } from './files';

/**
 * Uploaded files (D-011 #5). The route reads the body, `prepareUpload` checks and strips it, the object goes to
 * private storage, then `recordMedia` stores the row. Files are only ever streamed back through `mediaForDownload`,
 * to the client they belong to and their coaches (exercise demos: anyone in the workspace).
 */
export const MEDIA_PURPOSES = ['progress_photo', 'message', 'form_check', 'exercise_demo'] as const;
export type MediaPurpose = (typeof MEDIA_PURPOSES)[number];

const ALLOWED: Record<MediaPurpose, MediaType[]> = {
  progress_photo: ['image/jpeg', 'image/png', 'image/webp'],
  message: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
  form_check: ['video/mp4'],
  exercise_demo: ['video/mp4'],
};
/** PRD D10: form-check videos are short. */
const FORM_CHECK_MAX = 50 * 1024 * 1024;

const notFound = () => new DomainError('NOT_FOUND', 'Not found.');
const invalid = (message: string) =>
  new DomainError('VALIDATION', 'Some fields are invalid.', { file: [message] });

const isCoach = (a: ActorContext) => isCoachRole(a.role);

/** Checks the bytes for `purpose` and returns them ready to store (images without metadata). */
export function prepareUpload(
  purpose: unknown,
  body: Buffer,
): { purpose: MediaPurpose; contentType: MediaType; bytes: Buffer } {
  if (!(MEDIA_PURPOSES as readonly unknown[]).includes(purpose)) throw invalid('Unknown upload.');
  const p = purpose as MediaPurpose;
  const type = sniffType(body);
  if (!type || !ALLOWED[p].includes(type)) {
    throw invalid(
      p === 'progress_photo'
        ? 'Use a JPEG, PNG or WebP photo.'
        : p === 'message'
          ? 'Send a photo (JPEG, PNG, WebP) or a PDF.'
          : 'Use an MP4 video.',
    );
  }
  const max = p === 'form_check' ? FORM_CHECK_MAX : MAX_BYTES[type];
  if (body.length > max)
    throw invalid(`The file is too big (at most ${Math.round(max / 1048576)} MB).`);
  let bytes = body;
  if (isImage(type)) {
    try {
      bytes = stripMetadata(body, type);
    } catch {
      throw invalid("That image couldn't be read. Try another one.");
    }
  }
  return { purpose: p, contentType: type, bytes };
}

/**
 * Which client the upload belongs to, checked before anything is stored: a client uploads for themselves; a coach for
 * a client in the workspace; exercise demos belong to no client and only coaches add them.
 */
export async function uploadOwner(
  tx: TenantTx,
  actor: ActorContext,
  purpose: MediaPurpose,
  clientId: unknown,
): Promise<string | null> {
  if (purpose === 'exercise_demo') {
    if (!isCoach(actor)) throw new DomainError('FORBIDDEN', 'You do not have access to this.');
    return null;
  }
  if (actor.role === 'client') {
    if (!actor.clientId) throw notFound();
    return actor.clientId;
  }
  if (!isUuid(clientId)) throw notFound();
  const client = await tx.client.findFirst({
    where: { id: clientId, status: { not: 'archived' } },
    select: { id: true },
  });
  if (!client) throw notFound();
  return client.id;
}

export const storageKeyFor = (orgId: string, purpose: MediaPurpose) =>
  `media/${orgId}/${purpose}/${randomUUID()}`;

export async function recordMedia(
  tx: TenantTx,
  actor: ActorContext,
  input: {
    purpose: MediaPurpose;
    clientId: string | null;
    contentType: MediaType;
    bytes: number;
    key: string;
  },
): Promise<{ id: string; contentType: MediaType }> {
  const row = await tx.mediaFile.create({
    data: {
      clientId: input.clientId,
      uploadedBy: actor.userId,
      purpose: input.purpose,
      contentType: input.contentType,
      bytes: input.bytes,
      storageKey: input.key,
    },
  } as Parameters<typeof tx.mediaFile.create>[0]);
  await appendAudit(tx, {
    orgId: actor.orgId,
    actorId: actor.userId,
    objectType: 'media',
    objectId: row.id,
    action: 'media.uploaded',
    metadata: { purpose: input.purpose, bytes: input.bytes },
  });
  return { id: row.id, contentType: input.contentType };
}

/** The object to stream, if this actor may see it; NOT_FOUND otherwise (never 403). */
export async function mediaForDownload(
  tx: TenantTx,
  actor: ActorContext,
  id: unknown,
): Promise<{ key: string; contentType: string; bytes: number }> {
  if (!isUuid(id)) throw notFound();
  const row = await tx.mediaFile.findFirst({
    where: { id, erasedAt: null },
    select: { storageKey: true, contentType: true, bytes: true, clientId: true, purpose: true },
  });
  if (!row) throw notFound();
  if (
    actor.role === 'client' &&
    row.purpose !== 'exercise_demo' &&
    row.clientId !== actor.clientId
  ) {
    throw notFound();
  }
  return { key: row.storageKey, contentType: row.contentType, bytes: row.bytes };
}

/** A file this actor uploaded (or, for a coach, one of the workspace's) that `purpose` may use. */
export async function ownMedia(
  tx: TenantTx,
  actor: ActorContext,
  id: unknown,
  purpose: MediaPurpose,
  clientId: string | null,
): Promise<string> {
  if (!isUuid(id)) throw invalid('Upload the file first.');
  const row = await tx.mediaFile.findFirst({
    where: {
      id,
      purpose,
      clientId,
      erasedAt: null,
      ...(actor.role === 'client' ? { uploadedBy: actor.userId } : {}),
    },
    select: { id: true },
  });
  if (!row) throw invalid('Upload the file first.');
  return row.id;
}

/** Marks files for deletion; `purgeErasedMedia` removes the objects. */
export async function eraseMedia(tx: TenantTx, ids: string[], now: Date = new Date()) {
  if (ids.length === 0) return;
  await tx.mediaFile.updateMany({
    where: { id: { in: ids }, erasedAt: null },
    data: { erasedAt: now },
  });
}

/**
 * Worker (D-011 #5): deletes the objects of erased files, and of uploads never attached within a day, then their
 * rows. A storage failure leaves the rows to retry next run.
 */
export async function purgeErasedMedia(
  prisma: PrismaClient,
  storage: { deleteMany(keys: string[]): Promise<void> },
  now: Date = new Date(),
): Promise<{ purged: number }> {
  const dayAgo = new Date(now.getTime() - 86_400_000);
  const rows = await withSystem(async (tx) => {
    // Unattached uploads older than a day are abandoned: erase them first.
    await tx.mediaFile.updateMany({
      where: {
        erasedAt: null,
        createdAt: { lt: dayAgo },
        progressPhoto: { is: null },
        sessionMedia: { is: null },
        messages: { none: {} },
        exercises: { none: {} },
      },
      data: { erasedAt: now },
    });
    return tx.mediaFile.findMany({
      where: { erasedAt: { not: null } },
      take: 500,
      select: { id: true, storageKey: true },
    });
  }, prisma);
  if (rows.length === 0) return { purged: 0 };
  await storage.deleteMany(rows.map((r) => r.storageKey));
  await withSystem(async (tx) => {
    const ids = rows.map((r) => r.id);
    await tx.progressPhoto.deleteMany({ where: { mediaId: { in: ids } } });
    await tx.sessionMedia.deleteMany({ where: { mediaId: { in: ids } } });
    await tx.exercise.updateMany({
      where: { demoMediaId: { in: ids } },
      data: { demoMediaId: null },
    });
    await tx.mediaFile.deleteMany({ where: { id: { in: ids }, messages: { none: {} } } });
  }, prisma);
  return { purged: rows.length };
}
