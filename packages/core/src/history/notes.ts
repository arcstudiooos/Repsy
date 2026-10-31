import { appendAudit, type TenantTx } from '@kinetic/db';
import type { ActorContext } from '../authz/actor';
import { assertCan } from '../authz/policies';
import { DomainError } from '../errors';
import { isUuid } from '../uuid';

export const NOTE_MAX = 4000;

const notFound = () => new DomainError('NOT_FOUND', 'Not found.');
const invalid = (field: string, message: string) =>
  new DomainError('VALIDATION', 'Some fields are invalid.', { [field]: [message] });

export interface NoteView {
  id: string;
  clientId: string;
  authorUserId: string;
  authorName: string;
  /** The acting coach wrote it (only the author edits or deletes, Ruling 7). */
  mine: boolean;
  body: string;
  /** Pinned to the client context card (PRD B7). */
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
}

const SELECT = {
  id: true,
  clientId: true,
  authorUserId: true,
  body: true,
  pinnedAt: true,
  createdAt: true,
  updatedAt: true,
  author: { select: { name: true } },
} as const;

type Row = {
  id: string;
  clientId: string;
  authorUserId: string;
  body: string;
  pinnedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  author: { name: string } | null;
};

const toView = (r: Row, actor: ActorContext): NoteView => ({
  id: r.id,
  clientId: r.clientId,
  authorUserId: r.authorUserId,
  authorName: r.author?.name ?? 'Coach',
  mine: r.authorUserId === actor.userId,
  body: r.body,
  pinned: r.pinnedAt !== null,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
});

function cleanBody(body: unknown): string {
  const b = typeof body === 'string' ? body.trim() : '';
  if (b.length < 1) throw invalid('body', 'Write a note.');
  if (b.length > NOTE_MAX) throw invalid('body', `Use at most ${NOTE_MAX} characters.`);
  return b;
}

async function assertClient(tx: TenantTx, clientId: string) {
  if (!isUuid(clientId)) throw notFound();
  const c = await tx.client.findFirst({ where: { id: clientId }, select: { id: true } });
  if (!c) throw notFound();
}

/** A client's private notes, newest first. Coach/owner only (a client actor is FORBIDDEN). */
export async function listNotes(
  tx: TenantTx,
  actor: ActorContext,
  clientId: string,
): Promise<NoteView[]> {
  assertCan(actor, 'note:read');
  await assertClient(tx, clientId);
  const rows = await tx.internalNote.findMany({
    where: { clientId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 200,
    select: SELECT,
  });
  return rows.map((r) => toView(r, actor));
}

export async function createNote(
  tx: TenantTx,
  actor: ActorContext,
  clientId: string,
  input: { body?: unknown },
  opts: { requestId?: string } = {},
): Promise<NoteView> {
  assertCan(actor, 'note:write');
  await assertClient(tx, clientId);
  const row = await tx.internalNote.create({
    data: { clientId, authorUserId: actor.userId, body: cleanBody(input.body) } as never,
    select: SELECT,
  });
  await appendAudit(tx, {
    orgId: actor.orgId,
    actorId: actor.userId,
    objectType: 'internal_note',
    objectId: row.id,
    action: 'internal_note.created',
    metadata: { clientId },
    requestId: opts.requestId,
  });
  return toView(row, actor);
}

async function ownNote(tx: TenantTx, actor: ActorContext, noteId: string) {
  if (!isUuid(noteId)) throw notFound();
  const note = await tx.internalNote.findFirst({ where: { id: noteId }, select: SELECT });
  if (!note) throw notFound();
  if (note.authorUserId !== actor.userId) {
    throw new DomainError('FORBIDDEN', 'Only the coach who wrote this note can change it.');
  }
  return note;
}

export async function updateNote(
  tx: TenantTx,
  actor: ActorContext,
  noteId: string,
  input: { body?: unknown },
  opts: { requestId?: string } = {},
): Promise<NoteView> {
  assertCan(actor, 'note:write');
  const note = await ownNote(tx, actor, noteId);
  const row = await tx.internalNote.update({
    where: { id: note.id },
    data: { body: cleanBody(input.body) },
    select: SELECT,
  });
  await appendAudit(tx, {
    orgId: actor.orgId,
    actorId: actor.userId,
    objectType: 'internal_note',
    objectId: note.id,
    action: 'internal_note.updated',
    metadata: { clientId: note.clientId },
    requestId: opts.requestId,
  });
  return toView(row, actor);
}

export async function deleteNote(
  tx: TenantTx,
  actor: ActorContext,
  noteId: string,
  opts: { requestId?: string } = {},
): Promise<void> {
  assertCan(actor, 'note:write');
  const note = await ownNote(tx, actor, noteId);
  await tx.internalNote.delete({ where: { id: note.id } });
  await appendAudit(tx, {
    orgId: actor.orgId,
    actorId: actor.userId,
    objectType: 'internal_note',
    objectId: note.id,
    action: 'internal_note.deleted',
    metadata: { clientId: note.clientId },
    requestId: opts.requestId,
  });
}
