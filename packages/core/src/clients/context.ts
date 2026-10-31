import { appendAudit, type TenantTx } from '@kinetic/db';
import type { ActorContext } from '../authz/actor';
import { assertCan } from '../authz/policies';
import { DomainError } from '../errors';
import { isUuid } from '../uuid';
import { GOALS_MAX } from './clients';

export const CONTEXT_FIELD_MAX = 1000;
export const PINNED_NOTES_MAX = 3;
const FIELDS = ['motivation', 'scheduleNotes', 'equipmentNotes', 'preferences'] as const;
type ContextField = (typeof FIELDS)[number];

export interface ClientContext {
  clientId: string;
  goals: string | null;
  motivation: string | null;
  scheduleNotes: string | null;
  equipmentNotes: string | null;
  preferences: string | null;
  /** Up to 3 notes pinned to the card, most recently pinned first. */
  pinnedNotes: { id: string; body: string; authorName: string; pinnedAt: string }[];
}

export type ClientContextInput = Partial<Record<ContextField | 'goals', unknown>>;

const notFound = () => new DomainError('NOT_FOUND', 'Not found.');
const invalid = (field: string, message: string) =>
  new DomainError('VALIDATION', 'Some fields are invalid.', { [field]: [message] });

/**
 * The client context card (PRD B7): what a coach should remember about this client. Coaches and owners only: it never
 * reaches a client view (note:read is coach-only).
 */
export async function getClientContext(
  tx: TenantTx,
  actor: ActorContext,
  clientId: string,
): Promise<ClientContext> {
  assertCan(actor, 'note:read');
  if (!isUuid(clientId)) throw notFound();
  const c = await tx.client.findFirst({
    where: { id: clientId },
    select: {
      id: true,
      goals: true,
      motivation: true,
      scheduleNotes: true,
      equipmentNotes: true,
      preferences: true,
    },
  });
  if (!c) throw notFound();
  const pinned = await tx.internalNote.findMany({
    where: { clientId: c.id, pinnedAt: { not: null } },
    orderBy: [{ pinnedAt: 'desc' }, { id: 'desc' }],
    take: PINNED_NOTES_MAX,
    select: { id: true, body: true, pinnedAt: true, author: { select: { name: true } } },
  });
  return {
    clientId: c.id,
    goals: c.goals,
    motivation: c.motivation,
    scheduleNotes: c.scheduleNotes,
    equipmentNotes: c.equipmentNotes,
    preferences: c.preferences,
    pinnedNotes: pinned.map((n) => ({
      id: n.id,
      body: n.body,
      authorName: n.author?.name ?? 'Coach',
      pinnedAt: (n.pinnedAt as Date).toISOString(),
    })),
  };
}

/** Updates the fields given; an empty string clears one (PRD B7). */
export async function updateClientContext(
  tx: TenantTx,
  actor: ActorContext,
  clientId: string,
  input: ClientContextInput,
  opts: { requestId?: string } = {},
): Promise<ClientContext> {
  assertCan(actor, 'client:update');
  assertCan(actor, 'note:read');
  if (!isUuid(clientId)) throw notFound();
  const exists = await tx.client.findFirst({ where: { id: clientId }, select: { id: true } });
  if (!exists) throw notFound();
  const data: Record<string, string | null> = {};
  for (const field of ['goals', ...FIELDS] as const) {
    const v = input[field];
    if (v === undefined) continue;
    if (v !== null && typeof v !== 'string') throw invalid(field, 'Use text.');
    const text = v === null ? '' : v.trim();
    const max = field === 'goals' ? GOALS_MAX : CONTEXT_FIELD_MAX;
    if (text.length > max) throw invalid(field, `Use at most ${max} characters.`);
    data[field] = text === '' ? null : text;
  }
  if (Object.keys(data).length > 0) {
    await tx.client.update({ where: { id: exists.id }, data });
    // Ids and field names only: never the text (D-007).
    await appendAudit(tx, {
      orgId: actor.orgId,
      actorId: actor.userId,
      objectType: 'client',
      objectId: exists.id,
      action: 'client.context_updated',
      requestId: opts.requestId,
      metadata: { fields: Object.keys(data).join(',') },
    });
  }
  return getClientContext(tx, actor, exists.id);
}

/** Pins a private note to the client's context card, or unpins it (PRD B7). At most 3 pinned per client. */
export async function setNotePinned(
  tx: TenantTx,
  actor: ActorContext,
  noteId: string,
  pinned: boolean,
): Promise<ClientContext> {
  assertCan(actor, 'note:write');
  if (!isUuid(noteId)) throw notFound();
  const note = await tx.internalNote.findFirst({
    where: { id: noteId },
    select: { id: true, clientId: true, pinnedAt: true },
  });
  if (!note) throw notFound();
  if (pinned && !note.pinnedAt) {
    const count = await tx.internalNote.count({
      where: { clientId: note.clientId, pinnedAt: { not: null } },
    });
    if (count >= PINNED_NOTES_MAX) {
      throw new DomainError(
        'CONFLICT',
        `Unpin a note first: at most ${PINNED_NOTES_MAX} can be pinned.`,
      );
    }
    await tx.internalNote.update({ where: { id: note.id }, data: { pinnedAt: new Date() } });
  } else if (!pinned && note.pinnedAt) {
    await tx.internalNote.update({ where: { id: note.id }, data: { pinnedAt: null } });
  }
  return getClientContext(tx, actor, note.clientId);
}
