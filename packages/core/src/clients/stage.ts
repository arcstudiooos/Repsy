import { appendAudit, type TenantTx } from '@repsy/db';
import { emitClientEvent } from '../automations/events';
import type { ActorContext } from '../authz/actor';
import { assertCan } from '../authz/policies';
import { DomainError } from '../errors';
import { isUuid } from '../uuid';
import { SETTABLE_STAGES, type LifecycleStage, type SettableStage } from './stage-labels';

export {
  LIFECYCLE_STAGES,
  SETTABLE_STAGES,
  STAGE_LABEL,
  type LifecycleStage,
  type SettableStage,
} from './stage-labels';

/**
 * PRD B20: where a client is in their coaching. The coach sets Onboarding, Active or At renewal; Paused and Alumni
 * follow the client's status (an open pause, archived), so the stage never contradicts it. The first completed
 * workout moves Onboarding to Active on its own.
 */
export function effectiveStage(row: { status: string; lifecycleStage: string }): LifecycleStage {
  if (row.status === 'archived') return 'alumni';
  if (row.status === 'paused') return 'paused';
  return (SETTABLE_STAGES as readonly string[]).includes(row.lifecycleStage)
    ? (row.lifecycleStage as SettableStage)
    : 'onboarding';
}

/** The `where` for clients in `stage`. */
export function stageWhere(stage: LifecycleStage): Record<string, unknown> {
  if (stage === 'alumni') return { status: 'archived' };
  if (stage === 'paused') return { status: 'paused' };
  return { lifecycleStage: stage, status: { notIn: ['archived', 'paused'] } };
}

export async function setLifecycleStage(
  tx: TenantTx,
  actor: ActorContext,
  clientId: unknown,
  stage: unknown,
  opts: { requestId?: string } = {},
): Promise<LifecycleStage> {
  assertCan(actor, 'client:update');
  if (!isUuid(clientId)) throw new DomainError('NOT_FOUND', 'Client not found.');
  if (!(SETTABLE_STAGES as readonly unknown[]).includes(stage)) {
    throw new DomainError('VALIDATION', 'Some fields are invalid.', {
      stage: ['Pick Onboarding, Active or At renewal.'],
    });
  }
  const client = await tx.client.findFirst({
    where: { id: clientId },
    select: { id: true, status: true, lifecycleStage: true },
  });
  if (!client) throw new DomainError('NOT_FOUND', 'Client not found.');
  if (client.status === 'archived' || client.status === 'paused') {
    throw new DomainError('CONFLICT', 'Paused and archived clients follow their status.');
  }
  if (client.lifecycleStage !== stage) {
    await tx.client.update({ where: { id: client.id }, data: { lifecycleStage: stage as string } });
    await appendAudit(tx, {
      orgId: actor.orgId,
      actorId: actor.userId,
      objectType: 'client',
      objectId: client.id,
      action: 'client.stage_changed',
      metadata: { clientId: client.id, from: client.lifecycleStage, to: stage as string },
      requestId: opts.requestId,
    });
    await emitClientEvent(tx, client.id, 'stage_changed', { stage: stage as string });
  }
  return stage as SettableStage;
}

/** After a completed workout: Onboarding becomes Active (no audit; the completion is audited). */
export async function promoteOnFirstCompletion(tx: TenantTx, clientId: string): Promise<void> {
  await tx.client.updateMany({
    where: { id: clientId, lifecycleStage: 'onboarding' },
    data: { lifecycleStage: 'active' },
  });
}
