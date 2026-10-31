import { appendAudit, type TenantTx } from '@kinetic/db';
import type { ActorContext } from '../authz/actor';
import { assertCan } from '../authz/policies';
import { DomainError } from '../errors';
import { isUuid } from '../uuid';

/** At most this many alternatives per exercise (PRD C4). */
export const MAX_ALTERNATIVES = 5;

export interface AlternativeView {
  exerciseId: string;
  name: string;
  trackingType: string;
}

const notFound = () => new DomainError('NOT_FOUND', 'Not found.');
const invalid = (message: string) =>
  new DomainError('VALIDATION', 'Some fields are invalid.', { alternativeIds: [message] });

/** Alternatives per exercise id, in the coach's order. No authorization: callers have already checked access. */
export async function alternativesFor(
  tx: TenantTx,
  exerciseIds: string[],
): Promise<Record<string, AlternativeView[]>> {
  const ids = [...new Set(exerciseIds)];
  if (ids.length === 0) return {};
  const rows = await tx.exerciseAlternative.findMany({
    where: { exerciseId: { in: ids } },
    orderBy: [{ exerciseId: 'asc' }, { position: 'asc' }],
    select: {
      exerciseId: true,
      alternative: { select: { id: true, name: true, trackingType: true } },
    },
  });
  const out: Record<string, AlternativeView[]> = {};
  for (const r of rows) {
    (out[r.exerciseId] ??= []).push({
      exerciseId: r.alternative.id,
      name: r.alternative.name,
      trackingType: r.alternative.trackingType,
    });
  }
  return out;
}

/** The coach's alternatives for one exercise (catalog or custom). */
export async function listAlternatives(
  tx: TenantTx,
  actor: ActorContext,
  exerciseId: string,
): Promise<AlternativeView[]> {
  assertCan(actor, 'exercise:read');
  if (!isUuid(exerciseId)) throw notFound();
  const ex = await tx.exercise.findFirst({ where: { id: exerciseId }, select: { id: true } });
  if (!ex) throw notFound();
  return (await alternativesFor(tx, [ex.id]))[ex.id] ?? [];
}

/**
 * Replaces an exercise's alternatives for this workspace (PRD C4): up to 5, in order, each a different exercise
 * with the same tracking type, so the planned sets still make sense for it.
 */
export async function setAlternatives(
  tx: TenantTx,
  actor: ActorContext,
  exerciseId: string,
  alternativeIds: unknown,
  opts: { requestId?: string } = {},
): Promise<AlternativeView[]> {
  assertCan(actor, 'exercise:create');
  if (!isUuid(exerciseId)) throw notFound();
  if (!Array.isArray(alternativeIds) || !alternativeIds.every((x) => typeof x === 'string')) {
    throw invalid('Send a list of exercise ids.');
  }
  const ids = alternativeIds as string[];
  if (ids.length > MAX_ALTERNATIVES) throw invalid(`Choose at most ${MAX_ALTERNATIVES}.`);
  if (new Set(ids).size !== ids.length) throw invalid('Each alternative can be listed once.');
  if (ids.includes(exerciseId)) throw invalid('An exercise cannot be its own alternative.');
  const ex = await tx.exercise.findFirst({
    where: { id: exerciseId },
    select: { id: true, trackingType: true },
  });
  if (!ex) throw notFound();
  const found = ids.length
    ? await tx.exercise.findMany({
        where: { id: { in: ids.filter(isUuid) } },
        select: { id: true, trackingType: true },
      })
    : [];
  if (found.length !== ids.length) throw invalid('Choose exercises from your library.');
  if (found.some((f) => f.trackingType !== ex.trackingType)) {
    throw invalid('Alternatives must be tracked the same way (reps, time or distance).');
  }
  await tx.exerciseAlternative.deleteMany({ where: { exerciseId: ex.id } });
  if (ids.length) {
    await tx.exerciseAlternative.createMany({
      data: ids.map((alternativeExerciseId, position) => ({
        exerciseId: ex.id,
        alternativeExerciseId,
        position,
      })) as never,
    });
  }
  await appendAudit(tx, {
    orgId: actor.orgId,
    actorId: actor.userId,
    objectType: 'exercise',
    objectId: ex.id,
    action: 'exercise.alternatives_set',
    metadata: { count: ids.length },
    requestId: opts.requestId,
  });
  return (await alternativesFor(tx, [ex.id]))[ex.id] ?? [];
}
