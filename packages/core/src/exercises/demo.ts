import { appendAudit, type TenantTx } from '@repsy/db';
import type { ActorContext } from '../authz/actor';
import { assertCan } from '../authz/policies';
import { DomainError } from '../errors';
import { eraseMedia, ownMedia } from '../media/media';
import { isUuid } from '../uuid';

/**
 * PRD C2: a coach uploads their own MP4 demo for one of the workspace's exercises (catalog exercises keep their
 * link). It replaces any earlier upload, which is erased; `null` removes it. Clients stream it like any demo.
 */
export async function setExerciseDemo(
  tx: TenantTx,
  actor: ActorContext,
  exerciseId: unknown,
  mediaId: unknown,
  options: { requestId?: string } = {},
): Promise<{ demoMediaId: string | null }> {
  assertCan(actor, 'exercise:create');
  const notFound = () => new DomainError('NOT_FOUND', 'Exercise not found.');
  if (!isUuid(exerciseId)) throw notFound();
  const exercise = await tx.exercise.findFirst({
    where: { id: exerciseId, organizationId: actor.orgId },
    select: { id: true, demoMediaId: true },
  });
  if (!exercise) throw notFound();
  const next = mediaId === null ? null : await ownMedia(tx, actor, mediaId, 'exercise_demo', null);
  if (next === exercise.demoMediaId) return { demoMediaId: next };
  await tx.exercise.update({ where: { id: exercise.id }, data: { demoMediaId: next } });
  if (exercise.demoMediaId) await eraseMedia(tx, [exercise.demoMediaId]);
  await appendAudit(tx, {
    orgId: actor.orgId,
    actorId: actor.userId,
    objectType: 'exercise',
    objectId: exercise.id,
    action: next ? 'exercise.demo_uploaded' : 'exercise.demo_removed',
    requestId: options.requestId,
  });
  return { demoMediaId: next };
}
