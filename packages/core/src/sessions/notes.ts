import { appendAudit, type Prisma, type TenantTx } from '@kinetic/db';
import type { ActorContext } from '../authz/actor';
import { assertCan } from '../authz/policies';
import { DomainError } from '../errors';
import { isUuid } from '../uuid';
import { sessionScope } from './read';

export const NOTE_MAX = 500;
export const NOTES_PER_SESSION_MAX = 100;

export interface SessionNoteView {
  id: string;
  workoutVersionExerciseId: string;
  /** null = the whole exercise. */
  setIndex: number | null;
  body: string;
  authorRole: 'client' | 'coach';
  authorName: string;
  createdAt: string;
}

const notFound = () => new DomainError('NOT_FOUND', 'Not found.');
const invalid = (field: string, message: string) =>
  new DomainError('VALIDATION', 'Some fields are invalid.', { [field]: [message] });

/** A session's notes, oldest first (PRD D9). Callers have already checked access to the session. */
export async function notesForSession(tx: TenantTx, sessionId: string): Promise<SessionNoteView[]> {
  const rows = await tx.sessionNote.findMany({
    where: { sessionId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  const names = new Map(
    (
      await tx.user.findMany({
        where: { id: { in: [...new Set(rows.map((r) => r.authorUserId))] } },
        select: { id: true, name: true },
      })
    ).map((u) => [u.id, u.name]),
  );
  return rows.map((r) => ({
    id: r.id,
    workoutVersionExerciseId: r.workoutVersionExerciseId,
    setIndex: r.setIndex,
    body: r.body,
    authorRole: r.authorRole as 'client' | 'coach',
    authorName: names.get(r.authorUserId) ?? (r.authorRole === 'coach' ? 'Coach' : 'Client'),
    createdAt: r.createdAt.toISOString(),
  }));
}

/**
 * Adds a note to an exercise (or one of its sets) in a started or finished session (PRD D9): the client on their own
 * session, or a coach on any client's, so a coach's note reads as a reply. Notes cannot be edited or deleted.
 */
export async function addSessionNote(
  tx: TenantTx,
  actor: ActorContext,
  sessionId: string,
  input: { workoutVersionExerciseId?: unknown; setIndex?: unknown; body?: unknown },
  opts: { requestId?: string } = {},
): Promise<SessionNoteView> {
  assertCan(actor, 'session:log');
  if (!isUuid(sessionId) || !isUuid(input.workoutVersionExerciseId)) throw notFound();
  const body = typeof input.body === 'string' ? input.body.trim() : '';
  if (body.length < 1 || body.length > NOTE_MAX)
    throw invalid('body', `Use 1-${NOTE_MAX} characters.`);
  let setIndex: number | null = null;
  if (input.setIndex !== undefined && input.setIndex !== null) {
    if (
      typeof input.setIndex !== 'number' ||
      !Number.isInteger(input.setIndex) ||
      input.setIndex < 0 ||
      input.setIndex > 19
    ) {
      throw invalid('setIndex', 'Pick a set.');
    }
    setIndex = input.setIndex;
  }
  const session = await tx.workoutSession.findFirst({
    where: { id: sessionId, ...sessionScope(actor), state: { not: 'cancelled' } },
    select: { id: true, state: true, workoutVersionId: true },
  });
  if (!session) throw notFound();
  if (!session.workoutVersionId)
    throw new DomainError('CONFLICT', 'Start the workout to add a note.');
  const wve = await tx.workoutVersionExercise.findFirst({
    where: { id: input.workoutVersionExerciseId, workoutVersionId: session.workoutVersionId },
    select: { id: true },
  });
  if (!wve) throw notFound();
  if ((await tx.sessionNote.count({ where: { sessionId: session.id } })) >= NOTES_PER_SESSION_MAX) {
    throw invalid('body', `A workout can have at most ${NOTES_PER_SESSION_MAX} notes.`);
  }
  const row = await tx.sessionNote.create({
    data: {
      sessionId: session.id,
      workoutVersionExerciseId: wve.id,
      setIndex,
      body,
      authorUserId: actor.userId,
      authorRole: actor.role === 'client' ? 'client' : 'coach',
    } as Prisma.SessionNoteUncheckedCreateInput,
  });
  // Content-free audit (D-008 #16): ids only, never the note.
  await appendAudit(tx, {
    orgId: actor.orgId,
    actorId: actor.userId,
    objectType: 'workout_session',
    objectId: session.id,
    action: 'session.note_added',
    metadata: { noteId: row.id },
    requestId: opts.requestId,
  });
  return (await notesForSession(tx, session.id)).find((n) => n.id === row.id)!;
}
