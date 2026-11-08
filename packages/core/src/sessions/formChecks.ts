import { appendAudit, type TenantTx } from '@repsy/db';
import type { ActorContext } from '../authz/actor';
import { assertCan } from '../authz/policies';
import { DomainError } from '../errors';
import { ownMedia } from '../media/media';
import { isUuid } from '../uuid';
import { sessionScope } from './read';

/** PRD D10: a short form-check video on a session, on one of its exercises; shown in the coach's review. */
export interface FormCheckView {
  id: string;
  mediaId: string;
  workoutVersionExerciseId: string | null;
  createdAt: string;
}

/** At most this many videos per session. */
export const FORM_CHECKS_PER_SESSION = 10;

const notFound = () => new DomainError('NOT_FOUND', 'Not found.');

export async function addFormCheck(
  tx: TenantTx,
  actor: ActorContext,
  sessionId: unknown,
  input: { mediaId?: unknown; workoutVersionExerciseId?: unknown },
  opts: { requestId?: string } = {},
): Promise<FormCheckView> {
  assertCan(actor, 'session:log');
  if (!isUuid(sessionId)) throw notFound();
  const session = await tx.workoutSession.findFirst({
    where: { id: sessionId, ...sessionScope(actor), state: { not: 'cancelled' } },
    select: { id: true, clientId: true, workoutVersionId: true },
  });
  if (!session) throw notFound();
  if (!session.workoutVersionId) {
    throw new DomainError('CONFLICT', 'Start the workout before adding a video.');
  }
  let wveId: string | null = null;
  if (input.workoutVersionExerciseId !== undefined && input.workoutVersionExerciseId !== null) {
    const wve = isUuid(input.workoutVersionExerciseId)
      ? await tx.workoutVersionExercise.findFirst({
          where: { id: input.workoutVersionExerciseId, workoutVersionId: session.workoutVersionId },
          select: { id: true },
        })
      : null;
    if (!wve) throw notFound();
    wveId = wve.id;
  }
  if (
    (await tx.sessionMedia.count({ where: { sessionId: session.id } })) >= FORM_CHECKS_PER_SESSION
  ) {
    throw new DomainError('VALIDATION', 'Some fields are invalid.', {
      file: [`At most ${FORM_CHECKS_PER_SESSION} videos per workout.`],
    });
  }
  const mediaId = await ownMedia(tx, actor, input.mediaId, 'form_check', session.clientId);
  const row = await tx.sessionMedia.create({
    data: { sessionId: session.id, workoutVersionExerciseId: wveId, mediaId },
  } as Parameters<typeof tx.sessionMedia.create>[0]);
  await appendAudit(tx, {
    orgId: actor.orgId,
    actorId: actor.userId,
    objectType: 'session',
    objectId: session.id,
    action: 'session.form_check_added',
    metadata: { clientId: session.clientId },
    requestId: opts.requestId,
  });
  return {
    id: row.id,
    mediaId,
    workoutVersionExerciseId: wveId,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function formChecksFor(tx: TenantTx, sessionId: string): Promise<FormCheckView[]> {
  const rows = await tx.sessionMedia.findMany({
    where: { sessionId, media: { is: { erasedAt: null } } },
    orderBy: { createdAt: 'asc' },
    select: { id: true, mediaId: true, workoutVersionExerciseId: true, createdAt: true },
  });
  return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
}
