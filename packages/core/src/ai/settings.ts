import type { TenantTx } from '@kinetic/db';
import type { ActorContext } from '../authz/actor';
import { assertCan } from '../authz/policies';
import { DomainError } from '../errors';

/**
 * Per-workspace opt-in for the AI assistant. OFF by default: no row, or `aiEnabled: false`, means the
 * assistant refuses to run and no workspace data is sent to the AI provider.
 */
export interface AiSettingView {
  aiEnabled: boolean;
  provider: string;
  /** PRD I15 actions: the assistant may propose changes the coach confirms. OFF by default. */
  actionsEnabled: boolean;
}

export async function getAiSetting(tx: TenantTx, actor: ActorContext): Promise<AiSettingView> {
  assertCan(actor, 'org:read');
  const row = await tx.aiSetting.findFirst({
    where: { organizationId: actor.orgId },
    select: { aiEnabled: true, provider: true, actionsEnabled: true },
  });
  return row ?? { aiEnabled: false, provider: 'anthropic', actionsEnabled: false };
}

/** Workspace opt-in toggle. Managers only (`settings:org:update`), like other workspace settings. */
export async function setAiSetting(
  tx: TenantTx,
  actor: ActorContext,
  aiEnabled: boolean,
): Promise<AiSettingView> {
  assertCan(actor, 'settings:org:update');
  const row = await tx.aiSetting.upsert({
    where: { organizationId: actor.orgId },
    create: { organizationId: actor.orgId, aiEnabled, provider: 'anthropic' },
    update: { aiEnabled, provider: 'anthropic' },
    select: { aiEnabled: true, provider: true, actionsEnabled: true },
  });
  return row;
}

/** Lets the assistant propose changes (each still needs the coach's Confirm). Managers only. */
export async function setAiActionsEnabled(
  tx: TenantTx,
  actor: ActorContext,
  actionsEnabled: boolean,
): Promise<AiSettingView> {
  assertCan(actor, 'settings:org:update');
  return tx.aiSetting.upsert({
    where: { organizationId: actor.orgId },
    create: {
      organizationId: actor.orgId,
      aiEnabled: false,
      provider: 'anthropic',
      actionsEnabled,
    },
    update: { actionsEnabled },
    select: { aiEnabled: true, provider: true, actionsEnabled: true },
  });
}

export async function assertAiEnabled(tx: TenantTx, actor: ActorContext): Promise<void> {
  const setting = await getAiSetting(tx, actor);
  if (!setting.aiEnabled) {
    throw new DomainError(
      'FORBIDDEN',
      'The AI assistant is off for this workspace. An owner or admin can turn it on in Settings.',
    );
  }
}
